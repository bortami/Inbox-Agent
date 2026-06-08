#!/usr/bin/env bash
# GCP infrastructure setup for Inbox Agent.
# Run once. Requires gcloud CLI authenticated with owner/editor on the project.
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_LOCATION:-us-central1}"
SA_NAME="inbox-agent"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
QUEUE_NAME="webhook-processing"
SERVICE_NAME="inbox-agent"

echo "▶ Setting project to ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}"

# ── Enable APIs ────────────────────────────────────────────────────────────────
echo "▶ Enabling APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudtasks.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com

# ── Firestore ──────────────────────────────────────────────────────────────────
echo "▶ Creating Firestore database (native mode)..."
gcloud firestore databases create \
  --location="${REGION}" \
  --type=firestore-native \
  2>/dev/null || echo "  Firestore already exists, skipping."

# TTL policy on dedupeKeys — auto-expires documents 24h after created_at
# This must be done in the GCP Console or via the Firestore REST API after the
# collection has at least one document. Command below uses gcloud alpha if available:
echo "ℹ  After first webhook, set Firestore TTL policy:"
echo "   Collection: dedupeKeys  |  Field: created_at  |  TTL: 86400s"
echo "   Console: https://console.cloud.google.com/firestore/databases/-default-/data"

# ── Cloud Tasks queue ──────────────────────────────────────────────────────────
echo "▶ Creating Cloud Tasks queue: ${QUEUE_NAME}..."
gcloud tasks queues create "${QUEUE_NAME}" \
  --location="${REGION}" \
  --max-attempts=5 \
  --max-retry-duration=3600s \
  --min-backoff=10s \
  --max-backoff=300s \
  --max-doublings=4 \
  2>/dev/null || echo "  Queue already exists, skipping."

# ── Service account ────────────────────────────────────────────────────────────
echo "▶ Creating service account: ${SA_EMAIL}..."
gcloud iam service-accounts create "${SA_NAME}" \
  --display-name="Inbox Agent" \
  2>/dev/null || echo "  Service account already exists, skipping."

# Grant roles
for ROLE in \
  roles/datastore.user \
  roles/secretmanager.secretAccessor \
  roles/cloudtasks.enqueuer \
  roles/run.invoker; do
  echo "  Granting ${ROLE}..."
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet
done

# ── Secrets ────────────────────────────────────────────────────────────────────
echo "▶ Creating secrets..."
echo "  Enter HUBSPOT_CLIENT_SECRET (will not echo):"
read -rs HUBSPOT_CLIENT_SECRET
echo "${HUBSPOT_CLIENT_SECRET}" | gcloud secrets create HUBSPOT_CLIENT_SECRET \
  --data-file=- \
  2>/dev/null || \
  echo "${HUBSPOT_CLIENT_SECRET}" | gcloud secrets versions add HUBSPOT_CLIENT_SECRET --data-file=-

echo "  Enter HUBSPOT_APP_WEBHOOK_SECRET (will not echo):"
read -rs HUBSPOT_WEBHOOK_SECRET
echo "${HUBSPOT_WEBHOOK_SECRET}" | gcloud secrets create HUBSPOT_APP_WEBHOOK_SECRET \
  --data-file=- \
  2>/dev/null || \
  echo "${HUBSPOT_WEBHOOK_SECRET}" | gcloud secrets versions add HUBSPOT_APP_WEBHOOK_SECRET --data-file=-

echo "  Enter ANTHROPIC_API_KEY (will not echo):"
read -rs ANTHROPIC_KEY
echo "${ANTHROPIC_KEY}" | gcloud secrets create ANTHROPIC_API_KEY \
  --data-file=- \
  2>/dev/null || \
  echo "${ANTHROPIC_KEY}" | gcloud secrets versions add ANTHROPIC_API_KEY --data-file=-

# Grant service account access to secrets
for SECRET in HUBSPOT_CLIENT_SECRET HUBSPOT_APP_WEBHOOK_SECRET ANTHROPIC_API_KEY; do
  gcloud secrets add-iam-policy-binding "${SECRET}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet
done

echo ""
echo "✅ GCP setup complete."
echo ""
echo "Next: deploy to Cloud Run with:"
echo "  gcloud run deploy ${SERVICE_NAME} \\"
echo "    --source . \\"
echo "    --region ${REGION} \\"
echo "    --service-account ${SA_EMAIL} \\"
echo "    --set-secrets HUBSPOT_CLIENT_SECRET=HUBSPOT_CLIENT_SECRET:latest,HUBSPOT_APP_WEBHOOK_SECRET=HUBSPOT_APP_WEBHOOK_SECRET:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest \\"
echo "    --set-env-vars GCP_PROJECT_ID=${PROJECT_ID},GCP_LOCATION=${REGION},CLOUD_TASKS_QUEUE=${QUEUE_NAME},SERVICE_ACCOUNT_EMAIL=${SA_EMAIL} \\"
echo "    --allow-unauthenticated"
