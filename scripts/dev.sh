#!/usr/bin/env bash
# Launch backend (FastAPI) and frontend (Next.js) for local dev.
#
# Frontend runs HTTPS via a Tailscale-issued Let's Encrypt cert so WebGPU
# is enabled in the browser (WebGPU requires a "secure context" everywhere
# except localhost). Backend stays plain HTTP — Next.js proxies to it
# internally over the loopback, so the browser only ever talks HTTPS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-/opt/node20/bin}"
export PATH="${NODE_BIN}:${PATH}"

API_PORT="${API_PORT:-8090}"
WEB_PORT="${WEB_PORT:-8091}"
HOST_BIND="${HOST_BIND:-0.0.0.0}"

CERT_DIR="${ROOT}/certs"
TAILSCALE_HOST="$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("Self",{}).get("HostName",""))' 2>/dev/null || echo "")"
TAILSCALE_DNS="$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("Self",{}).get("DNSName","").rstrip("."))' 2>/dev/null || echo "")"
TAILSCALE_IP="$(tailscale ip -4 2>/dev/null | head -1 || echo "")"

CERT_FILE="${CERT_DIR}/${TAILSCALE_DNS}.crt"
KEY_FILE="${CERT_DIR}/${TAILSCALE_DNS}.key"

LOG_DIR="${ROOT}/logs"
mkdir -p "${LOG_DIR}" "${CERT_DIR}"

cleanup() {
  echo
  echo ">> shutting down…"
  jobs -p | xargs -r kill 2>/dev/null || true
  pgrep -f "uvicorn app.main:app .* --port ${API_PORT}" | xargs -r kill 2>/dev/null || true
  pgrep -f "next-server .* --port ${WEB_PORT}\|next dev .* --port ${WEB_PORT}" | xargs -r kill 2>/dev/null || true
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

check_port_free() {
  local p="$1"
  if ss -tlnp 2>/dev/null | awk '{print $4}' | grep -qE "(^|:)${p}$"; then
    echo "!! port ${p} is already in use:"
    ss -tlnp 2>/dev/null | grep -E "(^|:)${p}\b" || true
    return 1
  fi
}

check_port_free "${API_PORT}" || exit 1
check_port_free "${WEB_PORT}" || exit 1

# --- Tailscale cert: refresh if missing or expiring within 7 days ---
need_cert=0
if [ -z "${TAILSCALE_DNS}" ]; then
  echo "!! Tailscale not running or no DNSName — falling back to plain HTTP."
  echo "   WebGPU preview will only work from http://localhost:${WEB_PORT}."
  HTTPS_FLAGS=()
elif [ ! -f "${CERT_FILE}" ] || [ ! -f "${KEY_FILE}" ]; then
  need_cert=1
elif ! openssl x509 -checkend 604800 -noout -in "${CERT_FILE}" >/dev/null 2>&1; then
  echo ">> Tailscale cert expires within 7 days, renewing"
  need_cert=1
fi

if [ -n "${TAILSCALE_DNS}" ]; then
  if [ "${need_cert}" = "1" ]; then
    echo ">> Requesting Tailscale cert for ${TAILSCALE_DNS}"
    tailscale cert --cert-file "${CERT_FILE}" --key-file "${KEY_FILE}" "${TAILSCALE_DNS}"
  fi
  HTTPS_FLAGS=(--experimental-https --experimental-https-cert "${CERT_FILE}" --experimental-https-key "${KEY_FILE}")
fi

echo ">> starting FastAPI on http://${HOST_BIND}:${API_PORT}"
(
  cd "${ROOT}/backend"
  exec .venv/bin/uvicorn app.main:app \
    --host "${HOST_BIND}" --port "${API_PORT}" \
    --log-level info
) > "${LOG_DIR}/api.log" 2>&1 &

scheme="http"
if [ "${#HTTPS_FLAGS[@]}" -gt 0 ]; then scheme="https"; fi
echo ">> starting Next.js on ${scheme}://${HOST_BIND}:${WEB_PORT}"
(
  cd "${ROOT}/frontend"
  exec npx --no-install next dev \
    --hostname "${HOST_BIND}" \
    --port "${WEB_PORT}" \
    "${HTTPS_FLAGS[@]}"
) > "${LOG_DIR}/web.log" 2>&1 &

sleep 3

cat <<EOF

  video_reimagine is running.

  Open in browser (WebGPU enabled):
    ${scheme}://localhost:${WEB_PORT}
EOF

if [ -n "${TAILSCALE_DNS}" ]; then
  cat <<EOF
    ${scheme}://${TAILSCALE_DNS}:${WEB_PORT}    (from any tailnet device)
EOF
fi

cat <<EOF

  API (internal, HTTP):
    http://localhost:${API_PORT}/health

  Logs:
    ${LOG_DIR}/api.log
    ${LOG_DIR}/web.log

  Ctrl-C to stop both services.

EOF

wait
