const PROPERTY_GROUP = 'inbox_agent';

const PROPERTIES = [
  {
    name: 'inbox_agent_lead_source',
    label: 'Lead Source (LeadCatch)',
    type: 'string',
    fieldType: 'text',
    description: 'Source identified by LeadCatch (e.g. CarGurus, Boat Trader, Dealer Site Form)',
  },
  {
    name: 'inbox_agent_inquiry_message',
    label: 'Inquiry Message (LeadCatch)',
    type: 'string',
    fieldType: 'textarea',
    description: 'Freeform buyer message extracted from the most recent lead email',
  },
  {
    name: 'inbox_agent_listing_ref',
    label: 'Listing Reference (LeadCatch)',
    type: 'string',
    fieldType: 'text',
    description: 'VIN, stock number, or listing URL extracted from the most recent lead email',
  },
  {
    name: 'inbox_agent_processed_at',
    label: 'Processed At (LeadCatch)',
    type: 'string',
    fieldType: 'text',
    description: 'ISO 8601 timestamp of the most recent email processed by LeadCatch',
  },
] as const;

async function hs(accessToken: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseBody = await res.text();
  if (!res.ok && res.status !== 409) {
    console.error(`HubSpot API error ${method} ${path}`, { status: res.status, body: responseBody });
  }
  return { status: res.status, ok: res.ok };
}

export async function ensureInboxAgentProperties(accessToken: string): Promise<void> {
  const { status: groupStatus, ok: groupOk } = await hs(
    accessToken,
    'POST',
    '/crm/v3/properties/contacts/groups',
    { name: PROPERTY_GROUP, label: 'LeadCatch' },
  );

  if (!groupOk && groupStatus !== 409) {
    throw new Error(`Failed to create inbox_agent property group: ${groupStatus}`);
  }

  for (const prop of PROPERTIES) {
    const { status, ok } = await hs(accessToken, 'POST', '/crm/v3/properties/contacts', {
      ...prop,
      groupName: PROPERTY_GROUP,
      hasUniqueValue: false,
      hidden: false,
    });

    if (!ok && status !== 409) {
      throw new Error(`Failed to create property ${prop.name}: ${status}`);
    }
  }
}
