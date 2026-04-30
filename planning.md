# Planning

Source-of-truth spec for Inbox-Agent: a distributable HubSpot public app that converts inbound emails in a HubSpot Conversations Inbox into structured CRM Leads.

## Vision

High-volume inbound businesses (car/boat dealers as the v1 use case) receive lead emails from dozens of syndication sites — each with a different email format, none of them a clean form submission. Today those emails sit in a shared inbox and a human re-keys them into the CRM, losing source attribution and follow-up time.

Inbox-Agent watches the inbox for new messages, extracts the lead's identity and intent into structured data with an AI model, and writes a Contact + Lead (optionally linked to a Listing) into HubSpot — preserving accurate per-source attribution so dealers can finally see which channels actually convert.

## Architecture

```
HubSpot Conversations Inbox
        │  conversation.newMessage  (webhook)
        ▼
Cloudflare Worker  (signature-verified handler)
        │
        ▼
Conversations API  →  full message body + headers
        │
        ▼
Source classifier   →  which template / source is this?
        │
        ▼
Structured extractor (Claude, JSON schema)
        │
        ▼
Dedupe + match  (D1 ledger, HubSpot Contact search, Listing match)
        │
        ▼
HubSpot writer  →  upsert Contact, create Lead, associate Listing
        │
        ▼
Audit log (D1)  +  optional note posted back to the conversation thread
```

## HubSpot app shape

- **Public app** in the developer's own HubSpot Developer account, distributable via direct install link and (eventually) Marketplace listing.
- **OAuth 2.0** install flow. Each portal that installs is stored as a tenant in D1 with its own access/refresh tokens.
- **Webhook subscription:** `conversation.newMessage` (and `conversation.creation` as a fallback during early dev).
- **Required scopes** (initial set, refine during Phase 0):
  - `oauth`
  - `conversations.read`
  - `crm.objects.contacts.read`, `crm.objects.contacts.write`
  - `crm.objects.leads.read`, `crm.objects.leads.write`
  - `crm.schemas.custom.read` (to discover Listing-style custom objects per portal)

## Data model

### HubSpot side

- **Contact** — the prospective buyer. Standard properties: `firstname`, `lastname`, `email`, `phone`. Always upserted on email match.
- **Lead** (HubSpot's first-class Lead object) — the inquiry itself. Properties:
  - `hs_lead_source` — high-level channel (e.g., "Email")
  - custom `lead_source_detail` — specific source ("CarGurus", "Boat Trader", "Dealer Site Form", etc.)
  - custom `inquiry_message` — the freeform question/message from the buyer
  - `hs_lead_status` — set to "New" on creation
- **Listing** (custom object per-portal, optional) — the vehicle/boat/product being inquired about. Lead → Listing association created when a stock number, VIN, or listing URL can be extracted from the email.

### Internal (Cloudflare D1)

- `portals` — one row per installed HubSpot portal: `portal_id`, `access_token`, `refresh_token`, `expires_at`, `installed_at`, `app_id`.
- `processed_messages` — dedupe ledger: `portal_id`, `message_id`, `dedupe_key` (email + listing ref + bucketed timestamp), `created_at`. Lookups before extraction skip duplicates.
- `audit_log` — one row per webhook processed: `portal_id`, `message_id`, `source_classified`, `extraction_json`, `confidence`, `outcome` (created / skipped / errored / queued-for-review), `hubspot_contact_id`, `hubspot_lead_id`, `created_at`. Enables replay.

## Components

### Webhook receiver

- Verifies `X-HubSpot-Signature-v3` against the app webhook secret before doing anything else.
- Returns 200 fast; queues the actual work via a Worker subrequest or Cloudflare Queue so HubSpot doesn't time out.
- Loads the portal's access token from D1, refreshing if expired.

### Source classifier

A short Claude call (or a small heuristic on `From:` domain first, falling back to the model) that maps the email to one of N known sources, or `"unknown"`. Output drives which extraction prompt is used and which source-detail value is written to HubSpot.

### Structured extractor

Single Claude call with **JSON schema enforcement** via tool-use. Schema:

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

- Skip if `dedupe_key` already exists in `processed_messages` within a configurable time window (default 24h).
- Search HubSpot Contacts by email; upsert.
- If listing reference is present, search the portal's Listing custom object by VIN / stock number / URL; associate on match.

### HubSpot writer

- Upserts Contact, creates Lead with source attribution, associates Lead to Contact and (when matched) to Listing.
- Optionally posts a note back to the originating conversation thread: "Lead extracted: [link to Lead]".

### Audit & replay

Every processed message gets an `audit_log` row. A small admin endpoint allows replay (re-run extraction on a past `message_id`) — useful when prompts improve or new sources are added.

## AI design

- **Structured-first, not agentic.** Single Claude call per message with a strict JSON schema. No tool loops in v1 — they don't earn their complexity for this task.
- **Model:** Claude Sonnet 4.6 (fast, cheap, accurate enough for templated email parsing). Bump to Opus only if confidence on a source stays low.
- **Prompt structure:** system prompt describing the task and schema; user message containing the raw email (headers + body, HTML stripped). Source classifier output is included as a hint when available.
- **Confidence routing:** if the model returns `confidence: "low"` or `is_actual_lead: false` with `confidence: "medium"`, the message is logged but no record is created — it's surfaced for human review instead.

## Hard problems / edge cases

- **Source classification on freeform emails** — a buyer who emails the dealer directly looks nothing like a CarGurus templated lead. Classifier needs an "unknown / freeform" bucket and the extractor needs to handle it.
- **Same lead, multiple sources** — CarGurus + AutoTrader sometimes deliver the same buyer's inquiry within minutes. Dedupe by `email + listing_reference + time bucket`, not by `message_id` alone.
- **Spam and non-lead noise** — listing-view notifications, dealer-to-dealer messages, vendor outreach. The `is_actual_lead` boolean is the first line of defense; spam patterns may need explicit examples in the prompt.
- **Listing match against per-portal custom objects** — the schema name and property names will differ per dealer. The app needs to detect the portal's Listing object schema (or be configured per install).
- **HTML email bodies** — strip to clean text before sending to Claude, but preserve enough structure (lists, line breaks) that contact details aren't mangled.
- **OAuth token lifecycle** — refresh proactively before expiry; handle uninstall events to clean up D1 rows.

## Distribution

- Public app installs via OAuth from the HubSpot Developer Marketplace (or a direct install URL during private-beta phase).
- Single Worker instance handles all installed portals; per-portal state lives in D1.
- Per-install configuration UI (later): which Listing object to use, custom field mappings, notification preferences. v1 ships without UI — sane defaults only.

## Out of scope (for now)

Outbound replies, auto-engagement workflows, multi-channel inboxes (SMS/chat — only email in v1), per-portal admin UI, billing/monetization, analytics dashboards. These are all reasonable v2+ directions once the parser is in production for a real portal.
