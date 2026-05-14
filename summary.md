# video_reimagine — Project Summary

A local web app that re-grades the colors of uploaded videos with curated
film looks (vintage film, 90s VHS, teal-orange, …) or an AI-generated
look matched from a reference image. Single-machine, reachable over
Tailscale.

For the deep dive on architecture and the LUT pipeline, see [README.md](./README.md).
This file is the quick reference.

## Tech stack

| Layer       | Choice                                              |
| ----------- | --------------------------------------------------- |
| Frontend    | Next.js 16, React 19, TypeScript, Tailwind v4       |
| Preview     | WebGPU (3D LUT applied in a WGSL fragment shader)   |
| Backend     | FastAPI (Python 3), SQLite                          |
| Render      | FFmpeg `lut3d` filter                               |
| Custom LUT  | [NLUT](https://github.com/semchan/NLUT) (PyTorch + custom trilinear CUDA extension) — falls back to channel-wise histogram matching when the model or CUDA isn't available |
| TLS         | `tailscale cert` issues a Let's Encrypt cert for the host's `<machine>.<tailnet>.ts.net` MagicDNS name; auto-refreshed when <7 days remain |
| Process mgmt| systemd units (`video-reimagine-api`, `video-reimagine-web`) |

## Repo layout

```
video_reimagine/
├── install.sh                    # one-shot bootstrap for a fresh machine
├── scripts/
│   ├── setup.sh                  # venv + node_modules + NLUT model + trilinear build
│   ├── install-services.sh       # install + start systemd units
│   ├── refresh-cert.sh           # auto-renew Tailscale TLS cert
│   └── dev.sh                    # foreground dev mode (hot reload)
├── systemd/
│   ├── video-reimagine-api.service
│   └── video-reimagine-web.service
├── backend/
│   ├── app/                      # FastAPI app
│   │   ├── main.py
│   │   ├── api/                  # uploads, luts, jobs, videos
│   │   ├── workers/              # render.py (ffmpeg), nlut.py + nlut_runner.py
│   │   └── storage_dir/          # uploads/ outputs/ refs/ custom_luts/ (gitignored)
│   ├── luts/                     # 12 preset .cube files
│   ├── ml/nlut/                  # SUBMODULE → github.com/a-ayad/NLUT
│   ├── scripts/build_presets.py  # regenerates the preset .cubes
│   └── requirements.txt
├── frontend/
│   ├── app/                      # Next.js app router
│   ├── components/               # Uploader, Preview, PresetGallery, ExportPanel, CustomLutPanel, …
│   ├── lib/
│   │   ├── webgpu/               # WGSL shader + LUT pipeline
│   │   ├── cube.ts               # .cube parser
│   │   └── api.ts                # backend client
│   └── server.js                 # HTTPS-aware Next.js production entrypoint
└── certs/                        # Tailscale-issued .crt/.key (gitignored)
```

## Submodule

`backend/ml/nlut` is a submodule pointing at
[`a-ayad/NLUT`](https://github.com/a-ayad/NLUT), which is a fork of
upstream `semchan/NLUT` with Blackwell/CUDA compatibility patches to the
trilinear C++/CUDA extension. The fork keeps `upstream` as a second
remote so future upstream changes can be merged in.

## Hosts and ports

| Service  | Port | URL                                                     |
| -------- | ---- | ------------------------------------------------------- |
| Frontend | 8091 | `https://localhost:8091` / `https://<host>.<tailnet>.ts.net:8091` |
| API      | 8090 | `http://127.0.0.1:8090/health` (loopback only)          |

WebGPU requires a secure context — that's why the frontend is HTTPS and
the cert needs to cover the FQDN the user types. Backend stays plain
HTTP; Next.js proxies to it on the loopback so the browser only ever
sees HTTPS.

## Deploy to a fresh machine

```bash
# 1. Grab the bootstrap script
curl -fsSL https://raw.githubusercontent.com/a-ayad/video_reimagine/main/install.sh -o install.sh
chmod +x install.sh

# 2. (Recommended) bring Tailscale up first so the FQDN is detectable
sudo apt install -y curl                           # if needed
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 3. Run the installer
sudo ./install.sh
```

`install.sh` is idempotent — re-run it after pulling new commits and it
skips anything already done.

**Useful flags**

| Flag / env var                 | Effect                                                |
| ------------------------------ | ----------------------------------------------------- |
| `--no-service`                 | Skip systemd install (use `./scripts/dev.sh` instead) |
| `--no-clone`                   | Repo is already present; just run setup + services    |
| `INSTALL_DIR=/srv/vr`          | Install somewhere other than `/root/video_reimagine`  |
| `REPO_URL=https://…`           | Clone via HTTPS instead of SSH                        |
| `BRANCH=develop`               | Check out a non-`main` branch                         |
| `NODE_VERSION=v20.18.1`        | Pin a specific Node 20 patch release                  |

`install.sh` will detect the host's Tailscale FQDN at install time and
**patch the systemd unit files** to substitute the correct paths and
cert filename, so the same units work on any host. (If Tailscale isn't
`up` yet, install.sh runs setup but warns — bring Tailscale up then
re-run with `--no-clone`.)

## Development mode

After `setup.sh` has run at least once:

```bash
./scripts/dev.sh
```

This launches the FastAPI backend and Next.js dev server in the
foreground with hot reload, writing logs to `logs/api.log` and
`logs/web.log`. Ctrl-C stops both.

## Service control

```bash
systemctl status   video-reimagine-api video-reimagine-web
systemctl restart  video-reimagine-api video-reimagine-web
journalctl -u video-reimagine-web -f
```

The web unit's `ExecStartPre` runs `scripts/refresh-cert.sh`, which
renews the Tailscale TLS cert when there's <7 days left on it.

## Adding a new preset LUT

1. Add an entry to `PRESETS` in `backend/app/presets.py`.
2. Add a matching function to `PRESET_FUNCS` in `backend/scripts/build_presets.py`.
3. Regenerate:

   ```bash
   backend/.venv/bin/python backend/scripts/build_presets.py
   ```

## GPU / performance notes

- NLUT inference uses CUDA (RTX PRO 6000 Blackwell on the dev box). End-to-end LUT generation: ~6–10s.
- Histogram-matching fallback is CPU-only, sub-second.
- FFmpeg `lut3d` is CPU-bound; the slow step is H.264 encode at roughly real-time. Swap `libx264` → `h264_nvenc` in `backend/app/workers/render.py` to offload encode to the GPU.

## Repo

- Main repo: <https://github.com/a-ayad/video_reimagine>
- NLUT fork: <https://github.com/a-ayad/NLUT> (upstream: `semchan/NLUT`)
