#!/usr/bin/env bash
# Bootstrap video_reimagine on a fresh Debian/Ubuntu machine.
#
# What it does:
#   1. Installs apt packages (python3, ffmpeg, git, openssl, build tools, …)
#   2. Installs Node 20 to /opt/node20 if missing
#   3. Installs Tailscale if missing (you'll still need `sudo tailscale up`)
#   4. Clones git@github.com:a-ayad/video_reimagine.git into INSTALL_DIR
#      (with the NLUT submodule)
#   5. Patches systemd unit paths if INSTALL_DIR or Tailscale FQDN differ
#      from the defaults baked into the units
#   6. Runs scripts/setup.sh   (Python venv, frontend deps, NLUT model + trilinear)
#   7. Runs scripts/install-services.sh   (unless --no-service)
#
# Usage:
#   sudo ./install.sh                          # default paths
#   sudo INSTALL_DIR=/srv/vr ./install.sh
#   sudo REPO_URL=https://github.com/a-ayad/video_reimagine.git ./install.sh
#   sudo ./install.sh --no-service             # don't install systemd units
#   sudo ./install.sh --no-clone               # repo already present
#
# Re-runnable: skips any step that's already done.

set -euo pipefail

# --------------- defaults / args ---------------
REPO_URL="${REPO_URL:-git@github.com:a-ayad/video_reimagine.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/root/video_reimagine}"
NODE_BIN_DIR="${NODE_BIN_DIR:-/opt/node20}"
NODE_VERSION="${NODE_VERSION:-v20.18.1}"

INSTALL_SERVICE=1
DO_CLONE=1
for arg in "$@"; do
  case "$arg" in
    --no-service) INSTALL_SERVICE=0 ;;
    --no-clone)   DO_CLONE=0 ;;
    --help|-h)    sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//' | head -n -1 ; exit 0 ;;
    *)            echo "!! unknown arg: $arg (try --help)"; exit 1 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "!! must run as root (apt + systemd)"; exit 1
fi

# --------------- system deps ---------------
echo ">> [1/7] apt packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
  ca-certificates curl git openssl xz-utils \
  python3 python3-venv python3-pip \
  ffmpeg build-essential pkg-config

# --------------- Node 20 ---------------
echo ">> [2/7] Node ${NODE_VERSION}"
if [ ! -x "${NODE_BIN_DIR}/bin/node" ]; then
  case "$(uname -m)" in
    x86_64)  NODE_ARCH=linux-x64 ;;
    aarch64) NODE_ARCH=linux-arm64 ;;
    *) echo "!! unsupported arch: $(uname -m)"; exit 1 ;;
  esac
  TMP="$(mktemp -d)"
  trap 'rm -rf "${TMP}"' EXIT
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_ARCH}.tar.xz" \
       -o "${TMP}/node.tar.xz"
  tar -xJf "${TMP}/node.tar.xz" -C "${TMP}"
  rm -rf "${NODE_BIN_DIR}"
  mkdir -p "$(dirname "${NODE_BIN_DIR}")"
  mv "${TMP}/node-${NODE_VERSION}-${NODE_ARCH}" "${NODE_BIN_DIR}"
  echo "   installed at ${NODE_BIN_DIR}"
else
  echo "   already present ($(${NODE_BIN_DIR}/bin/node --version))"
fi
export PATH="${NODE_BIN_DIR}/bin:${PATH}"

# --------------- Tailscale ---------------
echo ">> [3/7] Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
  echo "   Tailscale installed. After this script, run:  sudo tailscale up"
fi

HOST_FQDN="$(tailscale status --json 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("Self",{}).get("DNSName","").rstrip("."))' \
  2>/dev/null || echo "")"
if [ -z "${HOST_FQDN}" ]; then
  cat <<MSG
   !! Tailscale is not 'up' yet — no DNSName available. The web service
      will run on plain HTTP (localhost only) until you do:
        sudo tailscale up
      then re-run:  sudo $0 --no-clone
MSG
fi

# --------------- CUDA check (warning only) ---------------
echo ">> [4/7] CUDA toolchain check"
if ! command -v nvcc >/dev/null && [ ! -x /usr/local/cuda/bin/nvcc ]; then
  cat <<MSG
   !! No CUDA toolchain found. NLUT's trilinear extension won't build, so
      the AI custom-LUT path will fall back to histogram matching (works,
      just less aesthetically interesting). To enable NLUT later: install
      CUDA 12.8+ and re-run  scripts/setup.sh.
MSG
else
  echo "   ok ($(nvcc --version 2>/dev/null | grep release || echo /usr/local/cuda detected))"
fi

# --------------- clone / update ---------------
echo ">> [5/7] repo at ${INSTALL_DIR}"
if [ "$DO_CLONE" = "1" ]; then
  if [ -d "${INSTALL_DIR}/.git" ]; then
    echo "   pulling latest + updating submodules"
    git -C "${INSTALL_DIR}" pull --ff-only origin "${BRANCH}"
    git -C "${INSTALL_DIR}" submodule update --init --recursive
  else
    mkdir -p "$(dirname "${INSTALL_DIR}")"
    git clone --recurse-submodules --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
  fi
else
  [ -d "${INSTALL_DIR}/.git" ] || { echo "!! ${INSTALL_DIR} is not a git repo and --no-clone was given"; exit 1; }
fi
cd "${INSTALL_DIR}"

# --------------- patch unit files to this host ---------------
DEFAULT_DIR="/root/video_reimagine"
DEFAULT_FQDN="upscale-demo.tail2074ee.ts.net"
NEED_PATCH=0
[ "${INSTALL_DIR}" != "${DEFAULT_DIR}" ] && NEED_PATCH=1
[ -n "${HOST_FQDN}" ] && [ "${HOST_FQDN}" != "${DEFAULT_FQDN}" ] && NEED_PATCH=1

if [ "${NEED_PATCH}" = "1" ]; then
  echo "   patching systemd units (dir=${INSTALL_DIR}, fqdn=${HOST_FQDN:-<unset>})"
  for f in systemd/video-reimagine-*.service; do
    sed -i -e "s|${DEFAULT_DIR}|${INSTALL_DIR}|g" "$f"
    [ -n "${HOST_FQDN}" ] && sed -i -e "s|${DEFAULT_FQDN}|${HOST_FQDN}|g" "$f"
  done
fi

# --------------- setup.sh ---------------
echo ">> [6/7] running scripts/setup.sh"
NODE_BIN="${NODE_BIN_DIR}/bin" ./scripts/setup.sh

# --------------- systemd ---------------
echo ">> [7/7] systemd"
if [ "$INSTALL_SERVICE" = "1" ]; then
  NODE_BIN="${NODE_BIN_DIR}/bin" ./scripts/install-services.sh
else
  echo "   skipped (--no-service). To start manually:  cd ${INSTALL_DIR} && ./scripts/dev.sh"
fi

cat <<EOF

  video_reimagine installed at ${INSTALL_DIR}.

  Open in browser:
    https://localhost:8091
EOF
[ -n "${HOST_FQDN}" ] && echo "    https://${HOST_FQDN}:8091   (any tailnet device)"
cat <<'EOF'

  Service control:
    systemctl status   video-reimagine-{api,web}
    systemctl restart  video-reimagine-{api,web}
    journalctl -u video-reimagine-web -f

EOF
