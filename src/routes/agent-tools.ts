import { Router, type Request, type Response } from 'express';
import { verifyHubSpotSignature } from '../lib/hubspot-verify.js';
import {
  getAuditLogByMessageId,
  getLatestAuditLogByContactId,
  getRecentAuditLogs,
} from '../lib/firestore.js';

export const agentToolsRouter = Router();

agentToolsRouter.use(verifyHubSpotSignature);

interface AgentToolRequestBody {
  callbackId?: string;
  origin?: { portalId?: number; userId?: number; userEmail?: string };
  context?: { agentId?: number; source?: string };
  inputFields?: Record<string, unknown>;
  // HubSpot has historically sent both `fields` and `inputFields`. Accept either.
  fields?: Record<string, unknown>;
}

function readInputs(req: Request): Record<string, unknown> {
  const body = req.body as AgentToolRequestBody;
  return body.inputFields ?? body.fields ?? {};
}

function readPortalId(req: Request): string | null {
  const body = req.body as AgentToolRequestBody;
  const id = body.origin?.portalId;
  return id ? String(id) : null;
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : String(value);
}

// HubSpot requires outputFields to be a flat object of string-string pairs.
// Non-string values cause all outputs to be dropped.
function outputs(fields: Record<string, string>) {
  return { outputFields: fields };
}

agentToolsRouter.post('/get-recent-leads', async (req: Request, res: Response) => {
  const portalId = readPortalId(req);
  if (!portalId) {
    res.status(400).json(outputs({ error: 'Missing portalId in request origin' }));
    return;
  }

  const inputs = readInputs(req);
  const source = asString(inputs.source);
  const sinceIso = asString(inputs.since);
  const limitRaw = asString(inputs.limit);
  const limit = limitRaw ? Math.min(parseInt(limitRaw, 10) || 25, 100) : 25;

  let sinceMs: number | undefined;
  if (sinceIso) {
    const parsed = Date.parse(sinceIso);
    if (!Number.isNaN(parsed)) sinceMs = parsed;
  }

  try {
    const entries = await getRecentAuditLogs(portalId, { source, sinceMs, limit });
    const summary = entries.map(e => {
      const x = (e.extraction_json ?? {}) as Record<string, unknown>;
      return {
        message_id: e.message_id,
        source: e.source_classified,
        confidence: e.confidence,
        outcome: e.outcome,
        hubspot_contact_id: e.hubspot_contact_id,
        firstname: x.firstname ?? null,
        lastname: x.lastname ?? null,
        email: x.email ?? null,
      };
    });

    res.json(
      outputs({
        count: String(summary.length),
        leads: JSON.stringify(summary),
      }),
    );
  } catch (err) {
    console.error('get-recent-leads error', err);
    res.status(500).json(outputs({ error: 'Failed to fetch recent leads' }));
  }
});

agentToolsRouter.post('/get-extraction-detail', async (req: Request, res: Response) => {
  const portalId = readPortalId(req);
  if (!portalId) {
    res.status(400).json(outputs({ error: 'Missing portalId in request origin' }));
    return;
  }

  const inputs = readInputs(req);
  const messageId = asString(inputs.message_id);
  const contactId = asString(inputs.hubspot_contact_id);
  if (!messageId && !contactId) {
    res.status(400).json(
      outputs({ error: 'Either message_id or hubspot_contact_id is required' }),
    );
    return;
  }

  try {
    const entry = messageId
      ? await getAuditLogByMessageId(messageId)
      : await getLatestAuditLogByContactId(portalId, contactId!);
    if (!entry || entry.portal_id !== portalId) {
      res.status(404).json(outputs({ error: 'Extraction not found for this portal' }));
      return;
    }

    const output: Record<string, string> = {
      message_id: entry.message_id,
      conversation_id: entry.conversation_id,
      source: entry.source_classified ?? '',
      confidence: entry.confidence ?? '',
      outcome: entry.outcome,
      extraction_json: JSON.stringify(entry.extraction_json ?? {}),
    };

    if (entry.hubspot_contact_id) {
      output.ctaCrmObjectType = 'contact';
      output.ctaCrmObjectId = entry.hubspot_contact_id;
      output.ctaLabel = 'View Contact';
    }

    res.json(outputs(output));
  } catch (err) {
    console.error('get-extraction-detail error', err);
    res.status(500).json(outputs({ error: 'Failed to fetch extraction detail' }));
  }
});

