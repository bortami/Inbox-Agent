# GCP Setup — Inbox Agent

Manual UI walkthrough. All steps are in the GCP Console for project **inbox-agent-498701**.

There's a sequencing dependency between GCP and HubSpot:
- HubSpot requires a live webhook URL before `hs project upload` will succeed
- Cloud Run needs the HubSpot secrets to be fully configured
- Solution: do an initial deploy with just the Anthropic key → get the URL → upload HubSpot → add HubSpot secrets → update the service

---

## 1. Enable APIs

Open: https://console.cloud.google.com/apis/library?project=inbox-agent-498701

Enable each of these (search by name, click **Enable**):

- **Cloud Run Admin API**
- **Cloud Tasks API**
- **Cloud Firestore API**
- **Secret Manager API**
- **Cloud Build API**

---

## 2. Create the Firestore database

Open: https://console.cloud.google.com/firestore?project=inbox-agent-498701

1. Click **Create database**
2. Select **Native mode** → **Continue**
3. Location: **us-central1**
4. Click **Create database**

---

## 3. Create the Cloud Tasks queue

Open: https://console.cloud.google.com/cloudtasks?project=inbox-agent-498701

1. Click **Create queue**
2. Queue ID: `webhook-processing`
3. Region: **us-central1**
4. Expand **Retry configuration**:
   - Max attempts: `5`
   - Max retry duration: `3600s`
   - Min backoff: `10s`
   - Max backoff: `300s`
   - Max doublings: `4`
5. Click **Create**

---

## 4. Create the service account

Open: https://console.cloud.google.com/iam-admin/serviceaccounts?project=inbox-agent-498701

1. Click **Create service account**
2. Service account name: `inbox-agent`
3. Service account ID will auto-fill as `inbox-agent` → full email: `inbox-agent@inbox-agent-498701.iam.gserviceaccount.com`
4. Click **Create and continue**
5. Skip the optional steps → click **Done**

---

## 5. Grant IAM roles to the service account

Open: https://console.cloud.google.com/iam-admin/iam?project=inbox-agent-498701

1. Click **Grant access**
2. New principals: `inbox-agent@inbox-agent-498701.iam.gserviceaccount.com`
3. Add each of these four roles (click **Add another role** between each):
   - `Cloud Datastore User`
   - `Secret Manager Secret Accessor`
   - `Cloud Tasks Enqueuer`
   - `Cloud Run Invoker`
4. Click **Save**

---

## 6. Add the Anthropic API key to Secret Manager

Open: https://console.cloud.google.com/security/secret-manager?project=inbox-agent-498701

1. Click **Create secret**
2. Name: `ANTHROPIC_API_KEY`
3. Paste your key into **Secret value**
4. Click **Create secret**

Then grant the service account access to it:

1. Click `ANTHROPIC_API_KEY` → **Permissions** tab → **Grant access**
2. New principals: `inbox-agent@inbox-agent-498701.iam.gserviceaccount.com`
3. Role: `Secret Manager Secret Accessor`
4. Click **Save**

---

## 7. Initial Cloud Run deploy (Anthropic key only)

From the **Inbox-Agent repo root**:

```bash
gcloud run deploy inbox-agent \
  --source . \
  --region us-central1 \
  --project inbox-agent-498701 \
  --service-account inbox-agent@inbox-agent-498701.iam.gserviceaccount.com \
  --set-secrets ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest \
  --set-env-vars="^#^GCP_PROJECT_ID=inbox-agent-498701#GCP_LOCATION=us-central1#CLOUD_TASKS_QUEUE=webhook-processing#SERVICE_ACCOUNT_EMAIL=inbox-agent@inbox-agent-498701.iam.gserviceaccount.com#AI_PROVIDER=claude" \
  --allow-unauthenticated
```

> The `^#^` prefix changes gcloud's dict separator from `,` to `#` so hyphens and `@` in values (like `webhook-processing` and the service account email) parse correctly.

Copy the **Service URL** from the output, e.g. `https://inbox-agent-xxxx-uc.a.run.app`.

Confirm it's live:
```bash
curl https://inbox-agent-xxxx-uc.a.run.app/health
# → {"status":"ok"}
```

---

## 8. Update the HubSpot config with the real URL

```bash
CLOUD_RUN_URL="https://inbox-agent-xxxx-uc.a.run.app"  # your actual URL

sed -i '' "s|YOUR-CLOUD-RUN-URL|${CLOUD_RUN_URL}|g" \
  inbox-ai-agent/src/app/app-hsmeta.json \
  inbox-ai-agent/src/app/webhooks/webhooks-hsmeta.json
```

Also update `project.yaml` → `gcp.cloud_run_url` with the URL.

---

## 9. Upload the HubSpot project and grab credentials

```bash
cd inbox-ai-agent && hs project upload
```

Then open the project in HubSpot to get the two credentials you need:

```bash
hs project open
```

- **Client secret:** click **inbox_ai_agent_app** → **Auth** tab → copy **Client secret**
- **Webhook signing secret:** click **inbox_ai_agent_webhooks** → copy **Signing secret**

---

## 10. Add HubSpot secrets to Secret Manager

Open: https://console.cloud.google.com/security/secret-manager?project=inbox-agent-498701

Create two secrets (same steps as step 6 — **Create secret**, paste value, **Create secret**):

| Name | Value |
|---|---|
| `HUBSPOT_CLIENT_SECRET` | Client secret from step 9 |
| `HUBSPOT_APP_WEBHOOK_SECRET` | Webhook signing secret from step 9 |

Then grant the service account access to each one — click the secret → **Permissions** → **Grant access** → `inbox-agent@inbox-agent-498701.iam.gserviceaccount.com` → `Secret Manager Secret Accessor` → **Save**.

---

## 11. Update Cloud Run with the HubSpot secrets

```bash
gcloud run services update inbox-agent \
  --region us-central1 \
  --project inbox-agent-498701 \
  --update-secrets HUBSPOT_CLIENT_SECRET=HUBSPOT_CLIENT_SECRET:latest,HUBSPOT_APP_WEBHOOK_SECRET=HUBSPOT_APP_WEBHOOK_SECRET:latest \
  --update-env-vars="^#^SERVICE_URL=${CLOUD_RUN_URL}#HUBSPOT_CLIENT_ID=YOUR-HUBSPOT-CLIENT-ID"
```

Replace `YOUR-HUBSPOT-CLIENT-ID` with the Client ID from **inbox_ai_agent_app** → **Auth** tab (the public ID, not the secret).

---

## 12. Set the Firestore TTL policy (after first webhook)

Do this after the first real webhook fires so the `dedupeKeys` collection exists.

Open: https://console.cloud.google.com/firestore/databases/-default-/ttl?project=inbox-agent-498701

1. Click **Create TTL policy**
2. Collection group: `dedupeKeys`
3. Timestamp field: `created_at`
4. Click **Create**

---

## Verification

- `curl https://YOUR-CLOUD-RUN-URL/health` → `{"status":"ok"}`
- HubSpot project page shows both components with no build errors
- OAuth install URL redirects correctly and stores a document in Firestore `/portals`
