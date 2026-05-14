from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..config import settings
from ..db import SessionLocal, Video
from ..ffprobe import video_metadata
from ..schemas import VideoOut
from ..storage import public_path_for, save_upload_video


router = APIRouter(prefix="/api/uploads", tags=["uploads"])


@router.post("/video", response_model=VideoOut)
async def upload_video(file: UploadFile = File(...)) -> VideoOut:
    # Lenient mime check: only block obvious mismatches; rely on ffprobe to verify
    # the file is actually a video. Many clients send application/octet-stream.
    ct = (file.content_type or "").lower()
    if ct and not (
        ct.startswith("video/")
        or ct == "application/octet-stream"
        or ct == "application/x-matroska"
    ):
        raise HTTPException(415, f"unsupported content-type: {ct}")

    try:
        video_id, dest, size = await save_upload_video(file)
    except ValueError as e:
        raise HTTPException(413, str(e)) from e

    meta = video_metadata(dest)
    if meta.get("width") is None or meta.get("height") is None:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, "file does not contain a decodable video stream")

    with SessionLocal() as s:
        video = Video(
            id=video_id,
            filename=file.filename or dest.name,
            path=str(dest),
            size_bytes=size,
            duration_seconds=meta.get("duration_seconds"),
            width=meta.get("width"),
            height=meta.get("height"),
        )
        s.add(video)
        s.commit()
        s.refresh(video)

        return VideoOut(
            id=video.id,
            filename=video.filename,
            size_bytes=video.size_bytes,
            duration_seconds=video.duration_seconds,
            width=video.width,
            height=video.height,
            trim_start=video.trim_start,
            trim_end=video.trim_end,
            stream_url=public_path_for(dest),
            created_at=video.created_at,
        )
