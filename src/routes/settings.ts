import { Router } from 'express';
import { getPortal, savePortal } from '../lib/firestore.js';
import { verifyHubSpotSignature } from '../lib/hubspot-verify.js';
import type { PortalSettings } from '../types/index.js';

export const settingsRouter = Router();

const DEFAULT_SETTINGS: PortalSettings = {
  review_owner_email: null,
  notes_enabled: true,
};

settingsRouter.get('/', verifyHubSpotSignature, async (req, res) => {
  const portalId = req.query.portalId as string | undefined;

  if (!portalId) {
    res.status(400).json({ error: 'portalId required' });
    return;
  }

  try {
    const portal = await getPortal(portalId);
    if (!portal) {
      res.status(404).json({ error: 'Portal not found' });
      return;
    }
    res.json(portal.settings ?? DEFAULT_SETTINGS);
  } catch (err) {
    console.error('GET /settings error', { portalId, err });
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

settingsRouter.post('/', verifyHubSpotSignature, async (req, res) => {
  const { portalId, settings } = req.body as {
    portalId?: string;
    settings?: PortalSettings;
  };

  if (!portalId || !settings) {
    res.status(400).json({ error: 'portalId and settings required' });
    return;
  }

  try {
    const portal = await getPortal(portalId);
    if (!portal) {
      res.status(404).json({ error: 'Portal not found' });
      return;
    }
    await savePortal(portalId, { ...portal, settings });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /settings error', { portalId, err });
    res.status(500).json({ error: 'Failed to save settings' });
  }
});
