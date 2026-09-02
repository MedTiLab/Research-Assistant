# NHANES Local Workflow

Use the workflow in `SKILL.md`. This reference exists for quick copy/paste when an agent needs exact fallback commands.

## Priority

1. API: `GET /api/v1/sources`, `POST /api/v1/variables/query`, sidecar `/manifest`, `/search`, `/resolve`, `/schema`, `/extract`.
2. Local files: `../Web_database/database/query/sources/nhanes` and `../Web_database/database/data/sources/nhanes`.
3. Official CDC public-use data and documentation: `https://wwwn.cdc.gov/nchs/nhanes/default.aspx` through `scripts/fetch_official_codebooks.py`.
4. User upload for restricted or absent files.

Do not use official downloads before checking API and local files. If public NHANES row-level data is missing locally, the official download step is mandatory.

## Base Detection

```bash
BASE=""
for u in "$MEDHELP_DATABASE_API_URL" http://127.0.0.1:8787 http://127.0.0.1:8878; do
  [ -n "$u" ] && curl -fs -m 3 "$u/api/v1/health" >/dev/null 2>&1 && { BASE="$u"; break; }
done
echo "BASE=$BASE"
```

## Local Paths

```bash
WEBDB_ROOT="${MEDHELP_LOCAL_DATABASE_APP_ROOT:-../Web_database}"
QUERY_NHANES="$WEBDB_ROOT/database/query/sources/nhanes"
DATA_NHANES="$WEBDB_ROOT/database/data/sources/nhanes"
OFFICIAL_STAGE="$DATA_NHANES/official_downloads"
```

Useful files:

- `$QUERY_NHANES/00_indexes/nhanes_ai_dictionary.csv`
- `$QUERY_NHANES/00_indexes/nhanes_variable_index.csv`
- `$QUERY_NHANES/00_indexes/nhanes_cross_cycle_guardrails.csv`
- `$QUERY_NHANES/metadata/`
- `$DATA_NHANES/analysis_data/`
- `$DATA_NHANES/raw_data/`
- `$DATA_NHANES/matrix_data/`

## Official CDC Data And Documentation Pulls

The script parses official CDC component pages and saves public-use XPT data and Doc/codebook HTML with source URLs in a manifest.

List candidate official Docs:

```bash
python3 skills/nhanes-skill/scripts/fetch_official_codebooks.py \
  --components Questionnaire Examination Laboratory Demographics Dietary \
  --years 2017-2018 2017-2020 2021-2023 \
  --datasets BPQ_J P_BPQ BPQ_L
```

Download selected multi-year Docs:

```bash
python3 skills/nhanes-skill/scripts/fetch_official_codebooks.py \
  --components Questionnaire \
  --years 2017-2018 2017-2020 2021-2023 \
  --datasets BPQ_J P_BPQ BPQ_L \
  --download-docs \
  --download-dir "$OFFICIAL_STAGE"
```

Download missing official row-level data plus its Doc/codebook:

```bash
python3 skills/nhanes-skill/scripts/fetch_official_codebooks.py \
  --components Examination \
  --years 2017-2018 \
  --datasets BMX_J \
  --download-data \
  --download-docs \
  --download-dir "$OFFICIAL_STAGE" \
  --manifest-out "$OFFICIAL_STAGE/BMX_J-manifest.json"
```

Search across many cycles for Docs containing a variable:

```bash
python3 skills/nhanes-skill/scripts/fetch_official_codebooks.py \
  --components Questionnaire Examination Laboratory Demographics Dietary \
  --years 1999-2000 2001-2002 2003-2004 2005-2006 2007-2008 2009-2010 2011-2012 2013-2014 2015-2016 2017-2018 2017-2020 2021-2023 \
  --variable BPQ020 \
  --max-docs 0 \
  --download-docs \
  --download-dir "$OFFICIAL_STAGE"
```

The broad variable scan downloads many official pages. Narrow by `--datasets` when known; use `--max-docs 0` only when an all-matching-docs scan is intentional.

Use the downloaded Doc/codebook to verify:

- categorical code labels, skip-to fields, missing codes, and whether numeric codes are ordinal;
- continuous units, target population, analytic notes, and valid ranges;
- cycle-specific wording or variable replacements such as renamed 2021-2023 variables.
