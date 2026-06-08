import 'dotenv/config';
import express from 'express';
import { webhookRouter } from './routes/webhook.js';
import { oauthRouter } from './routes/oauth.js';
import { taskRouter } from './routes/task-handler.js';
import { replayRouter } from './routes/replay.js';
import { settingsRouter } from './routes/settings.js';
import { journalRouter } from './routes/journal.js';
import { ensureUninstallSubscription } from './lib/hubspot-journal.js';

const app = express();

// Capture raw body for HubSpot signature verification before JSON parsing
app.use(
  express.json({
    verify: (req: express.Request & { rawBody?: string }, _res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/webhook', webhookRouter);
app.use('/oauth', oauthRouter);
app.use('/tasks', taskRouter);
app.use('/replay', replayRouter);
app.use('/settings', settingsRouter);
app.use('/journal', journalRouter);

const PORT = parseInt(process.env.PORT ?? '8080', 10);
app.listen(PORT, () => {
  console.log(`Inbox Agent listening on port ${PORT}`);
  console.log(`AI provider: ${process.env.AI_PROVIDER ?? 'claude'}`);

  // Ensure the journal subscription for APP_UNINSTALL events is registered.
  // Idempotent — safe to run on every cold start.
  ensureUninstallSubscription().catch(err =>
    console.error('Failed to ensure journal uninstall subscription', err),
  );
});
