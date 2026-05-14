# video_reimagine

A local webapp that re-grades the colors of uploaded videos with curated film
looks (vintage film, 90s VHS, teal-orange, etc.) or an AI-generated look
matched from a reference image. Designed to run on a single machine and be
reachable through Tailscale.

## How it works

1. **Browser preview** — WebGPU samples the video texture and a 3D LUT
   (`texture_3d<f32>`) in a fragment shader. Switching looks is instant, no
   server hit. Side-by-side split toggle and intensity slider.
2. **Server render** — On export, FastAPI hands the input video and the chosen
   `.cube` to FFmpeg's `lut3d` filter. Real-time-ish on a single CPU core; runs
   on GPU happily too.
3. **AI custom look** — Upload a reference image (a film still, a photo, a
   Pinterest screenshot). The backend extracts a keyframe from the uploaded
   video, then generates a `.cube` LUT that pushes the video's color
   distribution toward the reference. The result is downloadable as a real
   `.cube` for use in Premiere/Resolve.

## Hosts and ports

Both services bind `0.0.0.0`. The frontend serves **HTTPS** using a
Let's Encrypt cert that `tailscale cert` issues for the host's
`<machine>.<tailnet>.ts.net` MagicDNS name. WebGPU requires a secure
context, and the cert is trusted by every browser, so no scary warnings.

| Service  | Port | URL                                                     |
| -------- | ---- | ------------------------------------------------------- |
| Frontend | 8091 | https://localhost:8091                                  |
|          |      | https://upscale-demo.tail2074ee.ts.net:8091             |
| API      | 8090 | http://localhost:8090/health (loopback only, internal)  |

Notes:
- Use the **full Tailscale FQDN** (`upscale-demo.tail2074ee.ts.net`) — the
  cert doesn't cover the short hostname or raw IP, so those would get a
  TLS mismatch warning.
- The cert is valid for ~3 months. `dev.sh` auto-renews when it has
  less than 7 days left, so as long as you start the launcher
  occasionally it stays fresh.
- The backend stays plain HTTP because Next.js proxies to it over the
  loopback — the browser only ever sees HTTPS.

## Run

For development (manual, foreground, hot-reload):

```bash
./scripts/setup.sh   # one-time: venv + node_modules + LUT generation
./scripts/dev.sh     # start both services
```

For "always on, auto-restart, auto-start on boot" — install systemd units:

```bash
sudo ./scripts/install-services.sh
```

This builds the production frontend bundle, installs two units
(`video-reimagine-api.service` and `video-reimagine-web.service`),
enables them so they start on boot, and starts them right now.
The web unit's `ExecStartPre` refreshes the Tailscale TLS cert
when it's within 7 days of expiry.

```bash
systemctl status   video-reimagine-api video-reimagine-web
systemctl restart  video-reimagine-api video-reimagine-web
journalctl -u video-reimagine-web -f
```

## Architecture

```
frontend (Next.js 16 + React 19)         backend (FastAPI + SQLite)
─────────────────────────────────        ────────────────────────────
app/page.tsx           — main UI         app/main.py        — entrypoint
components/Uploader    — drag-drop       app/api/uploads.py — /api/uploads/video
components/Preview     — WebGPU preview  app/api/luts.py    — presets + generate
components/PresetGall  — preset picker   app/api/jobs.py    — render queue
components/ExportPanel — server render   app/workers/render.py — ffmpeg lut3d
components/CustomLut   — reference->LUT  app/workers/nlut.py   — LUT generator
lib/webgpu/lut-pipe..  — WGSL + pipeline app/storage_dir/      — uploads/outputs
lib/webgpu/shader.ts   — fragment shader luts/                 — 12 preset .cubes
lib/cube.ts            — .cube parser
```

## The custom LUT pipeline

When `backend/ml/nlut/experiments/model.pth` is present (downloaded by
`scripts/setup.sh`), the "AI custom look" feature runs the
[NLUT](https://github.com/semchan/NLUT) model: ~40 iterations of test-time
fine-tuning on the (video keyframe, reference image) pair, then a forward
pass to extract the predicted 3D LUT. End-to-end on Blackwell is about
**6–10 seconds**. NLUT outputs a delta-LUT (`output = input + LUT(input)`);
`nlut_runner.py` adds the identity grid and clamps to [0, 1] before writing
the `.cube` file.

If the model or its trilinear CUDA extension are unavailable, the same code
path falls back to a fast channel-wise histogram-matching method (<1 second on
CPU). Less aesthetically interesting than NLUT, but the same `.cube` artifact.

NLUT-specific install steps (run automatically by `scripts/setup.sh`):

1. `git clone https://github.com/semchan/NLUT backend/ml/nlut`
2. `gdown` the pretrained `model.pth` into `backend/ml/nlut/experiments/`
3. Patch the trilinear CUDA extension for PyTorch 2.x (drop deprecated
   `THC/THC.h` includes, switch `.data<T>()` → `.data_ptr<T>()`)
4. `python setup.py install` from `backend/ml/nlut/trilinear_cpp/` with
   `TORCH_CUDA_ARCH_LIST="8.0;8.9;9.0;12.0"` for Blackwell support

## Adding more presets

Each preset is a deterministic numpy function in
`backend/scripts/build_presets.py`. Add an entry to `PRESETS` in
`backend/app/presets.py` and a matching function in `PRESET_FUNCS`, then:

```bash
backend/.venv/bin/python backend/scripts/build_presets.py
```

This regenerates all `.cube` files in `backend/luts/`.

## GPU

Inference uses the RTX PRO 6000 Blackwell when available. The current
histogram-matching fallback is CPU-only and runs in well under a second.
The render path (FFmpeg `lut3d`) is also CPU-bound at decode/encode speed;
H.264 encode is the slow step at ~real-time. To use GPU encode swap `libx264`
for `h264_nvenc` in `backend/app/workers/render.py`.
