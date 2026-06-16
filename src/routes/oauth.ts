import { Router } from 'express';
import { randomUUID } from 'crypto';
import { savePortal, getBilling, saveBilling } from '../lib/firestore.js';
import { isBillingActive } from '../lib/stripe.js';
import { ensureInboxAgentProperties } from '../lib/hubspot-properties.js';
import type { Portal } from '../types/index.js';

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

// GET /oauth/install — redirect user to HubSpot OAuth
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
  // /oauth/install). HubSpot-initiated installs (marketplace, dev test account) skip
  // our /install route, so no cookie exists — allow them through.
  const cookieState = req.signedCookies?.[STATE_COOKIE];
  if (cookieState) {
    if (!state || state !== cookieState) {
      res.status(400).send('Invalid OAuth state');
      return;
    }
    res.clearCookie(STATE_COOKIE);
  }

  try {
    // Exchange code for tokens
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

    const tokenData = await tokenRes.json() as {
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

    const info = await infoRes.json() as {
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

    // Billing gate. A reinstall that still has an active subscription (e.g. the user
    // uninstalled only to refresh the connection) reattaches seamlessly: clear the
    // detached flag and skip Checkout. Everyone else goes to Checkout to subscribe.
    const billing = await getBilling(portalId);
    if (billing && isBillingActive(billing.status)) {
      res.redirect(`https://app.hubspot.com/contacts/${portalId}`);
      return;
    }
    if (billing?.status === 'detached' && billing.stripe_subscription_id) {
      // Subscription was left intact at uninstall — reattach within the grace window.
      await saveBilling(portalId, { status: 'active', detached_at: null });
      console.log(`Reattached billing on reinstall — portal=${portalId}`);
      res.redirect(`https://app.hubspot.com/contacts/${portalId}`);
      return;
    }

    res.redirect(`${process.env.SERVICE_URL}/billing/checkout?portalId=${portalId}`);
  } catch (err) {
    console.error('OAuth callback error', err);
    res.status(500).send('Installation failed. Please try again.');
  }
});
