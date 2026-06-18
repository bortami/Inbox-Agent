import { createRemoteJWKSet, jwtVerify } from 'jose';
import { consumeJti } from './firestore.js';
import { isValidTier } from './stripe.js';
import type { BillingTier } from '../types/index.js';

// The Red Anthos account/billing-identity service. It owns user accounts and the Stripe
// customer; LeadCatch trusts a short-lived RS256 handoff JWT it signs (verified against
// its JWKS) and falls back to a service-to-service lookup for the Stripe customer.
// Contract: docs/REDANTHOS_DEV_SPEC.md.

const REDANTHOS_BASE_URL = process.env.REDANTHOS_BASE_URL ?? 'https://redanthos.com';
const JWT_ISSUER = process.env.REDANTHOS_JWT_ISSUER ?? REDANTHOS_BASE_URL;
const JWT_AUDIENCE = process.env.REDANTHOS_JWT_AUDIENCE ?? 'leadcatch';

// The verified, trusted result of a Red Anthos handoff.
export interface HandoffAccount {
  account_id: string;          // durable, opaque `sub` — the identity we link to a portal
  email: string;
  tier: BillingTier | null;    // preselected tier, if the user chose one pre-install
  stripe_customer_id: string | null;
}

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!_jwks) {
    // createRemoteJWKSet caches keys and refetches on unknown `kid`, so this is created once.
    _jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', REDANTHOS_BASE_URL));
  }
  return _jwks;
}

// Verifies a Red Anthos handoff JWT and returns the trusted account, or throws. Checks
// the RS256 signature against the JWKS, `iss`/`aud`/`exp`, and rejects a reused `jti`
// (replay protection via Firestore). The `sub` claim is the durable account identity.
export async function verifyHandoffToken(token: string): Promise<HandoffAccount> {
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    // Pin RS256 (Red Anthos's signing alg) so a forged token can't downgrade to a weaker
    // or "none" alg. `exp` is validated by default; clockTolerance guards 5-min-token skew.
    algorithms: ['RS256'],
    clockTolerance: 30,
  });

  const sub = typeof payload.sub === 'string' ? payload.sub : null;
  const jti = typeof payload.jti === 'string' ? payload.jti : null;
  const email = typeof payload.email === 'string' ? payload.email : null;
  if (!sub) throw new Error('Handoff token missing sub');
  if (!jti) throw new Error('Handoff token missing jti');
  if (!email) throw new Error('Handoff token missing email');

  // Replay protection: a given handoff token may be redeemed exactly once.
  const fresh = await consumeJti(jti);
  if (!fresh) throw new Error('Handoff token replayed (jti already used)');

  const tierClaim = typeof payload.tier === 'string' ? payload.tier : undefined;
  const customerClaim =
    typeof payload.stripe_customer_id === 'string' ? payload.stripe_customer_id : null;

  return {
    account_id: sub,
    email,
    tier: isValidTier(tierClaim) ? tierClaim : null,
    stripe_customer_id: customerClaim,
  };
}

// §3 fallback: resolve a Red Anthos account to its Stripe customer when the handoff JWT
// didn't carry one. Service-to-service, authenticated with a static API key. Red Anthos
// creates the customer on demand if the account has none yet.
export async function lookupStripeCustomer(accountId: string): Promise<string | null> {
  const apiKey = process.env.REDANTHOS_API_KEY;
  if (!apiKey) {
    console.error('REDANTHOS_API_KEY not set — cannot look up Stripe customer');
    return null;
  }

  const url = `${REDANTHOS_BASE_URL}/v1/accounts/${encodeURIComponent(accountId)}/stripe-customer`;
  const res = await fetch(url, { headers: { 'X-Api-Key': apiKey } });
  if (!res.ok) {
    console.error('Red Anthos stripe-customer lookup failed', {
      accountId,
      status: res.status,
    });
    return null;
  }

  const body = (await res.json()) as { stripe_customer_id?: string };
  return body.stripe_customer_id ?? null;
}

// Builds the Red Anthos hosted login/signup URL the browser is redirected to during an
// account-first install. `returnTo` is the LeadCatch endpoint that receives `?ra_token`.
export function buildLoginUrl(returnTo: string, tier?: string | null): string {
  const url = new URL('/app/login', REDANTHOS_BASE_URL);
  url.searchParams.set('return_to', returnTo);
  url.searchParams.set('product', 'leadcatch');
  if (tier) url.searchParams.set('tier', tier);
  return url.toString();
}
