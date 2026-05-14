from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException

from ..db import CustomLut, Job, JobKind, JobStatus, SessionLocal, Video
from ..presets import get_preset
from ..schemas import JobOut, RenderJobIn
from ..storage import new_id, public_path_for


router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _job_to_out(job: Job) -> JobOut:
    output_url = None
    if job.output_path:
        try:
            output_url = public_path_for(Path(job.output_path))
        except ValueError:
            output_url = None
    return JobOut(
        id=job.id,
        kind=job.kind.value,
        status=job.status.value,
        progress=job.progress or 0.0,
        error=job.error,
        video_id=job.video_id,
        preset_id=job.preset_id,
        custom_lut_id=job.custom_lut_id,
        output_url=output_url,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


@router.post("/render", response_model=JobOut)
def create_render_job(payload: RenderJobIn, bg: BackgroundTasks) -> JobOut:
    if not payload.preset_id and not payload.custom_lut_id:
        raise HTTPException(400, "preset_id or custom_lut_id is required")
    if payload.preset_id and payload.custom_lut_id:
        raise HTTPException(400, "specify only one of preset_id or custom_lut_id")

    with SessionLocal() as s:
        video = s.get(Video, payload.video_id)
        if video is None:
            raise HTTPException(404, "video not found")

        lut_path: Path
        if payload.preset_id:
            preset = get_preset(payload.preset_id)
            if preset is None or not preset.cube_path.exists():
                raise HTTPException(404, "preset not found")
            lut_path = preset.cube_path
        else:
            custom = s.get(CustomLut, payload.custom_lut_id)
            if custom is None:
                raise HTTPException(404, "custom LUT not found")
            lut_path = Path(custom.path)
            if not lut_path.exists():
                raise HTTPException(404, "custom LUT file missing")

        job = Job(
            id=new_id(),
            kind=JobKind.render,
            status=JobStatus.queued,
            video_id=video.id,
            preset_id=payload.preset_id,
            custom_lut_id=payload.custom_lut_id,
        )
        s.add(job)
        s.commit()
        s.refresh(job)
        job_id = job.id
        input_path = Path(video.path)
        duration = video.duration_seconds
        trim_start = video.trim_start
        trim_end = video.trim_end

    bg.add_task(
        _run_render_task,
        job_id=job_id,
        input_path=str(input_path),
        lut_path=str(lut_path),
        duration=duration,
        trim_start=trim_start,
        trim_end=trim_end,
    )

    with SessionLocal() as s:
        job = s.get(Job, job_id)
        assert job is not None
        return _job_to_out(job)


def _run_render_task(
    job_id: str,
    input_path: str,
    lut_path: str,
    duration: float | None,
    trim_start: float | None,
    trim_end: float | None,
) -> None:
    from ..workers.render import render_lut

    render_lut(
        job_id=job_id,
        input_path=Path(input_path),
        lut_path=Path(lut_path),
        duration=duration,
        trim_start=trim_start,
        trim_end=trim_end,
    )


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: str) -> JobOut:
    with SessionLocal() as s:
        job = s.get(Job, job_id)
        if job is None:
            raise HTTPException(404, "job not found")
        return _job_to_out(job)


@router.get("", response_model=list[JobOut])
def list_jobs(limit: int = 50) -> list[JobOut]:
    with SessionLocal() as s:
        rows = s.query(Job).order_by(Job.created_at.desc()).limit(limit).all()
        return [_job_to_out(r) for r in rows]
