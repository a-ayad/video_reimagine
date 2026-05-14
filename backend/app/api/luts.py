from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from ..config import settings
from ..db import CustomLut, Job, JobKind, JobStatus, SessionLocal, Video
from ..presets import PRESETS, get_preset
from ..schemas import CustomLutOut, JobOut, PresetOut
from ..storage import new_id, public_path_for, save_upload_image


router = APIRouter(prefix="/api/luts", tags=["luts"])


@router.get("/presets", response_model=list[PresetOut])
def list_presets() -> list[PresetOut]:
    out: list[PresetOut] = []
    for p in PRESETS:
        if not p.cube_path.exists():
            continue
        out.append(
            PresetOut(
                id=p.id,
                name=p.name,
                description=p.description,
                cube_url=public_path_for(p.cube_path),
                swatch=list(p.swatch),
            )
        )
    return out


@router.get("/presets/{preset_id}", response_model=PresetOut)
def get_preset_meta(preset_id: str) -> PresetOut:
    p = get_preset(preset_id)
    if p is None or not p.cube_path.exists():
        raise HTTPException(404, "preset not found")
    return PresetOut(
        id=p.id,
        name=p.name,
        description=p.description,
        cube_url=public_path_for(p.cube_path),
        swatch=list(p.swatch),
    )


@router.get("/custom", response_model=list[CustomLutOut])
def list_custom_luts() -> list[CustomLutOut]:
    with SessionLocal() as s:
        items = s.query(CustomLut).order_by(CustomLut.created_at.desc()).all()
        return [
            CustomLutOut(
                id=c.id,
                name=c.name,
                cube_url=public_path_for(Path(c.path)) if c.path else "",
                created_at=c.created_at,
            )
            for c in items
        ]


@router.post("/generate", response_model=JobOut)
async def generate_custom_lut(
    bg: BackgroundTasks,
    reference: UploadFile = File(...),
    video_id: Optional[str] = Form(None),
    name: Optional[str] = Form(None),
) -> JobOut:
    """Generate a custom LUT from a reference image (and optional source video).

    Runs NLUT inference in the background. Polls /api/jobs/{id} for status.
    """
    from .jobs import _job_to_out  # local import to avoid cycle

    try:
        _ref_id, ref_path = await save_upload_image(reference, settings.refs_dir)
    except ValueError as e:
        raise HTTPException(413, str(e)) from e

    with SessionLocal() as s:
        if video_id is not None:
            video = s.get(Video, video_id)
            if video is None:
                raise HTTPException(404, "video not found")

        job = Job(
            id=new_id(),
            kind=JobKind.generate_lut,
            status=JobStatus.queued,
            video_id=video_id,
        )
        s.add(job)
        s.commit()
        s.refresh(job)
        job_id = job.id

    bg.add_task(
        _run_generate_lut_task,
        job_id=job_id,
        reference_path=str(ref_path),
        video_id=video_id,
        name=name,
    )

    with SessionLocal() as s:
        job = s.get(Job, job_id)
        assert job is not None
        return _job_to_out(job)


def _run_generate_lut_task(
    job_id: str,
    reference_path: str,
    video_id: Optional[str],
    name: Optional[str],
) -> None:
    """Background entrypoint for NLUT inference."""
    from pathlib import Path

    from ..workers.nlut import generate_lut_from_reference

    generate_lut_from_reference(
        job_id=job_id,
        reference_image=Path(reference_path),
        source_video_id=video_id,
        custom_name=name,
    )
