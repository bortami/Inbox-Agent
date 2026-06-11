import { Router } from 'express';
import { getValidToken } from '../lib/token-store.js';
import { verifyHubSpotSignature } from '../lib/hubspot-verify.js';

export const ownersRouter = Router();

ownersRouter.get('/', verifyHubSpotSignature, async (req, res) => {
  const portalId = req.query.portalId as string | undefined;
  const after = req.query.after as string | undefined;

  if (!portalId) {
    res.status(400).json({ error: 'portalId required' });
    return;
  }

  try {
    const token = await getValidToken(portalId);
    const url = new URL('https://api.hubapi.com/crm/v3/owners');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);

    const upstream = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await upstream.text();
    res.status(upstream.status).type('application/json').send(body);
  } catch (err) {
    console.error('GET /owners error', { portalId, err });
    res.status(500).json({ error: 'Failed to load owners' });
  }
});
