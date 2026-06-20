# LeadCatch — Claude Code Guide

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
- **AI:** Abstracted `AIExtractor` interface. Only `ClaudeExtractor` (`claude-sonnet-4-6`) is implemented today; `getExtractor()` returns it unconditionally. A `GeminiExtractor` is planned but not yet written, so `AI_PROVIDER` is not currently read.
- **Billing:** Stripe subscription (flat per-tier) + metered per-lead usage, gated before extraction. Billing identity is owned by Red Anthos (cross-product Stripe customer); LeadCatch reuses that customer.
- **HubSpot:** Public app, OAuth 2.0, `conversation.newMessage` webhook; uninstall handled via the webhooks journal (polled by Cloud Scheduler).

## Project status

Code-complete through Phase 4 (Breeze Agent Tools) and Phase 8 (Stripe billing); see [todo.md](todo.md) for the per-phase checklist. The full pipeline is implemented and type-checks clean: signed webhook → Cloud Tasks → billing gate → AI extraction → confidence/dedupe routing → HubSpot upsert + Note, with audit logging and an account-first Red Anthos onboarding/billing handoff.

Not yet done before first users: validate extraction quality on real dealer email (Phase 6 — only synthetic samples tested so far); Marketplace assets (Phase 5 — LeadCatch-specific Privacy Policy + ToS, setup docs, demo video); and the remaining billing infra setup (Firestore composite index for the grace-period sweep, `BILLING_GRACE_DAYS` + Stripe price env vars — handled with Red Anthos, outside this repo). There are no automated tests.

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

Requested in the OAuth flow ([src/routes/oauth.ts](src/routes/oauth.ts)): `oauth`, `conversations.read`, `conversations.write`, `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.owners.read`, `crm.schemas.contacts.write`.

- `conversations.write` — assign low-confidence threads to a review owner.
- `crm.objects.owners.read` — populate the review-owner picker on the Settings page.

Note: there is no separate Notes scope in HubSpot — Note engagements are covered by `crm.objects.contacts.*`. `timeline` (legacy Timeline Events) is **not** used; per-email history is written as Notes. App Events (the modern replacement) require HubSpot technology partner approval and are planned for the Marketplace phase.

## GCP services in use

| Service | Purpose |
|---|---|
| Cloud Run | Hosts the Node.js service (webhook receiver + OAuth + agent tool routes) |
| Cloud Tasks | Async processing queue — decouples webhook receipt from extraction work |
| Cloud Scheduler | Polls the HubSpot webhooks journal for uninstalls and runs the billing grace-period sweep (`POST /journal/sync`) |
| Firestore | `/portals`, `/dedupeKeys` (TTL 24h), `/auditLog`, `/billing` (survives uninstall), `/installStates` (TTL), journal offset |
| Secret Manager | `HUBSPOT_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Red Anthos handoff verification key |

## Webhook signature verification

All inbound HubSpot requests must be verified against `X-HubSpot-Signature-v3` before any processing — the webhook receiver, Breeze Agent Tool `actionUrl` routes, and HubSpot-signed Settings/billing routes. Cloud Tasks and Cloud Scheduler routes are instead verified via Google OIDC tokens; the Stripe webhook is verified against the Stripe signature on the raw body.

## What's built vs. out of scope

Built (beyond the original v1 line): Stripe billing (Phase 8), Breeze Agent Tools (Phase 4), the per-portal Settings page, and account-first Red Anthos onboarding.

Still out of scope: outbound replies, Lead object, Listing/custom-object matching, analytics dashboards, multi-source per-template prompts (Phase 7).


