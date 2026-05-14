"""Wrapper around the NLUT model that produces a `.cube`-compatible 3D LUT.

NLUT (https://github.com/semchan/NLUT) is a test-time-finetuned model:
for each (content_frame, style_image) pair we run ~40 iterations of fine-tuning,
then read out the model's 3D LUT and convert it to absolute-RGB form. The
LUT NLUT outputs is a *delta* over the identity map: the final stylized image
is `input + LUT(input)`. To match the `.cube` file convention (absolute output
values), we add the identity grid to the delta and clamp to [0, 1].

Inference takes ~10–15 seconds on a Blackwell GPU at 256×256 input. The model
weights are loaded once and cached at module level.

To enable, the cloned NLUT repo must exist at `backend/ml/nlut/` and the
pretrained checkpoint at `backend/ml/nlut/experiments/model.pth`.
"""
from __future__ import annotations

import logging
import os
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import numpy as np


log = logging.getLogger(__name__)


NLUT_DIR = Path(__file__).resolve().parents[2] / "ml" / "nlut"
NLUT_CKPT = NLUT_DIR / "experiments" / "model.pth"
LUT_DIM = 33

# Hyperparameters lifted from NLUT's parameter_finetuning.py defaults.
_FINETUNE_ITERS = 40
_BATCH_SIZE = 2
_LR = 1e-4
_LAMBDA_SMOOTH = 2e6
_LAMBDA_MN = 2e6
_MN_CONS_WEIGHT = 100.0
_STYLE_WEIGHT = 1.0
_CONTENT_WEIGHT = 1.0
_INPUT_SIZE = 256  # NLUT trains at 256x256


_lock = threading.Lock()
_cached: dict = {}


def is_available() -> bool:
    """Whether the NLUT repo and weights are installed."""
    return NLUT_DIR.is_dir() and NLUT_CKPT.is_file()


@contextmanager
def _cwd(path: Path):
    """NLUT's modules reference `models/vgg_normalised.pth` relatively."""
    prev = os.getcwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(prev)


def _ensure_loaded():
    """Import NLUT modules lazily and load model weights on first call."""
    if "model" in _cached:
        return

    import torch
    import torch.nn as nn  # noqa: F401

    if not is_available():
        raise RuntimeError(f"NLUT not installed at {NLUT_DIR}")

    if str(NLUT_DIR) not in sys.path:
        sys.path.insert(0, str(NLUT_DIR))

    with _cwd(NLUT_DIR):
        from nlut_models import NLUTNet, TVMN  # type: ignore[import-not-found]

        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        log.info("loading NLUT model on %s", device)

        model = NLUTNet("2048+32+32", dim=LUT_DIM).to(device)
        state = torch.load(NLUT_CKPT, map_location=device, weights_only=False)
        sd = state.get("state_dict", state)
        missing, unexpected = model.load_state_dict(sd, strict=False)
        if missing:
            log.warning("NLUT missing keys: %d (first: %s)", len(missing), missing[:3])
        if unexpected:
            log.info("NLUT unexpected keys (ignored): %d (first: %s)", len(unexpected), unexpected[:3])

        tvmn = TVMN(LUT_DIM).to(device)
        _cached["model"] = model
        _cached["tvmn"] = tvmn
        _cached["device"] = device
        _cached["initial_state"] = {k: v.detach().clone() for k, v in model.state_dict().items()}


def _load_image(path: Path):
    """Load an image as a [1, 3, H, W] float tensor in [0, 1] on the model's device."""
    import torch
    from PIL import Image
    from torchvision import transforms

    tf = transforms.Compose([
        transforms.Resize((_INPUT_SIZE, _INPUT_SIZE)),
        transforms.ToTensor(),
    ])
    img = Image.open(path).convert("RGB")
    return tf(img).unsqueeze(0).to(_cached["device"])


def generate_lut(
    content_frame: Path,
    style_image: Path,
    iters: int = _FINETUNE_ITERS,
) -> np.ndarray:
    """Produce a (33, 33, 33, 3) numpy LUT in [0, 1] suitable for writing a .cube file.

    Order of the returned array: data[b, g, r, :] = output_rgb for input (r, g, b)
    on a uniform grid 0..1. This matches the layout consumed by `_write_cube`
    in `app.workers.nlut`.
    """
    import torch
    import torch.nn as nn

    with _lock:
        _ensure_loaded()
        model = _cached["model"]
        tvmn = _cached["tvmn"]
        device = _cached["device"]

        with _cwd(NLUT_DIR):
            # Reset model weights to the pretrained checkpoint before each run
            # — test-time fine-tuning leaves us with a per-pair adapter, and
            # we want each new pair to start from the same baseline.
            model.load_state_dict(_cached["initial_state"], strict=False)
            model.train()

            content = _load_image(content_frame).repeat(_BATCH_SIZE, 1, 1, 1)
            style = _load_image(style_image).repeat(_BATCH_SIZE, 1, 1, 1)

            optimizer = torch.optim.Adam(model.parameters(), lr=_LR)
            t0 = time.time()
            last_lut: Optional[torch.Tensor] = None

            for i in range(iters):
                stylized, _st_out, others = model(content, content, style, TVMN=tvmn)
                tvmn_term = others.get("tvmn")
                lut = others.get("LUT")
                last_lut = lut
                mn_cons = (_LAMBDA_SMOOTH * (tvmn_term[0] + 10 * tvmn_term[2])
                           + _LAMBDA_MN * tvmn_term[1]) * _MN_CONS_WEIGHT
                loss_c, loss_s = model.encoder(content, style, stylized)
                loss = _CONTENT_WEIGHT * loss_c.mean() + _STYLE_WEIGHT * loss_s.mean() + mn_cons

                optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), max_norm=0.2)
                optimizer.step()

            assert last_lut is not None
            log.info("NLUT finetuned %d iters in %.2fs", iters, time.time() - t0)

            # last_lut shape: [B, 3, D, D, D]. Take batch 0.
            delta = last_lut[0].detach()  # [3, D, D, D]

    return _delta_to_absolute_cube(delta.cpu().numpy())


def _delta_to_absolute_cube(delta: np.ndarray) -> np.ndarray:
    """Convert NLUT's delta-LUT to absolute output values.

    NLUT stores `delta` such that final image = input_image + delta(input_image).
    The kernel's flat index `r + g*N + b*N*N` means `delta[channel, b, g, r]`
    holds the per-channel offset for input RGB coordinate (r, g, b) on a 0..1 grid.

    The .cube file format (and our render path) expects absolute output values
    in [0, 1]. So we add the identity ramp to delta and clamp.

    Returns: (N, N, N, 3) array indexed as [b, g, r, channel].
    """
    n = delta.shape[-1]
    axis = np.linspace(0.0, 1.0, n, dtype=np.float32)

    # delta is [3, N(b), N(g), N(r)]. We want output [N(b), N(g), N(r), 3].
    delta_bgr = np.transpose(delta, (1, 2, 3, 0))  # -> [b, g, r, c]

    identity = np.empty((n, n, n, 3), dtype=np.float32)
    # identity[b, g, r] = [r_value, g_value, b_value]
    identity[..., 0] = axis[np.newaxis, np.newaxis, :]  # r varies on last axis
    identity[..., 1] = axis[np.newaxis, :, np.newaxis]  # g varies on middle axis
    identity[..., 2] = axis[:, np.newaxis, np.newaxis]  # b varies on first axis

    absolute = identity + delta_bgr
    return np.clip(absolute, 0.0, 1.0)
