---
name: ukb-skill
description: Use when working with UKB, UK Biobank, 英国生物银行 database source through source_id ukb in ../Web_database. Search indexes, verify variables, inspect schema, resolve paths, and extract only real database-backed rows for UK Biobank participant-level fields, field IDs, instances, arrays, reference dictionaries, and locally matched proteomics/Olink files.
---

# UKB Skill

This skill is API-first and source-backed. Use it for `ukb` only. Shared API mechanics live in `$medhelp-database-api-access`; this skill records the source-specific trigger, paths, and guardrails.

## Source Identity

- Source ID: `ukb`
- Source name: `UKB`
- Aliases: UKB, UK Biobank, 英国生物银行
- Research focus: UK Biobank participant-level fields, field IDs, instances, arrays, reference dictionaries, and locally matched proteomics/Olink files
- Query source root: `../Web_database/database/query/sources/ukb`
- Local source root: `../Web_database/database/data/sources/ukb`
- Source manifest: `../Web_database/database/query/sources/ukb/source_manifest.json`
- Index directory: `../Web_database/database/query/sources/ukb/00_indexes`
- Metadata directory: `../Web_database/database/query/sources/ukb/metadata`
- Local analysis data: `../Web_database/database/data/sources/ukb/analysis_data`
- Local raw data: `../Web_database/database/data/sources/ukb/raw_data`
- Local matrix data: `../Web_database/database/data/sources/ukb/matrix_data`
- Local availability summary: raw requirements: 0; analysis requirements: 6; supports local extract: true; schema cache: false

## Use When

- UKB field ID lookup for phenotype, biomarker, lifestyle, medication, disease, endpoint, imaging, genetics, or proteomics questions
- participant-level matrix extraction and exact column resolution such as field-instance-array columns
- matched Olink/proteomics discovery and extraction when local files confirm availability

## Hard Rules

- Never use old direct roots such as legacy `UKB_data` directories as the default entry. The current entry is `query_layer/sources/ukb` plus `local_data_layer/sources/ukb`.
- Never simulate, invent, or guess values, counts, waves, field IDs, table names, labels, join keys, sample restrictions, or variable availability.
- Search the query layer first. Only read row-level files through `/schema`, `/extract`, or a checked local path from `/resolve`.
- Do not claim HES, death, primary care, imaging, genetics, or proteomics availability unless the local indexes or schema confirm it.
- Resolve field IDs and exact columns before extraction; UKB instances and arrays matter.
- For proteomics, check matched_proteomics_summary and local parquet schemas before building an analysis matrix.

## API Workflow

Check the source and available database data:

```bash
curl -sS http://127.0.0.1:8765/source/ukb
```

Search. Available search kinds for this source include: `auto, all, dictionary, variables, datasets, overview`.

```bash
curl -sS -X POST http://127.0.0.1:8765/search \
  -H 'Content-Type: application/json' \
  -d '{"q":"<keyword>","source":"ukb","kind":"auto","limit":20}'
```

For Chinese or multilingual labels, keep POST JSON and search synonyms separately if needed:

```bash
curl -sS -X POST http://127.0.0.1:8765/search/batch \
  -H 'Content-Type: application/json' \
  -d '{"q":["<English keyword>","<中文关键词>","<abbreviation>"],"source":"ukb","kind":"auto","limit":10}'
```

Resolve, inspect schema, then extract only a small slice:

```bash
curl -sS "http://127.0.0.1:8765/resolve?source=ukb&file=<relative_or_indexed_path>"
curl -sS "http://127.0.0.1:8765/schema?source=ukb&file=<relative_or_indexed_path>"
curl -sS "http://127.0.0.1:8765/extract?source=ukb&file=<relative_or_indexed_path>&columns=<col1,col2>&limit=20"
```

Read the source manifest when route or file placement is unclear:

```bash
curl -sS "http://127.0.0.1:8765/manifest?source=ukb"
```

## Direct Fallback

Use direct file reads only if the API is unavailable or the task explicitly needs inspecting local metadata. Prefer these new paths:

- `../Web_database/database/query/sources/ukb/00_indexes/`
- `../Web_database/database/query/sources/ukb/metadata/`
- `../Web_database/database/data/sources/ukb/analysis_data/`
- `../Web_database/database/data/sources/ukb/raw_data/`
- `../Web_database/database/data/sources/ukb/matrix_data/`
- `../Web_database/database/data/matrix_metadata/` for cross-source matrix routing.

## Source Recipes

Source-specific recipes, if needed, are copied into the query layer. Prefer API calls for normal lookup; use recipes only when their behavior is needed and the path exists.

- `../Web_database/database/query/sources/ukb/recipes/extract_ukb_ai_access.py`
- `../Web_database/database/query/sources/ukb/recipes/query_matched_proteomics.py`
- `../Web_database/database/query/sources/ukb/recipes/query_ukb_ai_access.py`

## Reporting Standard

Report the source ID, exact index file or API endpoint used, exact variable/table/file path resolved, exact columns extracted, and any grain, wave, cycle, country, field ID, join, or time-semantics warning that affects interpretation.
