# LeadCatch

A HubSpot public app that turns inbound emails into structured Contact records.

When a new email lands in a connected HubSpot Conversations Inbox, a Cloud Run service receives the webhook, an AI model extracts structured data from the email body, and a Contact is upserted in HubSpot — with source attribution as custom properties and a Note appended per email for full inquiry history. Works in any HubSpot tier with no custom objects required.

Built initially for car and boat dealers whose listings are syndicated across many third-party sites (CarGurus, Boat Trader, Facebook Marketplace, dealer-site forms, etc.) and who need every inbound email consolidated as a properly-attributed contact.

See [planning.md](planning.md) for the full spec and [todo.md](todo.md) for the build plan.

## Stack

- **Runtime:** Node.js/TypeScript on Google Cloud Run
- **Queue:** Google Cloud Tasks (async webhook processing)
- **State:** Firestore (per-portal OAuth tokens, dedupe ledger, audit log, billing)
- **Secrets:** GCP Secret Manager
- **AI:** Claude (Sonnet 4.6) via an abstracted `AIExtractor` interface (a Gemini implementation is planned but not yet built)
- **Billing:** Stripe (flat per-tier + metered per-lead), with billing identity owned by Red Anthos
- **HubSpot:** Public app, OAuth 2.0, subscribed to `conversation.newMessage`
