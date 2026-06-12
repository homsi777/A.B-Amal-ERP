#!/usr/bin/env python3
"""
استخراج النصوص العربية من مشروع CLOTEX وإنشاء مسودة ترجمة تركية.

تشغيل من جذر المشروع (بعد تفعيل venv):
  python scripts/extract_ar_for_tr.py
  python scripts/extract_ar_for_tr.py --translate
  python scripts/extract_ar_for_tr.py --translate --output scripts/output/tr-draft.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ARABIC_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+")
STRING_LITERAL_RE = re.compile(
    r"""(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`)"""
)
SCAN_EXTENSIONS = {".tsx", ".ts", ".jsx", ".js"}
SKIP_DIRS = {
    "node_modules",
    "dist",
    "build",
    ".git",
    ".venv-i18n",
    "venv",
    "__pycache__",
}


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def flatten_json(obj: object, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    if isinstance(obj, dict):
        for key, value in obj.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            out.update(flatten_json(value, path))
    elif isinstance(obj, str):
        if prefix and ARABIC_RE.search(obj):
            out[prefix] = obj.strip()
    return out


def load_locale_ar_strings(root: Path) -> dict[str, dict[str, str]]:
    locale_dir = root / "src" / "locales" / "ar"
    entries: dict[str, dict[str, str]] = {}
    if not locale_dir.is_dir():
        return entries
    for path in sorted(locale_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print(f"تخطي ملف JSON تالف: {path} ({exc})", file=sys.stderr)
            continue
        for key, text in flatten_json(data).items():
            full_key = f"{path.stem}.{key}"
            entries[full_key] = {
                "ar": text,
                "source": str(path.relative_to(root)).replace("\\", "/"),
                "kind": "locale",
            }
    return entries


def extract_from_source_file(path: Path, root: Path) -> dict[str, dict[str, str]]:
    entries: dict[str, dict[str, str]] = {}
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return entries

    rel = str(path.relative_to(root)).replace("\\", "/")
    seen: set[str] = set()
    for match in STRING_LITERAL_RE.finditer(content):
        raw = next((g for g in match.groups() if g is not None), "")
        if not raw or not ARABIC_RE.search(raw):
            continue
        text = raw.strip()
        if len(text) < 2 or text in seen:
            continue
        seen.add(text)
        key = f"code::{rel}::{text[:48]}"
        entries[key] = {
            "ar": text,
            "source": rel,
            "kind": "source",
        }
    return entries


def scan_source_tree(root: Path) -> dict[str, dict[str, str]]:
    src = root / "src"
    entries: dict[str, dict[str, str]] = {}
    if not src.is_dir():
        return entries
    for path in src.rglob("*"):
        if not path.is_file() or path.suffix not in SCAN_EXTENSIONS:
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if "locales" in path.parts:
            continue
        entries.update(extract_from_source_file(path, root))
    return entries


def merge_entries(*maps: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    merged: dict[str, dict[str, str]] = {}
    for data in maps:
        for key, value in data.items():
            if key not in merged:
                merged[key] = value
    return merged


def translate_batch(texts: list[str], batch_size: int = 40) -> list[str]:
    try:
        from deep_translator import GoogleTranslator
    except ImportError as exc:
        raise SystemExit(
            "المكتبة deep-translator غير مثبتة. شغّل:\n"
            "  source .venv-i18n/bin/activate\n"
            "  pip install -r scripts/requirements-i18n.txt"
        ) from exc

    translator = GoogleTranslator(source="ar", target="tr")
    translated: list[str] = []
    for i in range(0, len(texts), batch_size):
        chunk = texts[i : i + batch_size]
        try:
            translated.extend(translator.translate_batch(chunk))
        except Exception:
            for text in chunk:
                try:
                    translated.append(translator.translate(text))
                except Exception as err:
                    print(f"فشل ترجمة: {text[:60]!r} ({err})", file=sys.stderr)
                    translated.append("")
    return translated


def main() -> None:
    parser = argparse.ArgumentParser(description="استخراج العربية وإنشاء مسودة تركية")
    parser.add_argument(
        "--translate",
        action="store_true",
        help="ترجمة تلقائية عبر Google (deep-translator)",
    )
    parser.add_argument(
        "--output",
        default="scripts/output/tr-draft.json",
        help="مسار ملف JSON الناتج",
    )
    parser.add_argument(
        "--skip-source-scan",
        action="store_true",
        help="اقرأ فقط src/locales/ar بدون مسح ملفات TSX",
    )
    args = parser.parse_args()

    root = repo_root()
    locale_entries = load_locale_ar_strings(root)
    source_entries = {} if args.skip_source_scan else scan_source_tree(root)
    merged = merge_entries(locale_entries, source_entries)

    unique_ar: list[str] = []
    ar_index: dict[str, int] = {}
    for item in merged.values():
        ar = item["ar"]
        if ar not in ar_index:
            ar_index[ar] = len(unique_ar)
            unique_ar.append(ar)

    tr_by_ar: dict[str, str] = {}
    if args.translate and unique_ar:
        print(f"جاري ترجمة {len(unique_ar)} نص عربي فريد...")
        translated = translate_batch(unique_ar)
        tr_by_ar = dict(zip(unique_ar, translated, strict=False))

    output_rows: dict[str, dict[str, str]] = {}
    for key, item in sorted(merged.items()):
        ar = item["ar"]
        row = {
            "ar": ar,
            "tr": tr_by_ar.get(ar, ""),
            "source": item["source"],
            "kind": item["kind"],
            "status": "auto" if tr_by_ar.get(ar) else "pending",
        }
        output_rows[key] = row

    out_path = (root / args.output).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(output_rows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"تم: {len(output_rows)} مفتاح")
    print(f"نصوص عربية فريدة: {len(unique_ar)}")
    print(f"الملف: {out_path}")
    if not args.translate:
        print("للترجمة التلقائية أعد التشغيل مع: --translate")


if __name__ == "__main__":
    main()
