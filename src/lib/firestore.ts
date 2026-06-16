import { Firestore, FieldValue, type Query } from '@google-cloud/firestore';
import type { Portal, AuditLog, BillingRecord } from '../types/index.js';

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

export async function writeAuditLog(entry: AuditLog): Promise<string> {
  const ref = await getDb().collection('auditLog').add({
    ...entry,
    created_at: FieldValue.serverTimestamp(),
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
