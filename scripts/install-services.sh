#!/usr/bin/env bash
# Install + start systemd units for video_reimagine.
#
# - Stops any nohup'd dev processes that might be holding the ports
# - Builds the frontend production bundle if missing
# - Symlinks the unit files into /etc/systemd/system/
# - daemon-reload + enable + start
# - Verifies the services are listening
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-/opt/node20/bin}"

if [ "$(id -u)" -ne 0 ]; then
  echo "!! must run as root (systemd unit installs into /etc/systemd/system/)"
  exit 1
fi

if [ ! -x "${NODE_BIN}/node" ]; then
  echo "!! Node 20 not at ${NODE_BIN}; run scripts/setup.sh first"
  exit 1
fi

if [ ! -d "${ROOT}/backend/.venv" ]; then
  echo "!! Backend venv missing; run scripts/setup.sh first"
  exit 1
fi

echo ">> stopping any backgrounded dev processes on 8090/8091"
for pat in "uvicorn app.main:app .* 8090" "next dev .* 8091" "next-server .* 8091" "node server\.js"; do
  pgrep -f "$pat" 2>/dev/null | xargs -r kill 2>/dev/null || true
done
sleep 1

if [ ! -d "${ROOT}/frontend/.next" ]; then
  echo ">> building frontend production bundle (next build)"
  ( cd "${ROOT}/frontend" && PATH="${NODE_BIN}:${PATH}" npx --no-install next build )
fi

echo ">> installing unit files via symlink"
ln -sf "${ROOT}/systemd/video-reimagine-api.service" /etc/systemd/system/video-reimagine-api.service
ln -sf "${ROOT}/systemd/video-reimagine-web.service" /etc/systemd/system/video-reimagine-web.service

echo ">> reloading systemd"
systemctl daemon-reload

echo ">> enabling + starting services"
systemctl enable --now video-reimagine-api.service
systemctl enable --now video-reimagine-web.service

echo ">> waiting for services to become ready"
for i in $(seq 1 30); do
  api_ok=0; web_ok=0
  ss -tlnp 2>/dev/null | grep -q ":8090" && api_ok=1
  ss -tlnp 2>/dev/null | grep -q ":8091" && web_ok=1
  if [ "$api_ok$web_ok" = "11" ]; then break; fi
  sleep 1
done

echo
echo "=== status ==="
systemctl --no-pager --lines=3 status video-reimagine-api.service || true
echo
systemctl --no-pager --lines=3 status video-reimagine-web.service || true
echo
echo "=== ports ==="
ss -tlnp 2>/dev/null | grep -E ":809[01]" || true
echo
echo "=== quick health check ==="
curl -fsS http://127.0.0.1:8090/health && echo
curl -k -fsS -o /dev/null -w "https://localhost:8091  HTTP %{http_code}\n" https://localhost:8091/

cat <<EOF

  video_reimagine is now installed as a service.

  Open in browser:
    https://localhost:8091
    https://upscale-demo.tail2074ee.ts.net:8091   (from any tailnet device)

  Useful commands:
    systemctl status   video-reimagine-{api,web}
    systemctl restart  video-reimagine-{api,web}
    systemctl stop     video-reimagine-{api,web}
    journalctl -u video-reimagine-api -f
    journalctl -u video-reimagine-web -f

EOF
