import { Router } from 'express';
import { dedupeKeyExists, createDedupeKey, writeAuditLog, getPortal, getBilling } from '../lib/firestore.js';
import { getValidToken } from '../lib/token-store.js';
import { fetchMessageText, assignThread } from '../lib/hubspot-conversations.js';
import { upsertContact, createNote } from '../lib/hubspot-writer.js';
import { isBillingActive, recordLeadUsage } from '../lib/stripe.js';
import { getExtractor } from '../ai/extractor-factory.js';
import { verifyGoogleOidcToken } from '../lib/verify-google-oidc.js';
import type { TaskPayload } from '../types/index.js';

export const taskRouter = Router();

const verifyCloudTasks = verifyGoogleOidcToken(
  process.env.SERVICE_URL!,
  [process.env.SERVICE_ACCOUNT_EMAIL!],
);

function buildDedupeKey(installId: string, email: string, listingRef: string): string {
  const hourBucket = Math.floor(Date.now() / (1000 * 60 * 60));
  return `${installId}|${email}|${listingRef}|${hourBucket}`;
}

function getListingRef(lr: { vin?: string; stock_number?: string; url?: string; title?: string } | null): string {
  if (!lr) return '';
  return lr.vin ?? lr.stock_number ?? lr.url ?? lr.title ?? '';
}

taskRouter.post('/process', verifyCloudTasks, async (req, res) => {
  const payload: TaskPayload = req.body;
  const { portalId, event } = payload;
  const threadId = event.objectId;
  const { messageId } = event;

  console.log(`Task started — portal=${portalId} messageId=${messageId} threadId=${threadId}`);

  try {
    const portal = await getPortal(portalId.toString());

    // Billing gate — checked BEFORE any AI extraction or Conversations fetch so an
    // unpaid portal incurs no AI/HubSpot cost. We still write an audit entry capturing
    // the webhook event so a future replay can re-extract once the portal pays.
    const billing = await getBilling(portalId.toString());
    if (!isBillingActive(billing?.status)) {
      await writeAuditLog({
        portal_id: portalId.toString(),
        install_id: portal?.install_id ?? portalId.toString(),
        message_id: messageId,
        conversation_id: threadId.toString(),
        source_classified: null,
        extraction_json: null,
        confidence: null,
        outcome: 'skipped_unpaid',
        hubspot_contact_id: null,
        created_at: Date.now(),
      });
      console.log(`Skipped (unpaid) — portal=${portalId} messageId=${messageId} status=${billing?.status ?? 'none'}`);
      res.sendStatus(200);
      return;
    }

    const token = await getValidToken(portalId.toString());

    // Fetch full message body from Conversations API
    const emailText = await fetchMessageText(token, threadId, messageId);

    // AI extraction
    const extractor = getExtractor();
    const extraction = await extractor.extract(emailText);

    console.log(`Extracted — portal=${portalId} messageId=${messageId} isLead=${extraction.is_actual_lead} confidence=${extraction.confidence}`);

    const installId = portal?.install_id ?? portalId.toString();

    const auditBase = {
      portal_id: portalId.toString(),
      install_id: installId,
      conversation_id: threadId.toString(),
      source_classified: extraction.source,
      extraction_json: extraction as unknown as Record<string, unknown>,
      confidence: extraction.confidence,
      hubspot_contact_id: null,
      created_at: Date.now(),
    };

    // Skip non-leads
    if (!extraction.is_actual_lead) {
      await writeAuditLog({ ...auditBase, message_id: messageId, outcome: 'skipped' });
      console.log(`Skipped (not a lead) — messageId=${messageId}`);
      res.sendStatus(200);
      return;
    }

    // Low-confidence leads queue for human review instead of writing to HubSpot
    if (extraction.confidence === 'low') {
      await writeAuditLog({ ...auditBase, message_id: messageId, outcome: 'queued_for_review' });
      const reviewEmail = portal?.settings?.review_owner_email;
      if (reviewEmail) {
        await assignThread(token, threadId, reviewEmail).catch(err =>
          console.warn(`Failed to assign thread ${threadId} for review`, err),
        );
      }
      console.log(`Queued for review (low confidence) — messageId=${messageId}`);
      res.sendStatus(200);
      return;
    }

    // No email → can't dedupe or upsert reliably; queue for review
    if (!extraction.email) {
      await writeAuditLog({ ...auditBase, message_id: messageId, outcome: 'queued_for_review' });
      const reviewEmail = portal?.settings?.review_owner_email;
      if (reviewEmail) {
        await assignThread(token, threadId, reviewEmail).catch(err =>
          console.warn(`Failed to assign thread ${threadId} for review`, err),
        );
      }
      console.log(`Queued for review (no email) — messageId=${messageId}`);
      res.sendStatus(200);
      return;
    }

    // Dedupe check: scoped to this install to avoid cross-install collisions on quick reinstall
    const listingRef = getListingRef(extraction.listing_reference);
    const dedupeKey = buildDedupeKey(installId, extraction.email, listingRef);

    if (await dedupeKeyExists(dedupeKey)) {
      await writeAuditLog({ ...auditBase, message_id: messageId, outcome: 'skipped' });
      console.log(`Skipped (duplicate) — messageId=${messageId} key=${dedupeKey}`);
      res.sendStatus(200);
      return;
    }

    // Write to HubSpot
    const contactId = await upsertContact(token, extraction);
    if (portal?.settings?.notes_enabled !== false) {
      await createNote(token, contactId, extraction, portalId, threadId);
    }

    // Mark dedupe key and write audit log only after successful HubSpot writes
    await createDedupeKey(dedupeKey, portalId.toString(), messageId);

    await writeAuditLog({ ...auditBase, message_id: messageId, outcome: 'created', hubspot_contact_id: contactId });

    // Record one metered usage event for the billed lead. messageId is the idempotency
    // key, so a Cloud Tasks retry of this task never double-bills. Failure here must not
    // fail the task (the lead is already in HubSpot) — log and move on.
    if (billing?.stripe_customer_id) {
      await recordLeadUsage(billing.stripe_customer_id, messageId).catch(err =>
        console.error('Failed to record lead usage', { portalId, messageId, err }),
      );
    }

    console.log(`Contact created/updated — portal=${portalId} messageId=${messageId} contactId=${contactId}`);
    res.sendStatus(200);
  } catch (err) {
    console.error('Task processing error', { portalId, messageId, err });
    // Return 500 so Cloud Tasks will retry
    res.status(500).json({ error: 'Processing failed' });
  }
});
