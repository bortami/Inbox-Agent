#!/bin/bash
# Build & deploy Inbox Agent to Cloud Run, then upload the HubSpot project.
# Run from the project root. Reads config from .env if present.
set -euo pipefail

# ── Load .env ──────────────────────────────────────────────────────────────────
if [[ -f .env ]]; then
  set -o allexport
  # shellcheck disable=SC1091
  source .env
  set +o allexport
fi

: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID in .env or environment}"
: "${SERVICE_ACCOUNT_EMAIL:?Set SERVICE_ACCOUNT_EMAIL in .env or environment}"

REGION="${GCP_LOCATION:-us-central1}"
SERVICE_NAME="inbox-agent"
SA_EMAIL="${SERVICE_ACCOUNT_EMAIL}"

# ── 1. Deploy to Cloud Run ─────────────────────────────────────────────────────
echo "▶ Deploying ${SERVICE_NAME} to Cloud Run (${REGION})..."
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --region "${REGION}" \
  --service-account "${SA_EMAIL}" \
  --allow-unauthenticated \
  --project "${GCP_PROJECT_ID}" \
  
# ── 2. Upload HubSpot project ──────────────────────────────────────────────────
echo "▶ Uploading HubSpot project..."
cd inbox-ai-agent
hs project upload

echo ""
echo "✅ Deploy complete."
