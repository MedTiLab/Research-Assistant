#!/usr/bin/env python3
"""
Export BibTeX bibliographies to reference-manager import formats.

Supported outputs:
- RIS: broad import support across Zotero, Mendeley, EndNote, Paperpile, and others
- ENW: EndNote tagged format
"""

import argparse
import unicodedata
import re
import sys
from pathlib import Path


TYPE_TO_RIS = {
    "article": "JOUR",
    "book": "BOOK",
    "inbook": "CHAP",
    "incollection": "CHAP",
    "inproceedings": "CONF",
    "conference": "CONF",
    "proceedings": "CONF",
    "phdthesis": "THES",
    "mastersthesis": "THES",
    "techreport": "RPRT",
    "manual": "GEN",
    "misc": "GEN",
}

TYPE_TO_ENW = {
    "article": "Journal Article",
    "book": "Book",
    "inbook": "Book Section",
    "incollection": "Book Section",
    "inproceedings": "Conference Paper",
    "conference": "Conference Paper",
    "proceedings": "Conference Proceedings",
    "phdthesis": "Thesis",
    "mastersthesis": "Thesis",
    "techreport": "Report",
    "manual": "Generic",
    "misc": "Generic",
}

COMBINING_ACCENTS = {
    "`": "\u0300",
    "'": "\u0301",
    "^": "\u0302",
    '"': "\u0308",
    "~": "\u0303",
    "=": "\u0304",
    ".": "\u0307",
    "u": "\u0306",
    "v": "\u030c",
    "H": "\u030b",
    "c": "\u0327",
    "r": "\u030a",
}

LATEX_SPECIAL_CHARS = {
    r"\i": "i",
    r"\j": "j",
    r"\ae": "ae",
    r"\AE": "AE",
    r"\oe": "oe",
    r"\OE": "OE",
    r"\aa": "a",
    r"\AA": "A",
    r"\o": "o",
    r"\O": "O",
    r"\ss": "ss",
}


def parse_balanced(text, start, opener, closer):
    depth = 0
    chars = []
    i = start
    while i < len(text):
        char = text[i]
        if char == opener:
            depth += 1
            if depth > 1:
                chars.append(char)
        elif char == closer:
            depth -= 1
            if depth == 0:
                return "".join(chars), i + 1
            chars.append(char)
        else:
            chars.append(char)
        i += 1
    raise ValueError("Unbalanced BibTeX entry")


def parse_quoted(text, start):
    chars = []
    i = start + 1
    escaped = False
    while i < len(text):
        char = text[i]
        if char == '"' and not escaped:
            return "".join(chars), i + 1
        chars.append(char)
        escaped = char == "\\" and not escaped
        if char != "\\":
            escaped = False
        i += 1
    raise ValueError("Unbalanced quoted BibTeX value")


def parse_value(text, start):
    i = start
    while i < len(text) and text[i].isspace():
        i += 1
    if i >= len(text):
        return "", i
    if text[i] == "{":
        return parse_balanced(text, i, "{", "}")
    if text[i] == '"':
        return parse_quoted(text, i)
    end = i
    while end < len(text) and text[end] not in ",\n\r":
        end += 1
    return text[i:end].strip(), end


def parse_fields(fields_text):
    fields = {}
    i = 0
    while i < len(fields_text):
        while i < len(fields_text) and (fields_text[i].isspace() or fields_text[i] == ","):
            i += 1
        match = re.match(r"([A-Za-z][A-Za-z0-9_-]*)\s*=", fields_text[i:])
        if not match:
            i += 1
            continue
        name = match.group(1).lower()
        i += match.end()
        value, i = parse_value(fields_text, i)
        fields[name] = clean_text(value)
    return fields


def parse_bibtex(content):
    entries = []
    i = 0
    while True:
        at = content.find("@", i)
        if at == -1:
            break
        type_match = re.match(r"@([A-Za-z]+)\s*[{(]", content[at:])
        if not type_match:
            i = at + 1
            continue
        entry_type = type_match.group(1).lower()
        opener_index = at + type_match.end() - 1
        opener = content[opener_index]
        closer = "}" if opener == "{" else ")"
        body, next_index = parse_balanced(content, opener_index, opener, closer)
        if entry_type in {"comment", "preamble", "string"}:
            i = next_index
            continue
        key, _, fields_text = body.partition(",")
        entries.append({
            "type": entry_type,
            "key": key.strip(),
            "fields": parse_fields(fields_text),
        })
        i = next_index
    return entries


def clean_text(value):
    value = value.strip()
    value = latex_to_unicode(value)
    replacements = {
        r"\&": "&",
        r"\%": "%",
        r"\_": "_",
        r"\#": "#",
        r"\$": "$",
        r"\{": "{",
        r"\}": "}",
        "~": " ",
        "--": "-",
    }
    for old, new in replacements.items():
        value = value.replace(old, new)
    value = re.sub(r"[{}]", "", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def latex_to_unicode(value):
    for latex, unicode_value in LATEX_SPECIAL_CHARS.items():
        value = value.replace(latex, unicode_value)

    def replace_accent(match):
        accent = match.group(1)
        base = match.group(2)
        combining = COMBINING_ACCENTS.get(accent)
        if not combining:
            return base
        return unicodedata.normalize("NFC", base + combining)

    return re.sub(r"\\([`'\"^~=\.Huvcr])\s*\{?([A-Za-zıȷ])\}?", replace_accent, value)


def split_authors(author_field):
    if not author_field:
        return []
    authors = re.split(r"\s+and\s+", author_field)
    return [author.strip() for author in authors if author.strip() and author.strip().lower() != "others"]


def split_pages(pages):
    if not pages:
        return "", ""
    normalized = pages.replace("--", "-")
    if "-" not in normalized:
        return normalized.strip(), ""
    start, end = normalized.split("-", 1)
    return start.strip(), end.strip()


def keywords(value):
    if not value:
        return []
    return [item.strip() for item in re.split(r";|,", value) if item.strip()]


def add_ris(lines, tag, value):
    if value:
        lines.append(f"{tag}  - {value}")


def entry_to_ris(entry):
    fields = entry["fields"]
    lines = [f"TY  - {TYPE_TO_RIS.get(entry['type'], 'GEN')}"]
    for author in split_authors(fields.get("author", "")):
        add_ris(lines, "AU", author)
    for editor in split_authors(fields.get("editor", "")):
        add_ris(lines, "ED", editor)
    add_ris(lines, "TI", fields.get("title"))
    add_ris(lines, "T2", fields.get("journal") or fields.get("booktitle"))
    add_ris(lines, "PY", fields.get("year"))
    add_ris(lines, "VL", fields.get("volume"))
    add_ris(lines, "IS", fields.get("number"))
    start_page, end_page = split_pages(fields.get("pages", ""))
    add_ris(lines, "SP", start_page)
    add_ris(lines, "EP", end_page)
    add_ris(lines, "PB", fields.get("publisher"))
    add_ris(lines, "CY", fields.get("address"))
    add_ris(lines, "DO", fields.get("doi"))
    add_ris(lines, "UR", fields.get("url"))
    add_ris(lines, "SN", fields.get("issn") or fields.get("isbn"))
    add_ris(lines, "AB", fields.get("abstract"))
    for keyword in keywords(fields.get("keywords", "")):
        add_ris(lines, "KW", keyword)
    add_ris(lines, "N1", fields.get("note"))
    lines.append("ER  -")
    return "\n".join(lines)


def add_enw(lines, tag, value):
    if value:
        lines.append(f"{tag} {value}")


def entry_to_enw(entry):
    fields = entry["fields"]
    lines = [f"%0 {TYPE_TO_ENW.get(entry['type'], 'Generic')}"]
    for author in split_authors(fields.get("author", "")):
        add_enw(lines, "%A", author)
    for editor in split_authors(fields.get("editor", "")):
        add_enw(lines, "%E", editor)
    add_enw(lines, "%T", fields.get("title"))
    add_enw(lines, "%J", fields.get("journal") or fields.get("booktitle"))
    add_enw(lines, "%D", fields.get("year"))
    add_enw(lines, "%V", fields.get("volume"))
    add_enw(lines, "%N", fields.get("number"))
    add_enw(lines, "%P", fields.get("pages"))
    add_enw(lines, "%I", fields.get("publisher"))
    add_enw(lines, "%C", fields.get("address"))
    add_enw(lines, "%R", fields.get("doi"))
    add_enw(lines, "%U", fields.get("url"))
    add_enw(lines, "%@", fields.get("issn") or fields.get("isbn"))
    add_enw(lines, "%X", fields.get("abstract"))
    for keyword in keywords(fields.get("keywords", "")):
        add_enw(lines, "%K", keyword)
    add_enw(lines, "%Z", fields.get("note"))
    return "\n".join(lines)


def export_entries(entries, output_format):
    converter = entry_to_ris if output_format == "ris" else entry_to_enw
    return "\n\n".join(converter(entry) for entry in entries).strip() + "\n"


def default_output_path(input_path, output_format):
    suffix = ".ris" if output_format == "ris" else ".enw"
    return input_path.with_suffix(suffix)


def main():
    parser = argparse.ArgumentParser(
        description="Export BibTeX to RIS or ENW for reference managers."
    )
    parser.add_argument("input", help="Input BibTeX file")
    parser.add_argument(
        "--format",
        choices=["ris", "enw"],
        default="ris",
        help="Export format (default: ris)",
    )
    parser.add_argument(
        "-o",
        "--output",
        help="Output file path. Defaults to input filename with .ris or .enw suffix.",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output) if args.output else default_output_path(input_path, args.format)

    try:
        content = input_path.read_text(encoding="utf-8")
    except OSError as error:
        print(f"Error reading input file: {error}", file=sys.stderr)
        sys.exit(1)

    try:
        entries = parse_bibtex(content)
    except ValueError as error:
        print(f"Error parsing BibTeX: {error}", file=sys.stderr)
        sys.exit(1)

    if not entries:
        print("Error: no BibTeX entries found", file=sys.stderr)
        sys.exit(1)

    output_path.write_text(export_entries(entries, args.format), encoding="utf-8")
    print(f"Wrote {len(entries)} entries to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
