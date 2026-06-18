import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  savePortal,
  getBilling,
  saveBilling,
  getBillingByAccountId,
} from '../lib/firestore.js';
import { isBillingActive } from '../lib/stripe.js';
import { ensureInboxAgentProperties } from '../lib/hubspot-properties.js';
import { verifyHandoffToken, type HandoffAccount } from '../lib/redanthos.js';
import type { Portal, BillingTier } from '../types/index.js';

export const oauthRouter = Router();

const SCOPES = [
  'oauth',
  'conversations.read',
  'conversations.write',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.owners.read',
  'crm.schemas.contacts.write',
].join(' ');

const STATE_COOKIE = 'oauth_state';
const STATE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;
// Carries the verified Red Anthos handoff (account + tier + customer) across the HubSpot
// OAuth round-trip in the website flow, so the callback can link identities and reuse the
// account's Stripe customer. Signed + httpOnly, same lifetime as the state cookie.
const HANDOFF_COOKIE = 'ra_handoff';

// Result of a HubSpot token exchange we persist as a Portal. Shared by the website
// callback here and the marketplace finalize step in routes/install.ts.
export interface TokenExchangeResult {
  portalId: string;
  access_token: string;
}

// Exchanges a HubSpot authorization `code` for tokens, persists the Portal, and ensures
// our custom contact properties exist. Returns the portalId + access token. Throws on any
// HubSpot API failure. Shared by both install entry points.
export async function exchangeCodeAndSavePortal(
  code: string,
): Promise<TokenExchangeResult> {
  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.HUBSPOT_CLIENT_ID!,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
    redirect_uri: `${process.env.SERVICE_URL}/oauth/callback`,
    code,
  });

  const tokenRes = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error('Token exchange failed', {
      status: tokenRes.status,
      body,
      redirect_uri: `${process.env.SERVICE_URL}/oauth/callback`,
      client_id_set: !!process.env.HUBSPOT_CLIENT_ID,
      client_secret_set: !!process.env.HUBSPOT_CLIENT_SECRET,
    });
    throw new Error(`Token exchange failed: ${tokenRes.status} ${body}`);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    hub_domain: string;
    token_type: string;
  };

  // Fetch portal info (hub_id) from introspect endpoint
  const infoRes = await fetch(
    `https://api.hubapi.com/oauth/v1/access-tokens/${tokenData.access_token}`,
  );
  if (!infoRes.ok) {
    throw new Error(`Token introspect failed: ${infoRes.status}`);
  }

  const info = (await infoRes.json()) as {
    hub_id: number;
    hub_domain: string;
    app_id: number;
  };

  const portalId = info.hub_id.toString();

  const portal: Portal = {
    install_id: randomUUID(),
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: Date.now() + tokenData.expires_in * 1000,
    installed_at: Date.now(),
    hub_domain: info.hub_domain ?? tokenData.hub_domain,
    hub_id: portalId,
  };

  await savePortal(portalId, portal);
  console.log(`Ensuring inbox_agent properties for portal ${portalId}`);
  await ensureInboxAgentProperties(tokenData.access_token);
  console.log(`inbox_agent properties ensured for portal ${portalId}`);
  console.log(`Installed on portal ${portalId} (${portal.hub_domain})`);

  return { portalId, access_token: tokenData.access_token };
}

// Enforces the 1 Red Anthos account → 1 HubSpot portal rule (REDANTHOS_DEV_SPEC §6).
// Returns the portalId already linked to this account, or null if free to link here.
// A reinstall on the *same* portal is allowed (returns null).
export async function conflictingPortalForAccount(
  accountId: string,
  portalId: string,
): Promise<string | null> {
  const existing = await getBillingByAccountId(accountId);
  if (existing && existing.portal_id !== portalId) {
    return existing.portal_id;
  }
  return null;
}

// Links a verified Red Anthos account to a portal and seeds the billing record with the
// account's Stripe customer + chosen tier, so Checkout reuses that customer instead of
// minting a new one. Idempotent (merge write).
export async function linkAccountToPortal(
  portalId: string,
  account: HandoffAccount,
): Promise<void> {
  await saveBilling(portalId, {
    redanthos_account_id: account.account_id,
    linked_at: Date.now(),
    customer_email: account.email,
    ...(account.stripe_customer_id
      ? { stripe_customer_id: account.stripe_customer_id }
      : {}),
  });
  console.log(
    `Linked portal ${portalId} ↔ Red Anthos account ${account.account_id}`,
  );
}

// Routes a freshly-installed portal into the pay-at-install path: reattach an
// active/detached subscription (and land at `finalUrl`), or send to Stripe Checkout for
// the chosen tier (Checkout then lands at `finalUrl` on success). Shared by both install
// entry points — the website callback and the marketplace finalize — so install→pay is
// identical for each. `finalUrl` is where the user ends up post-install (HubSpot home for
// the website flow, HubSpot's returnUrl for marketplace); it's also Checkout's success_url.
export async function redirectToPayment(
  res: import('express').Response,
  portalId: string,
  tier: BillingTier | null | undefined,
  finalUrl: string,
): Promise<void> {
  const billing = await getBilling(portalId);

  if (billing && isBillingActive(billing.status)) {
    res.redirect(finalUrl);
    return;
  }
  if (billing?.status === 'detached' && billing.stripe_subscription_id) {
    await saveBilling(portalId, { status: 'active', detached_at: null });
    console.log(`Reattached billing on reinstall — portal=${portalId}`);
    res.redirect(finalUrl);
    return;
  }

  const checkout = new URL('/billing/checkout', process.env.SERVICE_URL!);
  checkout.searchParams.set('portalId', portalId);
  if (tier) checkout.searchParams.set('tier', tier);
  checkout.searchParams.set('returnUrl', finalUrl);
  res.redirect(checkout.toString());
}

// GET /oauth/start — website-flow entry point. Receives the Red Anthos handoff
// (?ra_token=…) from the pricing page, verifies it, stashes the account in a signed
// cookie, then kicks off HubSpot OAuth. (REDANTHOS_DEV_SPEC: the `return_to` endpoint.)
oauthRouter.get('/start', async (req, res) => {
  const raToken = req.query.ra_token as string | undefined;
  if (!raToken) {
    res.status(400).send('Missing ra_token');
    return;
  }

  let account: HandoffAccount;
  try {
    account = await verifyHandoffToken(raToken);
  } catch (err) {
    console.error('Handoff verification failed (/oauth/start)', err);
    res.status(401).send('Could not verify your Red Anthos sign-in. Please try again.');
    return;
  }

  const state = randomUUID();
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    signed: true,
    maxAge: STATE_COOKIE_MAX_AGE_MS,
  });
  res.cookie(HANDOFF_COOKIE, JSON.stringify(account), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    signed: true,
    maxAge: STATE_COOKIE_MAX_AGE_MS,
  });

  const params = new URLSearchParams({
    client_id: process.env.HUBSPOT_CLIENT_ID!,
    redirect_uri: `${process.env.SERVICE_URL}/oauth/callback`,
    scope: SCOPES,
    state,
  });
  res.redirect(`https://app.hubspot.com/oauth/authorize?${params.toString()}`);
});

// GET /oauth/install — redirect user to HubSpot OAuth (no Red Anthos handoff; e.g. a
// direct/dev install). The account-first website flow uses /oauth/start instead.
oauthRouter.get('/install', (req, res) => {
  const state = randomUUID();

  // Signed httpOnly cookie binds this browser to the state we'll verify on callback.
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    signed: true,
    maxAge: STATE_COOKIE_MAX_AGE_MS,
  });

  const params = new URLSearchParams({
    client_id: process.env.HUBSPOT_CLIENT_ID!,
    redirect_uri: `${process.env.SERVICE_URL}/oauth/callback`,
    scope: SCOPES,
    state,
  });

  res.redirect(`https://app.hubspot.com/oauth/authorize?${params.toString()}`);
});

// GET /oauth/callback — exchange code for tokens, store in Firestore
oauthRouter.get('/callback', async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code) {
    res.status(400).send('Missing authorization code');
    return;
  }

  // CSRF check is enforced only when a state cookie is present (install started at
  // /oauth/install or /oauth/start). HubSpot-initiated installs (marketplace, dev test
  // account) skip our route, so no cookie exists — allow them through.
  const cookieState = req.signedCookies?.[STATE_COOKIE];
  if (cookieState) {
    if (!state || state !== cookieState) {
      res.status(400).send('Invalid OAuth state');
      return;
    }
    res.clearCookie(STATE_COOKIE);
  }

  // Recover the Red Anthos handoff stashed at /oauth/start (website flow), if any.
  let handoff: HandoffAccount | null = null;
  const rawHandoff = req.signedCookies?.[HANDOFF_COOKIE];
  if (rawHandoff) {
    res.clearCookie(HANDOFF_COOKIE);
    try {
      handoff = JSON.parse(rawHandoff) as HandoffAccount;
    } catch {
      handoff = null;
    }
  }

  try {
    const { portalId } = await exchangeCodeAndSavePortal(code);

    // Account-first website flow: enforce 1:1:1 and link the account to this portal.
    if (handoff) {
      const conflict = await conflictingPortalForAccount(handoff.account_id, portalId);
      if (conflict) {
        console.warn(
          `1:1:1 violation — account ${handoff.account_id} already on portal ${conflict}, ` +
            `blocked install on portal ${portalId}`,
        );
        res
          .status(409)
          .send(
            'This Red Anthos account is already connected to another HubSpot portal. ' +
              'Use a separate Red Anthos account for each portal.',
          );
        return;
      }
      await linkAccountToPortal(portalId, handoff);
    }

    await redirectToPayment(
      res,
      portalId,
      handoff?.tier,
      `https://app.hubspot.com/contacts/${portalId}`,
    );
  } catch (err) {
    console.error('OAuth callback error', err);
    res.status(500).send('Installation failed. Please try again.');
  }
});
