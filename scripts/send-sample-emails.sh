#!/usr/bin/env bash
# Send all sample .eml files to the HubSpot conversations inbox via Brevo SMTP.
#
# Setup (takes ~2 min):
#   1. Sign up at brevo.com (free — 300 emails/day)
#   2. Go to SMTP & API → Generate a new SMTP key
#   3. Set the env vars below
#
# Required env vars:
#   SMTP_FROM   — your Brevo sender email (must be a verified sender in Brevo)
#   SMTP_USER   — your Brevo login email address
#   SMTP_PASS   — the SMTP key generated in Brevo (not your login password)
#
# Optional env vars:
#   SMTP_HOST   — defaults to smtp-relay.brevo.com
#   SMTP_PORT   — defaults to 587
#   INBOX_EMAIL — defaults to the HubSpot test inbox below

set -euo pipefail

# Load .env from project root if present
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$SCRIPT_DIR/../.env" ]]; then
  set -o allexport
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/../.env"
  set +o allexport
fi

INBOX="${INBOX_EMAIL:-support@inbox-agent-test-account-dev-51574240.com.hs-inbox.com}"
SMTP_FROM="${SMTP_FROM:-michelle@redanthos.com}"
SMTP_USER="${SMTP_USER:?Set SMTP_USER or source .env}"
SMTP_PASS="${SMTP_PASS:?Set SMTP_PASS or source .env}"
SMTP_HOST="${SMTP_HOST:-smtp-relay.brevo.com}"
SMTP_PORT="${SMTP_PORT:-587}"

SAMPLE_DIR="$SCRIPT_DIR/../sample-emails"

sent=0
failed=0

for eml in "$SAMPLE_DIR"/*.eml; do
  name=$(basename "$eml")
  printf "Sending %-45s" "$name..."

  # Brevo validates the From: header — replace it with the verified sender
  # while keeping the rest of the email (subject, body, lead data) intact
  TMPFILE=$(mktemp)
  sed "s|^From:.*|From: <${SMTP_FROM}>|" "$eml" > "$TMPFILE"

  if curl --silent --show-error \
    "smtp://${SMTP_HOST}:${SMTP_PORT}" \
    --ssl-reqd \
    --mail-from "$SMTP_FROM" \
    --mail-rcpt "$INBOX" \
    --upload-file "$TMPFILE" \
    --user "${SMTP_USER}:${SMTP_PASS}" 2>&1; then
    echo "ok"
    sent=$((sent + 1))
  else
    echo "FAILED"
    failed=$((failed + 1))
  fi
  rm -f "$TMPFILE"

  # 3s between sends — avoids spam flags and gives the webhook pipeline
  # time to process each message before the next one arrives
  sleep 3
done

echo ""
echo "Done — sent: $sent  failed: $failed"
echo "Inbox: $INBOX"
