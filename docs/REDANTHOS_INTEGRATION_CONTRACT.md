# LeadCatch ↔ Red Anthos — Integration Contract (endpoints Red Anthos depends on)

This is the concrete handshake. Red Anthos has shipped its side (login page, RS256 handoff
JWT + JWKS, Stripe-customer creation, §3 lookup). This doc states exactly what LeadCatch
now exposes and what it needs from Red Anthos, so the two sides line up.

LeadCatch base URL (production): `https://inbox-agent-483790599125.us-central1.run.app`
(below: `<LC>`).

---

## 1. What Red Anthos calls / redirects to on LeadCatch

### Website flow — the `return_to` endpoint Red Anthos was waiting on

**`GET <LC>/oauth/start?ra_token=<jwt>`**

- This is the value Red Anthos's pricing page must use as `return_to` when it sends the
  user to its own login page. After the user authenticates, Red Anthos redirects the
  browser to this URL with the signed handoff JWT as `ra_token`.
- LeadCatch verifies the JWT, then drives HubSpot OAuth and (on the callback) links the
  account ↔ portal and runs pay-at-install Checkout against the account's Stripe customer.
- Requires only `ra_token` — it is a cold entry point (no prior cookie/state needed).
- Failure modes: missing `ra_token` → 400; bad/expired/replayed token → 401.

Full website redirect chain:
`RA pricing page → RA login → <LC>/oauth/start?ra_token=… → HubSpot OAuth → <LC>/oauth/callback → Stripe Checkout → app.hubspot.com`

### Marketplace flow — LeadCatch calls Red Anthos's login page

Here **LeadCatch** builds the Red Anthos login URL (HubSpot invokes our install endpoint
first). LeadCatch redirects to:

`https://redanthos.com/app/login?return_to=<LC>/install/return&product=leadcatch[&tier=<tier>]`

Red Anthos authenticates, then must redirect the browser to **`return_to`** with the
handoff JWT appended as **`ra_token`**:

`<LC>/install/return?ra_token=<jwt>`

> **Append, don't replace.** LeadCatch does not rely on Red Anthos preserving any query
> string on `return_to` (the marketplace `returnUrl` is carried in a LeadCatch cookie), so
> a plain `?ra_token=<jwt>` is fine. Just make sure the param name is exactly `ra_token`.

### §3 — Stripe customer lookup (LeadCatch calls Red Anthos)

LeadCatch calls, only when the handoff JWT didn't carry `stripe_customer_id`:

`GET https://redanthos.com/v1/accounts/<account_id>/stripe-customer`
Header: `X-Api-Key: <shared key>`
Expected JSON: `{ "account_id", "email", "stripe_customer_id": "cus_…" }`
(Red Anthos creates the customer on demand if the account has none.)

---

## 2. Handoff JWT — what LeadCatch verifies (must match RA's signer)

LeadCatch verifies with `jose` against `https://redanthos.com/.well-known/jwks.json`:

| Check | Expected value |
|---|---|
| Algorithm | **RS256** (pinned — LeadCatch rejects any other alg) |
| `iss` | `https://redanthos.com` |
| `aud` | `leadcatch` |
| `exp` | required, must be in the future (±30s skew tolerance) |
| `jti` | required, **single-use** — LeadCatch rejects a reused `jti` (replay) |
| `sub` | required — durable, opaque account id; LeadCatch keys the portal link on it |
| `email` | required |
| `tier` | optional — `starter\|growth\|pro\|enterprise` |
| `stripe_customer_id` | optional — `cus_…`; if present LeadCatch skips the §3 call |

`kid` `ra-handoff-1` / 300s TTL as Red Anthos specified — both compatible with the above
(LeadCatch reads `kid` from the JWKS, not hard-coded; any TTL within `exp` is fine).

If Red Anthos changes `iss` or `aud`, LeadCatch must update `REDANTHOS_JWT_ISSUER` /
`REDANTHOS_JWT_AUDIENCE` — otherwise verification fails closed.

---

## 3. LeadCatch config that must agree with Red Anthos

| Env var | Must match |
|---|---|
| `REDANTHOS_BASE_URL` (default `https://redanthos.com`) | RA's host serving JWKS, login, §3 |
| `REDANTHOS_JWT_ISSUER` (default `https://redanthos.com`) | the JWT `iss` RA signs |
| `REDANTHOS_JWT_AUDIENCE` (default `leadcatch`) | the JWT `aud` RA signs |
| `REDANTHOS_API_KEY` | the §3 `X-Api-Key` value (shared out-of-band) |

---

## 4. Identity rule LeadCatch enforces (context for Red Anthos)

1 Red Anthos account (`sub`) → 1 HubSpot portal. If an account already linked to a portal
tries to install on a **different** portal, LeadCatch blocks it (website: HTTP 409;
marketplace: returns to HubSpot `returnUrl?error=account_in_use`). A reinstall on the
**same** portal is allowed. `sub` must stay stable for the life of the account.
