import { Router } from 'express';
import { randomUUID } from 'crypto';
import { savePortal } from '../lib/firestore.js';
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

// GET /oauth/install — redirect user to HubSpot OAuth
oauthRouter.get('/install', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.HUBSPOT_CLIENT_ID!,
    redirect_uri: `${process.env.SERVICE_URL}/oauth/callback`,
    scope: SCOPES,
  });

  res.redirect(`https://app.hubspot.com/oauth/authorize?${params.toString()}`);
});

// GET /oauth/callback — exchange code for tokens, store in Firestore
oauthRouter.get('/callback', async (req, res) => {
  const { code } = req.query as { code?: string };
  if (!code) {
    res.status(400).send('Missing authorization code');
    return;
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
    res.redirect(`https://app.hubspot.com/contacts/${portalId}`);
  } catch (err) {
    console.error('OAuth callback error', err);
    res.status(500).send('Installation failed. Please try again.');
  }
});
