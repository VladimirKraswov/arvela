#!/usr/bin/env python3
"""Read Archive search/item metadata; never bypass restrictions or download files."""
import argparse
import json
import sys
import urllib.parse
import urllib.request

BASE = "https://archive.org"


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("Metadata exceeds 4 MiB")
    return json.loads(raw)


def candidates(identifier, data):
    if not isinstance(data, dict) or not isinstance(data.get("metadata", {}), dict) or not isinstance(data.get("files", []), list):
        raise ValueError("Unexpected item metadata shape")
    metadata = data.get("metadata", {})
    restricted = str(metadata.get("access-restricted-item", "false")).lower() == "true" or bool(data.get("is_dark"))
    files = []
    for file in data.get("files", []):
        if not isinstance(file, dict):
            raise ValueError("Unexpected file metadata shape")
        name = file.get("name", "")
        if not isinstance(name, str) or not name.lower().endswith(".pdf"):
            continue
        private = str(file.get("private", "false")).lower() in ("true", "1")
        files.append({"name": name, "size": file.get("size"), "format": file.get("format"),
                      "private": private, "completeness": "unknown",
                      "url": None if restricted or private else BASE + "/download/" + urllib.parse.quote(identifier, safe="") + "/" + urllib.parse.quote(name, safe="")})
    return {"identifier": identifier, "title": metadata.get("title"), "year": metadata.get("year"),
            "restricted": restricted, "rights": metadata.get("rights"), "license": metadata.get("licenseurl"), "candidates": files}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--query")
    action.add_argument("--item")
    parser.add_argument("--rows", type=int, default=10, choices=range(1, 51), metavar="1..50")
    args = parser.parse_args()
    try:
        if args.item:
            result = candidates(args.item, fetch(BASE + "/metadata/" + urllib.parse.quote(args.item, safe="")))
        else:
            query = urllib.parse.urlencode({"q": args.query, "output": "json", "rows": args.rows,
                                           "fl[]": ["identifier", "title", "year", "access-restricted-item"]}, doseq=True)
            data = fetch(BASE + "/advancedsearch.php?" + query)
            result = data["response"]["docs"]
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
