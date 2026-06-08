# Planning

Source-of-truth spec for Inbox-Agent: a distributable HubSpot public app that converts inbound emails in a HubSpot Conversations Inbox into structured Contact records.

## Vision

High-volume inbound businesses (car/boat dealers as the v1 use case) receive lead emails from dozens of syndication sites — each with a different email format, none of them a clean form submission. Today those emails sit in a shared inbox and a human re-keys them into the CRM, losing source attribution and follow-up time.

Inbox-Agent watches the inbox for new messages, extracts the lead's identity and intent into structured data with an AI model, and upserts a Contact into HubSpot — writing the latest inquiry as custom properties and appending a timeline Note for full history. Works out of the box in any HubSpot tier with no custom object requirements.

## Architecture

```
HubSpot Conversations Inbox
        │  conversation.newMessage  (webhook)
        ▼
Cloud Run service  (signature-verified handler)
        │  enqueue task (returns 200 immediately)
        ▼
Cloud Tasks  (async processing queue)
        │
        ▼
Conversations API  →  full message body + headers
        │
        ▼
Source classifier   →  which template / source is this?
        │
        ▼
Structured extractor (AIExtractor: Claude or Gemini, JSON schema)
        │
        ▼
Dedupe + match  (Firestore ledger, HubSpot Contact search)
        │
        ▼
HubSpot writer  →  upsert Contact (custom properties) + post timeline Note
        │
        ▼
Audit log (Firestore)  +  optional reply posted back to the conversation thread
```

## HubSpot app shape

- **Public app** in the developer's own HubSpot Developer account, distributable via direct install link and (eventually) Marketplace listing.
- **OAuth 2.0** install flow. Each portal that installs is stored as a tenant in Firestore with its own access/refresh tokens.
- **Webhook subscription:** `conversation.newMessage` (and `conversation.creation` as a fallback during early dev).
- **Required scopes** (initial set, refine during Phase 0):
  - `oauth`
  - `conversations.read`
  - `crm.objects.contacts.read`, `crm.objects.contacts.write`
  - `crm.schemas.contacts.write` (to register `inbox_agent_*` custom properties on install)
  - `crm.objects.notes.write` (to post a Note engagement on the Contact per processed email)

## Data model

### HubSpot side

Everything is written to the **Contact** object — no Lead, no custom objects required. Works in any HubSpot tier.

**Contact — standard properties** (always upserted on email match):
- `firstname`, `lastname`, `email`, `phone`

**Contact — custom properties** (registered on install under the `inbox_agent` group; overwritten with the latest inquiry each time):
- `inbox_agent_lead_source` — specific source ("CarGurus", "Boat Trader", "Dealer Site Form", etc.)
- `inbox_agent_inquiry_message` — the freeform question/message from the buyer
- `inbox_agent_listing_ref` — VIN, stock number, or listing URL extracted from the email (if present)
- `inbox_agent_processed_at` — ISO timestamp of the most recent processed email

**Notes** (one per processed email; full inquiry history on the Contact timeline):
- A Note engagement (`POST /crm/v3/objects/notes`) associated with the Contact per processed email
- Note body contains: source, message, listing ref, confidence, and conversation URL
- No event type registration required; works in any HubSpot tier
- App Events (the modern Timeline Events replacement) are planned for the Marketplace phase — they require HubSpot technology partner approval and are defined in the developer project config, not via a setup script

### Internal (Firestore)

Three top-level collections:

- `/portals/{portal_id}` — one document per installed HubSpot portal: `access_token`, `refresh_token`, `expires_at`, `installed_at`, `app_id`.
- `/dedupeKeys/{dedupe_key}` — dedupe ledger: `portal_id`, `message_id`, `created_at`. Key is `email + listing_ref + bucketed_timestamp`. A Firestore TTL policy auto-expires documents after 24 h — no manual cleanup needed.
- `/auditLog/{auto_id}` — one document per webhook processed: `portal_id`, `message_id`, `source_classified`, `extraction_json`, `confidence`, `outcome` (created / skipped / errored / queued-for-review), `hubspot_contact_id`, `created_at`. Enables replay.

## Components

### Webhook receiver

- Verifies `X-HubSpot-Signature-v3` against the app webhook secret before doing anything else.
- Returns 200 fast; enqueues the actual work as a Cloud Tasks HTTP task so HubSpot doesn't time out.
- The Cloud Tasks handler loads the portal's access token from Firestore, refreshing if expired.

### Source classifier

A short AI call (or a small heuristic on `From:` domain first, falling back to the model) that maps the email to one of N known sources, or `"unknown"`. Output drives which extraction prompt is used and which source-detail value is written to HubSpot.

### Structured extractor

Single AI call with **JSON schema enforcement** (`output_config.format` for Claude; `response_schema` for Gemini). Both implementations satisfy the same `AIExtractor` interface — swapped via the `AI_PROVIDER` env var. Schema:

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

`is_actual_lead` filters out "your listing was viewed" notifications, dealer-to-dealer chatter, and marketing junk before any record gets created.

### Dedupe + match

- Skip if a `/dedupeKeys/{dedupe_key}` document exists in Firestore (TTL-expired docs are automatically removed after 24 h).
- Search HubSpot Contacts by email; upsert.

### HubSpot writer

- Upserts Contact (standard fields + `inbox_agent_*` custom properties for latest inquiry).
- Posts a Note engagement on the Contact for full inquiry history (source, message, listing ref, confidence, conversation link).
- Optionally posts a reply back to the originating conversation thread: "Contact updated: [link to Contact]".

### Audit & replay

Every processed message gets an `/auditLog` document in Firestore. A small admin endpoint allows replay (re-run extraction on a past `message_id`) — useful when prompts improve or new sources are added.

## AI design

- **Structured-first, not agentic.** Single AI call per message with a strict JSON schema. No tool loops in v1 — they don't earn their complexity for this task.
- **Abstracted provider.** The extractor and classifier are accessed through an `AIExtractor` interface; `AI_PROVIDER` env var selects the active implementation (`"claude"` or `"gemini"`).
- **Claude implementation** (`ClaudeExtractor`): model `claude-sonnet-4-6`, structured output via `output_config.format` with a strict JSON schema. Prompt caching enabled on the static system prompt (~90% token savings on repeated calls). Cost: ~$0.006/call. Escalation path: `claude-opus-4-8` when confidence stays low on a source.
- **Gemini implementation** (`GeminiExtractor`): model `gemini-2.0-flash` via Vertex AI (uses GCP Application Default Credentials — no separate API key on Cloud Run). Structured output via `response_schema` in the generation config. Cost: ~$0.001–$0.003/call.
- **Evaluation plan:** after Phase 1, run both implementations on the same 50+ email corpus and compare `is_actual_lead` accuracy, field extraction correctness, `confidence` distribution, and cost. Commit to one provider before Phase 2.
- **Prompt structure:** system prompt describing the task and schema; user message containing the raw email (headers + body, HTML stripped). Source classifier output is included as a hint when available.
- **Confidence routing:** if the model returns `confidence: "low"` or `is_actual_lead: false` with `confidence: "medium"`, the message is logged but no record is created — it's surfaced for human review instead.

## Hard problems / edge cases

- **Source classification on freeform emails** — a buyer who emails the dealer directly looks nothing like a CarGurus templated lead. Classifier needs an "unknown / freeform" bucket and the extractor needs to handle it.
- **Same lead, multiple sources** — CarGurus + AutoTrader sometimes deliver the same buyer's inquiry within minutes. Dedupe by `email + listing_reference + time bucket`, not by `message_id` alone.
- **Spam and non-lead noise** — listing-view notifications, dealer-to-dealer messages, vendor outreach. The `is_actual_lead` boolean is the first line of defense; spam patterns may need explicit examples in the prompt.
- **HTML email bodies** — strip to clean text before sending to the AI model, but preserve enough structure (lists, line breaks) that contact details aren't mangled.
- **Note association** — Notes must be associated to a Contact record at creation time via the `associations` array in the POST body. The Note write must follow the Contact upsert so the `contactId` is available.
- **OAuth token lifecycle** — refresh proactively before expiry; handle uninstall events to clean up Firestore documents for the portal.

## Distribution

- Public app installs via OAuth from the HubSpot Developer Marketplace (or a direct install URL during private-beta phase).
- Single Cloud Run service handles all installed portals; per-portal state lives in Firestore. Secrets managed via GCP Secret Manager.
- Per-install configuration UI (later): source-detail label overrides, notification preferences. v1 ships without UI — sane defaults only.

## HubSpot Breeze Agent Tools (v2)

HubSpot is building a first-party AI agent platform — **Breeze** — where users interact with an AI in natural language and the agent calls registered tools to fulfill requests. Agent Tools are custom HTTP endpoints your app exposes; HubSpot signs and POSTs to them when the agent decides to invoke them. They use the same `X-HubSpot-Signature` verification as webhooks and are configured via `*-hsmeta.json` files in `src/app/workflow-actions/`.

**Why this is additive, not a replacement:** Inbox-Agent's core is event-driven and fully automatic — the webhook pipeline runs without any human in the loop. Breeze Agent Tools are user-invoked (someone asks Breeze a question or a workflow step fires), so they cannot replace the autonomous inbox listener. But the same Cloud Run service can host both: the webhook routes handle autonomous processing; additional routes serve as `actionUrl` endpoints for agent tools.

### Planned Agent Tools (v2)

| Tool | `toolType` | What it enables |
|---|---|---|
| `get_recent_leads` | `GET_DATA` | "Show me leads from CarGurus this week" — queries Firestore audit log |
| `get_extraction_detail` | `GET_DATA` | "Why was this email low-confidence?" — returns audit log entry for a message |
| `reprocess_email` | `TAKE_ACTION` | "Re-extract that email from yesterday" — triggers the replay endpoint |
| `classify_source` | `GENERATE` | "What source would this email be?" — runs the classifier on pasted text |

Each tool definition lives in `src/app/workflow-actions/<tool-name>-hsmeta.json` with `supportedClients: ["AGENTS"]`, a `toolType`, and an `llmConfig.actionDescription` that tells Breeze when and how to invoke it. Required scope: `timeline` already requested; no additional scopes needed for read-only tools.

This makes for a stronger Marketplace story: automatic zero-touch lead processing *plus* on-demand querying from Breeze.

## Out of scope (for now)

Outbound replies, auto-engagement workflows, multi-channel inboxes (SMS/chat — only email in v1), per-portal admin UI, billing/monetization, analytics dashboards. These are all reasonable v2+ directions once the parser is in production for a real portal.
