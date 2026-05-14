#!/usr/bin/env bash
# Refresh the Tailscale-issued TLS cert if it's missing or close to expiry.
# Called as ExecStartPre by the web systemd unit; non-fatal on failure.
set -euo pipefail

CERT_DIR="/root/video_reimagine/certs"
mkdir -p "${CERT_DIR}"

# Resolve the Tailscale FQDN at runtime so renames (or fresh installs) work.
DNS_NAME="$(tailscale status --json 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("Self",{}).get("DNSName","").rstrip("."))' 2>/dev/null \
  || echo "")"

if [ -z "${DNS_NAME}" ]; then
  echo "[refresh-cert] Tailscale not reachable; skipping" >&2
  exit 0
fi

CERT="${CERT_DIR}/${DNS_NAME}.crt"
KEY="${CERT_DIR}/${DNS_NAME}.key"

if [ -f "${CERT}" ] && openssl x509 -checkend 604800 -noout -in "${CERT}" >/dev/null 2>&1; then
  echo "[refresh-cert] cert ${DNS_NAME} valid for >7 days, no refresh needed"
  exit 0
fi

echo "[refresh-cert] requesting/renewing cert for ${DNS_NAME}"
tailscale cert --cert-file "${CERT}" --key-file "${KEY}" "${DNS_NAME}"
