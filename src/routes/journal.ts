import { Router } from 'express';
import { syncUninstallEvents } from '../lib/hubspot-journal.js';

export const journalRouter = Router();

// Called by Cloud Scheduler (e.g. every 5 minutes) to poll the HubSpot webhooks
// journal for APP_UNINSTALL events and delete the corresponding Firestore data.
journalRouter.post('/sync', async (req, res) => {
  try {
    const processed = await syncUninstallEvents();
    console.log(`Journal sync complete — ${processed} uninstall(s) processed`);
    res.json({ ok: true, processed });
  } catch (err) {
    console.error('Journal sync error', err);
    res.status(500).json({ error: 'Journal sync failed' });
  }
});
