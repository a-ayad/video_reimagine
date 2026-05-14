#!/usr/bin/env bash
# One-time installer for backend venv + frontend node_modules + NLUT model.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-/opt/node20/bin}"
CUDA_HOME="${CUDA_HOME:-/usr/local/cuda}"

if [ ! -x "${NODE_BIN}/node" ]; then
  echo "!! Node 20 not found at ${NODE_BIN}/node"
  echo "   Install with:"
  echo "     curl -fsSL -o /tmp/node20.tar.xz https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz"
  echo "     tar -xJf /tmp/node20.tar.xz -C /opt && mv /opt/node-v20.18.1-linux-x64 /opt/node20"
  exit 1
fi
export PATH="${NODE_BIN}:${PATH}"

echo ">> Setting up backend venv"
cd "${ROOT}/backend"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

# PyTorch with CUDA 12.8 wheel (matches the Blackwell box). For other systems
# adjust the --index-url or drop it to fall back to whatever pip selects.
if ! .venv/bin/python -c "import torch" 2>/dev/null; then
  echo ">> Installing PyTorch (CUDA 12.8 wheel)"
  .venv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
fi

echo ">> Generating preset .cube LUTs"
.venv/bin/python scripts/build_presets.py

# --- NLUT setup ---
if [ ! -d ml/nlut/.git ] && [ ! -f ml/nlut/nlut_models.py ]; then
  echo ">> Cloning NLUT repo"
  mkdir -p ml
  git clone --depth=1 https://github.com/semchan/NLUT.git ml/nlut
fi

if [ ! -f ml/nlut/experiments/model.pth ]; then
  echo ">> Downloading NLUT pretrained weights from Google Drive (~236 MB)"
  mkdir -p ml/nlut/experiments
  .venv/bin/gdown --folder \
    "https://drive.google.com/drive/folders/1YqCKnfqzOPtmwdYAziGZMQ79iAI0_0ur" \
    -O /tmp/nlut_dl
  cp /tmp/nlut_dl/336999_style_lut.pth ml/nlut/experiments/model.pth
  rm -rf /tmp/nlut_dl
fi

if ! .venv/bin/python -c "import torch; import trilinear" 2>/dev/null; then
  echo ">> Building NLUT's trilinear CUDA extension for Blackwell (sm_120)"
  (
    cd ml/nlut/trilinear_cpp
    rm -rf build dist trilinear.egg-info
    export CUDA_HOME
    export TORCH_CUDA_ARCH_LIST="8.0;8.9;9.0;12.0"
    ../../../.venv/bin/python setup.py install
  )
fi

echo ">> Installing frontend dependencies"
cd "${ROOT}/frontend"
# Tailwind v4's @tailwindcss/oxide ships native bindings as an optional
# dependency; npm has a long-standing bug that drops them on first install
# (#4828). Force a clean install so the native module is present.
rm -rf node_modules package-lock.json
npm install --no-audit --no-fund

# Turbopack's require resolver doesn't always find the sibling oxide platform
# package; copy the .node binding into the main @tailwindcss/oxide package so
# `require('./tailwindcss-oxide.linux-x64-gnu.node')` succeeds.
NATIVE="$(ls node_modules/@tailwindcss/oxide-linux-x64-gnu/*.node 2>/dev/null | head -1 || true)"
if [ -n "${NATIVE}" ] && [ -f "${NATIVE}" ]; then
  cp -f "${NATIVE}" node_modules/@tailwindcss/oxide/
  echo "   copied $(basename "${NATIVE}") into @tailwindcss/oxide"
fi

echo
echo ">> Setup complete. Run ./scripts/dev.sh to start."
