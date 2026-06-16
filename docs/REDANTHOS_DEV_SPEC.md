# Red Anthos Dev — Build Spec: Accounts, Auth & Billing for LeadCatch

Audience: the **Red Anthos Dev** team. This is the contract Red Anthos must implement so
the LeadCatch HubSpot app can do account-first onboarding. LeadCatch-side work is tracked
separately in `docs/ONBOARDING_PLAN.md`.

**TL;DR for Red Anthos:** you build (1) a hosted login/signup page, (2) a signed handoff
JWT that includes a Stripe `customer` id, and (3) a fallback endpoint to look that customer
up by account. You own user accounts and the Stripe **customer** object. You do **not**
touch pricing, Checkout, subscriptions, or usage — LeadCatch owns all of that. You and
LeadCatch share **one Stripe account** (confirmed).

## Decisions locked

- **Handoff:** Red Anthos proves an authenticated account to LeadCatch with a **short-lived
  signed JWT**.
- **Identity model:** strict **1 Red Anthos account → 1 Stripe customer → 1 HubSpot portal**.
- **Billing ownership:** **Red Anthos owns the Stripe customer** (the cross-product
  identity); **LeadCatch owns tier selection, pricing, and Checkout.** Red Anthos creates
  the customer and hands its `stripe_customer_id` to LeadCatch; LeadCatch runs the per-tier
  Stripe Checkout against that existing customer, owns the subscription lifecycle for the
  LeadCatch product, and reports metered per-lead usage. Red Anthos does **not** run
  LeadCatch's Checkout or own its pricing.
- **No free trial — pay at install.** Website pricing must match the HubSpot Marketplace
  listing exactly (4 tiers: Starter / Growth / Pro / Enterprise).
- **Shared Stripe account (confirmed):** LeadCatch and Red Anthos operate on the **same
  Stripe account**, so LeadCatch can run Checkout and post usage against the customer
  Red Anthos creates.

## Responsibility split

| Capability | Owner |
|---|---|
| Login/signup UI, password, session, account store | **Red Anthos** |
| Stripe **customer** creation & storage (cross-product identity) | **Red Anthos** |
| Pricing page + tier selection + Stripe **Checkout** | **LeadCatch** |
| Subscription lifecycle for LeadCatch (Stripe webhooks → status) | **LeadCatch** |
| HubSpot OAuth, portal tokens, lead pipeline | **LeadCatch** |
| Gate: process leads only if subscription active | **LeadCatch** |
| Metered usage: report 1 unit per processed lead | **LeadCatch** → Stripe |

---

## 1. Hosted login/signup page

A page LeadCatch can redirect the browser to during install, e.g.
`https://accounts.redanthos.dev/login`.

Accepts query params:
- `return_to` (required) — absolute LeadCatch URL to redirect back to after auth.
- `product` (required) — `leadcatch` (so Red Anthos knows which product context).
- `tier` (optional) — preselected tier from the pricing page.

After the user authenticates (or signs up), redirect the browser to `return_to` with a
signed **handoff JWT** appended as `?ra_token=<jwt>` (see §2).

Must be safe to load in an embedded browser context (HubSpot frames the install flow).

## 2. Handoff JWT (the trust contract)

A compact JWT, signed by Red Anthos, that LeadCatch verifies to trust the account.

**Signing:** RS256 with a Red Anthos private key; expose the public key via a JWKS URL
(`https://accounts.redanthos.dev/.well-known/jwks.json`) so LeadCatch verifies without a
shared secret. (HS256 with a shared secret is acceptable as a simpler v1 if a JWKS is too
much — state which.)

**Claims:**
```
{
  "iss": "https://accounts.redanthos.dev",
  "aud": "leadcatch",
  "sub": "<redanthos_account_id>",   // stable, opaque, never reused
  "email": "<account email>",
  "exp": <now + 5 min>,              // short-lived
  "iat": <now>,
  "jti": "<unique id>",              // for replay protection
  "tier": "starter|growth|pro|enterprise",  // optional, if chosen pre-install
  "stripe_customer_id": "cus_..."   // the account's Stripe customer (lets LeadCatch skip the §3 call)
}
```

LeadCatch will verify: signature, `iss`, `aud`, `exp`, and reject reused `jti`.
`sub` is the durable identity LeadCatch stores against the HubSpot portal.
Including `stripe_customer_id` here means LeadCatch can run Checkout immediately without
calling §3 in the common path.

## 3. Stripe customer lookup (LeadCatch reads this)

LeadCatch owns the LeadCatch subscription, but **Red Anthos owns the Stripe customer**.
So LeadCatch needs to resolve a Red Anthos account to its `stripe_customer_id`, then run
its own per-tier Checkout against that existing customer (rather than creating a new one).

Most of the time the `stripe_customer_id` arrives in the handoff JWT (§2) and no call is
needed. This endpoint is the fallback / source of truth:

`GET https://api.redanthos.dev/v1/accounts/<account_id>/stripe-customer`

Auth: service-to-service (LeadCatch → Red Anthos) — a Red Anthos-issued API key or
mTLS. Specify which.

Response:
```
{
  "account_id": "...",
  "email": "...",
  "stripe_customer_id": "cus_..."   // create on demand if the account has none yet
}
```

LeadCatch then passes this `customer` into `checkout.sessions.create` and stores it on its
own billing record. LeadCatch — not Red Anthos — tracks subscription status/tier from its
own Stripe webhooks; Red Anthos does not need a subscription-status endpoint.

## 4. Metered usage reporting (LeadCatch → Stripe, no Red Anthos involvement)

LeadCatch reports 1 metered unit per billed lead **directly to Stripe** using the
account's `stripe_customer_id` (from the JWT or §3). It calls
`stripe.billing.meterEvents.create` (`event_name: lead_processed`) with
`identifier=<hubspot messageId>` for idempotency — Cloud Tasks may retry, and this prevents
double-billing. **Red Anthos does not handle usage.** Red Anthos only needs to ensure the
Stripe customer exists; LeadCatch owns the meter and the metered prices. (Already
implemented in LeadCatch.)

> Note on Stripe API keys: usage events post to the customer Red Anthos created. LeadCatch
> and Red Anthos operate on the **same Stripe account** (confirmed), so this works as long
> as LeadCatch's `STRIPE_SECRET_KEY` and Red Anthos's Stripe key target that one account.

## 5. Pricing & Checkout — owned by LeadCatch (not Red Anthos)

Under this model LeadCatch keeps the billing UI and logic it already has:

- LeadCatch owns the pricing/tier selection and runs Stripe **Checkout** against the
  Red Anthos-provided `stripe_customer_id` (passes it as `customer` instead of minting a
  new one).
- LeadCatch owns the Stripe **Product**, the 8 per-tier prices (a flat **base** price + a
  graduated **overage** metered price each), the single `lead_processed` meter, and its own
  Stripe webhook for subscription status/tier. Pricing is **base + included quota +
  overage** (4 tiers; source of truth `docs/pricing.md`) — the included quota is free, only
  usage past it is billed. None of this is Red Anthos's concern beyond providing the customer.
- **Red Anthos provides only the customer.** It does not run Checkout or store LeadCatch
  pricing.
- The LeadCatch website pricing page **must match the HubSpot Marketplace listing pricing
  exactly** (a HubSpot listing requirement) — but this page is LeadCatch's, not a central
  Red Anthos pricing page.

## 6. Identity linking (LeadCatch-side — context for Red Anthos)

LeadCatch stores the link `account_id (sub) ↔ portalId` and enforces the **1:1:1** rule:
one Red Anthos account maps to exactly one HubSpot portal. Red Anthos doesn't store this
link, but should be aware of the boundary:

- If an account that's already linked to a portal tries to install on a **second** portal,
  LeadCatch rejects it (an account can't run two LeadCatch installs). Red Anthos doesn't
  need to handle this, but support/UX copy should reflect that a separate account is needed
  per portal.
- `sub` must be **stable for the life of the account** — LeadCatch keys the portal link on
  it. Don't recycle or change it.

---

## End-to-end flows (for reference)

**Website install** (LeadCatch's pricing page)
1. LeadCatch pricing page → pick tier → sign in / create Red Anthos account (§1).
2. Red Anthos authenticates, ensures a Stripe customer exists, redirects back with the
   handoff JWT (§2) carrying `tier` + `stripe_customer_id`.
3. LeadCatch runs Stripe Checkout for the chosen tier against that customer (pay at
   install) → subscription `active`.
4. LeadCatch kicks off the HubSpot install (`/oauth/install`), completes OAuth, and links
   `portalId ↔ account_id` (1:1).

**Marketplace install** (HubSpot partner sign-in flow)
1. User clicks Install on the listing → HubSpot calls LeadCatch with `step=authorize`.
2. LeadCatch redirects to the Red Anthos login page (§1) with `return_to`.
3. User authenticates; Red Anthos ensures a Stripe customer, redirects back to LeadCatch
   with the handoff JWT (§2).
4. LeadCatch generates HubSpot `state`, returns to HubSpot; HubSpot calls `step=finalize`
   with `code`; LeadCatch exchanges tokens and links `portalId ↔ account_id`.
5. LeadCatch runs its own Checkout (§5) for the chosen tier against the account's customer.

## Open items for Red Anthos to decide

These are choices for the Red Anthos team; LeadCatch will adapt to whatever you pick.

1. JWT signing: RS256 + JWKS (preferred), or HS256 + shared secret for v1?
2. Service-to-service auth on §3 (Stripe customer lookup): API key or mTLS?
3. JWT can include `stripe_customer_id`, creating the customer on demand if the account
   has none yet? (If yes, LeadCatch skips the §3 call in the common path.)
4. Confirm `account_id` (`sub`) is stable for the account's lifetime and issued before the
   first handoff JWT.

Already settled (not open): identity model is 1:1:1; billing ownership is Red-Anthos-
customer / LeadCatch-everything-else; shared Stripe account; pay-at-install, no trial.
