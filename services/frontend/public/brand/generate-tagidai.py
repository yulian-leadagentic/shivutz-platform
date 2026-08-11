#!/usr/bin/env python3
"""
Build the TagidAI brand assets from the raw ChatGPT source in
docs/Logo/new logo/. Produces the 8 files the BrandLogo component
+ favicon/PWA metadata expects, all with proper alpha channels.

Source : docs/Logo/new logo/ChatGPT Image Jun 15, 2026, 09_30_48 AM.png
         (1254×1254, RGB, white bg, navy globe/workers + orange
         highlights + "TagidAI" wordmark)

Outputs (in this directory):
  tagidai_lockup.png         full lockup, transparent, on-light
  tagidai_lockup_white.png   full lockup, transparent, on-dark
                             (navy→white, orange kept)
  tagidai_icon.png           icon only (globe + workers), on-light
  tagidai_icon_white.png     icon only, on-dark
  favicon-16.png             icon @ 16×16
  favicon-32.png             icon @ 32×32
  favicon-48.png             icon @ 48×48
  apple-touch-icon.png       icon @ 180×180 on white square (iOS
                             rejects transparent apple-touch)
  icon-192.png               icon @ 192×192 (PWA)
  icon-512.png               icon @ 512×512 (PWA)

Why not hand-crop in Photoshop:
- Deterministic — same source PNG → identical outputs every run.
- The remap logic here mirrors generate-on-dark.py's approach
  for the BuildUp lockup, keeping the two brand generators
  aligned in behaviour (alpha ramp on the AA band, orange
  passthrough).
"""

from __future__ import annotations
from pathlib import Path
from PIL import Image

HERE = Path(__file__).parent
SRC = HERE.parent.parent.parent.parent / "docs" / "Logo" / "new logo" / "ChatGPT Image Jun 15, 2026, 09_30_48 AM.png"

# Region bounds found by scanning the source (see generator run
# log for the row-content analysis). Hard-coded because the source
# never changes — if a new source lands, re-run the scan and update.
CONTENT_TOP    = 134
CONTENT_BOTTOM = 1025
ICON_END       = 747  # last row of icon region; wordmark starts below

# Padding around cropped regions so nothing sits flush against the edge.
PAD_LOCKUP = 24
PAD_ICON   = 40


def is_orange(r: int, g: int, b: int) -> bool:
    """Brand orange (~#F77F02) has strong red, mid-low green, low blue."""
    return r > 180 and r > b + 60 and g < r - 20


def remap_light(px: tuple[int, int, int]) -> tuple[int, int, int, int]:
    """On-light variant: keep navy + orange, drop the white bg."""
    r, g, b = px
    bright = max(r, g, b)
    if is_orange(r, g, b):
        return (r, g, b, 255)
    if bright >= 245:
        return (255, 255, 255, 0)
    if bright > 200:
        # Anti-alias band between icon edge and pure bg — ramp alpha
        # so edges stay smooth instead of hard-stepped.
        alpha = int((245 - bright) / 45 * 255)
        return (r, g, b, alpha)
    return (r, g, b, 255)


def remap_dark(px: tuple[int, int, int]) -> tuple[int, int, int, int]:
    """On-dark variant: orange stays orange, navy → white."""
    r, g, b = px
    bright = max(r, g, b)
    if is_orange(r, g, b):
        return (r, g, b, 255)
    if bright >= 245:
        return (255, 255, 255, 0)
    if bright > 200:
        alpha = int((245 - bright) / 45 * 255)
        return (255, 255, 255, alpha)
    return (255, 255, 255, 255)


def convert(src: Image.Image, remap) -> Image.Image:
    """Apply per-pixel remap across the whole image."""
    W, H = src.size
    out = Image.new("RGBA", (W, H))
    sp = src.load()
    op = out.load()
    for y in range(H):
        for x in range(W):
            op[x, y] = remap(sp[x, y])
    return out


def crop_tight(im: Image.Image, top: int, bottom: int, pad: int) -> Image.Image:
    """Crop to [top, bottom] rows across full width, plus horizontal
    trim to the alpha bbox so we don't ship blank pixels on the sides."""
    W, H = im.size
    top    = max(0, top - pad)
    bottom = min(H, bottom + pad + 1)
    strip  = im.crop((0, top, W, bottom))
    # Trim horizontally to alpha bounding box.
    bbox = strip.getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        # Reapply pad horizontally without exceeding image bounds.
        x0 = max(0, x0 - pad)
        x1 = min(strip.width, x1 + pad)
        strip = strip.crop((x0, y0, x1, y1))
    return strip


def save_square(im: Image.Image, size: int, dst: Path, bg: tuple | None = None) -> None:
    """Fit `im` into a square canvas of `size`px, preserving aspect
    ratio; optional solid `bg` for apple-touch which iOS rejects
    with alpha."""
    W, H = im.size
    scale = size / max(W, H)
    new = im.resize((int(W * scale), int(H * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), bg + (255,) if bg else (0, 0, 0, 0))
    x = (size - new.width) // 2
    y = (size - new.height) // 2
    canvas.alpha_composite(new, (x, y))
    if bg is not None:
        canvas = canvas.convert("RGB")
    canvas.save(dst, optimize=True)
    print(f"  wrote {dst.name} ({dst.stat().st_size:,} bytes)")


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"source not found: {SRC}")
    src = Image.open(SRC).convert("RGB")
    print(f"source: {SRC.name} — {src.size}")

    # Pass 1: full-canvas remap for each tone.
    print("remapping to on-light variant …")
    on_light = convert(src, remap_light)
    print("remapping to on-dark variant …")
    on_dark  = convert(src, remap_dark)

    # Full lockups
    print("cropping lockups …")
    lock_light = crop_tight(on_light, CONTENT_TOP, CONTENT_BOTTOM, PAD_LOCKUP)
    lock_dark  = crop_tight(on_dark,  CONTENT_TOP, CONTENT_BOTTOM, PAD_LOCKUP)
    lock_light.save(HERE / "tagidai_lockup.png",       optimize=True)
    lock_dark.save (HERE / "tagidai_lockup_white.png", optimize=True)
    print(f"  wrote tagidai_lockup.png ({(HERE/'tagidai_lockup.png').stat().st_size:,} bytes)")
    print(f"  wrote tagidai_lockup_white.png ({(HERE/'tagidai_lockup_white.png').stat().st_size:,} bytes)")

    # Icons (crop the icon region only, above the wordmark)
    print("cropping icons …")
    icon_light = crop_tight(on_light, CONTENT_TOP, ICON_END, PAD_ICON)
    icon_dark  = crop_tight(on_dark,  CONTENT_TOP, ICON_END, PAD_ICON)
    icon_light.save(HERE / "tagidai_icon.png",       optimize=True)
    icon_dark.save (HERE / "tagidai_icon_white.png", optimize=True)
    print(f"  wrote tagidai_icon.png ({(HERE/'tagidai_icon.png').stat().st_size:,} bytes)")
    print(f"  wrote tagidai_icon_white.png ({(HERE/'tagidai_icon_white.png').stat().st_size:,} bytes)")

    # Favicons + PWA — all derived from the on-light icon so the
    # tab icon reads on both the light and dark browser chrome
    # (navy on transparent works on both; white on transparent
    # would disappear on light browser bars).
    print("generating favicons + PWA icons …")
    save_square(icon_light, 16,  HERE / "favicon-16.png")
    save_square(icon_light, 32,  HERE / "favicon-32.png")
    save_square(icon_light, 48,  HERE / "favicon-48.png")
    save_square(icon_light, 192, HERE / "icon-192.png")
    save_square(icon_light, 512, HERE / "icon-512.png")
    # Apple touch icon must NOT be transparent — iOS composites it
    # over its own bg and produces a jagged look otherwise. White
    # square keeps the icon visible on any home-screen wallpaper.
    save_square(icon_light, 180, HERE / "apple-touch-icon.png", bg=(255, 255, 255))
    print("done.")


if __name__ == "__main__":
    main()
