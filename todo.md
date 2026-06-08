# Todo

Phased build plan. Polish the app to Marketplace quality before chasing a real pilot portal — better installs, better feedback, better shot at approval.

See [planning.md](planning.md) for the spec each item maps to.

## Phase 0 — Foundation

- [x] Create the public app in the HubSpot Developer account
- [x] Configure OAuth: redirect URL, required scopes (`oauth`, `conversations.read`, `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.write`, `crm.objects.notes.write`); post-install redirect back to the portal's HubSpot contacts view
- [x] Subscribe the app to the `conversation.newMessage` webhook event
- [x] Register the `inbox_agent_*` custom contact property group + properties on install — called from OAuth callback via `ensureInboxAgentProperties()`, idempotent (409 = skip)
- [x] ~~Register the custom Timeline Event Type~~ — using Notes instead; App Events planned for Marketplace phase
- [x] Cloud Run scaffold: `Dockerfile`, `package.json`, TypeScript config, basic Express/Hono server
- [x] Create GCP project; enable Cloud Run, Cloud Tasks, Firestore, Secret Manager APIs
- [x] Create Firestore database (native mode); define `/portals`, `/dedupeKeys` (with TTL policy), `/auditLog` collections
- [x] Enable Cloud Tasks queue for async webhook processing
- [x] Configure Cloud Run service account with Firestore + Secret Manager + Cloud Tasks permissions
- [x] Store secrets via `gcloud secrets create` (`HUBSPOT_CLIENT_SECRET`, `HUBSPOT_APP_WEBHOOK_SECRET`); bind to Cloud Run service account
- [x] OAuth install flow: install URL handler, callback handler, token exchange, refresh logic
- [x] Webhook endpoint with HubSpot `X-HubSpot-Signature-v3` verification; enqueue Cloud Tasks task on receipt
- [x] End-to-end "hello world": install on a test portal, receive a webhook, log it, return 200
- [x] Wire `AI_PROVIDER` env var; scaffold `ClaudeExtractor` and `GeminiExtractor` behind shared `AIExtractor` interface

## Phase 1 — Core Pipeline

Goal: full extraction pipeline wired end-to-end.

- [x] Fetch the full message body via Conversations API on webhook receipt
- [x] HTML → clean text utility for email bodies
- [x] Define the extraction JSON schema (firstname, lastname, email, phone, message, listing_reference, is_actual_lead, confidence)
- [x] Build the extraction AI call via `AIExtractor` interface (JSON schema enforcement; `AI_PROVIDER` selects Claude or Gemini)
- [x] Dedupe check against `/dedupeKeys` in Firestore (TTL handles 24h expiry automatically)
- [x] HubSpot writer: upsert Contact by email (standard fields + `inbox_agent_*` custom properties); post Note engagement on the Contact
- [x] Write `/auditLog` document to Firestore for every webhook processed

## Phase 2 — Quality Controls

Goal: make the pipeline safe and observable before it touches real customer data. All pure code — no real installs needed.

- [x] Confidence routing: low-confidence extractions skip record creation, surface for human review
- [x] Spam / non-lead filter via `is_actual_lead` field; track false-negatives in audit log
- [x] Human review surface: on low-confidence extraction, call `POST /conversations/v3/conversations/threads/{threadId}/assignee` with `{ "actorId": portal.settings.review_owner_email }` to assign the existing inbox conversation to the reviewer — `threadId` is `event.objectId` from the webhook payload, already in `TaskPayload`; skip assignment silently if `review_owner_email` is not set (requires `conversations.write` scope, added in Phase 3)
- [x] Replay endpoint: re-run extraction on a past `message_id` from `audit_log`
- [x] Backfill mode: process historical inbox messages on first install, gated behind `portal.settings.backfill_enabled` (set in Phase 3 settings page)

## Phase 3 — App Lifecycle & Settings

Goal: handle the full install/uninstall lifecycle and give per-portal configuration. Uninstall is a hard requirement for HubSpot certification and must be demoed in the certification video.

**Uninstall handler:**
- [x] Handle the `app.uninstalled` webhook event in the existing webhook router: verify `X-HubSpot-Signature`, call the [Uninstall App API Endpoint](https://developers.hubspot.com/docs/api-reference/latest/app-management/app-uninstalls), delete `/portals/{portal_id}` and any related Firestore documents for the portal

**Firestore — Portal settings schema:**
- [x] Add `PortalSettings` interface to `src/types/index.ts`:
  ```
  {
    backfill_enabled?: boolean;           // run backfill of historical inbox on first install
    review_owner_email?: string | null;   // email address of HubSpot user to assign low-confidence conversations to (used as actorId directly in Conversations API)
    notes_enabled?: boolean;              // write a Note engagement per processed email (default: true)
    source_labels?: Record<string, string>;
  }
  ```
- [x] Add optional `settings?: PortalSettings` field to the existing `Portal` interface in `src/types/index.ts`

**Cloud Run — settings routes (`src/routes/settings.ts`):**
- [x] `GET /settings`: verify `X-HubSpot-Signature`; read `portalId` from query params; return `portal.settings` from Firestore (or hard-coded defaults if not yet saved)
- [x] `POST /settings`: verify `X-HubSpot-Signature`; validate body against `PortalSettings`; write updated `settings` field to `/portals/{portalId}` in Firestore
- [x] Mount the settings router on `src/server.ts`
- [x] Update the HubSpot writer (`src/lib/hubspot/writer.ts` or equivalent) to skip Note creation when `portal.settings.notes_enabled === false`

**HubSpot project — settings component (`inbox-ai-agent/`):**
- [x] Fix scopes in `inbox-ai-agent/src/app/app-hsmeta.json`: add `"conversations.write"` (needed to assign threads in the human review flow)
- [x] Add the Cloud Run service URL to `permittedUrls.fetch` in `inbox-ai-agent/src/app/app-hsmeta.json`
- [x] Add `local.json` proxy in `inbox-ai-agent/src/app/settings/` mapping the production Cloud Run URL → `http://localhost:8080` for local development via `hs project dev`
- [x] Build `SettingsPage.tsx` (`inbox-ai-agent/src/app/settings/`):
  - Fetch current settings on mount via `hubspot.fetch` GET to Cloud Run `/settings`
  - Fetch HubSpot owners list on mount via `hubspot.fetch` GET to `https://api.hubapi.com/crm/v3/owners` (already in `permittedUrls.fetch`); populate a `Select` displaying owner name, storing owner `email` as the value (used as `actorId` when assigning conversations)
  - Render: **Backfill** toggle (run historical inbox on first install), **Review owner** select (HubSpot user to assign low-confidence conversations to; no-op if unset), **Note creation** toggle (write a Note per processed email; default on), **Source label** overrides (text input per known source)
  - Save all fields in a single `hubspot.fetch` POST to Cloud Run `/settings`
  - Show success/error feedback via `actions.addAlert`
  - **Disconnect HubSpot** button (destructive) → POST `/uninstall` → calls HubSpot Uninstall App API + deletes Firestore portal data
- [x] Deploy via `hs project upload` and verify the **Settings** tab appears on the Connected Apps page in a test account

## Phase 4 — Breeze Agent Tools

Goal: register Inbox-Agent as a first-class Breeze AI participant — a strong differentiator for Marketplace listing and certification.

- [ ] Add `get_recent_leads` tool (`GET_DATA`): queries Firestore audit log by portal, source, and date range; returns structured list for Breeze
- [ ] Add `get_extraction_detail` tool (`GET_DATA`): returns full audit log entry (extraction JSON, confidence, outcome) for a given `message_id`
- [ ] Add `reprocess_email` tool (`TAKE_ACTION`): triggers the replay endpoint for a past `message_id`; requires user approval in Breeze
- [ ] Add `classify_source` tool (`GENERATE`): runs the source classifier on pasted email text; returns source name and confidence
- [ ] Register all tools in `src/app/workflow-actions/` with `*-hsmeta.json` config (`supportedClients: ["AGENTS"]`, `llmConfig.actionDescription`)
- [ ] Verify `X-HubSpot-Signature` on all tool `actionUrl` routes (same logic as webhook receiver)
- [ ] Test each tool with the HubSpot Developer Tool Testing Agent

## Phase 5 — Marketplace Submission Prep

Goal: assemble every asset HubSpot requires to list and certify the app. Nothing here requires a real portal install.

- [ ] App listing copy and screenshots (HubSpot brand rules: capital "S" in "HubSpot"; do not use "Hub" in the app name)
- [ ] Demo video: full install → configure → use → disconnect → uninstall flow (required for certification review — HubSpot will not review without it)
- [ ] Setup documentation on a live, public URL (no login wall): install steps with scope-approval screenshot, configure, use, disconnect, uninstall — must include current HubSpot UI screenshots
- [ ] Privacy policy (live, GDPR-compliant URL)
- [ ] Terms of service (live URL — separate from privacy policy; both required in listing)
- [ ] Pricing page on external website (listing pricing must match; use free/freemium if offering a no-cost tier)
- [ ] Support contact method (required listing field)
- [ ] "Shared data" table in listing: accurately maps each OAuth scope to data flowing in/out (bi-directional where applicable)
- [ ] Verify domain in HubSpot Developer account (required for certification)
- [ ] Submit for HubSpot Marketplace review, or distribute via direct install link during private beta

## Phase 6 — Real-world Pilot

Goal: validate extraction quality on real email volume. Requires 3+ active unique installs from portals unaffiliated with your org before HubSpot will approve the listing; certification requires 60+.

- [ ] Pick the highest-volume source for the pilot dealer (likely CarGurus or Boat Trader)
- [ ] Run on 50+ real emails from the pilot dealer; tune the prompt based on misses

## Phase 7 — Multi-source Expansion

Goal: generalize beyond the first source once real email data is available.

- [ ] Source classifier: `From:` domain heuristic with Claude fallback for unknown senders
- [ ] Per-source extraction prompts or example sets (few-shot per known template)
- [ ] Add 4–5 additional sources (AutoTrader, Boat Trader, Facebook Marketplace, dealer site forms, generic)
- [ ] "Unknown / freeform" bucket — extractor handles direct buyer emails without a template

## Later / maybe

- [ ] Auto-reply or workflow trigger on Contact update (e.g., enroll in a sequence when `inbox_agent_lead_source` is set)
- [ ] Outbound thread monitoring (treat dealer replies as engagement signal)
- [ ] ROI-per-source dashboard inside HubSpot (custom report bundled with the app)
- [ ] Multi-channel: chat, SMS, web form sources beyond Conversations email
- [ ] Billing / paid tiers if distributed at scale
