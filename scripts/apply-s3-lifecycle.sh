#!/usr/bin/env bash
#
# Apply S3 Intelligent-Tiering lifecycle policy to the JWST data bucket.
#
# Usage:
#   ./scripts/apply-s3-lifecycle.sh [bucket-name]
#
# Requires: aws CLI configured with appropriate credentials.
# Not applicable to SeaweedFS (local dev) — only for production AWS S3.
#
set -euo pipefail

BUCKET="${1:-jwst-data}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLICY_FILE="${SCRIPT_DIR}/s3-lifecycle-policy.json"

if [ ! -f "$POLICY_FILE" ]; then
  echo "Error: Policy file not found at $POLICY_FILE"
  exit 1
fi

echo "Applying lifecycle policy to bucket: $BUCKET"
aws s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET" \
  --lifecycle-configuration "file://${POLICY_FILE}"

echo "Lifecycle policy applied successfully."
echo "Verifying..."
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET"
