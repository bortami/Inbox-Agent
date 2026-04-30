# Inbox-Agent

A HubSpot public app that turns inbound emails into structured CRM Leads.

When a new email lands in a connected HubSpot Conversations Inbox, a Cloudflare Worker receives the webhook, an AI extractor (Claude) parses the email body into typed fields, and a Contact + Lead is written into the HubSpot CRM — optionally associated to the Listing the inquiry is about.

Built initially for car and boat dealers whose listings are syndicated across many third-party sites (CarGurus, Boat Trader, Facebook Marketplace, dealer-site forms, etc.) and who need every inbound email consolidated as a properly-attributed Lead.

See [planning.md](planning.md) for the full spec and [todo.md](todo.md) for the build plan.

## Stack

- **Runtime:** Cloudflare Workers (TypeScript)
- **State:** Cloudflare D1 (per-portal OAuth tokens, dedupe ledger, audit log)
- **AI:** Anthropic Claude API (Sonnet 4.6) with structured JSON output
- **HubSpot:** public app, OAuth, subscribed to `conversation.newMessage`

## Local development

Wrangler-based, standard Cloudflare Workers workflow:

    npm install
    npx wrangler dev

## Deploy

    npx wrangler deploy

Secrets (HubSpot client secret, app webhook secret, Anthropic API key) are set via `wrangler secret put`.
