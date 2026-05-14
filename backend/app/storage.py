from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import BinaryIO

from fastapi import UploadFile

from .config import settings


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def _safe_suffix(filename: str, fallback: str = ".bin") -> str:
    suffix = Path(filename).suffix.lower()
    if not suffix or len(suffix) > 8 or "/" in suffix or "\\" in suffix:
        return fallback
    return suffix


async def save_upload_video(upload: UploadFile) -> tuple[str, Path, int]:
    """Stream an upload to disk under uploads/. Returns (id, path, size)."""
    video_id = new_id()
    suffix = _safe_suffix(upload.filename or "", ".mp4")
    dest = settings.uploads_dir / f"{video_id}{suffix}"
    size = await _stream_to_file(upload, dest)
    return video_id, dest, size


async def save_upload_image(upload: UploadFile, target_dir: Path) -> tuple[str, Path]:
    image_id = new_id()
    suffix = _safe_suffix(upload.filename or "", ".jpg")
    dest = target_dir / f"{image_id}{suffix}"
    await _stream_to_file(upload, dest)
    return image_id, dest


async def _stream_to_file(upload: UploadFile, dest: Path) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    max_bytes = settings.max_upload_mb * 1024 * 1024
    with dest.open("wb") as f:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                f.close()
                dest.unlink(missing_ok=True)
                raise ValueError(f"upload exceeds {settings.max_upload_mb} MB limit")
            f.write(chunk)
    return size


def copy_file(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)


def public_path_for(file_path: Path) -> str:
    """Return a URL path for a file under storage_dir or luts/."""
    root = settings.storage_root.resolve()
    presets = settings.presets_dir.resolve()
    p = file_path.resolve()
    if str(p).startswith(str(root)):
        rel = p.relative_to(root)
        return f"/media/{rel.as_posix()}"
    if str(p).startswith(str(presets)):
        rel = p.relative_to(presets)
        return f"/presets/{rel.as_posix()}"
    raise ValueError(f"file outside servable roots: {file_path}")
