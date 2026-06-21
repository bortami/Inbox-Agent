import { htmlToText } from './html-to-text.js';
import { HubSpotApiError } from './hubspot-writer.js';

interface MessageResponse {
  text?: string;
  richText?: string;
  truncationStatus?: string;
}

interface OriginalContentResponse {
  text?: string;
  richText?: string;
}


async function getJson<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    // Throw HubSpotApiError (carrying the status) rather than a plain Error so the task
    // handler can drop permanent failures instead of retrying them. A 404 here means the
    // thread is gone — common for phantom/expired webhook objectIds — and will never
    // succeed on retry; the handler's isPermanent check acks it with 200.
    throw new HubSpotApiError(res.status, `GET ${path} failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

// Returns the inbox ID the given thread belongs to, or null if HubSpot doesn't report
// one. inboxId isn't in the thread's default response, so we request it explicitly via
// ?property=inboxId. Used by the task handler to enforce the per-portal inbox filter.
export async function fetchThreadInboxId(
  accessToken: string,
  threadId: number,
): Promise<string | null> {
  const thread = await getJson<{ inboxId?: string }>(
    accessToken,
    `/conversations/v3/conversations/threads/${threadId}?property=inboxId`,
  );
  return thread.inboxId ?? null;
}

export async function fetchMessageText(
  accessToken: string,
  threadId: number,
  messageId: string,
): Promise<string> {
  const msg = await getJson<MessageResponse>(
    accessToken,
    `/conversations/v3/conversations/threads/${threadId}/messages/${messageId}`,
  );

  // For truncated messages, fetch the complete original content
  if (msg.truncationStatus && msg.truncationStatus !== 'NOT_TRUNCATED') {
    try {
      const orig = await getJson<OriginalContentResponse>(
        accessToken,
        `/conversations/v3/conversations/threads/${threadId}/messages/${messageId}/original-content`,
      );
      if (orig.text) return orig.text;
      if (orig.richText) return htmlToText(orig.richText);
    } catch (err) {
      console.warn(`Could not fetch original content for ${messageId}, using truncated version`, err);
    }
  }

  if (msg.text) return msg.text;
  if (msg.richText) return htmlToText(msg.richText);

  throw new Error(`Message ${messageId} has no text content`);
}

// Posts an internal COMMENT to a thread. Comments are visible only to agents in the
// inbox — never sent to the visitor — so they're safe for linking back to the Contact
// LeadCatch created. Inbound dealer emails always come from generic aggregator
// addresses (noreply@cars.com, leads@autotrader.com), so HubSpot's auto-created thread
// contact is the aggregator, not the buyer; a thread's associatedContactId is
// system-owned and can't be repointed via the API. This comment is how an agent gets
// from the aggregator thread to the real buyer Contact.
//
// `text` is the plain-text fallback; `richText` is the HTML the inbox actually renders.
// The contact link is only clickable when it's an <a href> in richText — a bare URL in
// text renders as non-clickable plain text.
export async function postThreadComment(
  accessToken: string,
  threadId: number,
  text: string,
  richText: string,
): Promise<void> {
  const res = await fetch(
    `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'COMMENT', text, richText }),
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to post comment to thread ${threadId}: ${res.status} ${await res.text()}`);
  }
}

// Resolves a HubSpot user's email to the agent actor ID the assignee endpoint expects
// (`A-{userId}`). The Settings page stores only the review owner's email, but a thread
// assignee must be an actor ID, not an email — so we look the owner up in /crm/v3/owners
// and build the actor from their userId. Returns null if no owner matches the email or
// the owner has no userId (e.g. an integration/queue owner).
export async function resolveOwnerActorId(
  accessToken: string,
  email: string,
): Promise<string | null> {
  const url = new URL('https://api.hubapi.com/crm/v3/owners');
  url.searchParams.set('email', email);
  url.searchParams.set('limit', '1');

  const data = await getJson<{ results?: Array<{ userId?: number | null }> }>(
    accessToken,
    url.pathname + url.search,
  );
  const userId = data.results?.[0]?.userId;
  return userId ? `A-${userId}` : null;
}

export async function assignThread(
  accessToken: string,
  threadId: number,
  actorId: string,
): Promise<void> {
  const res = await fetch(
    `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/assignee`,
    {
      // PUT, not POST — the assignee endpoint is PUT; POST returns 405.
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ actorId }),
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to assign thread ${threadId}: ${res.status} ${await res.text()}`);
  }
}
