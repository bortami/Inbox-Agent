import { Router } from 'express';
import { dedupeKeyExists, createDedupeKey, writeAuditLog, getPortal } from '../lib/firestore.js';
import { getValidToken } from '../lib/token-store.js';
import { fetchMessageText, assignThread } from '../lib/hubspot-conversations.js';
import { upsertContact, createNote } from '../lib/hubspot-writer.js';
import { getExtractor } from '../ai/extractor-factory.js';
import type { TaskPayload } from '../types/index.js';

export const taskRouter = Router();

function buildDedupeKey(installId: string, email: string, listingRef: string): string {
  const hourBucket = Math.floor(Date.now() / (1000 * 60 * 60));
  return `${installId}|${email}|${listingRef}|${hourBucket}`;
}

function getListingRef(lr: { vin?: string; stock_number?: string; url?: string; title?: string } | null): string {
  if (!lr) return '';
  return lr.vin ?? lr.stock_number ?? lr.url ?? lr.title ?? '';
}

taskRouter.post('/process', async (req, res) => {
  const payload: TaskPayload = req.body;
  const { portalId, event } = payload;
  const threadId = event.objectId;
  const { messageId } = event;

  console.log(`Task started — portal=${portalId} messageId=${messageId} threadId=${threadId}`);

  try {
    const token = await getValidToken(portalId.toString());
    const portal = await getPortal(portalId.toString());

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
      source_classified: null,
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

    console.log(`Contact created/updated — portal=${portalId} messageId=${messageId} contactId=${contactId}`);
    res.sendStatus(200);
  } catch (err) {
    console.error('Task processing error', { portalId, messageId, err });
    // Return 500 so Cloud Tasks will retry
    res.status(500).json({ error: 'Processing failed' });
  }
});
