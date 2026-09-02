#!/usr/bin/env python3
"""Fetch official CDC/NCHS NHANES public-use data and Doc/codebook pages.

The script parses CDC data component pages and can download matching public-use
XPT data files and Doc HTML files. It uses only Python stdlib so it can run in
minimal Codex skill contexts.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import Request, urlopen


CDC_ROOT = "https://wwwn.cdc.gov"
CDC_DATA_PAGE = "https://wwwn.cdc.gov/nchs/nhanes/search/datapage.aspx"
DEFAULT_COMPONENTS = [
    "Demographics",
    "Dietary",
    "Examination",
    "Laboratory",
    "Questionnaire",
    "Limited Access",
]
USER_AGENT = "Codex NHANES official data and documentation fetcher; source verification"
YEAR_RE = re.compile(r"(?:\d{4}-March\s+\d{4}|\d{4}-\d{4}|\d{4})")


class LinkRowParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[dict] = []
        self._row: dict | None = None
        self._link: dict | None = None
        self._in_tr = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): value or "" for key, value in attrs}
        tag = tag.lower()
        if tag == "tr":
            self._in_tr = True
            self._row = {"text": [], "links": []}
        elif tag == "a" and self._in_tr and self._row is not None:
            self._link = {"href": attrs_dict.get("href", ""), "text": []}

    def handle_data(self, data: str) -> None:
        if self._in_tr and self._row is not None:
            self._row["text"].append(data)
        if self._link is not None:
            self._link["text"].append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "a" and self._link is not None and self._row is not None:
            self._link["text"] = norm(" ".join(self._link["text"]))
            self._row["links"].append(self._link)
            self._link = None
        elif tag == "tr" and self._row is not None:
            self._row["text"] = norm(" ".join(self._row["text"]))
            if self._row["text"] or self._row["links"]:
                self.rows.append(self._row)
            self._row = None
            self._in_tr = False
            self._link = None


class TextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    @property
    def text(self) -> str:
        return norm(" ".join(self.parts))


def norm(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def fetch_text(url: str, timeout: int = 30) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=timeout) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def fetch_bytes(url: str, timeout: int = 120) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=timeout) as response:
        payload = response.read()
    if not payload:
        raise URLError(f"empty response from {url}")
    return payload


def component_url(component: str) -> str:
    return f"{CDC_DATA_PAGE}?{urlencode({'Component': component})}"


def safe_part(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    return safe.strip("._") or "unknown"


def dataset_from_doc_link(text: str, href: str) -> str:
    text_code = re.sub(r"\s+Doc\s*$", "", text, flags=re.I).strip()
    if text_code:
        return text_code
    name = Path(href.split("?", 1)[0]).stem
    return name


def row_year(text: str) -> str:
    match = YEAR_RE.search(text)
    return norm(match.group(0)) if match else ""


def discover_component(component: str) -> list[dict]:
    url = component_url(component)
    page = fetch_text(url)
    parser = LinkRowParser()
    parser.feed(page)
    records: list[dict] = []
    for row in parser.rows:
        text = row["text"]
        year = row_year(text)
        for link in row["links"]:
            link_text = link.get("text", "")
            href = link.get("href", "")
            if not href or not re.search(r"\bDoc\b", link_text, flags=re.I):
                continue
            if "DataFiles" not in href or not href.lower().endswith(".htm"):
                continue
            data_links = [
                urljoin(CDC_ROOT, other.get("href", ""))
                for other in row["links"]
                if re.search(r"\bData\b", other.get("text", ""), flags=re.I)
            ]
            records.append(
                {
                    "component": component,
                    "year": year,
                    "dataset": dataset_from_doc_link(link_text, href),
                    "doc_text": link_text,
                    "row_text": text,
                    "doc_url": urljoin(CDC_ROOT, href),
                    "data_url": data_links[0] if data_links else "",
                    "component_page": url,
                }
            )
    return records


def matches_filters(record: dict, args: argparse.Namespace) -> bool:
    if args.years:
        wanted = {item.lower() for item in args.years}
        text = f"{record.get('year', '')} {record.get('row_text', '')}".lower()
        if not any(year in text for year in wanted):
            return False
    if args.datasets:
        wanted_codes = {item.upper().replace(".XPT", "") for item in args.datasets}
        if record.get("dataset", "").upper().replace(".XPT", "") not in wanted_codes:
            return False
    if args.query:
        q = args.query.lower()
        if q not in record.get("row_text", "").lower() and q not in record.get("dataset", "").lower():
            return False
    return True


def variable_in_doc(variable: str, doc_html: str) -> bool:
    parser = TextParser()
    parser.feed(doc_html)
    text = parser.text
    pattern = re.compile(rf"(?<![A-Za-z0-9_]){re.escape(variable)}(?![A-Za-z0-9_])", re.I)
    return bool(pattern.search(text))


def doc_output_path(record: dict, download_dir: Path) -> Path:
    component = safe_part(record["component"])
    year = safe_part(record.get("year") or "unknown_year")
    dataset = safe_part(record["dataset"])
    return download_dir / "docs" / component / year / f"{dataset}.html"


def data_output_path(record: dict, download_dir: Path) -> Path:
    component = safe_part(record["component"])
    year = safe_part(record.get("year") or "unknown_year")
    dataset = safe_part(record["dataset"])
    suffix = Path(urlparse(record.get("data_url", "")).path).suffix.lower()
    if not suffix or len(suffix) > 10:
        suffix = ".xpt"
    return download_dir / "data" / component / year / f"{dataset}{suffix}"


def maybe_fetch_doc(record: dict, cache: dict[str, str]) -> str:
    url = record["doc_url"]
    if url not in cache:
        cache[url] = fetch_text(url)
        time.sleep(0.15)
    return cache[url]


def write_outputs(records: list[dict], args: argparse.Namespace) -> None:
    if args.format == "json":
        payload = {"count": len(records), "records": records}
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    else:
        fields = [
            "component",
            "year",
            "dataset",
            "doc_url",
            "data_url",
            "downloaded_path",
            "downloaded_doc_path",
            "downloaded_data_path",
            "downloaded_data_bytes",
            "data_download_error",
            "variable",
            "variable_present",
            "component_page",
        ]
        from io import StringIO

        buf = StringIO()
        writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for record in records:
            writer.writerow(record)
        text = buf.getvalue()

    if args.manifest_out:
        path = Path(args.manifest_out)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    print(text)


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--components", nargs="+", default=DEFAULT_COMPONENTS)
    parser.add_argument("--years", nargs="*", help="Cycle labels, e.g. 2017-2018 2017-2020 2021-2023")
    parser.add_argument("--datasets", nargs="*", help="CDC dataset codes, e.g. BPQ_J P_BPQ BPQ_L")
    parser.add_argument("--query", help="Case-insensitive row text filter, e.g. blood pressure")
    parser.add_argument("--variable", help="Only keep Docs whose HTML contains this variable code")
    parser.add_argument(
        "--download",
        "--download-docs",
        dest="download_docs",
        action="store_true",
        help="Download matching Doc/codebook HTML files",
    )
    parser.add_argument(
        "--download-data",
        action="store_true",
        help="Download matching official public-use data files (normally XPT)",
    )
    parser.add_argument("--download-dir", default="nhanes_official_downloads")
    parser.add_argument("--manifest-out", help="Also write the manifest to this path")
    parser.add_argument("--format", choices=["json", "csv"], default="json")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument(
        "--max-docs",
        type=int,
        default=200,
        help="Maximum matched files to fetch; 0 disables the guard",
    )
    return parser.parse_args(list(argv))


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    try:
        records: list[dict] = []
        for component in args.components:
            records.extend(
                record
                for record in discover_component(component)
                if matches_filters(record, args)
            )

        needs_doc_fetch = bool(args.variable or args.download_docs)
        needs_any_download = bool(args.download_docs or args.download_data)
        if (needs_doc_fetch or needs_any_download) and args.max_docs and len(records) > args.max_docs:
            print(
                f"Refusing to fetch {len(records)} matched files. Narrow --components/--years/--datasets or set --max-docs 0.",
                file=sys.stderr,
            )
            return 2

        cache: dict[str, str] = {}
        if args.variable:
            kept: list[dict] = []
            for record in records:
                doc_html = maybe_fetch_doc(record, cache)
                present = variable_in_doc(args.variable, doc_html)
                record["variable"] = args.variable
                record["variable_present"] = present
                if present:
                    kept.append(record)
            records = kept

        if needs_any_download:
            download_dir = Path(args.download_dir)
            for record in records:
                if args.download_docs:
                    target = doc_output_path(record, download_dir)
                    record["downloaded_path"] = str(target)
                    record["downloaded_doc_path"] = str(target)
                    if not target.exists() or args.overwrite:
                        doc_html = maybe_fetch_doc(record, cache)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_text(doc_html, encoding="utf-8")
                if args.download_data:
                    if not record.get("data_url"):
                        record["data_download_error"] = "official component row has no public data link"
                        continue
                    target = data_output_path(record, download_dir)
                    record["downloaded_data_path"] = str(target)
                    if not target.exists() or args.overwrite:
                        payload = fetch_bytes(record["data_url"])
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(payload)
                    record["downloaded_data_bytes"] = target.stat().st_size

        write_outputs(records, args)
        return 0
    except (HTTPError, URLError, TimeoutError) as exc:
        print(f"CDC fetch failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
