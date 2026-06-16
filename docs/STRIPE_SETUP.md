# Stripe Billing Setup

How to configure Stripe so LeadCatch can gate access behind a paid subscription,
bill per-lead usage, and handle the cancel/uninstall lifecycle.

The billing model is a **flat monthly subscription** (gates access) **plus a metered
price** billed per lead processed. Usage is reported through Stripe **Billing Meters**.

There are **4 tiers** — Starter, Growth, Pro, Enterprise — modeled as **one Product**
with **a pair of Prices per tier** (a flat price + that tier's own metered price). All
tiers share the **same single meter** (`lead_processed`); only the per-lead *rate*
differs between their metered prices. Keeping tiers as prices on one product (not
separate products) is what lets customers upgrade/downgrade on the same subscription
with proration via the Billing Portal.

Do all of this in **Test mode** first, then repeat the product/price/webhook/meter
steps in **Live mode** (test-mode and live-mode objects are separate and have
different IDs).

> Env vars and secrets are managed outside `deploy.sh` (see the deploy convention).
> This doc only tells you what values to produce; it does not set them.

---

## 1. Create the meter

The meter aggregates the usage events the app sends and is what the metered price
bills against.

1. Stripe Dashboard → **Billing → Meters → Create meter**.
2. **Event name:** `lead_processed`
   — must match exactly; the app sends this string in `src/lib/stripe.ts`.
3. **Aggregation:** **Sum** of `value`.
4. **Value settings → Event payload key:** `value` (the app sends `value: '1'` per lead).
5. **Customer mapping → Customer ID key:** `stripe_customer_id` (the app sends this in
   the event payload).
6. Save. Note the meter's name — you'll attach a price to it next.

## 2. Create the product and per-tier prices

Pricing model: **base fee + included quota + overage** (source of truth:
`docs/pricing.md`). The included emails are **free**; only usage **beyond** the quota is
billed, at the tier's overage rate. The quota resets each billing period.

| Tier | Base / mo | Included emails | Overage $/email |
|---|---|---|---|
| Starter | $20.00 | 100 | $0.1500 |
| Growth | $79.00 | 1,000 | $0.1000 |
| Pro | $249.00 | 5,000 | $0.0600 |
| Enterprise | $750.00 | 25,000 | $0.0350 |

Create **one Product** with **two Prices per tier** (8 prices total). The "first N free"
behavior is configured entirely in the **metered price** (graduated tiers) — **no app
code does quota math**; LeadCatch reports every lead and Stripe applies the free band.

1. **Product catalog → Create product** (e.g. name `LeadCatch`).
2. For **each** tier — Starter, Growth, Pro, Enterprise — add two recurring prices on
   this same product:
   - **Flat (base) price:** recurring monthly, the tier's **Base** amount above.
     Copy its **Price ID**.
   - **Metered (overage) price:** recurring, **Usage-based**, **Graduated** pricing;
     **Meter:** the `lead_processed` meter from step 1. Configure **two graduated tiers**:
     - First tier: **up to [Included emails]** units → **$0** per unit (the free quota).
     - Second tier: **[Included emails]+1 and up** → the tier's **Overage** rate per unit.

     Example (Starter): first **100** units = $0, then **$0.15**/unit. Copy its **Price ID**.
3. You'll end up with 8 Price IDs. They map to env vars by tier (see step 6):

   | Tier | Flat env var | Metered env var |
   |---|---|---|
   | Starter | `STRIPE_PRICE_STARTER_FLAT` | `STRIPE_PRICE_STARTER_METERED` |
   | Growth | `STRIPE_PRICE_GROWTH_FLAT` | `STRIPE_PRICE_GROWTH_METERED` |
   | Pro | `STRIPE_PRICE_PRO_FLAT` | `STRIPE_PRICE_PRO_METERED` |
   | Enterprise | `STRIPE_PRICE_ENTERPRISE_FLAT` | `STRIPE_PRICE_ENTERPRISE_METERED` |

The app puts the selected tier's **flat + metered** prices as the two line items in the
Checkout session: the customer pays the base fee, and Stripe bills overage only for usage
past the included quota. (Env-var names are derived in code as
`STRIPE_PRICE_<TIER>_FLAT/_METERED` — they must match exactly.)

> **Graduated vs. volume:** use **graduated** (not "volume") pricing. Graduated charges
> the first N at $0 and only the *excess* at the overage rate — which is the intended
> "included quota then overage" behavior. Volume pricing would apply one rate to the
> entire month's usage based on the final total, which is **not** what we want.

## 3. Configure the Billing Portal

The Settings page "Manage subscription" button opens the Stripe Billing Portal so
customers can update cards and cancel.

1. **Settings → Billing → Customer portal**.
2. Enable **Customers can cancel subscriptions** (this is the supported cancel path —
   the app intentionally does *not* cancel on uninstall).
3. Enable **Customers can switch plans**, and add **all four tiers' prices** as the
   allowed products/prices. This is what lets a customer move Starter→Pro etc. in the
   portal with proration. The app re-derives the tier from the live price on the
   `customer.subscription.updated` webhook, so a portal-initiated switch updates the
   stored tier automatically.
4. Optionally enable updating payment methods / viewing invoices.
5. Save and **activate** the portal configuration.
6. **Copy the "Share link"** (the static login link, `https://billing.stripe.com/p/login/…`)
   → this is `STRIPE_PORTAL_LOGIN_URL`. The app uses it only as a **fallback** when it
   can't create a per-customer portal session (no Stripe customer yet, or a Stripe API
   error). The primary path is a session deep-link that pre-authenticates the customer;
   the static link requires an email-code login. **Note:** this link is mode-specific —
   the test-mode link differs from the live-mode one.

## 4. Register the webhook endpoint

1. **Developers → Webhooks → Add endpoint**.
2. **Endpoint URL:**
   `https://inbox-agent-483790599125.us-central1.run.app/billing/webhook`
   (your Cloud Run service URL + `/billing/webhook`).
3. **Events to send** — select exactly these (the only ones the handler processes):
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Save, then copy the endpoint's **Signing secret** (`whsec_...`) → this is
   `STRIPE_WEBHOOK_SECRET`.

> The app verifies this signature against the **raw** request body, which is why the
> webhook route is mounted before `express.json()`. Don't change that ordering.

## 5. Get the API key

1. **Developers → API keys**.
2. Copy the **Secret key** (`sk_test_...` in test mode, `sk_live_...` in live) →
   this is `STRIPE_SECRET_KEY`.

## 6. Environment variables

Set these on the Cloud Run service (per the deploy convention, **not** in `deploy.sh`):

| Variable | Value | Source |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` / `sk_live_…` | Step 5 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | Step 4 |
| `STRIPE_PRICE_STARTER_FLAT` | `price_…` | Step 2 |
| `STRIPE_PRICE_STARTER_METERED` | `price_…` | Step 2 |
| `STRIPE_PRICE_GROWTH_FLAT` | `price_…` | Step 2 |
| `STRIPE_PRICE_GROWTH_METERED` | `price_…` | Step 2 |
| `STRIPE_PRICE_PRO_FLAT` | `price_…` | Step 2 |
| `STRIPE_PRICE_PRO_METERED` | `price_…` | Step 2 |
| `STRIPE_PRICE_ENTERPRISE_FLAT` | `price_…` | Step 2 |
| `STRIPE_PRICE_ENTERPRISE_METERED` | `price_…` | Step 2 |
| `STRIPE_PORTAL_LOGIN_URL` | `https://billing.stripe.com/p/login/…`, optional | Step 3 (Billing Portal share link) |
| `STRIPE_DEFAULT_TIER` | `starter`\|`growth`\|`pro`\|`enterprise`, optional (default `starter`) | your choice |
| `BILLING_GRACE_DAYS` | integer, optional (default `14`) | your choice |

`STRIPE_DEFAULT_TIER` is the tier used when Checkout is reached without a `tier`
param — e.g. the post-install OAuth redirect. The Settings page always sends an
explicit tier from its plan picker.

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are credentials — store them in
Secret Manager and bind them, alongside the existing HubSpot secrets.

## 7. Firestore composite index

The grace-period sweep queries `/billing` with two filters, which Firestore requires
a composite index for. Create it once:

- **Collection:** `billing`
- **Fields:** `status` (Ascending) + `detached_at` (Ascending)

Easiest path: trigger `/journal/sync` once after deploy with a detached record
present; Firestore's error log will include a one-click "create index" link. Or
define it in `firestore.indexes.json` / the GCP Console up front.

---

## How the pieces connect (reference)

- **Signup:** HubSpot OAuth callback redirects new portals to `GET /billing/checkout`
  (no tier → `STRIPE_DEFAULT_TIER`); the Settings page sends `?tier=<chosen>`. The
  session uses that tier's flat + metered prices and carries `client_reference_id`,
  `metadata.portalId`, and `metadata.tier`.
- **Activation:** on `checkout.session.completed`, the webhook writes
  `/billing/{portalId}` with `status: active` and the Stripe customer/subscription IDs.
- **Gate:** the task handler checks billing status **before** AI extraction. Not
  `active`/`trialing` → audit `skipped_unpaid`, no AI or HubSpot cost.
- **Usage:** on each successful Contact write, the app calls
  `billing.meterEvents.create` with `identifier: messageId` (idempotent — Cloud Tasks
  retries never double-bill).
- **Cancel:** customer cancels in the Billing Portal →
  `customer.subscription.updated/deleted` → status flips → gate soft-blocks.
- **Uninstall:** marks billing `detached` (does **not** cancel Stripe). A reinstall
  within `BILLING_GRACE_DAYS` reattaches; otherwise the sweep cancels the subscription.

## Test-mode smoke test

1. Install the app on a HubSpot test portal → you should land on Stripe Checkout.
2. Pay with test card `4242 4242 4242 4242`, any future expiry/CVC.
3. Confirm `/billing/{portalId}` in Firestore shows `status: active`.
4. Send a test inbound email → confirm a Contact is created **and** a usage event
   appears under the meter (Billing → Meters → `lead_processed`).
5. In the Settings page, click **Manage subscription** → cancel in the portal →
   confirm status flips and the next lead is `skipped_unpaid`.


