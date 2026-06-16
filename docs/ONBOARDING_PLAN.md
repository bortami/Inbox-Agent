# Onboarding & Account-First Install — Plan

Status: **planning only** — no code in this repo yet. The Red Anthos account/auth
system is a prerequisite built in the **Red Anthos Dev** project, not here.

## Goal

Customers create/sign into a **Red Anthos account before the app activates**, from
both entry points:

- **Website** — Pricing page → sign in/create Red Anthos account → pick tier → install.
- **HubSpot Marketplace** — uses HubSpot's **partner sign-in install flow** so the
  account step happens during install (HubSpot calls our install URL with
  `step=authorize`, we show Red Anthos login, then `step=finalize` completes OAuth).

Both converge on: **Red Anthos account ↔ HubSpot portal ↔ Stripe customer**, all linked.

Decisions locked: account-first (Red Anthos), **no free trial — pay at install**,
website install routed through a pricing page (`?tier=` preselected into Checkout).

## Ownership boundary (important)

| Concern | Owner |
|---|---|
| User auth, login UI, password/session, account store | **Red Anthos Dev** (separate project) |
| HubSpot OAuth, portal token storage, lead pipeline, billing/Stripe | **LeadCatch** (this repo) |
| The link between a Red Anthos account and a HubSpot portal | **LeadCatch** stores the mapping; Red Anthos is the identity source of truth |

LeadCatch **never** stores passwords or renders login screens. It trusts a signed
assertion of "this is Red Anthos account X" handed off during install.

## Prerequisite (Red Anthos Dev — build first)

The account system must expose, at minimum:

1. **A hosted login/signup page** that LeadCatch's partner sign-in endpoint can redirect
   to, with a return URL back to LeadCatch.
2. **A way to verify the authenticated account** after redirect — e.g. a short-lived
   signed token (JWT) or an introspection endpoint LeadCatch can call to get a stable
   `redanthos_account_id` + email. (Auth mechanism TBD by Red Anthos Dev — LeadCatch
   needs: a stable account ID, the account email, and a way to verify the handoff
   wasn't forged.)
3. **Stripe customer association** — since Red Anthos owns cross-product billing
   identity, the account should map to (or create) a Stripe customer keyed by email.
   LeadCatch reuses that `stripe_customer_id` instead of minting its own.

Until this exists, the partner sign-in flow below cannot ship.

## Marketplace partner sign-in flow (LeadCatch side, future)

Per HubSpot docs (`understand-app-install-flow`), with partner sign in enabled:

1. **`step=authorize`** — HubSpot hits our install URL with `returnUrl`. We redirect the
   user to the **Red Anthos login page** (passing our own callback).
2. User authenticates with Red Anthos (entirely in the Red Anthos project).
3. Red Anthos redirects back to LeadCatch with a verifiable account assertion. We:
   - generate a cryptographically random `state` token (≤10 min expiry),
   - persist `state → redanthos_account_id` (Firestore),
   - redirect back to HubSpot's `returnUrl` with `?state=…`.
4. **`step=finalize`** — HubSpot calls our install URL again with `code` + `state`.
   We verify `state`, look up the Red Anthos account, exchange `code` for OAuth tokens,
   then **link account ↔ portalId ↔ Stripe customer**, and redirect to `returnUrl`.

Constraints from the docs:
- Our install endpoint **must be iframeable by HubSpot**:
  `Content-Security-Policy: frame-ancestors 'self' https://app.hubspot.com https://app-eu1.hubspot.com;`
- Redirecting back to `returnUrl` is **required** at each step or the user is stuck in a
  login loop.
- Opting into the new install flow in the listing editor is **irreversible**.
- Listing rule: must not redirect to a *different HubSpot app* — our own Red Anthos auth
  site is fine (that's the intended partner sign-in pattern).

## Website flow (Red Anthos site, future)

1. Pricing page (4 tiers; must match Marketplace listing pricing exactly).
2. "Get started" → Red Anthos sign in / create account.
3. After auth → kick off HubSpot install (our `/oauth/install`) carrying the chosen
   `tier` and the Red Anthos account context.
4. OAuth callback links the identities, then → Stripe Checkout (`?tier=`).

## Data model change (LeadCatch, future)

Add the Red Anthos account link. Options: a field on the existing `/billing/{portalId}`
record, or a small `/accountLinks` collection keyed by portal:

```
redanthos_account_id: string   // from Red Anthos handoff — the durable identity
linked_at: number
```

The Stripe customer should come **from** the Red Anthos account (cross-product), not be
minted per-portal. This supersedes the current "email-keyed customer at Checkout" stopgap
once the account system exists. See [[project_redanthos_universal_portal]].

## What changes in this repo when we build it

- `src/routes/oauth.ts` — add `step=authorize`/`step=finalize` handling + `state`
  lifecycle (today it's a simple code-exchange callback).
- A CSP/frame-ancestors header on the install route.
- Identity-linking write (account ↔ portal ↔ Stripe customer) in the finalize step.
- Checkout reuses the account's Stripe customer instead of creating a new one.
- Listing editor: enable seamless install flow + partner sign in (one-way).

## Open questions for Red Anthos Dev

1. Handoff verification mechanism — signed JWT vs. introspection endpoint?
2. Does a Red Anthos account map 1:1 to a Stripe customer, or 1:many (per product)?
3. Can one Red Anthos account link **multiple** HubSpot portals (agencies/multi-portal)?
4. Where does tier selection live — Red Anthos pricing page, or handed to LeadCatch Checkout?
