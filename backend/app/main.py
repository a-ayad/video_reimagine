from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api import jobs, luts, uploads, videos
from .config import settings
from .db import init_db


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def create_app() -> FastAPI:
    init_db()

    app = FastAPI(title=settings.app_name, version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["content-length", "content-range", "accept-ranges"],
    )

    app.include_router(uploads.router)
    app.include_router(videos.router)
    app.include_router(luts.router)
    app.include_router(jobs.router)

    app.mount("/media", StaticFiles(directory=settings.storage_root), name="media")
    app.mount("/presets", StaticFiles(directory=settings.presets_dir), name="presets")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
