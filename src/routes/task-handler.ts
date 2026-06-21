import { Router } from 'express';
import { dedupeKeyExists, createDedupeKey, writeAuditLog, getPortal, getBilling } from '../lib/firestore.js';
import { getValidToken } from '../lib/token-store.js';
import { fetchMessageText, assignThread, fetchThreadInboxId, postThreadComment, resolveOwnerActorId } from '../lib/hubspot-conversations.js';
import { upsertContact, createEmailEngagement, normalizeEmail, HubSpotApiError } from '../lib/hubspot-writer.js';
import { isBillingActive, recordLeadUsage } from '../lib/stripe.js';
import { getExtractor } from '../ai/extractor-factory.js';
import { verifyGoogleOidcToken } from '../lib/verify-google-oidc.js';
import type { TaskPayload } from '../types/index.js';

export const taskRouter = Router();

const verifyCloudTasks = verifyGoogleOidcToken(
  process.env.SERVICE_URL!,
  [process.env.SERVICE_ACCOUNT_EMAIL!],
);

// Dedupe is keyed per thread: each conversation is processed (and billed) exactly once,
// on its first message. Later replies on the same thread are skipped — our job is initial
// processing only. This also suppresses Cloud Tasks retries (same thread). A second
// inquiry from the same buyer about the same car arrives as a *new* thread, so it is a
// distinct key and gets processed and commented on its own.
function buildDedupeKey(installId: string, threadId: number): string {
  return `${installId}|${threadId}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Internal comment posted back on the thread so an agent viewing the aggregator
// conversation (cars.com, autotrader.com) can jump to the real buyer Contact LeadCatch
// created — the thread itself stays associated with the aggregator and can't be
// repointed. 0-1 is the contacts object type id in the record URL. Returns the
// plain-text fallback and the HTML (richText) the inbox renders — the link is only
// clickable as an <a href> in the HTML.
function contactComment(
  portalId: number,
  contactId: string,
  name: string | null,
): { text: string; richText: string } {
  const url = `https://app.hubspot.com/contacts/${portalId}/record/0-1/${contactId}`;
  const who = name ? ` for ${name}` : '';
  return {
    text: `LeadCatch created/updated the contact${who} from this email: ${url}`,
    richText: `LeadCatch created/updated the contact${escapeHtml(who)} from this email: <a href="${url}">View contact</a>`,
  };
}

// Routes a thread to the portal's review owner: resolves the owner's email to an actor
// ID, assigns the thread, and posts an internal comment explaining why it was flagged so
// the assigned agent has context. All steps are best-effort — review routing must never
// fail the task (which would trigger a Cloud Tasks retry). `reason` is a short
// human-readable cause (e.g. "no email address could be extracted").
async function routeForReview(
  token: string,
  threadId: number,
  reviewEmail: string | null | undefined,
  reason: string,
): Promise<void> {
  const text = `LeadCatch flagged this conversation for review: ${reason}.`;
  await postThreadComment(token, threadId, text, escapeHtml(text)).catch(err =>
    console.warn(`Failed to post review comment to thread ${threadId}`, err),
  );

  if (!reviewEmail) {
    console.warn(`No review_owner_email configured — thread ${threadId} flagged but unassigned`);
    return;
  }

  try {
    const actorId = await resolveOwnerActorId(token, reviewEmail);
    if (!actorId) {
      console.warn(`Could not resolve review owner ${reviewEmail} to an actor — thread ${threadId} unassigned`);
      return;
    }
    await assignThread(token, threadId, actorId);
  } catch (err) {
    console.warn(`Failed to assign thread ${threadId} for review`, err);
  }
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

    // Inbox gate — if the portal has chosen a specific inbox, only process emails whose
    // thread belongs to it. Checked BEFORE fetching the message body or extracting, so an
    // email from another inbox costs no AI/extraction work. No selection = process all.
    const selectedInbox = portal?.settings?.inbox_id;
    if (selectedInbox) {
      const threadInbox = await fetchThreadInboxId(token, threadId);
      if (threadInbox !== selectedInbox) {
        console.log(
          `Skipped (other inbox) — portal=${portalId} messageId=${messageId} ` +
            `threadInbox=${threadInbox ?? 'unknown'} selected=${selectedInbox}`,
        );
        res.sendStatus(200);
        return;
      }
    }

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
      await routeForReview(token, threadId, portal?.settings?.review_owner_email, 'the lead data was low confidence');
      console.log(`Queued for review (low confidence) — messageId=${messageId}`);
      res.sendStatus(200);
      return;
    }

    // No / invalid email → can't dedupe or upsert reliably; queue for review. We
    // normalize here (not just `!extraction.email`) because the extractor sometimes
    // emits truthy-but-invalid values ("null", "n/a") that HubSpot rejects with
    // INVALID_EMAIL — those must route to review, not crash the upsert.
    const email = normalizeEmail(extraction.email);
    if (!email) {
      await writeAuditLog({ ...auditBase, message_id: messageId, outcome: 'queued_for_review' });
      await routeForReview(token, threadId, portal?.settings?.review_owner_email, 'no email address could be extracted');
      console.log(`Queued for review (no/invalid email) — messageId=${messageId}`);
      res.sendStatus(200);
      return;
    }

    // Dedupe check: per thread, so each conversation is processed and billed once.
    const dedupeKey = buildDedupeKey(installId, threadId);

    if (await dedupeKeyExists(dedupeKey)) {
      await writeAuditLog({ ...auditBase, message_id: messageId, outcome: 'skipped' });
      console.log(`Skipped (duplicate) — messageId=${messageId} key=${dedupeKey}`);
      res.sendStatus(200);
      return;
    }

    // Write to HubSpot
    const contactId = await upsertContact(token, extraction);
    // notes_enabled gates activity logging (now an Email engagement, not a Note); the
    // setting name is retained to avoid a Settings migration.
    if (portal?.settings?.notes_enabled !== false) {
      await createEmailEngagement(token, contactId, extraction, emailText, portalId, threadId);
    }

    // Post an internal comment back on the thread linking to the contact. The thread
    // stays associated with the aggregator (cars.com etc.) and can't be repointed, so
    // this is the agent's only in-conversation pointer to the real buyer record. Always
    // on (independent of notes_enabled) and best-effort: the contact is already written,
    // so a failed comment must not fail the task or trigger a re-bill on retry.
    const fullName = [extraction.firstname, extraction.lastname].filter(Boolean).join(' ') || null;
    const comment = contactComment(portalId, contactId, fullName);
    await postThreadComment(token, threadId, comment.text, comment.richText).catch(err =>
      console.warn(`Failed to post contact link comment to thread ${threadId}`, err),
    );

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

    // Permanent HubSpot client errors (4xx, e.g. INVALID_EMAIL) will never succeed on
    // retry — returning 500 just spins the Cloud Tasks retry queue. Record the failure
    // and ack with 200 so the task is dropped. Transient errors (5xx, network, 429)
    // fall through to 500 and get retried.
    if (err instanceof HubSpotApiError && err.isPermanent) {
      await writeAuditLog({
        portal_id: portalId.toString(),
        install_id: portalId.toString(),
        message_id: messageId,
        conversation_id: threadId.toString(),
        source_classified: null,
        extraction_json: null,
        confidence: null,
        outcome: 'errored',
        hubspot_contact_id: null,
        created_at: Date.now(),
      }).catch(e => console.error('Failed to write errored audit log', { messageId, e }));
      console.log(`Permanent error — not retrying. messageId=${messageId} status=${err.status}`);
      res.sendStatus(200);
      return;
    }

    // Return 500 so Cloud Tasks will retry (transient failure)
    res.status(500).json({ error: 'Processing failed' });
  }
});
