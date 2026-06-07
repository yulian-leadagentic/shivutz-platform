#!/usr/bin/env python3
"""
Build a clean transparent on-dark BuildUp lockup from the colored
on-light source.

Input : buildup-logo.png         (white bg, navy + orange lockup)
Output: buildup-logo-light.png   (transparent bg, white + orange)

Why: the original buildup-logo-light.png shipped with a Photoshop
transparency-grid pattern baked into its RGB pixels (no alpha
channel) — so on dark surfaces it showed a white-ish chip behind
the logo. This script regenerates a proper RGBA version from the
clean colored source.
"""

from pathlib import Path
from PIL import Image

SRC = Path(__file__).with_name("buildup-logo.png")
DST = Path(__file__).with_name("buildup-logo-light.png")


def is_orange(r: int, g: int, b: int) -> bool:
    """True if the pixel reads as the brand orange (~#F77F02)."""
    return r > 180 and r > b + 60 and g < r - 20


def remap(px: tuple[int, int, int]) -> tuple[int, int, int, int]:
    r, g, b = px
    bright = max(r, g, b)

    # Orange stays orange, full opacity.
    if is_orange(r, g, b):
        return (r, g, b, 255)

    # Pure / near-pure white = background → transparent.
    if bright >= 245:
        return (255, 255, 255, 0)

    # Soft anti-alias band: ramp alpha smoothly between solid
    # white-text (≤200 brightness) and pure background (≥245).
    if bright > 200:
        alpha = int((245 - bright) / 45 * 255)
        return (255, 255, 255, alpha)

    # Dark text / icon outline → solid white at full opacity.
    return (255, 255, 255, 255)


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    out = Image.new("RGBA", src.size)
    src_px = src.load()
    out_px = out.load()
    for y in range(src.height):
        for x in range(src.width):
            out_px[x, y] = remap(src_px[x, y])
    out.save(DST, optimize=True)
    print(f"wrote {DST} ({DST.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
