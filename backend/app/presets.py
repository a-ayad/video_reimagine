"""Registry of curated `.cube` LUT presets.

Each preset's `.cube` file lives in backend/luts/. Some are hand-tuned, others
are programmatically generated (see scripts/build_presets.py).
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .config import settings


@dataclass(frozen=True)
class Preset:
    id: str
    name: str
    description: str
    filename: str
    swatch: tuple[str, ...]

    @property
    def cube_path(self) -> Path:
        return settings.presets_dir / self.filename


PRESETS: tuple[Preset, ...] = (
    Preset(
        id="vintage-film",
        name="Vintage Film",
        description="Warm 1970s Kodachrome stock — creamy highlights, soft blacks.",
        filename="vintage_film.cube",
        swatch=("#3a2a1f", "#c8a672", "#e8d9b5"),
    ),
    Preset(
        id="vhs-90s",
        name="90s VHS",
        description="Magenta-tinted blacks, blown highlights, low saturation.",
        filename="vhs_90s.cube",
        swatch=("#2a1530", "#7a4a8a", "#d8c0e0"),
    ),
    Preset(
        id="teal-orange",
        name="Teal & Orange",
        description="Modern cinematic — cyan shadows, orange skintones.",
        filename="teal_orange.cube",
        swatch=("#1a3a4a", "#c87a3a", "#f0d8b0"),
    ),
    Preset(
        id="sun-bleached",
        name="Sun Bleached",
        description="Faded, washed-out highlights with lifted shadows.",
        filename="sun_bleached.cube",
        swatch=("#5a5a4a", "#c0b8a0", "#f0ead8"),
    ),
    Preset(
        id="bleach-bypass",
        name="Bleach Bypass",
        description="Desaturated, high-contrast gritty look.",
        filename="bleach_bypass.cube",
        swatch=("#0a0a0a", "#808080", "#f0f0f0"),
    ),
    Preset(
        id="sepia",
        name="Sepia",
        description="Classic monochrome warm tone.",
        filename="sepia.cube",
        swatch=("#2a1a08", "#a07040", "#f0d8b0"),
    ),
    Preset(
        id="cyberpunk",
        name="Cyberpunk",
        description="Magenta highlights, neon teal shadows, crushed blacks.",
        filename="cyberpunk.cube",
        swatch=("#0a0030", "#a020a0", "#20e0e0"),
    ),
    Preset(
        id="noir",
        name="Film Noir",
        description="High-contrast black and white with deep blacks.",
        filename="noir.cube",
        swatch=("#000000", "#606060", "#ffffff"),
    ),
    Preset(
        id="warm-summer",
        name="Warm Summer",
        description="Golden-hour warmth across the entire image.",
        filename="warm_summer.cube",
        swatch=("#3a2818", "#d09058", "#f8e8c0"),
    ),
    Preset(
        id="cold-winter",
        name="Cold Winter",
        description="Cool blue cast, lifted shadows.",
        filename="cold_winter.cube",
        swatch=("#1a2a4a", "#7090b0", "#d0e0f0"),
    ),
    Preset(
        id="anamorphic",
        name="Anamorphic",
        description="Cool shadows, slightly warm midtones, cinematic contrast.",
        filename="anamorphic.cube",
        swatch=("#0a1830", "#8898a8", "#f0e8d8"),
    ),
    Preset(
        id="kodachrome",
        name="Kodachrome",
        description="Saturated reds and greens with rich blacks.",
        filename="kodachrome.cube",
        swatch=("#1a0a0a", "#c83838", "#f0e0c0"),
    ),
)


def get_preset(preset_id: str) -> Preset | None:
    return next((p for p in PRESETS if p.id == preset_id), None)
