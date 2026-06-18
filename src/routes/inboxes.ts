import { Router } from 'express';
import { getValidToken } from '../lib/token-store.js';
import { verifyHubSpotSignature } from '../lib/hubspot-verify.js';

export const inboxesRouter = Router();

interface HubSpotInbox {
  id: string;
  name: string;
  type: 'INBOX' | 'HELP_DESK';
  archived: boolean;
}

// GET /inboxes?portalId=… — lists the portal's conversations inboxes for the settings
// dropdown. Filters to non-archived INBOX-type inboxes only (help desk workspaces are a
// different workflow and not used for lead capture). Returns { results: [{ id, name }] }.
inboxesRouter.get('/', verifyHubSpotSignature, async (req, res) => {
  const portalId = req.query.portalId as string | undefined;

  if (!portalId) {
    res.status(400).json({ error: 'portalId required' });
    return;
  }

  try {
    const token = await getValidToken(portalId);
    const upstream = await fetch(
      'https://api.hubapi.com/conversations/v3/conversations/inboxes',
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!upstream.ok) {
      const body = await upstream.text();
      console.error('GET /inboxes upstream error', { portalId, status: upstream.status, body });
      res.status(upstream.status).type('application/json').send(body);
      return;
    }

    const data = (await upstream.json()) as { results?: HubSpotInbox[] };
    const results = (data.results ?? [])
      .filter(i => i.type === 'INBOX' && !i.archived)
      .map(i => ({ id: i.id, name: i.name }));

    res.json({ results });
  } catch (err) {
    console.error('GET /inboxes error', { portalId, err });
    res.status(500).json({ error: 'Failed to load inboxes' });
  }
});
