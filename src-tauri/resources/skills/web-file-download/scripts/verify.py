#!/usr/bin/env python3
"""Inspect existing PDFs; no downloads, package installation or completeness claims."""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


def inspect(path):
    result = {"file": str(path), "status": "invalid", "complete": "unknown"}
    try:
        if not path.is_file():
            raise ValueError("Not a regular file")
        with path.open("rb") as stream:
            if stream.read(5) != b"%PDF-":
                raise ValueError("Missing PDF signature")
            stream.seek(0)
            digest = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
            result["sha256"] = digest.hexdigest()
        result["bytes"] = path.stat().st_size
        try:
            from pypdf import PdfReader
        except ImportError:
            PdfReader = None
        if PdfReader:
            reader = PdfReader(path, strict=True)
            if reader.is_encrypted:
                raise ValueError("Encrypted PDF: structural/content verification unavailable")
            result["pages"] = len(reader.pages)
            result["sample"] = "\n".join((page.extract_text() or "")[:1200] for page in reader.pages[:2])
            result["parser"] = "pypdf"
        elif shutil.which("pdfinfo"):
            info = subprocess.run(["pdfinfo", str(path.resolve())], capture_output=True, text=True, timeout=30)
            if info.returncode:
                raise ValueError("pdfinfo rejected PDF")
            fields = dict(line.split(":", 1) for line in info.stdout.splitlines() if ":" in line)
            result["pages"] = int(fields.get("Pages", "0").strip())
            if fields.get("Encrypted", "").strip().startswith("yes"):
                raise ValueError("Encrypted PDF: content verification unavailable")
            result["parser"] = "pdfinfo"
        else:
            result.update(status="unverified", error="Install/choose a PDF parser explicitly; header/hash alone are insufficient")
            return result
        if result["pages"] < 1:
            raise ValueError("No pages")
        result["status"] = "structure-checked"
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        result["error"] = str(exc)
    except Exception as exc:
        result["error"] = "PDF parser failed: " + type(exc).__name__
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path)
    args = parser.parse_args()
    results = [inspect(path) for path in args.files]
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0 if all(item["status"] == "structure-checked" for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
