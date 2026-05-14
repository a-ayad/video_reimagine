from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class VideoOut(BaseModel):
    id: str
    filename: str
    size_bytes: int
    duration_seconds: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    trim_start: Optional[float] = None
    trim_end: Optional[float] = None
    stream_url: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TrimIn(BaseModel):
    """Body of PATCH /api/videos/{id}/trim. Send nulls to clear the trim."""
    trim_start: Optional[float] = None
    trim_end: Optional[float] = None


class PresetOut(BaseModel):
    id: str
    name: str
    description: str
    cube_url: str
    swatch: list[str] = Field(default_factory=list)


class JobOut(BaseModel):
    id: str
    kind: str
    status: str
    progress: float
    error: Optional[str] = None
    video_id: Optional[str] = None
    preset_id: Optional[str] = None
    custom_lut_id: Optional[str] = None
    output_url: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class RenderJobIn(BaseModel):
    video_id: str
    preset_id: Optional[str] = None
    custom_lut_id: Optional[str] = None
    output_format: str = "mp4"


class CustomLutOut(BaseModel):
    id: str
    name: str
    cube_url: str
    created_at: datetime

    model_config = {"from_attributes": True}
