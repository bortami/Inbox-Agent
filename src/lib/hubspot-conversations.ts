import { htmlToText } from './html-to-text.js';

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
    throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
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

export async function assignThread(
  accessToken: string,
  threadId: number,
  actorId: string,
): Promise<void> {
  const res = await fetch(
    `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/assignee`,
    {
      method: 'POST',
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
