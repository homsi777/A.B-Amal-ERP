"""
Generate logo-thermal.png: solid black logo on transparent background for thermal labels.

Source: logo.png (repo root) — white background is removed; artwork becomes #000.
Run from repo root: python scripts/generate-thermal-logo.py
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Install Pillow: pip install pillow", file=sys.stderr)
    raise SystemExit(2)


def build_thermal_logo(master: Path, out: Path) -> None:
    im = Image.open(master).convert("RGBA")
    w, h = im.size
    src = im.load()
    out_im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dst = out_im.load()

    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a < 20:
                continue
            if r > 235 and g > 235 and b > 235:
                continue
            dst[x, y] = (0, 0, 0, 255)

    bbox = out_im.getbbox()
    if bbox:
        out_im = out_im.crop(bbox)

    out.parent.mkdir(parents=True, exist_ok=True)
    out_im.save(out, optimize=True)

    public_copy = out.parent / "public" / "logo-thermal.png"
    public_copy.parent.mkdir(parents=True, exist_ok=True)
    out_im.save(public_copy, optimize=True)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    master = root / "logo.png"
    out = root / "logo-thermal.png"

    if not master.is_file():
        print(f"Missing master logo: {master}", file=sys.stderr)
        raise SystemExit(2)

    build_thermal_logo(master, out)
    print(f"Generated {out.relative_to(root)} ({Image.open(out).size[0]}x{Image.open(out).size[1]})")


if __name__ == "__main__":
    main()
