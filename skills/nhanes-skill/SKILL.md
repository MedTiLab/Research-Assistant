---
name: nhanes-skill
description: Use when working with NHANES, National Health and Nutrition Examination Survey, US survey source through source_id nhanes in the MedHelp/Web_database stack. Search API indexes, verify variables, inspect schema, resolve paths, extract real rows, check survey-cycle guardrails, and when API/local data is missing, download the required public-use data and documentation from the official CDC/NCHS NHANES portal.
---

# NHANES Skill

Use this skill for `nhanes` only. The workflow is **API first, local second, official CDC data and documentation third**. Shared API mechanics live in `$medhelp-database-api-access`; this skill records NHANES-specific paths, official-download fallback, and cycle guardrails.

## Source Identity

- Source ID: `nhanes`
- Source name: `NHANES`
- Aliases: NHANES, National Health and Nutrition Examination Survey, US survey
- Research focus: US NHANES cycles, harmonized libraries, laboratory, examination, questionnaire, diet, ophthalmology, microbiome, and survey-weighted public health data
- Query source root: `../Web_database/database/query/sources/nhanes`
- Local source root: `../Web_database/database/data/sources/nhanes`
- Source manifest: `../Web_database/database/query/sources/nhanes/source_manifest.json`
- Index directory: `../Web_database/database/query/sources/nhanes/00_indexes`
- Metadata directory: `../Web_database/database/query/sources/nhanes/metadata`
- Local analysis data: `../Web_database/database/data/sources/nhanes/analysis_data`
- Local raw data: `../Web_database/database/data/sources/nhanes/raw_data`
- Official download staging: `../Web_database/database/data/sources/nhanes/official_downloads`
- Official portal: `https://wwwn.cdc.gov/nchs/nhanes/default.aspx`
- Continuous NHANES data/documentation: `https://wwwn.cdc.gov/nchs/nhanes/continuousnhanes/`

## Hard Rules

- Never invent values, counts, waves, field IDs, table names, labels, join keys, sample restrictions, code labels, units, or variable availability.
- Always query the API/index first. Only inspect local files or CDC pages after API lookup fails, is incomplete, or cannot verify labels/units/code order.
- Do not treat NHANES as longitudinal person-level follow-up. It is repeated cross-sectional except for specific linked follow-up products.
- Always check cycle coverage, component availability, weights, strata, PSU, and cross-cycle guardrails before analysis.
- Do not append 2017-2018 harmonized data with 2017-March 2020 pre-pandemic files without de-overlap rules.
- For categorical variables, verify code labels, code order, missing-value codes, and skip patterns from local metadata or official codebooks before delivery.
- For continuous variables, verify units, scale, valid range, and transformation status from local metadata or official codebooks before delivery.
- Official CDC codebooks are metadata evidence. Do not claim row-level data exists locally unless API/local files or downloaded official data files are inspected.
- If the requested variables are in a public NHANES release but no usable local row-level data exists, do not stop and do not ask the user to find the files. Download the matching official public-use data file from CDC/NCHS, stage it with its source URL, inspect it, and continue.
- Download only from official `cdc.gov`/`wwwn.cdc.gov` NHANES pages. Do not substitute third-party mirrors.

## Strict Fallback Order

1. **API first**: use the local MedHelp API or its sidecar endpoints for source listing, variable search, manifest, resolve, schema, and extraction.
2. **Local second**: if the API cannot answer or package the result, inspect `../Web_database/database/query/sources/nhanes` and `../Web_database/database/data/sources/nhanes` directly.
3. **Official CDC third**: if API and local metadata/data are missing or insufficient, use the official NHANES portal at `https://wwwn.cdc.gov/nchs/nhanes/default.aspx`. Download matching public-use XPT data with `scripts/fetch_official_codebooks.py --download-data`, and download its Doc/codebook with `--download-docs`.
4. **User upload last**: if needed variables are restricted, licensed, user-owned, or absent from public NHANES releases, ask for the original file(s) and continue with verified available variables.

## API Workflow

Detect the same-host API base. Do not send a Bearer token for trusted-local loopback calls:

```bash
BASE=""
for u in "$MEDHELP_DATABASE_API_URL" http://127.0.0.1:8787 http://127.0.0.1:8878; do
  [ -n "$u" ] && curl -fs -m 3 "$u/api/v1/health" >/dev/null 2>&1 && { BASE="$u"; break; }
done
echo "BASE=$BASE"
```

Search variables through the high-level API:

```bash
curl -sS -X POST "$BASE/api/v1/variables/query" \
  -H 'Content-Type: application/json' \
  -d '{"query":"BMXBMI body mass index BMI","source":"nhanes","limit":20}'
```

Use sidecar-style endpoints on the same base for NHANES index detail:

```bash
curl -sS "$BASE/manifest?source=nhanes"
curl -sS -X POST "$BASE/search" \
  -H 'Content-Type: application/json' \
  -d '{"q":"BMXBMI","source":"nhanes","kind":"dictionary","limit":20}'
curl -sS "$BASE/resolve?source=nhanes&file=<relative_or_indexed_path>"
curl -sS "$BASE/schema?source=nhanes&file=<relative_or_indexed_path>"
curl -sS "$BASE/extract?source=nhanes&file=<relative_or_indexed_path>&columns=<col1,col2>&limit=20"
```

Build small extracts first:

```bash
curl -sS -X POST "$BASE/api/v1/extract" \
  -H 'Content-Type: application/json' \
  -d '{"source":"nhanes","selected":["BMXBMI"],"projectName":"nhanes_bmi_check","rowCap":20}'
```

## Local Metadata/Data Fallback

Use direct file reads only after API lookup is unavailable, incomplete, or cannot verify metadata. Prefer:

- `../Web_database/database/query/sources/nhanes/00_indexes/nhanes_ai_dictionary.csv`
- `../Web_database/database/query/sources/nhanes/00_indexes/nhanes_variable_index.csv`
- `../Web_database/database/query/sources/nhanes/00_indexes/nhanes_cross_cycle_guardrails.csv`
- `../Web_database/database/query/sources/nhanes/metadata/`
- `../Web_database/database/data/sources/nhanes/analysis_data/`
- `../Web_database/database/data/sources/nhanes/raw_data/`
- `../Web_database/database/data/sources/nhanes/matrix_data/`

Resolve actual columns with structured tools (`duckdb`, `python3` with pandas/pyarrow, or `csvcut` if available). Inspect a few rows before reporting availability.

## Official CDC Data And Documentation Fallback

Use the bundled script to discover and download official public-use XPT data plus matching Doc/codebook HTML from CDC/NCHS component pages. It parses the official pages instead of guessing URLs.

List official codebooks without downloading:

```bash
python3 skills/nhanes-skill/scripts/fetch_official_codebooks.py \
  --components Questionnaire Examination Laboratory Demographics Dietary \
  --years 2017-2018 2017-2020 2021-2023 \
  --datasets BPQ_J P_BPQ BPQ_L
```

Download multi-year official docs into a traceable local staging folder:

```bash
python3 skills/nhanes-skill/scripts/fetch_official_codebooks.py \
  --components Questionnaire \
  --years 2017-2018 2017-2020 2021-2023 \
  --datasets BPQ_J P_BPQ BPQ_L \
  --download-docs \
  --download-dir ../Web_database/database/data/sources/nhanes/official_downloads
```

When the local data file is absent, download both the official public-use XPT and its documentation, then inspect the XPT before extraction:

```bash
python3 skills/nhanes-skill/scripts/fetch_official_codebooks.py \
  --components Examination \
  --years 2017-2018 \
  --datasets BMX_J \
  --download-data \
  --download-docs \
  --download-dir ../Web_database/database/data/sources/nhanes/official_downloads \
  --manifest-out ../Web_database/database/data/sources/nhanes/official_downloads/BMX_J-manifest.json
```

Find official docs that contain a variable before downloading:

```bash
python3 skills/nhanes-skill/scripts/fetch_official_codebooks.py \
  --components Questionnaire Examination Laboratory \
  --years 1999-2000 2001-2002 2003-2004 2005-2006 2007-2008 2009-2010 2011-2012 2013-2014 2015-2016 2017-2018 2017-2020 2021-2023 \
  --variable BPQ020 \
  --max-docs 0 \
  --download-docs \
  --download-dir ../Web_database/database/data/sources/nhanes/official_downloads
```

The script refuses broad downloads above `--max-docs` unless you explicitly set `--max-docs 0`. Prefer narrowing by `--components`, `--years`, or `--datasets` before disabling the guard.

Continuous NHANES public-use data/Doc pages cover 1999 onward. Historical NHANES I/II/III pages use separate CDC historical pages; use the historical links from the same official NHANES portal when the requested variable is historical-only.

## Source Recipes

Source-specific recipes are copied into the query layer. Prefer API calls for normal lookup; use recipes only when their behavior is needed and the path exists.

- `../Web_database/database/query/sources/nhanes/recipes/build_nhanes_ophthalmology_1999_2008.R`
- `../Web_database/database/query/sources/nhanes/recipes/build_unified_nhanes_index.R`
- `../Web_database/database/query/sources/nhanes/recipes/extract_nhanes_matrix.R`
- `../Web_database/database/query/sources/nhanes/recipes/query_nhanes_ai_access.py`

## Reporting Standard

Report the source ID, API endpoint or local/official file used, exact variable/table/file path resolved, exact columns extracted, codebook or metadata evidence for labels/units/code order, row limit, and any grain, cycle, weight, join, overlap, or time-semantics warning.
