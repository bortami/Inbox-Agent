import type { ExtractionResult } from '../ai/types.js';

// associationTypeId 202 = note_to_contact (HUBSPOT_DEFINED)
const NOTE_TO_CONTACT_ASSOC = 202;

interface UpsertResponse {
  results: Array<{ id: string }>;
  status: string;
}

interface NoteResponse {
  id: string;
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
    throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
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

function formatNoteBody(
  extraction: ExtractionResult,
  portalId: number,
  threadId: number,
): string {
  const lines: string[] = [];

  lines.push(`Confidence: ${extraction.confidence}`);
  lines.push('');
  lines.push('Message:');
  lines.push(extraction.message);

  const ref = listingRefValue(extraction.listing_reference);
  if (ref) {
    lines.push('');
    lines.push(`Listing: ${ref}`);
  }

  lines.push('');
  lines.push(`Portal: ${portalId}  |  Conversation ID: ${threadId}`);

  return lines.join('\n');
}

export async function upsertContact(
  accessToken: string,
  extraction: ExtractionResult,
): Promise<string> {
  if (!extraction.email) {
    throw new Error('Cannot upsert contact: email is null');
  }

  const properties: Record<string, string> = {
    email: extraction.email,
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
      inputs: [{ idProperty: 'email', id: extraction.email, properties }],
    },
  );

  const contactId = data.results?.[0]?.id;
  if (!contactId) {
    throw new Error('Contact upsert returned no ID');
  }

  return contactId;
}

export async function createNote(
  accessToken: string,
  contactId: string,
  extraction: ExtractionResult,
  portalId: number,
  threadId: number,
): Promise<string> {
  const noteBody = formatNoteBody(extraction, portalId, threadId);

  const note = await hsPost<NoteResponse>(
    accessToken,
    '/crm/objects/2026-03/notes',
    {
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_note_body: noteBody,
      },
      associations: [
        {
          to: { id: parseInt(contactId, 10) },
          types: [
            {
              associationCategory: 'HUBSPOT_DEFINED',
              associationTypeId: NOTE_TO_CONTACT_ASSOC,
            },
          ],
        },
      ],
    },
  );

  return note.id;
}
