"""
Keep public/clotex-logo.png in sync with the master logo at repo root (logo.png).

Used before Electron packaging so favicon / installer assets match the app brand.
Run from repo root: python scripts/extract-clotex-logo.py
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    master = root / "logo.png"
    out = root / "public" / "clotex-logo.png"

    if not master.is_file():
        print(f"Missing master logo: {master}", file=sys.stderr)
        raise SystemExit(2)

    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(master, out)
    print(f"Synced {master.relative_to(root)} -> {out.relative_to(root)}")


if __name__ == "__main__":
    main()
