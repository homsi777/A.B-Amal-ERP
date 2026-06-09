"""
Extract the first page of `clotex logo.pdf` as a square PNG for web + Windows packaging.

Uses only page 0 (first design). Run from repo root: python scripts/extract-clotex-logo.py
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
    from PIL import Image
except ImportError as e:
    print("Need PyMuPDF and Pillow: pip install pymupdf pillow", file=sys.stderr)
    raise SystemExit(1) from e


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    pdf = root / "clotex logo.pdf"
    out = root / "public" / "clotex-logo.png"
    if not pdf.is_file():
        print(f"Missing PDF: {pdf}", file=sys.stderr)
        raise SystemExit(2)

    out.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(str(pdf))
    try:
        page = doc.load_page(0)
        mat = fitz.Matrix(3.0, 3.0)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        w, h = img.size
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side)).resize(
            (512, 512), Image.Resampling.LANCZOS
        )
        img.save(out, "PNG")
    finally:
        doc.close()

    print(f"Wrote {out.relative_to(root)} (512x512, from first PDF page only)")


if __name__ == "__main__":
    main()
