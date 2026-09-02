#!/usr/bin/env python3
"""Small stdlib client for the remote MedHelp database API."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.parse import urlencode
from urllib.request import ProxyHandler, Request, build_opener, urlopen


DEFAULT_PUBLIC_BASE_URL = "https://api.medtimehelp.com"
DEFAULT_LOCAL_FALLBACK_BASE_URL = "http://127.0.0.1:8787"
DEFAULT_BASE_URL = DEFAULT_PUBLIC_BASE_URL
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SOCKET = "/opt/medtimehelp/.runtime/database-api.sock"
DEFAULT_DEPLOY_DIRS = (
    Path("/opt/medtimehelp/database"),
    REPO_ROOT / "database",
)
PERMISSION_GROUPS = [
    {
        "id": "icu",
        "label": "ICU / EHR",
        "sources": ["mimiciii", "mimiciv", "mimiciv31", "nwicu", "eicu", "sicdb", "pic"],
    },
    {
        "id": "aging",
        "label": "Aging cohorts",
        "sources": ["charls", "clhls", "elsa", "hrs", "klosa", "lasi", "mhas", "share"],
    },
    {"id": "class", "label": "CLASS aging survey", "sources": ["class"]},
    {"id": "perioperative", "label": "Perioperative medicine", "sources": ["inspire"]},
    {"id": "nhanes", "label": "NHANES", "sources": ["nhanes"]},
    {"id": "gshs", "label": "GSHS school health survey", "sources": ["gshs"]},
    {"id": "ukb", "label": "UK Biobank", "sources": ["ukb"]},
    {
        "id": "family_finance",
        "label": "Family, finance, society, nutrition",
        "sources": ["cfps", "cgss", "css", "chfs", "chip", "clds", "chns"],
    },
    {"id": "gco", "label": "GCO cancer database", "sources": ["gco"]},
    {"id": "seer", "label": "SEER cancer registry", "sources": ["seer"]},
]
ALL_PERMISSION_SOURCE_IDS = sorted({source for group in PERMISSION_GROUPS for source in group["sources"]})
QUERY_ONLY_SOURCE_IDS = {"gco"}


def _probe(base: str, timeout: float = 1.5) -> bool:
    """Return True if base/api/v1/health answers (used to auto-detect the port)."""
    try:
        opener = build_opener(ProxyHandler({}))
        with opener.open(base.rstrip("/") + "/api/v1/health", timeout=timeout) as response:
            return 200 <= getattr(response, "status", 200) < 300
    except Exception:
        return False


def env_base_url() -> str:
    explicit = os.environ.get("MEDHELP_DATABASE_API_URL") or os.environ.get("DATABASE_API_URL")
    if explicit:
        return explicit.rstrip("/")
    # Public API is the default for distributed/remote users. Only fall back to
    # the loopback deployment when the public health endpoint is unavailable
    # and a healthy local service is actually running.
    if _probe(DEFAULT_PUBLIC_BASE_URL):
        return DEFAULT_PUBLIC_BASE_URL
    if _probe(DEFAULT_LOCAL_FALLBACK_BASE_URL):
        return DEFAULT_LOCAL_FALLBACK_BASE_URL
    return DEFAULT_PUBLIC_BASE_URL


def env_token() -> str:
    return os.environ.get("MEDHELP_DATABASE_API_TOKEN") or os.environ.get("DATABASE_API_TOKEN") or ""


def is_loopback_base(base_url: str) -> bool:
    host = (urlparse(base_url).hostname or "").lower()
    return host in {"127.0.0.1", "localhost", "::1"}


def resolve_token(args: argparse.Namespace, base_url: str) -> str:
    token = args.token or env_token()
    if os.environ.get("MEDHELP_MANAGED_AGENT_SESSION") == "1":
        connection_status = os.environ.get("MEDHELP_DATABASE_API_CONNECTION_STATUS", "").strip()
        if connection_status != "connected":
            raise SystemExit(
                "Managed MedHelp Database Connector is not connected "
                f"(status={connection_status or 'missing'}). The backend Connector, not the AI, "
                "must verify it in Settings > Connectors > Database API. Do not paste the PAT "
                "into chat or search local files/logs for it."
            )
        if token:
            return token
        raise SystemExit(
            "Managed MedHelp Database Connector says connected, but this Agent did not receive "
            "the verified credential. This is an injection inconsistency; retry the session. "
            "Do not paste the PAT into chat or search local files/logs for it."
        )
    if token or is_loopback_base(base_url):
        return token
    if sys.stdin.isatty():
        token = getpass.getpass("MedHelp data API token: ").strip()
        if token:
            return token
    raise SystemExit(
        "Missing MedHelp data API token. Configure MEDHELP_DATABASE_API_TOKEN "
        "in the process environment or a protected secret store, then retry."
    )


def headers(args: argparse.Namespace, base_url: str, content_type: str | None = None) -> dict[str, str]:
    result: dict[str, str] = {}
    token = resolve_token(args, base_url)
    if token:
        result["Authorization"] = f"Bearer {token}"
    if args.device_id:
        result["X-Device-ID"] = args.device_id
    if content_type:
        result["Content-Type"] = content_type
    return result


def request_transport(args: argparse.Namespace, url: str) -> str:
    """Select a transport without replaying a request after a TLS failure."""
    if args.transport not in {"auto", "urllib", "curl"}:
        raise SystemExit(
            "Invalid MEDHELP_DATABASE_API_TRANSPORT. Use auto, urllib, or curl."
        )
    if args.transport != "auto":
        return args.transport
    if sys.platform.startswith("win") and urlparse(url).scheme.lower() == "https":
        return "curl"
    return "urllib"


def request_proxy_mode(args: argparse.Namespace) -> str:
    """Keep MedHelp API traffic direct unless the operator explicitly opts in."""
    if args.proxy_mode not in {"direct", "system"}:
        raise SystemExit(
            "Invalid MEDHELP_DATABASE_API_PROXY_MODE. Use direct or system."
        )
    return args.proxy_mode


def curl_request(
    args: argparse.Namespace,
    method: str,
    url: str,
    request_headers: dict[str, str],
    payload: bytes | None,
) -> bytes:
    """Use curl directly; Windows Schannel skips only certificate revocation checks."""
    executable = shutil.which("curl.exe") or shutil.which("curl")
    if not executable:
        raise RuntimeError(
            "curl transport requested but curl was not found. Install curl, or use "
            "--transport urllib to require the Python TLS stack."
        )

    command = [
        executable,
        "--silent",
        "--show-error",
        "--fail",
        "--location",
        "--request",
        method,
        "--connect-timeout",
        str(args.timeout),
        "--max-time",
        str(args.timeout),
    ]
    if request_proxy_mode(args) == "direct":
        command.extend(["--noproxy", "*"])
    if sys.platform.startswith("win") and urlparse(url).scheme.lower() == "https":
        # This keeps certificate-chain and hostname verification enabled. It is
        # intentionally narrower than --insecure and fixes Schannel error
        # CRYPT_E_REVOCATION_OFFLINE on restricted Windows networks.
        command.append("--ssl-no-revoke")
    for name, value in request_headers.items():
        command.extend(["--header", f"{name}: {value}"])
    if payload is not None:
        command.extend(["--data-binary", "@-"])
    command.extend(["--url", url])

    completed = subprocess.run(
        command,
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode:
        message = completed.stderr.decode("utf-8", errors="replace").strip()
        for name, value in request_headers.items():
            if name.lower() == "authorization" and value:
                message = message.replace(value, "<redacted>")
        raise RuntimeError(
            f"curl transport failed with exit code {completed.returncode}: "
            f"{message or 'no error detail'}"
        )
    return completed.stdout


def request(
    args: argparse.Namespace,
    method: str,
    path: str,
    *,
    query: dict[str, object] | None = None,
    body: dict[str, object] | None = None,
) -> bytes:
    base_url = (args.base_url or env_base_url()).rstrip("/")
    url = base_url + path
    if query:
        url += "?" + urlencode({k: v for k, v in query.items() if v is not None and v != ""})
    payload = None
    content_type = None
    if body is not None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        content_type = "application/json"
    request_headers = headers(args, base_url, content_type)
    if request_transport(args, url) == "curl":
        return curl_request(args, method, url, request_headers, payload)
    req = Request(url, data=payload, method=method, headers=request_headers)
    if request_proxy_mode(args) == "direct":
        opener = build_opener(ProxyHandler({}))
        with opener.open(req, timeout=args.timeout) as response:
            return response.read()
    with urlopen(req, timeout=args.timeout) as response:
        return response.read()


def print_json(data: bytes) -> None:
    try:
        payload = json.loads(data.decode("utf-8"))
    except Exception:
        sys.stdout.buffer.write(data)
        return
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def parse_json(data: bytes) -> object:
    return json.loads(data.decode("utf-8"))


def write_or_print(data: bytes, output: str | None) -> None:
    if output:
        Path(output).expanduser().resolve().write_bytes(data)
        print(output)
    else:
        sys.stdout.buffer.write(data)


def download_to_file(args: argparse.Namespace, path: str, output: str, *, resume: bool = True) -> Path:
    """Stream a dataset to disk; resume a partial file with HTTP Range."""
    target = Path(output).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    base_url = (args.base_url or env_base_url()).rstrip("/")
    if path.startswith(("http://", "https://")):
        base_parts = urlparse(base_url)
        url_parts = urlparse(path)
        if (base_parts.scheme, base_parts.hostname, base_parts.port) != (url_parts.scheme, url_parts.hostname, url_parts.port):
            raise RuntimeError("Refusing to send the Bearer token to a cross-origin download URL")
        url = path
    else:
        url = base_url + path
    request_headers = headers(args, base_url)
    existing_size = target.stat().st_size if resume and target.exists() else 0

    if request_transport(args, url) == "curl":
        executable = shutil.which("curl.exe") or shutil.which("curl")
        if not executable:
            raise RuntimeError("curl transport requested but curl was not found")
        command = [
            executable,
            "--silent",
            "--show-error",
            "--fail",
            "--location",
            "--connect-timeout",
            str(args.timeout),
            "--output",
            str(target),
        ]
        if resume and existing_size:
            command.extend(["--continue-at", "-"])
        if request_proxy_mode(args) == "direct":
            command.extend(["--noproxy", "*"])
        if sys.platform.startswith("win") and urlparse(url).scheme.lower() == "https":
            command.append("--ssl-no-revoke")
        for name, value in request_headers.items():
            command.extend(["--header", f"{name}: {value}"])
        command.extend(["--url", url])
        completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if completed.returncode:
            message = completed.stderr.decode("utf-8", errors="replace").strip()
            for name, value in request_headers.items():
                if name.lower() == "authorization" and value:
                    message = message.replace(value, "<redacted>")
            raise RuntimeError(f"dataset download failed with exit code {completed.returncode}: {message}")
        return target

    if existing_size:
        request_headers["Range"] = f"bytes={existing_size}-"
    req = Request(url, method="GET", headers=request_headers)
    opener = build_opener(ProxyHandler({})) if request_proxy_mode(args) == "direct" else build_opener()
    with opener.open(req, timeout=args.timeout) as response:
        append = existing_size > 0 and getattr(response, "status", 200) == 206
        with target.open("ab" if append else "wb") as handle:
            shutil.copyfileobj(response, handle, length=1024 * 1024)
    return target


def split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def selection_columns(args: argparse.Namespace, *, allow_objects: bool = False) -> list:
    """Preserve literal names and file context; CSV input is legacy shorthand."""
    if args.selection_file:
        try:
            selected = json.loads(Path(args.selection_file).read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as exc:
            raise SystemExit("Cannot read --selection-file as a UTF-8 JSON array") from exc
    elif args.literal_columns is not None:
        selected = args.literal_columns
    else:
        legacy = getattr(args, "selected", getattr(args, "columns", ""))
        if not legacy:
            return []
        selected = split_csv(legacy)
    if not isinstance(selected, list) or not selected:
        raise SystemExit("Selection must be a nonempty JSON array")
    for item in selected:
        if isinstance(item, str) and item.strip():
            continue
        if (allow_objects and isinstance(item, dict) and set(item) == {"file", "column"}
                and all(isinstance(v, str) and v.strip() for v in item.values())):
            continue
        shape = 'strings or {"file": "...", "column": "..."} objects' if allow_objects else 'strings'
        raise SystemExit("Selection entries must be nonempty " + shape)
    return selected


def add_selection_args(parser: argparse.ArgumentParser, *, legacy: str = "--selected", required: bool = False) -> None:
    group = parser.add_mutually_exclusive_group(required=required)
    group.add_argument(legacy, default="", help="Legacy comma-separated codes; use --column or --selection-file for literal names.")
    group.add_argument("--column", dest="literal_columns", action="append", help="One exact column name; repeat for multiple columns. Never split on punctuation.")
    group.add_argument("--selection-file", default="", help="UTF-8 JSON array of exact names; build/export also accept {file,column} objects.")


def duckdb_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def source_ids_from_payload(payload: object) -> list[str]:
    if isinstance(payload, dict):
        raw_sources = payload.get("sources")
    else:
        raw_sources = payload
    result: list[str] = []
    if not isinstance(raw_sources, list):
        return result
    for item in raw_sources:
        value = ""
        if isinstance(item, dict):
            value = str(item.get("id") or item.get("source") or item.get("name") or "")
        else:
            value = str(item or "")
        value = value.strip().lower()
        if value and value not in result:
            result.append(value)
    return sorted(result)


def permission_group_status(accessible_sources: list[str]) -> list[dict[str, object]]:
    allowed = set(accessible_sources)
    groups: list[dict[str, object]] = []
    for group in PERMISSION_GROUPS:
        sources = list(group["sources"])
        allowed_sources = [source for source in sources if source in allowed]
        denied_sources = [source for source in sources if source not in allowed]
        if len(allowed_sources) == len(sources):
            status = "full"
        elif allowed_sources:
            status = "partial"
        else:
            status = "none"
        query_only = bool(sources) and all(source in QUERY_ONLY_SOURCE_IDS for source in sources)
        groups.append({
            "id": group["id"],
            "label": group["label"],
            "status": status,
            "downloadable": bool(allowed_sources) and not query_only,
            "queryOnly": query_only,
            "allowedSources": allowed_sources,
            "deniedSources": denied_sources,
            "rule": "query only; dataset extraction and download are disabled" if query_only else (
                "download all group sources" if status == "full" else (
                    "download only allowedSources" if status == "partial" else "download none from this group"
                )
            ),
        })
    return groups


def permission_summary(accessible_sources: list[str], groups: list[dict[str, object]]) -> dict[str, object]:
    allowed = set(accessible_sources)
    denied_source_count = len(set(ALL_PERMISSION_SOURCE_IDS) - allowed)
    full_groups = [str(group["id"]) for group in groups if group.get("status") == "full"]
    partial_groups = [str(group["id"]) for group in groups if group.get("status") == "partial"]
    denied_groups = [str(group["id"]) for group in groups if group.get("status") == "none"]
    return {
        "allowedSourceCount": len(accessible_sources),
        "deniedSourceCount": denied_source_count,
        "fullGroups": full_groups,
        "partialGroups": partial_groups,
        "deniedGroups": denied_groups,
        "startupInstruction": (
            "Use accessibleSources as the query allow-list and downloadAllowed as the "
            "extract/export/download allow-list; queryOnlyAllowed can only be queried. "
            "Never download sources listed in downloadDenied."
        ),
    }


def requested_source_status(requested: list[str], accessible_sources: list[str]) -> dict[str, object]:
    allowed = set(accessible_sources)
    normalized = []
    for source in requested:
        value = source.strip().lower()
        if value and value not in normalized:
            normalized.append(value)
    return {
        "requestedSources": normalized,
        "allowedRequestedSources": [source for source in normalized if source in allowed],
        "deniedRequestedSources": [source for source in normalized if source not in allowed],
    }


def cmd_health(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", "/health"))


def cmd_sources(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", "/sources"))


def cmd_api_health(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", "/api/v1/health"))


def cmd_api_sources(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", "/api/v1/sources"))


def cmd_api_permissions(args: argparse.Namespace) -> None:
    payload = parse_json(request(args, "GET", "/api/v1/sources"))
    accessible = source_ids_from_payload(payload)
    allowed = set(accessible)
    access_denied = [source for source in ALL_PERMISSION_SOURCE_IDS if source not in allowed]
    download_allowed = [source for source in accessible if source not in QUERY_ONLY_SOURCE_IDS]
    download_allowed_set = set(download_allowed)
    download_denied = [source for source in ALL_PERMISSION_SOURCE_IDS if source not in download_allowed_set]
    query_only_allowed = [source for source in accessible if source in QUERY_ONLY_SOURCE_IDS]
    base_url = (args.base_url or env_base_url()).rstrip("/")
    groups = permission_group_status(accessible)
    result: dict[str, object] = {
        "ok": True,
        "baseUrl": base_url,
        "permissionSource": "/api/v1/sources",
        "rule": (
            "Only accessibleSources can be queried. Only downloadAllowed can be extracted, "
            "exported, or downloaded; queryOnlyAllowed is read-only."
        ),
        "permissionSummary": permission_summary(accessible, groups),
        "accessibleSources": accessible,
        "accessDenied": access_denied,
        "downloadAllowed": download_allowed,
        "downloadDenied": download_denied,
        "queryOnlyAllowed": query_only_allowed,
        "permissionGroups": groups,
    }
    requested = split_csv(args.check_sources) if args.check_sources else []
    if requested:
        result["requestedSourceStatus"] = requested_source_status(requested, accessible)
    if args.include_auth_status:
        try:
            result["authStatus"] = parse_json(request(args, "GET", "/api/auth/status"))
        except Exception as exc:
            result["authStatusUnavailable"] = str(exc)
    print(json.dumps(result, ensure_ascii=False, indent=2))


def cmd_api_query(args: argparse.Namespace) -> None:
    body = {
        "query": args.query,
        "source": args.source,
        "sources": split_csv(args.sources) if args.sources else None,
        "limit": args.limit,
        "perSourceLimit": args.per_source_limit,
        "kind": args.kind,
        "match": args.match,
    }
    print_json(request(args, "POST", "/api/v1/variables/query", body={k: v for k, v in body.items() if v not in (None, "", [])}))


def cmd_api_coding(args: argparse.Namespace) -> None:
    print_json(request(args, "POST", "/api/v1/coding/query", body={
        "source": args.source,
        "variable": args.variable,
        "limit": args.limit,
        "maxDocuments": args.max_documents,
    }))


def cmd_api_coding_doc(args: argparse.Namespace) -> None:
    print_json(request(
        args,
        "GET",
        f"/api/v1/coding/docs/{quote(args.doc_id)}",
        query={"source": args.source, "offset": args.offset, "max_chars": args.max_chars},
    ))


def cmd_api_build(args: argparse.Namespace) -> None:
    body = {
        "source": args.source,
        "sources": split_csv(args.sources) if args.sources else None,
        "selected": selection_columns(args, allow_objects=True),
        "file": args.file,
        "join_on": args.join_on,
        "query": args.query,
        "variablesPerSource": args.variables_per_source,
        "projectName": args.project_name,
        "rowCap": args.row_cap,
    }
    print_json(request(args, "POST", "/api/v1/extract", body={k: v for k, v in body.items() if v not in (None, "", [])}))


def export_job_id(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    job = payload.get("job")
    if not isinstance(job, dict):
        return ""
    return str(job.get("id") or job.get("packageId") or "").strip()


def wait_for_export(args: argparse.Namespace, job_id: str) -> dict[str, object]:
    deadline = time.time() + args.wait_timeout
    while True:
        payload = parse_json(request(args, "GET", f"/api/v1/export/{quote(job_id)}"))
        if not isinstance(payload, dict) or not isinstance(payload.get("job"), dict):
            raise RuntimeError("Export status returned an invalid response")
        job = payload["job"]
        status = str(job.get("status") or "").lower()
        if status == "complete":
            return payload
        if status == "failed":
            raise RuntimeError(f"Export failed: {job.get('error') or 'unknown error'}")
        if time.time() >= deadline:
            raise TimeoutError(f"Export {job_id} did not finish within {args.wait_timeout} seconds")
        time.sleep(max(0.25, args.poll_interval))


def cmd_api_export(args: argparse.Namespace) -> None:
    selected = selection_columns(args, allow_objects=True)
    if not selected:
        raise SystemExit("Export requires a nonempty selection")
    body = {
        "source": args.source,
        "selected": selected,
        "file": args.file,
        "join_on": args.join_on,
        "projectName": args.project_name,
        "format": args.format,
        "rowCap": args.row_cap,
    }
    result = parse_json(request(args, "POST", "/api/v1/export", body={k: v for k, v in body.items() if v not in (None, "", [])}))
    job_id = export_job_id(result)
    if not job_id:
        raise RuntimeError("Export did not return job.id")
    if args.wait or args.output:
        result = wait_for_export(args, job_id)
    if args.output:
        job = result.get("job") if isinstance(result, dict) else None
        download_url = str(job.get("downloadUrl") or "") if isinstance(job, dict) else ""
        if not download_url:
            raise RuntimeError("Completed export did not return downloadUrl")
        target = download_to_file(args, download_url, args.output, resume=not args.no_resume)
        result["downloadedTo"] = str(target)
    print(json.dumps(result, ensure_ascii=False, indent=2))


def cmd_api_export_status(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", f"/api/v1/export/{quote(args.job_id)}"))


def cmd_api_export_retry(args: argparse.Namespace) -> None:
    print_json(request(args, "POST", f"/api/v1/export/{quote(args.job_id)}/retry", body={}))


def cmd_parquet_to_csv(args: argparse.Namespace) -> None:
    try:
        import duckdb  # type: ignore
    except ImportError as exc:
        raise SystemExit("DuckDB is required: install the duckdb Python package first") from exc
    source = Path(args.parquet_file).expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"Parquet file not found: {source}")
    target = Path(args.output).expanduser().resolve() if args.output else source.with_suffix(".csv")
    if target == source:
        raise SystemExit("CSV output must not overwrite the source Parquet file")
    if target.exists() and not args.force:
        raise SystemExit(f"Output already exists: {target}. Pass --force to replace it.")
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".partial")
    partial.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix="medhelp-duckdb-", dir=target.parent) as temp_dir:
        con = duckdb.connect()
        try:
            con.execute(f"SET memory_limit={duckdb_literal(args.memory_limit)}")
            con.execute(f"SET threads={max(1, args.threads)}")
            con.execute(f"SET temp_directory={duckdb_literal(temp_dir)}")
            con.execute(
                "COPY (SELECT * FROM read_parquet(" + duckdb_literal(str(source)) + ")) "
                "TO " + duckdb_literal(str(partial)) + " (FORMAT CSV, HEADER TRUE)"
            )
        finally:
            con.close()
    partial.replace(target)
    print(target)


def cmd_api_download(args: argparse.Namespace) -> None:
    target = download_to_file(
        args,
        f"/api/v1/datasets/{quote(args.dataset_id)}/download",
        args.output,
        resume=not args.no_resume,
    )
    print(target)


def cmd_ehr_catalogs(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", "/api/v1/ehr/catalogs"))


def cmd_ehr_sql(args: argparse.Namespace) -> None:
    print_json(request(args, "POST", "/api/v1/ehr/sql", body={
        "source": args.source,
        "sql": args.sql,
        "limit": args.limit,
    }))


def cmd_ehr_sql_export(args: argparse.Namespace) -> None:
    body = {
        "source": args.source,
        "sql": args.sql,
        "projectName": args.project_name,
    }
    if args.limit is not None:
        body["limit"] = args.limit
    payload = request(args, "POST", "/api/v1/ehr/sql/export", body=body)
    if args.output:
        result = json.loads(payload.decode("utf-8"))
        dataset_id = ((result.get("dataset") or {}).get("id") or "").strip()
        if not dataset_id:
            raise SystemExit("Export did not return dataset.id")
        target = download_to_file(
            args,
            f"/api/v1/datasets/{quote(dataset_id)}/download",
            args.output,
            resume=not args.no_resume,
        )
        result["downloadedTo"] = str(target)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    print_json(payload)


def cmd_source(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", f"/source/{args.source}"))


def cmd_manifest(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", "/manifest", query={"source": args.source}))


def cmd_search(args: argparse.Namespace) -> None:
    body = {
        "q": args.q,
        "source": args.source,
        "kind": args.kind,
        "match": args.match,
        "limit": args.limit,
    }
    print_json(request(args, "POST", "/search", body=body))


def cmd_batch(args: argparse.Namespace) -> None:
    body = {
        "q": args.q,
        "source": args.source,
        "kind": args.kind,
        "match": args.match,
        "limit": args.limit,
    }
    print_json(request(args, "POST", "/search/batch", body=body))


def cmd_resolve(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", "/resolve", query={"source": args.source, "file": args.file}))


def cmd_schema(args: argparse.Namespace) -> None:
    print_json(
        request(
            args,
            "GET",
            "/schema",
            query={"source": args.source, "file": args.file, "object": args.object},
        )
    )


def cmd_extract(args: argparse.Namespace) -> None:
    columns = selection_columns(args)
    data = request(
        args,
        "POST",
        "/extract",
        body={
            "source": args.source,
            "file": args.file,
            "columns": columns,
            "limit": args.limit,
            "offset": args.offset,
            "sheet": args.sheet,
            "object": args.object,
            "format": args.format,
        },
    )
    if args.format == "csv":
        write_or_print(data, args.output)
    else:
        print_json(data)


def find_start_script(explicit_deploy_dir: str | None) -> Path:
    candidates: list[Path] = []
    if explicit_deploy_dir:
        candidates.append(Path(explicit_deploy_dir).expanduser())
    env_dir = os.environ.get("MEDHELP_DATABASE_DEPLOY_DIR")
    if env_dir:
        candidates.append(Path(env_dir).expanduser())
    candidates.extend(DEFAULT_DEPLOY_DIRS)
    for deploy_dir in candidates:
        script = deploy_dir / "start_deploy_api.sh"
        if script.exists():
            return script.resolve()
    raise SystemExit(
        "Cannot find start_deploy_api.sh. Set MEDHELP_DATABASE_DEPLOY_DIR to the database deploy directory."
    )


def stop_port(port: int, wait_seconds: float = 2.0) -> None:
    try:
        found = subprocess.run(
            ["lsof", "-ti", f"tcp:{port}", "-sTCP:LISTEN"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except FileNotFoundError:
        return
    pids = [pid for pid in found.stdout.split() if pid.strip()]
    if not pids:
        return
    subprocess.run(["kill", *pids], check=False)
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        check = subprocess.run(
            ["lsof", "-ti", f"tcp:{port}", "-sTCP:LISTEN"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        if not check.stdout.strip():
            return
        time.sleep(0.2)


def cmd_start(args: argparse.Namespace) -> None:
    script = find_start_script(args.deploy_dir)
    socket_path = args.socket.strip()
    if args.restart and not socket_path:
        stop_port(args.port)
    env = os.environ.copy()
    env["MEDHELP_DATABASE_API_URL"] = f"http://{args.host}:{args.port}"
    env["DATABASE_API_PORT"] = str(args.port)
    argv = ["bash", str(script)]
    if socket_path:
        argv.extend([
            "--socket",
            socket_path,
            "--allowed-origins",
            f"http://localhost:{args.port},http://127.0.0.1:{args.port}",
        ])
    else:
        argv.extend(["--host", args.host, "--port", str(args.port)])
    argv.extend(["--idle-timeout-seconds", str(args.idle_timeout_seconds)])
    if args.require_token:
        argv.append("--require-token")
    os.execvpe("bash", argv, env)


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--base-url",
        default="",
        help=(
            "API base URL. Uses MEDHELP_DATABASE_API_URL/DATABASE_API_URL when set; "
            "otherwise prefers https://api.medtimehelp.com and falls back to a healthy "
            "http://127.0.0.1:8787 service."
        ),
    )
    parser.add_argument("--token", default="", help="Bearer token override. Prefer a protected MEDHELP_DATABASE_API_TOKEN environment variable.")
    parser.add_argument("--device-id", default="", help="Optional X-Device-ID header.")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument(
        "--transport",
        choices=("auto", "urllib", "curl"),
        default=os.environ.get("MEDHELP_DATABASE_API_TRANSPORT", "auto"),
        help=(
            "HTTP transport. auto uses curl.exe --ssl-no-revoke for Windows HTTPS "
            "and urllib elsewhere; urllib forces the Python TLS stack."
        ),
    )
    parser.add_argument(
        "--proxy-mode",
        choices=("direct", "system"),
        default=os.environ.get("MEDHELP_DATABASE_API_PROXY_MODE", "direct"),
        help=(
            "Proxy policy. direct (default) ignores HTTP_PROXY/HTTPS_PROXY/ALL_PROXY; "
            "system explicitly uses the operating-system/environment proxy settings."
        ),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Client for the remote MedHelp database API.")
    sub = parser.add_subparsers(dest="command", required=True)

    for name, fn in (("api-health", cmd_api_health), ("api-sources", cmd_api_sources), ("ehr-catalogs", cmd_ehr_catalogs)):
        p = sub.add_parser(name)
        add_common(p)
        p.set_defaults(func=fn)

    p = sub.add_parser("api-permissions", help="Show which database sources this token can query and download.")
    add_common(p)
    p.add_argument("--include-auth-status", action="store_true", help="Also try /api/auth/status when using a full login token.")
    p.add_argument("--check-sources", default="", help="Optional comma-separated source ids to classify as allowed or denied for this token.")
    p.set_defaults(func=cmd_api_permissions)

    p = sub.add_parser("query")
    add_common(p)
    p.add_argument("--query", required=True)
    p.add_argument("--source", default="")
    p.add_argument("--sources", default="", help="Comma-separated source ids.")
    p.add_argument("--kind", default="auto")
    p.add_argument("--match", default="all", choices=("all", "any"))
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--per-source-limit", type=int, default=10)
    p.set_defaults(func=cmd_api_query)

    p = sub.add_parser("coding", help="Search one variable across a source's complete published coding references.")
    add_common(p)
    p.add_argument("--source", required=True)
    p.add_argument("--variable", required=True)
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--max-documents", type=int, default=1000)
    p.set_defaults(func=cmd_api_coding)

    p = sub.add_parser("coding-doc", help="Read a pageable text rendering of a matched coding reference.")
    add_common(p)
    p.add_argument("doc_id")
    p.add_argument("--source", required=True)
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--max-chars", type=int, default=500000)
    p.set_defaults(func=cmd_api_coding_doc)

    p = sub.add_parser("build")
    add_common(p)
    p.add_argument("--source", default="")
    p.add_argument("--sources", default="", help="Comma-separated source ids.")
    add_selection_args(p)
    p.add_argument("--file", default="", help="Exact source-relative physical file; required to disambiguate waves/modules.")
    p.add_argument("--join-on", action="append", default=[], help="One required join key; repeat for all person/wave keys.")
    p.add_argument("--query", default="")
    p.add_argument("--variables-per-source", type=int, default=1)
    p.add_argument("--project-name", default="medhelp_dataset")
    p.add_argument("--row-cap", type=int, default=100)
    p.set_defaults(func=cmd_api_build)

    p = sub.add_parser("download")
    add_common(p)
    p.add_argument("dataset_id")
    p.add_argument("-o", "--output", required=True)
    p.add_argument("--no-resume", action="store_true", help="Overwrite instead of resuming an existing partial file with HTTP Range.")
    p.set_defaults(func=cmd_api_download)

    p = sub.add_parser("export", help="Create a background full CSV/Parquet export without a final row cap by default.")
    add_common(p)
    p.add_argument("--source", required=True)
    add_selection_args(p, required=True)
    p.add_argument("--file", default="", help="Exact source-relative physical file.")
    p.add_argument("--join-on", action="append", default=[], help="One required join key; repeat for all person/wave keys.")
    p.add_argument("--project-name", default="medhelp_full_export")
    p.add_argument("--format", choices=("parquet", "csv"), default="parquet")
    p.add_argument("--row-cap", type=int, default=None, help="Optional final row cap; omit for the complete result.")
    p.add_argument("--wait", action="store_true", help="Poll until the background export completes.")
    p.add_argument("--wait-timeout", type=float, default=86400.0)
    p.add_argument("--poll-interval", type=float, default=2.0)
    p.add_argument("-o", "--output", default="", help="Wait and stream the completed file to this path.")
    p.add_argument("--no-resume", action="store_true", help="Overwrite instead of resuming an existing partial download.")
    p.set_defaults(func=cmd_api_export)

    p = sub.add_parser("export-status", help="Read background export progress and its download URL when complete.")
    add_common(p)
    p.add_argument("job_id")
    p.set_defaults(func=cmd_api_export_status)

    p = sub.add_parser("export-retry", help="Retry a failed background export request.")
    add_common(p)
    p.add_argument("job_id")
    p.set_defaults(func=cmd_api_export_retry)

    p = sub.add_parser("parquet-to-csv", help="Convert a downloaded Parquet file to CSV with bounded DuckDB memory.")
    p.add_argument("parquet_file")
    p.add_argument("-o", "--output", default="")
    p.add_argument("--memory-limit", default="1GB", help="DuckDB working-memory cap; output size is not capped.")
    p.add_argument("--threads", type=int, default=2)
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_parquet_to_csv)

    p = sub.add_parser("ehr-sql")
    add_common(p)
    p.add_argument("--source", required=True, choices=("mimiciii", "mimiciv", "mimiciv31", "eicu", "sicdb", "inspire", "nwicu", "pic"))
    p.add_argument("--sql", required=True)
    p.add_argument("--limit", type=int, default=1000)
    p.set_defaults(func=cmd_ehr_sql)

    p = sub.add_parser(
        "ehr-sql-export",
        help="Export ICU/EHR SQL; join large event tables to an ICD/diagnosis cohort before download.",
    )
    add_common(p)
    p.add_argument("--source", required=True, choices=("mimiciii", "mimiciv", "mimiciv31", "eicu", "sicdb", "inspire", "nwicu", "pic"))
    p.add_argument("--sql", required=True, help="SELECT/WITH SQL. For ICU/EHR event tables, include an ICD/diagnosis cohort filter first.")
    p.add_argument("--limit", type=int, default=None, help="Optional row cap. Omit for full ICU/EHR export.")
    p.add_argument("--project-name", default="ehr_sql_export")
    p.add_argument("-o", "--output", default="", help="Optional CSV path to download after export.")
    p.add_argument("--no-resume", action="store_true", help="Overwrite instead of resuming an existing partial download.")
    p.set_defaults(func=cmd_ehr_sql_export)

    for name, fn in (("health", cmd_health), ("sources", cmd_sources)):
        p = sub.add_parser(name)
        add_common(p)
        p.set_defaults(func=fn)

    p = sub.add_parser("source")
    add_common(p)
    p.add_argument("--source", required=True)
    p.set_defaults(func=cmd_source)

    p = sub.add_parser("manifest")
    add_common(p)
    p.add_argument("--source", required=True)
    p.set_defaults(func=cmd_manifest)

    p = sub.add_parser("search")
    add_common(p)
    p.add_argument("--q", required=True)
    p.add_argument("--source", default="")
    p.add_argument("--kind", default="auto")
    p.add_argument("--match", default="all", choices=("all", "any"))
    p.add_argument("--limit", type=int, default=20)
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("batch")
    add_common(p)
    p.add_argument("--q", required=True, action="append", help="Query term. Repeat for multiple terms.")
    p.add_argument("--source", default="")
    p.add_argument("--kind", default="auto")
    p.add_argument("--match", default="all", choices=("all", "any"))
    p.add_argument("--limit", type=int, default=10)
    p.set_defaults(func=cmd_batch)

    p = sub.add_parser("resolve")
    add_common(p)
    p.add_argument("--source", required=True)
    p.add_argument("--file", required=True)
    p.set_defaults(func=cmd_resolve)

    p = sub.add_parser("schema")
    add_common(p)
    p.add_argument("--source", required=True)
    p.add_argument("--file", required=True)
    p.add_argument("--object", default="")
    p.set_defaults(func=cmd_schema)

    p = sub.add_parser("extract")
    add_common(p)
    p.add_argument("--source", required=True)
    p.add_argument("--file", required=True)
    add_selection_args(p, legacy="--columns")
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--sheet", default="")
    p.add_argument("--object", default="")
    p.add_argument("--format", choices=("json", "csv"), default="json")
    p.add_argument("--output", default="")
    p.set_defaults(func=cmd_extract)

    p = sub.add_parser("start")
    p.add_argument("--deploy-dir", default="", help="Directory containing start_deploy_api.sh.")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8787)
    p.add_argument("--socket", default=os.environ.get("DATABASE_API_SOCKET", DEFAULT_SOCKET), help="Unix socket path for the database sidecar. Pass an empty string only for explicit TCP maintenance.")
    p.add_argument("--idle-timeout-seconds", type=int, default=0)
    p.add_argument("--require-token", action="store_true")
    p.add_argument("--restart", action="store_true", help="Kill the old TCP listener on --port before starting when --socket is empty.")
    p.set_defaults(func=cmd_start)

    return parser


def main() -> int:
    args = build_parser().parse_args()
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
