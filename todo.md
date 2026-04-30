# Todo

Phased build plan. Each phase is shippable on its own — get one source working end-to-end (Phase 0 + 1) for a real pilot portal before generalizing.

See [planning.md](planning.md) for the spec each item maps to.

## Phase 0 — Foundation

- [ ] Create the public app in the HubSpot Developer account
- [ ] Configure OAuth: redirect URL, required scopes (`oauth`, `conversations.read`, `crm.objects.contacts.*`, `crm.objects.leads.*`, `crm.schemas.custom.read`)
- [ ] Subscribe the app to the `conversation.newMessage` webhook event
- [ ] Cloudflare Worker scaffold with `wrangler init` (TypeScript)
- [ ] Provision D1 database; create `portals`, `processed_messages`, `audit_log` tables
- [ ] OAuth install flow: install URL handler, callback handler, token exchange, refresh logic
- [ ] Webhook endpoint with HubSpot `X-HubSpot-Signature-v3` verification
- [ ] End-to-end "hello world": install on a test portal, receive a webhook, log it, return 200
- [ ] Set secrets via `wrangler secret put` (`HUBSPOT_CLIENT_SECRET`, `HUBSPOT_APP_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`)

## Phase 1 — Single-source MVP

Goal: one real source, end-to-end, on one pilot portal.

- [ ] Pick the highest-volume source for the pilot dealer (likely CarGurus or Boat Trader)
- [ ] Fetch the full message body via Conversations API on webhook receipt
- [ ] HTML → clean text utility for email bodies
- [ ] Define the extraction JSON schema (firstname, lastname, email, phone, message, listing_reference, is_actual_lead, confidence)
- [ ] Build the extraction Claude call (Sonnet 4.6, tool-use for schema enforcement)
- [ ] Dedupe check against `processed_messages` (email + listing ref + 24h window)
- [ ] HubSpot writer: upsert Contact by email, create Lead with `hs_lead_source` and custom `lead_source_detail`, associate Lead → Contact
- [ ] Write `audit_log` row for every webhook processed
- [ ] Run on 50+ real emails from the pilot dealer; tune the prompt based on misses

## Phase 2 — Multi-source generalization

- [ ] Source classifier: `From:` domain heuristic with Claude fallback for unknown senders
- [ ] Per-source extraction prompts or example sets (few-shot per known template)
- [ ] Add 4–5 additional sources (AutoTrader, Boat Trader, Facebook Marketplace, dealer site forms, generic)
- [ ] "Unknown / freeform" bucket — extractor handles direct buyer emails without a template

## Phase 3 — Listing / Vehicle linking

- [ ] Detect each portal's Listing custom object schema on install (or first webhook)
- [ ] Extract VIN, stock number, listing URL from email body via the same Claude call
- [ ] Match Listing record by VIN → stock number → URL (in priority order)
- [ ] Associate Lead → Listing on match; record unmatched listing references in audit log

## Phase 4 — Quality controls

- [ ] Confidence routing: low-confidence extractions skip record creation, surface for human review
- [ ] Spam / non-lead filter via `is_actual_lead` field; track false-negatives in audit log
- [ ] Human review surface: HubSpot ticket created (or conversation tagged) for low-confidence messages
- [ ] Replay endpoint: re-run extraction on a past `message_id` from `audit_log`
- [ ] Backfill mode: process historical inbox messages on first install (gated behind a config flag)

## Phase 5 — Distribution

- [ ] App listing copy, screenshots, demo video
- [ ] Privacy policy and support docs
- [ ] Per-install configuration page (Listing object selection, source-detail field mapping)
- [ ] Submit for HubSpot Marketplace review, or distribute via direct install link to early users
- [ ] Uninstall handler: delete D1 rows for the portal

## Later / maybe

- [ ] Auto-reply or instant-engagement workflow trigger on Lead creation
- [ ] Outbound thread monitoring (treat dealer replies as engagement signal)
- [ ] ROI-per-source dashboard inside HubSpot (custom report bundled with the app)
- [ ] Multi-channel: chat, SMS, web form sources beyond Conversations email
- [ ] Billing / paid tiers if distributed at scale
