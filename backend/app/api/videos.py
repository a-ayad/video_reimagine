"""Video metadata operations: trim, lookup."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..db import SessionLocal, Video
from ..schemas import TrimIn, VideoOut
from ..storage import public_path_for


router = APIRouter(prefix="/api/videos", tags=["videos"])


def _to_out(v: Video) -> VideoOut:
    return VideoOut(
        id=v.id,
        filename=v.filename,
        size_bytes=v.size_bytes,
        duration_seconds=v.duration_seconds,
        width=v.width,
        height=v.height,
        trim_start=v.trim_start,
        trim_end=v.trim_end,
        stream_url=public_path_for(Path(v.path)),
        created_at=v.created_at,
    )


@router.get("/{video_id}", response_model=VideoOut)
def get_video(video_id: str) -> VideoOut:
    with SessionLocal() as s:
        v = s.get(Video, video_id)
        if v is None:
            raise HTTPException(404, "video not found")
        return _to_out(v)


@router.patch("/{video_id}/trim", response_model=VideoOut)
def set_trim(video_id: str, payload: TrimIn) -> VideoOut:
    """Set or clear the trim range for a video.

    Pass `{"trim_start": null, "trim_end": null}` to clear the trim and use
    the full clip. Otherwise both values are clamped to the duration and
    must satisfy 0 <= trim_start < trim_end <= duration.
    """
    with SessionLocal() as s:
        v = s.get(Video, video_id)
        if v is None:
            raise HTTPException(404, "video not found")

        start = payload.trim_start
        end = payload.trim_end

        if start is None and end is None:
            v.trim_start = None
            v.trim_end = None
        else:
            duration = v.duration_seconds or 0.0
            if duration <= 0:
                raise HTTPException(400, "video has no known duration; cannot trim")

            start = max(0.0, float(start)) if start is not None else 0.0
            end = min(duration, float(end)) if end is not None else duration
            if end <= start:
                raise HTTPException(400, "trim_end must be greater than trim_start")
            # Treat trims that span the entire clip as "no trim" so other code
            # paths can short-circuit.
            if start <= 0.001 and end >= duration - 0.001:
                v.trim_start = None
                v.trim_end = None
            else:
                v.trim_start = start
                v.trim_end = end

        s.commit()
        s.refresh(v)
        return _to_out(v)
