import type { ExtractionResult } from '../ai/types.js';

// associationTypeId 198 = email_to_contact (HUBSPOT_DEFINED)
const EMAIL_TO_CONTACT_ASSOC = 198;

interface UpsertResponse {
  results: Array<{ id: string }>;
  status: string;
}

interface EngagementResponse {
  id: string;
}

// Error thrown by hsPost when HubSpot returns a non-2xx response. Carries the HTTP
// status so callers can distinguish permanent client errors (4xx — bad data, never
// retry) from transient ones (5xx — worth retrying).
export class HubSpotApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HubSpotApiError';
  }

  // A 4xx (except 429 rate-limit) is a permanent failure: retrying the same payload
  // will fail the same way. 429 and 5xx are transient and should be retried.
  get isPermanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

async function hsPost<T>(accessToken: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new HubSpotApiError(res.status, `POST ${path} failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

function listingRefValue(lr: ExtractionResult['listing_reference']): string | undefined {
  if (!lr) return undefined;
  if (lr.vin) return `VIN: ${lr.vin}`;
  if (lr.stock_number) return `Stock: ${lr.stock_number}`;
  if (lr.url) return lr.url;
  if (lr.title) return lr.title;
  return undefined;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function conversationUrl(portalId: number, threadId: number): string {
  return `https://app.hubspot.com/live-messages/${portalId}/inbox/${threadId}`;
}

// Subject for the logged email activity. The extraction has no real subject line, so we
// synthesize one from the lead's name (falling back to source, then a generic label) so
// the timeline entry reads meaningfully.
function emailSubject(extraction: ExtractionResult): string {
  const name = [extraction.firstname, extraction.lastname].filter(Boolean).join(' ').trim();
  if (name) return `New inquiry from ${name}`;
  if (extraction.source) return `New lead via ${extraction.source.trim()}`;
  return 'New inbound lead inquiry';
}

// HTML body for hs_email_html — the full original email content followed by a clickable
// "View original conversation" link. The raw email is escaped (and newlines converted to
// <br>) so it renders faithfully and can't break the markup or inject tags.
function emailBodyHtml(emailText: string, portalId: number, threadId: number): string {
  const body = escapeHtml(emailText).replace(/\n/g, '<br>');
  const link = `<a href="${conversationUrl(portalId, threadId)}">View original conversation</a>`;
  return `${body}<br><br>${link}`;
}

// Plain-text body for hs_email_text — the full original email content plus the raw
// conversation URL.
function emailBodyText(emailText: string, portalId: number, threadId: number): string {
  return `${emailText}\n\nOriginal conversation: ${conversationUrl(portalId, threadId)}`;
}

// Returns a normalized, valid email or null. The AI extractor sometimes emits
// truthy-but-invalid values ("null", "n/a", "not provided", whitespace) that pass a
// bare `!email` check but get rejected by HubSpot with INVALID_EMAIL — so we validate
// the shape here, not just truthiness.
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  // Minimal but real address shape: something@something.tld with no spaces.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export async function upsertContact(
  accessToken: string,
  extraction: ExtractionResult,
): Promise<string> {
  const email = normalizeEmail(extraction.email);
  if (!email) {
    throw new Error('Cannot upsert contact: email is missing or invalid');
  }

  const properties: Record<string, string> = {
    email,
    inbox_agent_inquiry_message: extraction.message,
    inbox_agent_processed_at: new Date().toISOString(),
  };

  if (extraction.firstname) properties.firstname = extraction.firstname;
  if (extraction.lastname) properties.lastname = extraction.lastname;
  if (extraction.phone) properties.phone = extraction.phone;
  if (extraction.source) properties.inbox_agent_lead_source = extraction.source.trim().toLowerCase();

  const ref = listingRefValue(extraction.listing_reference);
  if (ref) properties.inbox_agent_listing_ref = ref;

  const data = await hsPost<UpsertResponse>(
    accessToken,
    '/crm/objects/2026-03/contacts/batch/upsert',
    {
      inputs: [{ idProperty: 'email', id: email, properties }],
    },
  );

  const contactId = data.results?.[0]?.id;
  if (!contactId) {
    throw new Error('Contact upsert returned no ID');
  }

  return contactId;
}

// Logs the inbound lead as an Email engagement on the contact, so it appears in the
// contact's email timeline. Direction is INCOMING_EMAIL (these are buyer emails arriving
// in the inbox). The HTML body carries the clickable "View original conversation" link.
export async function createEmailEngagement(
  accessToken: string,
  contactId: string,
  extraction: ExtractionResult,
  emailText: string,
  portalId: number,
  threadId: number,
): Promise<string> {
  const email = await hsPost<EngagementResponse>(
    accessToken,
    '/crm/objects/2026-03/emails',
    {
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_email_direction: 'INCOMING_EMAIL',
        hs_email_subject: emailSubject(extraction),
        hs_email_html: emailBodyHtml(emailText, portalId, threadId),
        hs_email_text: emailBodyText(emailText, portalId, threadId),
      },
      associations: [
        {
          to: { id: parseInt(contactId, 10) },
          types: [
            {
              associationCategory: 'HUBSPOT_DEFINED',
              associationTypeId: EMAIL_TO_CONTACT_ASSOC,
            },
          ],
        },
      ],
    },
  );

  return email.id;
}
