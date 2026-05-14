from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session, relationship, sessionmaker

from .config import settings


engine = create_engine(
    settings.db_url,
    connect_args={"check_same_thread": False},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


class JobStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class JobKind(str, enum.Enum):
    render = "render"
    generate_lut = "generate_lut"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Video(Base):
    __tablename__ = "videos"

    id = Column(String, primary_key=True)
    filename = Column(String, nullable=False)
    path = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=False)
    duration_seconds = Column(Float, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    # Trim range in seconds. NULL = use full clip. trim_end is exclusive.
    trim_start = Column(Float, nullable=True)
    trim_end = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)

    jobs = relationship("Job", back_populates="video", cascade="all, delete-orphan")


class CustomLut(Base):
    __tablename__ = "custom_luts"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    path = Column(String, nullable=False)
    reference_image_path = Column(String, nullable=True)
    source_video_id = Column(String, ForeignKey("videos.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True)
    kind = Column(Enum(JobKind), nullable=False)
    status = Column(Enum(JobStatus), default=JobStatus.queued, nullable=False)
    progress = Column(Float, default=0.0, nullable=False)
    error = Column(String, nullable=True)

    video_id = Column(String, ForeignKey("videos.id"), nullable=True)
    preset_id = Column(String, nullable=True)
    custom_lut_id = Column(String, ForeignKey("custom_luts.id"), nullable=True)
    output_path = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)

    video = relationship("Video", back_populates="jobs")


def init_db() -> None:
    Base.metadata.create_all(engine)
    _migrate_videos_trim_columns()


def _migrate_videos_trim_columns() -> None:
    """Ad-hoc SQLite migration: add trim_start / trim_end if missing.

    `Base.metadata.create_all` only creates tables, never alters them, so
    we ALTER ADD COLUMN ourselves for backwards-compatibility with existing
    databases.
    """
    from sqlalchemy import text

    with engine.begin() as conn:
        existing = {
            row[1] for row in conn.exec_driver_sql("PRAGMA table_info(videos)").fetchall()
        }
        if "trim_start" not in existing:
            conn.execute(text("ALTER TABLE videos ADD COLUMN trim_start FLOAT"))
        if "trim_end" not in existing:
            conn.execute(text("ALTER TABLE videos ADD COLUMN trim_end FLOAT"))


def get_session() -> Session:
    return SessionLocal()
