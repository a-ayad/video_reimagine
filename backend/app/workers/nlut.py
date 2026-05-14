"""NLUT-based custom LUT generation.

Tries to load the NLUT model from `backend/ml/nlut/`. If the model is not
yet installed, falls back to a histogram-matching method that produces a
usable `.cube` file from the reference image. The fallback keeps the API
contract intact while NLUT weights download in the background.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image

from ..config import settings
from ..db import CustomLut, Job, JobStatus, SessionLocal, Video
from ..ffprobe import extract_keyframe
from ..storage import new_id


log = logging.getLogger(__name__)

LUT_SIZE = 33  # 33^3 = 35,937 entries, ~1MB ASCII .cube


def generate_lut_from_reference(
    job_id: str,
    reference_image: Path,
    source_video_id: Optional[str],
    custom_name: Optional[str],
) -> None:
    """Produce a `.cube` LUT that maps a source video's palette toward a reference image.

    For v1 we use a histogram-matching fallback. The NLUT model slot is reserved
    in `_try_nlut_inference`; when weights are present it will take over.
    """
    _mark_running(job_id)

    try:
        source_frame_path = _resolve_source_frame(source_video_id)
        lut_array = _try_nlut_inference(reference_image, source_frame_path)
        if lut_array is None:
            lut_array = _histogram_match_lut(reference_image, source_frame_path)

        lut_id = new_id()
        cube_path = settings.custom_luts_dir / f"{lut_id}.cube"
        _write_cube(cube_path, lut_array, title=custom_name or f"Custom {lut_id}")

        with SessionLocal() as s:
            custom = CustomLut(
                id=lut_id,
                name=custom_name or f"Custom {lut_id[:6]}",
                path=str(cube_path),
                reference_image_path=str(reference_image),
                source_video_id=source_video_id,
            )
            s.add(custom)
            job = s.get(Job, job_id)
            if job is not None:
                job.custom_lut_id = lut_id
                job.status = JobStatus.succeeded
                job.progress = 1.0
                job.finished_at = datetime.now(timezone.utc)
            s.commit()
    except Exception as e:
        log.exception("LUT generation failed")
        _mark_failed(job_id, f"{type(e).__name__}: {e}")


def _resolve_source_frame(video_id: Optional[str]) -> Optional[Path]:
    """Pull a representative keyframe from the (trimmed) source video.

    The keyframe time is the midpoint of the active range — full clip if
    no trim is set, the trim range otherwise. Cache key includes trim so
    re-trimming invalidates the cache.
    """
    if not video_id:
        return None
    with SessionLocal() as s:
        video = s.get(Video, video_id)
        if video is None:
            return None
        ts0 = video.trim_start
        ts1 = video.trim_end
        duration = video.duration_seconds or 0.0
        start = ts0 if ts0 is not None else 0.0
        end = ts1 if ts1 is not None else duration
        midpoint = start + (end - start) / 2.0 if end > start else start

        suffix = "_full" if ts0 is None and ts1 is None else f"_{int(start*1000)}_{int(end*1000)}"
        out = settings.refs_dir / f"keyframe_{video.id}{suffix}.jpg"
        if out.exists():
            return out
        return extract_keyframe(Path(video.path), out, time_seconds=midpoint)


def _try_nlut_inference(reference: Path, source_frame: Optional[Path]) -> Optional[np.ndarray]:
    """Run NLUT to predict a 3D LUT from a content frame + style image.

    Returns a (N, N, N, 3) array in [0, 1] indexed as [b, g, r, channel], or
    None if NLUT isn't installed or fails (caller falls back to histogram match).
    """
    try:
        from . import nlut_runner
    except ImportError:
        log.debug("nlut_runner not importable", exc_info=True)
        return None

    if not nlut_runner.is_available():
        return None

    if source_frame is None or not source_frame.exists():
        # NLUT needs a content frame; if we don't have one fall back.
        return None

    try:
        return nlut_runner.generate_lut(content_frame=source_frame, style_image=reference)
    except Exception:
        log.exception("NLUT inference failed; falling back to histogram match")
        return None


def _histogram_match_lut(reference: Path, source_frame: Optional[Path]) -> np.ndarray:
    """Build a 3D LUT via channel-wise histogram matching.

    For each R/G/B channel: build CDFs of source and reference, then map
    every value v_in -> CDF_ref^{-1}(CDF_src(v_in)). Stack into a 3D LUT.
    """
    ref = _load_image_rgb(reference)
    if source_frame is not None and source_frame.exists():
        src = _load_image_rgb(source_frame)
    else:
        src = _identity_source()

    channel_maps = np.stack(
        [_channel_cdf_map(src[..., c], ref[..., c]) for c in range(3)], axis=0
    )  # shape (3, 256)

    n = LUT_SIZE
    axis = np.linspace(0.0, 1.0, n, dtype=np.float32)
    lut = np.empty((n, n, n, 3), dtype=np.float32)

    for b_i in range(n):
        for g_i in range(n):
            for r_i in range(n):
                r = int(round(axis[r_i] * 255))
                g = int(round(axis[g_i] * 255))
                b = int(round(axis[b_i] * 255))
                lut[b_i, g_i, r_i, 0] = channel_maps[0, r] / 255.0
                lut[b_i, g_i, r_i, 1] = channel_maps[1, g] / 255.0
                lut[b_i, g_i, r_i, 2] = channel_maps[2, b] / 255.0
    return lut


def _load_image_rgb(path: Path) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    img.thumbnail((1024, 1024))
    return np.asarray(img, dtype=np.uint8)


def _identity_source() -> np.ndarray:
    # uniform ramp over [0, 255] in each channel for a neutral source
    ramp = np.linspace(0, 255, 256, dtype=np.uint8)
    grid = np.stack(np.meshgrid(ramp, ramp, indexing="ij"), axis=-1)
    return np.concatenate([grid, ramp[:, None, None].repeat(256, axis=1)], axis=-1)


def _channel_cdf_map(src: np.ndarray, ref: np.ndarray) -> np.ndarray:
    src_hist, _ = np.histogram(src.flatten(), bins=256, range=(0, 256))
    ref_hist, _ = np.histogram(ref.flatten(), bins=256, range=(0, 256))
    src_cdf = src_hist.cumsum().astype(np.float64)
    ref_cdf = ref_hist.cumsum().astype(np.float64)
    src_cdf /= max(src_cdf[-1], 1.0)
    ref_cdf /= max(ref_cdf[-1], 1.0)
    mapping = np.zeros(256, dtype=np.uint8)
    j = 0
    for i in range(256):
        while j < 255 and ref_cdf[j] < src_cdf[i]:
            j += 1
        mapping[i] = j
    return mapping


def _write_cube(path: Path, lut: np.ndarray, title: str) -> None:
    """Write a 3D LUT as a .cube file (Adobe spec).

    Order: r varies fastest, then g, then b.
    """
    n = lut.shape[0]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        f.write(f"TITLE \"{title}\"\n")
        f.write(f"LUT_3D_SIZE {n}\n")
        f.write("DOMAIN_MIN 0.0 0.0 0.0\n")
        f.write("DOMAIN_MAX 1.0 1.0 1.0\n")
        for b_i in range(n):
            for g_i in range(n):
                for r_i in range(n):
                    r, g, b = lut[b_i, g_i, r_i]
                    f.write(f"{r:.6f} {g:.6f} {b:.6f}\n")


def _mark_running(job_id: str) -> None:
    with SessionLocal() as s:
        job = s.get(Job, job_id)
        if job is None:
            return
        job.status = JobStatus.running
        job.started_at = datetime.now(timezone.utc)
        job.progress = 0.05
        s.commit()


def _mark_failed(job_id: str, msg: str) -> None:
    with SessionLocal() as s:
        job = s.get(Job, job_id)
        if job is None:
            return
        job.status = JobStatus.failed
        job.error = msg
        job.finished_at = datetime.now(timezone.utc)
        s.commit()
