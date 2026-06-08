import { getPortal, savePortal } from './firestore.js';
import type { Portal } from '../types/index.js';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export async function getValidToken(portalId: string): Promise<string> {
  const portal = await getPortal(portalId);
  if (!portal) {
    throw new Error(`No portal found for ${portalId}`);
  }

  if (Date.now() >= portal.expires_at - TOKEN_REFRESH_BUFFER_MS) {
    return refreshToken(portalId, portal);
  }

  return portal.access_token;
}

async function refreshToken(portalId: string, portal: Portal): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.HUBSPOT_CLIENT_ID!,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
    refresh_token: portal.refresh_token,
  });

  const res = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const updated: Portal = {
    ...portal,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  await savePortal(portalId, updated);
  return updated.access_token;
}
