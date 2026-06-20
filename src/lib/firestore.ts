import { Firestore, FieldValue, type Query } from '@google-cloud/firestore';
import type { Portal, AuditLog, BillingRecord, InstallState } from '../types/index.js';

let _db: Firestore | null = null;

export function getDb(): Firestore {
  if (!_db) {
    _db = new Firestore({
      projectId: process.env.GCP_PROJECT_ID,
    });
  }
  return _db;
}

export async function getPortal(portalId: string): Promise<Portal | null> {
  const doc = await getDb().collection('portals').doc(portalId).get();
  return doc.exists ? (doc.data() as Portal) : null;
}

export async function savePortal(portalId: string, data: Portal): Promise<void> {
  await getDb().collection('portals').doc(portalId).set(data);
}

export async function dedupeKeyExists(key: string): Promise<boolean> {
  const doc = await getDb().collection('dedupeKeys').doc(key).get();
  return doc.exists;
}

export async function createDedupeKey(
  key: string,
  portalId: string,
  messageId: string,
): Promise<void> {
  await getDb().collection('dedupeKeys').doc(key).set({
    portal_id: portalId,
    message_id: messageId,
    // Firestore TTL policy on this collection expires documents after 24h
    // based on the created_at field — configured via GCP Console or gcloud
    created_at: FieldValue.serverTimestamp(),
  });
}

// Audit log entries retain buyer PII (in extraction_json), so they expire on a rolling
// 90-day window via a Firestore TTL policy. The policy can only target a Timestamp field,
// so we stamp `ttl_at` here (same pattern as installStates). Uninstall still hard-deletes
// the whole portal's audit log immediately via deletePortalData — this TTL bounds the data
// for portals that stay installed.
const AUDIT_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export async function writeAuditLog(entry: AuditLog): Promise<string> {
  const ref = await getDb().collection('auditLog').add({
    ...entry,
    created_at: FieldValue.serverTimestamp(),
    ttl_at: new Date(Date.now() + AUDIT_LOG_RETENTION_MS),
  });
  return ref.id;
}

export async function deletePortalData(portalId: string): Promise<void> {
  const db = getDb();
  await db.collection('portals').doc(portalId).delete();

  const auditSnapshot = await db
    .collection('auditLog')
    .where('portal_id', '==', portalId)
    .get();

  if (!auditSnapshot.empty) {
    const batch = db.batch();
    auditSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
  // NOTE: /billing/{portalId} is intentionally NOT deleted here. Uninstall must
  // not lose the Stripe subscription id — the grace-period sweep needs it to
  // cancel later, and a reinstall within the window reattaches to it.
}

// --- Billing (separate collection that survives uninstall) ---

export async function getBilling(portalId: string): Promise<BillingRecord | null> {
  const doc = await getDb().collection('billing').doc(portalId).get();
  return doc.exists ? (doc.data() as BillingRecord) : null;
}

export async function saveBilling(
  portalId: string,
  data: Partial<BillingRecord>,
): Promise<void> {
  await getDb()
    .collection('billing')
    .doc(portalId)
    .set(
      { ...data, portal_id: portalId, updated_at: Date.now() },
      { merge: true },
    );
}

// Finds the billing record (if any) already linked to a Red Anthos account. Used to
// enforce the 1 account → 1 portal rule during account-first install: a second portal
// trying to install under an already-linked account is rejected (REDANTHOS_DEV_SPEC §6).
export async function getBillingByAccountId(
  accountId: string,
): Promise<BillingRecord | null> {
  const snapshot = await getDb()
    .collection('billing')
    .where('redanthos_account_id', '==', accountId)
    .limit(1)
    .get();

  return snapshot.empty ? null : (snapshot.docs[0].data() as BillingRecord);
}

// Returns detached billing records whose grace period has elapsed and that still
// have a subscription to cancel — driven by the journal-sync scheduler.
export async function getExpiredDetachedBilling(
  cutoffMs: number,
): Promise<BillingRecord[]> {
  const snapshot = await getDb()
    .collection('billing')
    .where('status', '==', 'detached')
    .where('detached_at', '<=', cutoffMs)
    .get();

  return snapshot.docs
    .map(doc => doc.data() as BillingRecord)
    .filter(b => b.stripe_subscription_id);
}

export async function getJournalOffset(): Promise<string | null> {
  const doc = await getDb().collection('appState').doc('journalOffset').get();
  return doc.exists ? (doc.data() as { offset: string }).offset : null;
}

export async function saveJournalOffset(offset: string): Promise<void> {
  await getDb().collection('appState').doc('journalOffset').set({
    offset,
    updated_at: FieldValue.serverTimestamp(),
  });
}

export async function getAuditLogByMessageId(
  messageId: string,
): Promise<(AuditLog & { id: string }) | null> {
  const snapshot = await getDb()
    .collection('auditLog')
    .where('message_id', '==', messageId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  return { id: doc.id, ...(doc.data() as AuditLog) };
}

export async function getLatestAuditLogByContactId(
  portalId: string,
  hubspotContactId: string,
): Promise<(AuditLog & { id: string }) | null> {
  const snapshot = await getDb()
    .collection('auditLog')
    .where('portal_id', '==', portalId)
    .where('hubspot_contact_id', '==', hubspotContactId)
    .orderBy('created_at', 'desc')
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  return { id: doc.id, ...(doc.data() as AuditLog) };
}

export async function getRecentAuditLogs(
  portalId: string,
  opts: { source?: string; sinceMs?: number; limit?: number } = {},
): Promise<Array<AuditLog & { id: string }>> {
  let query: Query = getDb()
    .collection('auditLog')
    .where('portal_id', '==', portalId);

  if (opts.source) {
    query = query.where('source_classified', '==', opts.source);
  }
  if (opts.sinceMs !== undefined) {
    query = query.where('created_at', '>=', new Date(opts.sinceMs));
  }

  const snapshot = await query
    .orderBy('created_at', 'desc')
    .limit(opts.limit ?? 25)
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as AuditLog) }));
}

// --- Red Anthos handoff: replay protection + install state (both TTL collections) ---

// Atomically records a handoff JWT's `jti` the first time it's seen. Returns false if it
// was already used (replay). A 24h Firestore TTL on /usedJtis cleans these up — handoff
// tokens are short-lived (5 min), so 24h far outlives any legitimate replay window.
export async function consumeJti(jti: string): Promise<boolean> {
  const ref = getDb().collection('usedJtis').doc(jti);
  try {
    await ref.create({ created_at: FieldValue.serverTimestamp() });
    return true;
  } catch (err: unknown) {
    // create() fails with ALREADY_EXISTS (code 6) if the jti was already consumed.
    if ((err as { code?: number }).code === 6) return false;
    throw err;
  }
}

export async function saveInstallState(state: InstallState): Promise<void> {
  await getDb()
    .collection('installStates')
    .doc(state.state)
    .set({
      ...state,
      // Firestore TTL only acts on Timestamp-typed fields, so the numeric `expires_at`
      // (kept for the app's own expiry check) can't drive it. This Timestamp does:
      // the TTL policy targets `ttl_at`, set to the same 10-min horizon.
      ttl_at: new Date(state.expires_at),
    });
}

// Reads and deletes the install state in one shot — state tokens are single-use. Returns
// null if missing or expired (a stale doc the TTL sweep hasn't reaped yet).
export async function consumeInstallState(
  state: string,
): Promise<InstallState | null> {
  const ref = getDb().collection('installStates').doc(state);
  const doc = await ref.get();
  if (!doc.exists) return null;
  await ref.delete();
  const data = doc.data() as InstallState;
  return data.expires_at > Date.now() ? data : null;
}
