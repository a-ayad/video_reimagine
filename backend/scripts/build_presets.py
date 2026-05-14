"""Generate the curated preset `.cube` LUT library.

Each preset is a deterministic function of (r, g, b) -> (r', g', b'). We
sample on a 33^3 grid and write Adobe .cube files into backend/luts/.

The math here is intentionally simple — pure tone mapping per channel plus
a few targeted hue/saturation moves. Output looks resemble film stocks and
common color-grade conventions; they are not exact LUT reproductions of any
commercial product.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.presets import PRESETS  # noqa: E402

LUT_SIZE = 33


# ---------- color helpers ----------

def rgb_to_hsv(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    diff = mx - mn

    h = np.zeros_like(mx)
    mask = diff > 1e-8
    rc = np.where(mask, (mx - r) / np.where(diff == 0, 1, diff), 0)
    gc = np.where(mask, (mx - g) / np.where(diff == 0, 1, diff), 0)
    bc = np.where(mask, (mx - b) / np.where(diff == 0, 1, diff), 0)
    h = np.where(r == mx, bc - gc, np.where(g == mx, 2.0 + rc - bc, 4.0 + gc - rc))
    h = (h / 6.0) % 1.0
    h = np.where(mask, h, 0.0)

    s = np.where(mx > 0, diff / np.where(mx == 0, 1, mx), 0)
    v = mx
    return np.stack([h, s, v], axis=-1)


def hsv_to_rgb(hsv: np.ndarray) -> np.ndarray:
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    i = np.floor(h * 6).astype(int)
    f = h * 6 - i
    p = v * (1 - s)
    q = v * (1 - f * s)
    t = v * (1 - (1 - f) * s)
    i = i % 6

    r = np.choose(i, [v, q, p, p, t, v])
    g = np.choose(i, [t, v, v, q, p, p])
    b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], axis=-1)


def lift_gamma_gain(c: np.ndarray, lift: float, gamma: float, gain: float) -> np.ndarray:
    """Standard color-grade primitives. c in [0, 1]."""
    c = lift + (gain - lift) * c
    c = np.clip(c, 0, None)
    c = np.power(c, 1.0 / max(gamma, 1e-6))
    return np.clip(c, 0, 1)


def contrast(c: np.ndarray, k: float, pivot: float = 0.5) -> np.ndarray:
    return np.clip((c - pivot) * k + pivot, 0, 1)


def s_curve(c: np.ndarray, strength: float = 0.3) -> np.ndarray:
    """Smooth S-shaped tone curve."""
    return c + strength * np.sin(np.pi * c) * (0.5 - c) * -2


# ---------- preset functions: rgb_grid (H, H, H, 3) -> rgb_grid ----------

def vintage_film(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    r = lift_gamma_gain(r, 0.04, 0.95, 1.02)
    g = lift_gamma_gain(g, 0.03, 1.00, 0.98)
    b = lift_gamma_gain(b, 0.02, 1.10, 0.88)
    out = np.stack([r, g, b], axis=-1)
    out = contrast(out, 0.92, pivot=0.45)
    # warm tint
    out[..., 0] = np.clip(out[..., 0] * 1.05, 0, 1)
    out[..., 2] = np.clip(out[..., 2] * 0.93, 0, 1)
    return out


def vhs_90s(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # crushed blacks with magenta tint, blown highlights
    r = lift_gamma_gain(r, 0.06, 1.05, 1.08)
    g = lift_gamma_gain(g, 0.04, 1.10, 0.95)
    b = lift_gamma_gain(b, 0.08, 1.00, 1.05)
    out = np.stack([r, g, b], axis=-1)
    # desaturate
    hsv = rgb_to_hsv(out)
    hsv[..., 1] *= 0.70
    out = hsv_to_rgb(hsv)
    return np.clip(out, 0, 1)


def teal_orange(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # shadows -> teal, highlights -> orange
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    shadow_w = np.clip(1.0 - luma * 1.4, 0, 1)
    highlight_w = np.clip((luma - 0.4) * 1.4, 0, 1)

    r = r + highlight_w * 0.12 - shadow_w * 0.06
    g = g + highlight_w * 0.05 - shadow_w * 0.01
    b = b - highlight_w * 0.10 + shadow_w * 0.10
    out = np.stack([r, g, b], axis=-1)
    out = contrast(out, 1.08)
    return np.clip(out, 0, 1)


def sun_bleached(rgb: np.ndarray) -> np.ndarray:
    # lift shadows, compress highlights, desaturate
    out = lift_gamma_gain(rgb, 0.12, 0.95, 0.92)
    hsv = rgb_to_hsv(out)
    hsv[..., 1] *= 0.55
    out = hsv_to_rgb(hsv)
    out[..., 0] = np.clip(out[..., 0] * 1.04, 0, 1)
    out[..., 1] = np.clip(out[..., 1] * 1.02, 0, 1)
    return np.clip(out, 0, 1)


def bleach_bypass(rgb: np.ndarray) -> np.ndarray:
    luma = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    luma3 = np.stack([luma, luma, luma], axis=-1)
    mixed = 0.6 * luma3 + 0.4 * rgb
    mixed = contrast(mixed, 1.30, pivot=0.5)
    return np.clip(mixed, 0, 1)


def sepia(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    nr = 0.393 * r + 0.769 * g + 0.189 * b
    ng = 0.349 * r + 0.686 * g + 0.168 * b
    nb = 0.272 * r + 0.534 * g + 0.131 * b
    out = np.stack([nr, ng, nb], axis=-1)
    return np.clip(out, 0, 1)


def cyberpunk(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    shadow_w = np.clip(1.0 - luma * 1.6, 0, 1)
    highlight_w = np.clip((luma - 0.35) * 1.6, 0, 1)

    # shadows -> neon teal, highlights -> magenta
    r = r - shadow_w * 0.12 + highlight_w * 0.20
    g = g + shadow_w * 0.08 - highlight_w * 0.04
    b = b + shadow_w * 0.18 + highlight_w * 0.15
    out = np.stack([r, g, b], axis=-1)
    out = contrast(out, 1.15, pivot=0.45)
    # boost saturation
    hsv = rgb_to_hsv(out)
    hsv[..., 1] = np.clip(hsv[..., 1] * 1.25, 0, 1)
    out = hsv_to_rgb(hsv)
    return np.clip(out, 0, 1)


def noir(rgb: np.ndarray) -> np.ndarray:
    luma = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    luma = contrast(luma, 1.35, pivot=0.45)
    return np.stack([luma, luma, luma], axis=-1)


def warm_summer(rgb: np.ndarray) -> np.ndarray:
    out = rgb.copy()
    out[..., 0] = np.clip(out[..., 0] * 1.08 + 0.02, 0, 1)
    out[..., 1] = np.clip(out[..., 1] * 1.02, 0, 1)
    out[..., 2] = np.clip(out[..., 2] * 0.90, 0, 1)
    return contrast(out, 1.05)


def cold_winter(rgb: np.ndarray) -> np.ndarray:
    out = rgb.copy()
    out[..., 0] = np.clip(out[..., 0] * 0.90, 0, 1)
    out[..., 1] = np.clip(out[..., 1] * 0.97, 0, 1)
    out[..., 2] = np.clip(out[..., 2] * 1.12 + 0.02, 0, 1)
    out = lift_gamma_gain(out, 0.04, 1.02, 1.0)
    return np.clip(out, 0, 1)


def anamorphic(rgb: np.ndarray) -> np.ndarray:
    out = teal_orange(rgb)
    out = lift_gamma_gain(out, 0.02, 1.05, 0.98)
    hsv = rgb_to_hsv(out)
    hsv[..., 1] = np.clip(hsv[..., 1] * 0.90, 0, 1)
    out = hsv_to_rgb(hsv)
    return np.clip(out, 0, 1)


def kodachrome(rgb: np.ndarray) -> np.ndarray:
    out = rgb.copy()
    hsv = rgb_to_hsv(out)
    hsv[..., 1] = np.clip(hsv[..., 1] * 1.30, 0, 1)
    out = hsv_to_rgb(hsv)
    out[..., 0] = np.clip(out[..., 0] * 1.06, 0, 1)
    out[..., 2] = np.clip(out[..., 2] * 0.94, 0, 1)
    out = contrast(out, 1.10, pivot=0.45)
    return np.clip(out, 0, 1)


# ---------- registry: id -> function ----------

PRESET_FUNCS: dict[str, Callable[[np.ndarray], np.ndarray]] = {
    "vintage-film": vintage_film,
    "vhs-90s": vhs_90s,
    "teal-orange": teal_orange,
    "sun-bleached": sun_bleached,
    "bleach-bypass": bleach_bypass,
    "sepia": sepia,
    "cyberpunk": cyberpunk,
    "noir": noir,
    "warm-summer": warm_summer,
    "cold-winter": cold_winter,
    "anamorphic": anamorphic,
    "kodachrome": kodachrome,
}


def make_identity_grid(n: int) -> np.ndarray:
    """Return an (n, n, n, 3) grid of RGB samples with r varying fastest, then g, then b."""
    axis = np.linspace(0.0, 1.0, n, dtype=np.float32)
    grid = np.empty((n, n, n, 3), dtype=np.float32)
    for b_i in range(n):
        for g_i in range(n):
            grid[b_i, g_i, :, 0] = axis  # r varies fastest
            grid[b_i, g_i, :, 1] = axis[g_i]
            grid[b_i, g_i, :, 2] = axis[b_i]
    return grid


def write_cube(path: Path, lut: np.ndarray, title: str) -> None:
    n = lut.shape[0]
    with path.open("w") as f:
        f.write(f"TITLE \"{title}\"\n")
        f.write(f"LUT_3D_SIZE {n}\n")
        f.write("DOMAIN_MIN 0.0 0.0 0.0\n")
        f.write("DOMAIN_MAX 1.0 1.0 1.0\n")
        for b_i in range(n):
            for g_i in range(n):
                for r_i in range(n):
                    r, g, b = lut[b_i, g_i, r_i]
                    f.write(f"{r:.6f} {g:.6f} {b:.6f}\n")


@dataclass
class BuildResult:
    preset_id: str
    path: Path
    bytes_written: int


def build_all() -> list[BuildResult]:
    results: list[BuildResult] = []
    grid = make_identity_grid(LUT_SIZE)

    for preset in PRESETS:
        fn = PRESET_FUNCS.get(preset.id)
        if fn is None:
            print(f"[skip] no function for {preset.id}", file=sys.stderr)
            continue
        out = fn(grid.copy())
        path = preset.cube_path
        write_cube(path, out, title=preset.name)
        results.append(BuildResult(preset.id, path, path.stat().st_size))
        print(f"[ok]   {preset.id:<14} -> {path}  ({path.stat().st_size:,} bytes)")
    return results


if __name__ == "__main__":
    build_all()
