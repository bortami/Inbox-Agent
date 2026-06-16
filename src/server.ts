import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { webhookRouter } from './routes/webhook.js';
import { oauthRouter } from './routes/oauth.js';
import { taskRouter } from './routes/task-handler.js';
import { replayRouter } from './routes/replay.js';
import { settingsRouter } from './routes/settings.js';
import { ownersRouter } from './routes/owners.js';
import { journalRouter } from './routes/journal.js';
import { agentToolsRouter } from './routes/agent-tools.js';
import { billingRouter, stripeWebhookRouter } from './routes/billing.js';
import { ensureUninstallSubscription } from './lib/hubspot-journal.js';

const app = express();

// Cloud Run sits behind a proxy; trust it so rate-limit and cookies see the real client IP/scheme.
app.set('trust proxy', 1);

// Stripe webhook must be verified against the raw request body — mount it BEFORE
// express.json() so the global JSON parser never consumes the body. It uses
// express.raw() internally. The rest of the billing routes are mounted after JSON
// parsing, alongside the other routers below.
app.use('/billing', stripeWebhookRouter);

// Capture raw body for HubSpot signature verification before JSON parsing
app.use(
  express.json({
    verify: (req: express.Request & { rawBody?: string }, _res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
);

app.use(cookieParser(process.env.COOKIE_SECRET));

const oauthLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/webhook', webhookLimiter, webhookRouter);
app.use('/oauth', oauthLimiter, oauthRouter);
app.use('/tasks', taskRouter);
app.use('/replay', replayRouter);
app.use('/settings', settingsRouter);
app.use('/owners', ownersRouter);
app.use('/journal', journalRouter);
app.use('/agent-tools', agentToolsRouter);
app.use('/billing', billingRouter);

const PORT = parseInt(process.env.PORT ?? '8080', 10);
app.listen(PORT, () => {
  console.log(`LeadCatch listening on port ${PORT}`);
  console.log(`AI provider: ${process.env.AI_PROVIDER ?? 'claude'}`);

  // Ensure the journal subscription for APP_UNINSTALL events is registered.
  // Idempotent — safe to run on every cold start.
  ensureUninstallSubscription().catch(err =>
    console.error('Failed to ensure journal uninstall subscription', err),
  );
});
