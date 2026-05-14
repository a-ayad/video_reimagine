from __future__ import annotations

import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from ..config import settings
from ..db import Job, JobStatus, SessionLocal


_TIME_RE = re.compile(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)")


def render_lut(
    job_id: str,
    input_path: Path,
    lut_path: Path,
    duration: Optional[float],
    trim_start: Optional[float] = None,
    trim_end: Optional[float] = None,
) -> None:
    """Run ffmpeg with lut3d filter; update job row as it progresses.

    If trim_start/trim_end are set, only that range is rendered. Progress
    is reported relative to the trimmed length.
    """
    output_path = settings.outputs_dir / f"{job_id}.mp4"

    # Compute the effective progress denominator.
    if trim_start is not None and trim_end is not None:
        effective_duration = max(0.001, trim_end - trim_start)
    else:
        effective_duration = duration

    # Place -ss and -t BEFORE -i for fast (keyframe-aligned) seek + accurate
    # cut. ffmpeg with -ss before -i seeks fast; combined with -t this gives
    # a clean trimmed output.
    seek_args: list[str] = []
    if trim_start is not None and trim_start > 0:
        seek_args += ["-ss", f"{trim_start:.3f}"]
    if trim_start is not None and trim_end is not None:
        seek_args += ["-t", f"{(trim_end - trim_start):.3f}"]
    elif trim_end is not None:
        seek_args += ["-t", f"{trim_end:.3f}"]

    cmd = [
        "ffmpeg",
        "-y",
        *seek_args,
        "-i",
        str(input_path),
        "-vf",
        f"lut3d=file={_escape_filter_path(lut_path)}",
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        "-nostats",
        str(output_path),
    ]

    _mark_running(job_id)

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            if line.startswith("out_time="):
                t = _parse_time(line.split("=", 1)[1])
                if t is not None and effective_duration and effective_duration > 0:
                    _update_progress(job_id, min(0.99, t / effective_duration))
            elif "time=" in line:
                m = _TIME_RE.search(line)
                if m and effective_duration and effective_duration > 0:
                    h, mn, sc = m.groups()
                    t = int(h) * 3600 + int(mn) * 60 + float(sc)
                    _update_progress(job_id, min(0.99, t / effective_duration))
    finally:
        proc.wait()

    if proc.returncode == 0 and output_path.exists():
        _mark_succeeded(job_id, output_path)
    else:
        _mark_failed(job_id, f"ffmpeg exited with code {proc.returncode}")


def _escape_filter_path(p: Path) -> str:
    s = str(p)
    # ffmpeg filter syntax: escape ':' and '\'.
    return s.replace("\\", "\\\\").replace(":", "\\:")


def _parse_time(value: str) -> Optional[float]:
    try:
        if value.endswith("us"):
            return float(value[:-2]) / 1_000_000.0
        if value.endswith("ms"):
            return float(value[:-2]) / 1_000.0
        return float(value)
    except ValueError:
        return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _with_job(fn: Callable[[Job], None], job_id: str) -> None:
    with SessionLocal() as s:
        job = s.get(Job, job_id)
        if job is None:
            return
        fn(job)
        s.commit()


def _mark_running(job_id: str) -> None:
    def upd(j: Job) -> None:
        j.status = JobStatus.running
        j.started_at = _now()
        j.progress = 0.01

    _with_job(upd, job_id)


def _update_progress(job_id: str, p: float) -> None:
    def upd(j: Job) -> None:
        j.progress = p

    _with_job(upd, job_id)


def _mark_succeeded(job_id: str, output_path: Path) -> None:
    def upd(j: Job) -> None:
        j.status = JobStatus.succeeded
        j.progress = 1.0
        j.output_path = str(output_path)
        j.finished_at = _now()

    _with_job(upd, job_id)


def _mark_failed(job_id: str, msg: str) -> None:
    def upd(j: Job) -> None:
        j.status = JobStatus.failed
        j.error = msg
        j.finished_at = _now()

    _with_job(upd, job_id)
