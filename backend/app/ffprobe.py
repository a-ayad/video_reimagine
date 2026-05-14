from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Optional


def probe(path: Path) -> dict:
    """Run ffprobe and return parsed JSON, or {} on failure."""
    try:
        out = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=20,
            check=True,
        )
        return json.loads(out.stdout)
    except (subprocess.SubprocessError, json.JSONDecodeError):
        return {}


def video_metadata(path: Path) -> dict:
    """Extract duration, width, height from a video file."""
    data = probe(path)
    info: dict = {"duration_seconds": None, "width": None, "height": None}
    fmt = data.get("format", {})
    if "duration" in fmt:
        try:
            info["duration_seconds"] = float(fmt["duration"])
        except ValueError:
            pass
    for s in data.get("streams", []):
        if s.get("codec_type") == "video":
            info["width"] = s.get("width")
            info["height"] = s.get("height")
            if info["duration_seconds"] is None and "duration" in s:
                try:
                    info["duration_seconds"] = float(s["duration"])
                except ValueError:
                    pass
            break
    return info


def extract_keyframe(video_path: Path, dest: Path, time_seconds: Optional[float] = None) -> Optional[Path]:
    """Pull a single JPEG keyframe near `time_seconds` (middle of clip if None)."""
    duration = video_metadata(video_path).get("duration_seconds") or 1.0
    ts = time_seconds if time_seconds is not None else duration / 2.0
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                f"{ts:.3f}",
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                "-q:v",
                "2",
                str(dest),
            ],
            capture_output=True,
            timeout=30,
            check=True,
        )
        return dest
    except subprocess.SubprocessError:
        return None
