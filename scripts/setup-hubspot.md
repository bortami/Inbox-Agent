# HubSpot App Setup

HubSpot apps are created and managed via the CLI. The project lives in `inbox-ai-agent/`.

## Prerequisites

```bash
npm install -g @hubspot/cli@latest   # v7.6.0+
hs account auth                      # authenticate with your developer account
```

## 1. Edit the config files

Two placeholders need your Cloud Run URL before uploading:

**`inbox-ai-agent/src/app/app-hsmeta.json`** — update `redirectUrls` and `supportEmail`:
```json
"redirectUrls": ["https://YOUR-CLOUD-RUN-URL/oauth/callback"],
"supportEmail": "YOUR-EMAIL"
```

**`inbox-ai-agent/src/app/webhooks/webhooks-hsmeta.json`** — update `targetUrl`:
```json
"targetUrl": "https://YOUR-CLOUD-RUN-URL/webhook"
```

If Cloud Run isn't deployed yet, use a placeholder and re-upload after deploy.

## 2. Upload the project

```bash
cd inbox-ai-agent
hs project upload
```

## 3. Get your client credentials

```bash
hs project open   # opens the project page in HubSpot
```

Click **inbox_ai_agent_app** → **Auth** tab → copy **Client ID** and **Client secret**.

Store them:
```bash
# Client secret → GCP Secret Manager
echo "YOUR-CLIENT-SECRET" | gcloud secrets create HUBSPOT_CLIENT_SECRET --data-file=-

# Client ID → Cloud Run env var (it's public, not a secret)
gcloud run services update inbox-agent \
  --update-env-vars HUBSPOT_CLIENT_ID=YOUR-CLIENT-ID \
  --region us-central1
```

## 4. Get the webhook signing secret

In HubSpot: project page → **inbox_ai_agent_webhooks** → copy the **signing secret**.

```bash
echo "YOUR-WEBHOOK-SECRET" | gcloud secrets create HUBSPOT_APP_WEBHOOK_SECRET --data-file=-
```

## 5. Install on a test portal

In HubSpot: project page → **inbox_ai_agent_app** → **Distribution** tab → **Add test install(s)** → pick your developer test account → **Install**.

To create a test account first: HubSpot developer account → **Test accounts** → **Create developer test account**.

## 6. Verify end-to-end

1. Send a test email to the Conversations inbox on the test portal
2. Check Cloud Run logs — you should see `Processing task` with the message ID
3. Check Firestore `auditLog` collection for the entry

## Re-uploading after config changes

```bash
cd inbox-ai-agent && hs project upload
```

## Project structure

```
inbox-ai-agent/
├── hsproject.json                              ← project manifest (platformVersion 2026.03)
└── src/
    └── app/
        ├── app-hsmeta.json                     ← app name, OAuth config, scopes
        ├── settings/                           ← per-portal settings UI (Phase 4)
        │   └── settings-page-hsmeta.json
        ├── webhooks/
        │   └── webhooks-hsmeta.json            ← conversation.newMessage subscription
        └── workflow-actions/                   ← Breeze Agent Tools (Phase 5)
            └── workflow-actions-hsmeta.json
```
