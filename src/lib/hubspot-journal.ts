import {
  deletePortalData,
  getJournalOffset,
  saveJournalOffset,
  getBilling,
  saveBilling,
  getExpiredDetachedBilling,
} from './firestore.js';
import { cancelSubscription } from './stripe.js';

const DEFAULT_GRACE_DAYS = 14;

interface TokenCache {
  token: string;
  expiresAt: number;
}

let _tokenCache: TokenCache | null = null;

async function getClientCredentialsToken(): Promise<string> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.HUBSPOT_CLIENT_ID!,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
    scope: 'developer.webhooks_journal.read developer.webhooks_journal.subscriptions.write',
  });

  const res = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`Client credentials token failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  _tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _tokenCache.token;
}

// Idempotent — safe to call on every startup. 409 = subscription already exists.
export async function ensureUninstallSubscription(): Promise<void> {
  const token = await getClientCredentialsToken();

  const res = await fetch('https://api.hubapi.com/webhooks-journal/subscriptions/2026-03', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subscriptionType: 'APP_LIFECYCLE_EVENT',
      eventTypeId: '4-1916193',
    }),
  });

  if (!res.ok && res.status !== 409) {
    throw new Error(`Subscription creation failed: ${res.status} ${await res.text()}`);
  }

  console.log(`Journal uninstall subscription ${res.status === 409 ? 'already exists' : 'created'}`);
}

interface JournalPointer {
  url: string;
  currentOffset: string;
}

interface JournalEvent {
  type: string;
  action: string;
  portalId: number;
  occurredAt: string;
}

interface JournalFile {
  journalEvents: JournalEvent[];
}

// Fetches the next journal entry after the stored offset, processes any APP_UNINSTALL
// events, and advances the offset. Returns the number of portals cleaned up.
export async function syncUninstallEvents(): Promise<number> {
  const token = await getClientCredentialsToken();
  const offset = await getJournalOffset();

  const endpoint = offset
    ? `https://api.hubapi.com/webhooks-journal/journal/2026-03/offset/${offset}/next`
    : `https://api.hubapi.com/webhooks-journal/journal/2026-03/earliest`;

  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // 404 = no new events since last offset; 204 = no entries at all
  if (res.status === 404 || res.status === 204) return 0;
  if (!res.ok) throw new Error(`Journal fetch failed: ${res.status} ${await res.text()}`);

  const body = await res.text();
  if (!body) return 0; // empty body = no entries

  const pointer = JSON.parse(body) as JournalPointer;

  const fileRes = await fetch(pointer.url);
  if (!fileRes.ok) throw new Error(`Journal file download failed: ${fileRes.status}`);

  const journal = await fileRes.json() as JournalFile;

  let processed = 0;
  for (const event of journal.journalEvents ?? []) {
    if (event.type === 'app_lifecycle_event' && event.action === 'APP_UNINSTALL') {
      const portalId = event.portalId.toString();
      console.log(`Journal uninstall — portal=${portalId}`);

      // Mark billing detached (NOT canceled) before deleting portal data. The user
      // may be uninstalling only to refresh the OAuth connection — a reinstall within
      // the grace window reattaches. The grace-period sweep cancels true abandoners.
      const billing = await getBilling(portalId);
      if (billing && billing.status !== 'canceled') {
        await saveBilling(portalId, {
          status: 'detached',
          detached_at: Date.now(),
        }).catch(err =>
          console.error('Failed to mark billing detached', { portalId, err }),
        );
      }

      await deletePortalData(portalId).catch(err =>
        console.error('deletePortalData failed', { portalId, err }),
      );
      processed++;
    }
  }

  await saveJournalOffset(pointer.currentOffset);
  return processed;
}

// Cancels Stripe subscriptions for portals that have stayed detached (uninstalled)
// past the grace window. Runs on the same scheduler cadence as syncUninstallEvents.
// Returns the number of subscriptions canceled.
export async function sweepDetachedBilling(): Promise<number> {
  const graceDays = parseInt(
    process.env.BILLING_GRACE_DAYS ?? String(DEFAULT_GRACE_DAYS),
    10,
  );
  const cutoff = Date.now() - graceDays * 24 * 60 * 60 * 1000;

  const expired = await getExpiredDetachedBilling(cutoff);

  let canceled = 0;
  for (const billing of expired) {
    try {
      await cancelSubscription(billing.stripe_subscription_id!);
      await saveBilling(billing.portal_id, { status: 'canceled' });
      console.log(`Grace period elapsed — canceled subscription for portal=${billing.portal_id}`);
      canceled++;
    } catch (err) {
      console.error('Failed to cancel detached subscription', {
        portalId: billing.portal_id,
        err,
      });
    }
  }

  return canceled;
}
