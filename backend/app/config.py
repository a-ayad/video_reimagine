from pathlib import Path

from pydantic_settings import BaseSettings


BACKEND_ROOT = Path(__file__).resolve().parent.parent
STORAGE_ROOT = BACKEND_ROOT / "app" / "storage_dir"


class Settings(BaseSettings):
    app_name: str = "video_reimagine"
    host: str = "0.0.0.0"
    port: int = 8090

    storage_root: Path = STORAGE_ROOT
    uploads_dir: Path = STORAGE_ROOT / "uploads"
    outputs_dir: Path = STORAGE_ROOT / "outputs"
    refs_dir: Path = STORAGE_ROOT / "refs"
    custom_luts_dir: Path = STORAGE_ROOT / "custom_luts"
    presets_dir: Path = BACKEND_ROOT / "luts"

    db_url: str = f"sqlite:///{STORAGE_ROOT / 'app.db'}"

    max_upload_mb: int = 500
    allowed_video_mimes: tuple[str, ...] = (
        "video/mp4",
        "video/quicktime",
        "video/webm",
        "video/x-matroska",
    )

    cors_origins: list[str] = [
        "http://localhost:8091",
        "http://127.0.0.1:8091",
        "http://upscale-demo:8091",
        "http://100.115.115.118:8091",
    ]


settings = Settings()

for d in (
    settings.uploads_dir,
    settings.outputs_dir,
    settings.refs_dir,
    settings.custom_luts_dir,
    settings.presets_dir,
):
    d.mkdir(parents=True, exist_ok=True)
