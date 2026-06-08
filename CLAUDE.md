# Inbox-Agent — Claude Code Guide

## What this project is

A HubSpot public app that converts inbound emails in a HubSpot Conversations Inbox into structured Contact records. When a new email arrives, a Cloud Run service receives the webhook, an AI model extracts structured data from the email body, and a Contact is upserted in HubSpot with custom properties and a Note per email for full history. Works in any HubSpot tier — no Lead object, no custom objects required.

See [planning.md](planning.md) for the full spec and [todo.md](todo.md) for the phased build plan.

## technical references
Always check the hubspot-dev mcp server when looking up, planning, or executing anythng to do with hubspot.

## Stack

- **Runtime:** Node.js/TypeScript on Google Cloud Run
- **Queue:** Google Cloud Tasks (async webhook processing)
- **State:** Firestore (per-portal OAuth tokens, dedupe ledger, audit log)
- **Secrets:** GCP Secret Manager
- **AI:** Abstracted `AIExtractor` interface — `claude-sonnet-4-6` or `gemini-2.0-flash` selected via `AI_PROVIDER` env var
- **HubSpot:** Public app, OAuth 2.0, `conversation.newMessage` webhook

## Project status

Pre-code — planning and spec only. No source files exist yet. Phase 0 (Foundation) is the next step.

## Key design decisions

- **Contact-only data model.** No Lead object, no Listing custom object. All inquiry data goes onto the Contact via `inbox_agent_*` custom properties (latest inquiry) and a Note engagement per email (full history).
- **Async by default.** The webhook receiver returns 200 immediately and enqueues a Cloud Tasks task. The task handler does all the work.
- **AI provider is abstracted.** Both `ClaudeExtractor` and `GeminiExtractor` implement the same `AIExtractor` interface. Switch with `AI_PROVIDER=claude|gemini`. Evaluate on real emails before committing.
- **Structured output always JSON.** Use `output_config.format` (Claude) or `response_schema` (Gemini) — never free-text parsing.
- **Dedupe via Firestore TTL.** The `/dedupeKeys` collection uses a TTL policy for 24h expiry — no cron or manual cleanup.

## Extraction schema

Every email produces this shape or is discarded:

```typescript
{
  firstname: string | null,
  lastname: string | null,
  email: string | null,
  phone: string | null,
  message: string,
  listing_reference: { vin?: string, stock_number?: string, url?: string, title?: string } | null,
  is_actual_lead: boolean,
  confidence: "high" | "medium" | "low"
}
```

Low-confidence or non-lead results are logged but never write to HubSpot.

## HubSpot scopes

`oauth`, `conversations.read`, `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.write`, `crm.objects.notes.write`

Note: `timeline` (legacy Timeline Events) is **not** used. Per-email history is written as Notes. App Events (the modern replacement) require HubSpot technology partner approval and are planned for the Marketplace phase.

## GCP services in use

| Service | Purpose |
|---|---|
| Cloud Run | Hosts the Node.js service (webhook receiver + OAuth + agent tool routes) |
| Cloud Tasks | Async processing queue — decouples webhook receipt from extraction work |
| Firestore | `/portals`, `/dedupeKeys` (TTL 24h), `/auditLog` |
| Secret Manager | `HUBSPOT_CLIENT_SECRET`, `HUBSPOT_APP_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY` |

## Webhook signature verification

All inbound HubSpot requests must be verified against `X-HubSpot-Signature-v3` before any processing. This applies to both the webhook receiver and any Breeze Agent Tool `actionUrl` routes.

## What's out of scope for v1

Outbound replies, Lead object, Listing/custom object matching, Breeze Agent Tools (planned v2), per-portal admin UI, billing, analytics dashboards.


