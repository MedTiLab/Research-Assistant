#!/usr/bin/env python3
"""Small authenticated client for the MedHelp GCO query-only API."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_BASE_URL = "https://api.medtimehelp.com"


def api_token() -> str:
    token = os.environ.get("MEDHELP_DATABASE_API_TOKEN") or os.environ.get("DATABASE_API_TOKEN") or ""
    if not token:
        raise SystemExit(
            "Missing GCO API token. Configure MEDHELP_DATABASE_API_TOKEN in the protected agent environment."
        )
    return token


def api_base() -> str:
    return (os.environ.get("MEDHELP_DATABASE_API_URL") or os.environ.get("DATABASE_API_URL") or DEFAULT_BASE_URL).rstrip("/")


def request_json(method: str, path: str, payload: dict | None = None, timeout: int = 120) -> dict:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        api_base() + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {api_token()}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise SystemExit(f"GCO API HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"GCO API unavailable: {exc.reason}") from exc


def parse_json_object(value: str, label: str) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid {label} JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise SystemExit(f"{label} must be a JSON object")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    metadata = subparsers.add_parser("metadata", help="List datasets or search code metadata.")
    metadata.add_argument("--kind", default="catalog")
    metadata.add_argument("--query", default="")
    metadata.add_argument("--limit", type=int, default=500)

    query = subparsers.add_parser("query", help="Run one guarded GCO query.")
    query.add_argument("--dataset", required=True)
    query.add_argument("--columns", default="")
    query.add_argument("--filters", default="{}", help="JSON object with column filters.")
    query.add_argument("--order-by", default="", help="Comma-separated field:asc|desc entries.")
    query.add_argument("--limit", type=int, default=500)
    query.add_argument("--offset", type=int, default=0)

    args = parser.parse_args()
    if args.command == "metadata":
        query_string = urllib.parse.urlencode({
            "kind": args.kind,
            "q": args.query,
            "limit": args.limit,
        })
        result = request_json("GET", f"/api/v1/gco/metadata?{query_string}")
    else:
        body = {
            "dataset": args.dataset,
            "filters": parse_json_object(args.filters, "filters"),
            "limit": args.limit,
            "offset": args.offset,
        }
        columns = [value.strip() for value in args.columns.split(",") if value.strip()]
        order_by = [value.strip() for value in args.order_by.split(",") if value.strip()]
        if columns:
            body["columns"] = columns
        if order_by:
            body["orderBy"] = order_by
        result = request_json("POST", "/api/v1/gco/query", body)
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
