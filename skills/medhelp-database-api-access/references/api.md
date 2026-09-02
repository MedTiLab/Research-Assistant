# MedHelp Database API — Remote Contract

This reference covers managed MedHelp App agents and independent external
agents using the public MedHelp database API.

## 1. Base And Token

MedHelp App sessions set `MEDHELP_MANAGED_AGENT_SESSION=1` and inject the
backend-verified Connector state as `MEDHELP_DATABASE_API_CONNECTION_STATUS`.
Only `connected` is usable. The backend then injects
`MEDHELP_DATABASE_API_URL` and `MEDHELP_DATABASE_API_TOKEN`. The AI must not
independently judge PAT validity; never print, echo, log, or commit the token.

Remote default:

```bash
export MEDHELP_DATABASE_API_URL="${MEDHELP_DATABASE_API_URL:-https://api.medtimehelp.com}"
BASE="$MEDHELP_DATABASE_API_URL"
```

Before public API calls in a managed session, require the code-owned connection
state and then the injected token:

```bash
test "${MEDHELP_DATABASE_API_CONNECTION_STATUS:-}" = "connected"
test -n "$MEDHELP_DATABASE_API_TOKEN" || test -n "$DATABASE_API_TOKEN"
```

If the managed status is not `connected`, stop and report its exact value. Do
not inspect the PAT or infer validity from logs. If status is `connected` but no
token exists, report a Connector credential-injection inconsistency. Never ask
the user to paste it and never search local databases, browser storage, Kernel
logs, session metadata, or session tokens.

For an independent external agent, require the operator to configure the token
outside chat through the process environment or a protected secret store.

```text
请在“设置 → 连接器 → 数据库 API”完成“连接并保存”。只有后端返回“已连接”后 Agent 才能继续；无需在对话中粘贴 PAT。
```

Use:

```bash
AUTH=(-H "Authorization: Bearer ${MEDHELP_DATABASE_API_TOKEN:-$DATABASE_API_TOKEN}")
```

Never print, echo, log, or commit the token.

### Startup Permission Check

After token setup, immediately call this before any query, extract, export, or
download. This check is mandatory for each new Bearer token/session:

```bash
python3 skills/medhelp-database-api-access/scripts/local_db_api.py \
  api-permissions \
  --base-url "$BASE"

# Manual curl on macOS/Linux
curl -sS --noproxy api.medtimehelp.com "$BASE/api/v1/sources" "${AUTH[@]}"
```

On Windows HTTPS, the bundled client defaults to the native `curl.exe`
transport with `--ssl-no-revoke`. This avoids Schannel failures when a proxy or
firewall blocks CRL/OCSP access while retaining certificate-chain and hostname
verification. For manual calls use `curl.exe --ssl-no-revoke`, not the
PowerShell `curl` alias, and add `--noproxy api.medtimehelp.com`. Never use `-k`
or `--insecure`. Use `--transport urllib` only when Python TLS works or
organizational policy requires revocation checks.

The API is a direct mainland-China endpoint. The bundled client defaults to
`--proxy-mode direct`, which ignores `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`,
and operating-system proxy configuration. Use `--proxy-mode system` only when
the operator explicitly requires a proxy. Add `--noproxy api.medtimehelp.com`
to every manual curl call.

The returned `/api/v1/sources` list is the authoritative allow-list for the
current Bearer token. Only those source IDs can be searched, extracted,
exported, or downloaded with that token, subject to the query-only exception
for `gco`. As of 2026-08-27 the catalog has 29 sources: 28 extractable sources
plus `gco`. Do not
rely on the static catalog when deciding what is accessible.

Permission groups currently configured on the API:

| Group id | Label | Sources |
| --- | --- | --- |
| `icu` | ICU / EHR | `mimiciii`, `mimiciv`, `mimiciv31`, `nwicu`, `eicu`, `sicdb`, `pic` |
| `aging` | 老年队列 | `charls`, `clhls`, `elsa`, `hrs`, `klosa`, `lasi`, `mhas`, `share` |
| `class` | CLASS 老年数据库 | `class` |
| `perioperative` | 围术期医学数据库 | `inspire` |
| `nhanes` | NHANES | `nhanes` |
| `gshs` | GSHS 青少年健康调查 | `gshs` |
| `ukb` | UK Biobank | `ukb` |
| `family_finance` | 家庭金融社会营养 | `cfps`, `cgss`, `css`, `chfs`, `chip`, `clds`, `chns` |
| `gco` | GCO 肿瘤数据库 | `gco` |
| `seer` | SEER 肿瘤登记数据库 | `seer` |

Interpret group status this way:

| Status | Meaning | Download decision |
| --- | --- | --- |
| `full` | All group sources are returned by `/api/v1/sources`. | The whole group is downloadable. |
| `partial` | Only some group sources are returned. | Only those returned sources are downloadable; the group's missing sources are forbidden. |
| `none` | No source from the group is returned. | Nothing from that group is downloadable. |

Agents should keep and report:

```text
可下载 = allowedSources / downloadAllowed
不可下载 = downloadDenied
按组权限 = permissionGroups[].status + allowedSources + deniedSources
```

If a full login/session token can call `GET /api/auth/status`, read
`user.databaseAccess`, `user.databaseAccessSummary`, and `permissionGroups` for
account-level context. PAT/data tokens may not be able to call auth endpoints
and may be narrower than the account grant. For download decisions, the
`/api/v1/sources` response for the current token always wins.

Forbidden database requests return `403` with code `DATABASE_ACCESS_DENIED`.
When this happens, do not retry the same source blindly; ask an admin to add the
needed group/source or mint a broader PAT.

Before a download, inspect or remember the dataset's source(s). If any dataset
source is absent from `allowedSources`, do not attempt the download; tell the
user which source/group is missing.

## 2. Remote Endpoint

```text
Public API base: https://api.medtimehelp.com

When no API URL is explicitly configured, the bundled client checks the public
deployment first. It falls back to `http://127.0.0.1:8787` only if the public
health endpoint is unavailable and the loopback health endpoint is healthy.
An explicitly injected/configured URL is authoritative and is not overridden.
```

Internal server paths and secret-file locations do not belong in the remote
agent contract. Use the separate local-access skill for trusted same-host work.

## 3. High-Level Surface A

Use `/api/v1/*` by default.

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/health` | service info |
| `GET /api/v1/openapi.json` | OpenAPI document |
| `GET /api/v1/sources` | list sources allowed for the current token |
| `GET\|POST /api/v1/variables/query` | ranked candidates |
| `GET\|POST /api/v1/coding/query` | resolve one variable against all published coding references for one source |
| `GET /api/v1/coding/docs/{id}?source=&offset=` | read a matched reference in pageable text form |
| `POST /api/v1/extract` | build stored downloadable dataset |
| `POST /api/v1/datasets/build` | alias for extract |
| `POST /api/v1/export` | queue a background complete CSV/Parquet export |
| `GET /api/v1/export/{id}` | inspect background export status/progress |
| `POST /api/v1/export/{id}/retry` | retry a failed export request |
| `GET /api/v1/datasets` | list datasets |
| `GET /api/v1/datasets/{id}` | inspect dataset |
| `GET /api/v1/datasets/{id}/download` | stream CSV or Parquet; HTTP Range is supported |
| `GET /api/v1/ehr/catalogs` | list ICU/EHR SQL catalogs |
| `POST /api/v1/ehr/sql` | preview guarded ICU/EHR SQL |
| `POST /api/v1/ehr/sql/export` | export guarded SQL as dataset |
| `GET /api/v1/gco/metadata` | list/search GCO, GLOBOCAN, CI5plus, and HDI metadata |
| `POST /api/v1/gco/query` | run guarded read-only GCO queries; query-only, no dataset download |

## 4. Low-Level Surface B

Use only for file/column verification.

| Method and path | Purpose |
| --- | --- |
| `POST /search` | raw ranked search |
| `POST /search/batch` | multiple terms |
| `GET /resolve?source=&file=` | resolve a data key |
| `GET /schema?source=&file=&object=` | inspect real columns |
| `POST /extract` with JSON `source`, `file`, `columns: [...]`, `limit`, `format` | rows from one file; preserves punctuation in column names |
| `GET /manifest?source=` | source manifest |
| `GET /docs?q=&source=` | search retrievable codebooks and reference documents |
| `GET /docs/{id}` | retrieve one codebook/document; use `format=text&offset=` for pageable text, including PDFs |

These paths have no `/api/v1` prefix.
Legacy GET `/extract` accepts comma-separated `columns`; do not use it for
literal names containing commas. The bundled `extract` command now sends POST
JSON arrays, including when using legacy simple-code CLI input.

## 5. Variable Search

Variable discovery is a minimum three-pass operation, not a single request:

1. exact/original-language terms;
2. bilingual Chinese-English synonyms, expanded abbreviations, clinical and
   statistical variants;
3. source-native table/module/instrument/wave terms with relevant `kind`
   variants.

Use at least two materially different query expressions per pass for each
critical concept (normally six or more total). Do not stop after the first hit.
If results conflict or remain sparse, add a fourth broader/documentation pass.
Record every exact query, source, `kind`, hit count, accepted/rejected candidate,
and reason, then deduplicate by source + physical field/table + wave/version.
Only freeze the variable manifest after this audit.

```bash
curl -sS --noproxy api.medtimehelp.com -X POST "$BASE/api/v1/variables/query" \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"query":"血压 blood pressure","source":"charls","limit":20}'
```

Fields:

| Field | Meaning |
| --- | --- |
| `query` | required keywords |
| `source` | one source id |
| `sources` | array of ids |
| `limit` | total candidate cap |
| `perSourceLimit` | per-source cap |
| `kind` | `auto`, `dictionary`, `variables`, `datasets`, `documents`, `concepts`, `joins`, `guardrails`, `overview` |
| `match` | `all` or `any` |

### Complete coding lookup

After selecting any categorical variable, call the generic coding endpoint.
It uses the variable index to expand codes, physical columns, labels, and
aliases, then searches every published codebook, questionnaire, dictionary,
and reference document for that source. It does not depend on a per-database
document path or a per-variable mapping.

```bash
curl -sS --noproxy api.medtimehelp.com -X POST "$BASE/api/v1/coding/query" \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"source":"charls","variable":"rafinacom","limit":20}'
```

Inspect `attached_value_labels`, `document_hits[].snippets`, and
`coding_status`. A document hit includes an authorized high-level `text_url`;
request later pages from `/api/v1/coding/docs/{id}` with the same `source` and
`offset=<next_offset>` until `eof=true` when more context is needed.
If `coding_status=not_found`, mark the definition/direction unverified. Do not
add a one-off mapping or infer direction from numeric order.

## 6. Dataset Build And Download

Keep these routes distinct:

| Route | Sample parameter | Result |
| --- | --- | --- |
| `POST /api/v1/extract` | `rowCap` | Stored dataset in `dataset` (or per-source `datasets`) and a download URL |
| `POST /api/extract` | `rows` | Web preview: `columnNames`, row objects in `rows`, and source capabilities |
| `POST /extract` | `limit` | One-file verification: `columns` and `records`; `format: "csv"` returns CSV |

Connectivity and regression checks use **2 or 20 real rows**. Do not remove
those caps to get a multi-file join to succeed. For a user-requested complete
result, use background `/api/v1/export` with no `rowCap`. A capped preview is
not a complete result. The default 10,000-row ceiling belongs to the web
preview, not a general limit on background exports.

### Exact file and literal column selection

Freeze source, file, requested column spelling, wave/version and table grain
after discovery and `/schema`. Prefer a verified `parquet_rel` or
`extract_hint.file`; directory names alone are not wave evidence. Use top-level
`file` for one file, or a `selected` JSON array of `{"file": "...", "column":
"..."}` objects. Each object names one field in one file. Do not collapse
different waves by code, lowercase names, or strip punctuation/embedded labels
from physical columns.

The client supports `--file` on `build` and `export`, repeated `--column` for
literal strings, and `--selection-file` for a UTF-8 JSON array of strings or
`{file,column}` objects. These selection modes are mutually exclusive. The
low-level `extract` command accepts only strings in its selection file.
Legacy `--selected` / `--columns` remain comma-separated shorthand for simple
codes; they cannot represent a comma inside a single column name.

```bash
python3 skills/medhelp-database-api-access/scripts/local_db_api.py build \
  --base-url "$BASE" --source elsa \
  --file 'raw_data/original/ELSA/wave2/wave_2_nurse_data_v2.parquet' \
  --column hscrp --column trig --row-cap 2

python3 skills/medhelp-database-api-access/scripts/local_db_api.py build \
  --base-url "$BASE" --source charls --file 'analysis_data/charls.parquet' \
  --column 'total_cognition (认知能力(0~21分,越大越好))' \
  --column 'cesd10 (心理健康(30分,越大越差))' --row-cap 2
```

For large lists or names containing quotes/newlines, write the exact array
with a JSON serializer to `selection.json`, then pass `--selection-file
selection.json`. Do not construct CSV strings or shell-interpolate field names.

### Multi-file and multi-wave boundaries

- Same-code fields in different files/waves remain separate selections. Check
  every selected file's schema, keys, coding/version and bounded sample.
- Distinguish wide person-level records from repeated person-wave records.
  For module joins, supply the complete verified key as `join_on: [...]` (or
  repeat the client's `--join-on` once per key). Every requested key must exist
  in every input. A missing wave key must not be reduced to person ID alone.
- The first selected file is the left-join anchor. Retain its unmatched rows;
  empty identifiers do not match. Check key uniqueness, overlapping non-key
  columns and expected row counts. Never stitch separate batches by row order.
- Independently truncated inputs cannot be safely joined. Recheck each file
  separately; complete-data joins are a distinct, user-scoped export, not a
  way to bypass the sample caps.
- Current support: one physical file can export CSV or supported Parquet;
  multiple physical files can assemble CSV only, subject to the join checks.
  Multiple-file Parquet or an unavailable Parquet worker fails explicitly.
  Do not silently change format or rename CSV as Parquet. Separate single-file
  exports are preferable to a large in-memory multi-file CSV assembly.

Explicit variables:

```bash
curl -sS --noproxy api.medtimehelp.com -X POST "$BASE/api/v1/extract" \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"source":"nhanes","selected":["BMXBMI"],"projectName":"nhanes_bmi_demo","rowCap":100}'
```

Query-to-dataset (exploratory routing, not a replacement for a frozen explicit
file/field manifest when waves or multiple requested variables matter):

```bash
curl -sS --noproxy api.medtimehelp.com -X POST "$BASE/api/v1/extract" \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"query":"BMI","source":"nhanes","variablesPerSource":1,"projectName":"nhanes_bmi_demo","rowCap":100}'
```

Download:

```bash
curl -L --noproxy api.medtimehelp.com "${AUTH[@]}" -o dataset.csv "$BASE/api/v1/datasets/<dataset_id>/download"
```

Inspect `id`, `downloadUrl`, `columnNames`, `rows`, `unresolved`, `errors`,
`sourceCapabilities.selected.physicalFiles`, `joinedOn`, applied filters and
truncation warnings. For background jobs use `job.dataset.column_names`,
`total_rows` and `source_capabilities`; do not confuse these with web preview
row objects. Check top-level and every per-source error for multi-source builds.

Decode the downloaded CSV/Parquet, compare **every requested name exactly**,
preserve identifiers/leading zeros, and compare bounded values with the same
physical file (accounting for documented numeric precision/null handling).
Check actual format, not just extension: a Parquet download must decode as
Parquet. HTTP 200, nonempty bytes, or `job.status=complete` alone is insufficient.
Zero rows can be legitimate with verified columns/filters; missing columns,
an identifier-only result when measurements were requested, or an empty schema
for a nonempty selection cannot be accepted as success.
The dataset source must still be allowed for the current token at download time;
otherwise the API returns `403 DATABASE_ACCESS_DENIED`.

| Rejection code | Response |
| --- | --- |
| `AMBIGUOUS_VARIABLE`, `COLUMN_NOT_RESOLVED`, `UNRESOLVED_VARIABLES` | Inspect the actual file/schema; qualify the requested file. Never pick the first match or drop the field. |
| `DUPLICATE_COLUMN_SELECTION` | Select each physical column once; aliases such as `ID` and `id` must not silently collapse. |
| `MISSING_JOIN_KEYS`, `UNSAFE_MULTI_FILE_JOIN` | Verify table grain and every person/wave key, or export files separately. |
| `TRUNCATED_MULTI_FILE_JOIN` | Keep sample caps; inspect files independently instead of joining truncated inputs. |
| `NON_UNIQUE_JOIN_KEYS`, `OVERLAPPING_JOIN_COLUMNS` | Resolve duplicate composite keys/ambiguous measurements explicitly; do not overwrite or deduplicate automatically. |
| `TOO_MANY_VARIABLES` | Current limit is 200 selected variables per source. Split explicitly with a coverage manifest and verified keys; never truncate the selection. |
| `INCOMPLETE_EXTRACTION` | Treat as a failed extraction, even if partial artifacts exist; do not advertise a successful download. |
| `UNSUPPORTED_PARQUET_EXPORT` | Use supported separate single-file Parquet or an agreed CSV result. Do not retry unchanged or change format silently. |

### Background complete export

One physical input file supports direct CSV and Parquet export, including CSV
output from a Parquet source file. Honor the user's format choice; use CSV for
readable tabular exchange or Parquet for large, typed analysis datasets.
After checking the intended file, queue its complete export by omitting
`rowCap`; do not omit it during connectivity/regression testing. This example
requests CSV; set `format` to `parquet` when Parquet is wanted:

```bash
curl -sS --noproxy api.medtimehelp.com -X POST "$BASE/api/v1/export" \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"source":"elsa","file":"raw_data/original/ELSA/wave2/wave_2_nurse_data_v2.parquet","selected":["hscrp","trig"],"projectName":"elsa_w2_nurse_full","format":"csv"}'
```

The bundled client can queue, poll, and stream the file in one command. Choose
one format, and keep the output extension consistent with it:

```bash
python3 skills/medhelp-database-api-access/scripts/local_db_api.py export \
  --base-url "$BASE" --source elsa \
  --file 'raw_data/original/ELSA/wave2/wave_2_nurse_data_v2.parquet' \
  --column hscrp --column trig --format csv --wait -o elsa_w2_nurse.csv
```

Or, for Parquet:

```bash
python3 skills/medhelp-database-api-access/scripts/local_db_api.py export \
  --base-url "$BASE" --source elsa \
  --file 'raw_data/original/ELSA/wave2/wave_2_nurse_data_v2.parquet' \
  --column hscrp --column trig --format parquet --wait -o elsa_w2_nurse.parquet
```

The response is `202` with `job.id`. Poll until `job.status` is `complete`:

```bash
curl -sS --noproxy api.medtimehelp.com \
  "$BASE/api/v1/export/<job_id>" "${AUTH[@]}"
```

Retry only a failed job:

```bash
curl -sS --noproxy api.medtimehelp.com -X POST \
  "$BASE/api/v1/export/<job_id>/retry" "${AUTH[@]}"
```

The DuckDB `1GB` setting limits working memory, not output size or row count.
The worker can spill to disk and write files larger than 1GB, and it exits after
success/failure rather than when the result reaches 1GB. Stream the completed
download to disk and resume partial transfers with HTTP Range. Do not read a
large response body into Python/Node memory.

The single-file DuckDB memory bound does not describe the multi-file CSV
assembly path, which can materialize rows in the Node process.

Pass `--format csv` or `--format parquet` explicitly. The client's existing
default remains Parquet for compatibility; CSV is equally supported for a
single-file export. Do not require a Parquet download before producing CSV.
Only when an existing Parquet download needs conversion, use:

```bash
python3 skills/medhelp-database-api-access/scripts/local_db_api.py \
  parquet-to-csv dataset.parquet -o dataset.csv --memory-limit 1GB
```

CSV can be larger and does not retain column types. Keep schema information
and import identifiers as text to preserve leading zeros. The optional
conversion uses DuckDB COPY with bounded memory and disk spill; it does not
load the full table into pandas. Do not create both formats unless wanted.

## 7. ICU/EHR SQL Export

Supported source ids:

```text
mimiciii  mimiciv  mimiciv31  eicu  sicdb  inspire  nwicu  pic
```

Default export behavior is full extraction. Use `limit` only for preview or
when the user explicitly asks for a capped sample. Do not send `limit`,
`rowLimit`, `row_limit`, `rowCap`, or `row_cap` to
`/api/v1/ehr/sql/export` for MIMIC/eICU/SICdb/INSPIRE/NWICU/PIC production extraction.
Omitting `limit` (or using `all`/`full`/`unlimited`/`全量`) means no
API-imposed row cap.

Queue control for ICU/EHR exports: full extraction should happen after
ICD/diagnosis cohort narrowing. First build a cohort from the source's
diagnosis/ICD table, preview it, then join large event tables to that cohort
before export/download. Do not enqueue broad `chartevents`, `labevents`,
`vitalPeriodic`, or similar event-table downloads unless an ICD/diagnosis
cohort or another user-approved cohort filter is already in the SQL.

Catalogs:

```bash
curl -sS --noproxy api.medtimehelp.com "$BASE/api/v1/ehr/catalogs" "${AUTH[@]}"
```

Preview:

```bash
curl -sS --noproxy api.medtimehelp.com -X POST "$BASE/api/v1/ehr/sql" \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"source":"pic","sql":"select SUBJECT_ID, HADM_ID, ICUSTAY_ID from pic_raw.ICUSTAYS","limit":5}'
```

Export:

```bash
curl -sS --noproxy api.medtimehelp.com -X POST "$BASE/api/v1/ehr/sql/export" \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"source":"mimiciv31","sql":"with cohort as (select distinct subject_id, hadm_id from mimiciv_hosp.diagnoses_icd where icd_code like '\''I50%'\'') select i.subject_id, i.hadm_id, i.stay_id, i.intime, i.outtime from mimiciv_icu.icustays i join cohort c using (subject_id, hadm_id)","projectName":"mimiciv31_icd_cohort_icustays"}'
```

Then download via the returned `dataset.downloadUrl`.

Common relations:

```sql
mimiciii_raw.DIAGNOSES_ICD
mimiciii_raw.ICUSTAYS
mimiciii_raw.CHARTEVENTS
mimiciii_raw.LABEVENTS

mimiciv_hosp.diagnoses_icd
mimiciv_icu.icustays
mimiciv_icu.chartevents
mimiciv_hosp.labevents

eicu_raw.diagnosis
eicu_raw.patient
eicu_raw.lab
eicu_raw.vitalPeriodic

nwicu_hosp.diagnoses_icd
nwicu_icu.icustays
nwicu_icu.chartevents
nwicu_hosp.labevents

pic_raw.DIAGNOSES_ICD
pic_raw.ICUSTAYS
pic_raw.CHARTEVENTS
pic_raw.LABEVENTS
```

Only `SELECT` and `WITH` are accepted. Add ICD/diagnosis cohort filters first,
then item/table/time filters for large event tables.

## 8. Python Client

```bash
python3 skills/medhelp-database-api-access/scripts/local_db_api.py \
  api-permissions \
  --base-url https://api.medtimehelp.com
```

If token is missing for the public base, the client prompts securely.

Transport selection:

- `--transport auto` (default): use `curl.exe --ssl-no-revoke` for Windows
  HTTPS and Python `urllib` elsewhere.
- `--transport urllib`: require Python's TLS stack.
- `--transport curl`: force curl; `--ssl-no-revoke` is added only for Windows
  HTTPS.
- `--proxy-mode direct` (default): ignore system and environment proxies.
- `--proxy-mode system`: explicitly use system/environment proxy settings.

The client selects the Windows transport before sending the real request. Do
not implement an automatic retry of a mutating build/export POST after
`UNEXPECTED_EOF_WHILE_READING`, because the server may already have accepted
the first request.

## 9. Result Field Glossary

Data-key fields: `extract_hint.file`, `parquet_rel`, `data_path`, `source_rel_path`, `dataset_path`, `file_path`, `path`, `source_file`, `data_paths`.

Extractable variable/column fields: `extract_hint.columns`, `physical_column`, `preferred_name`, `variable_name`, `source_variable_name`, `field_id`, `colname`, `column_name`, `raw_column_name`, `code`.

Label-only fields: `description_best`, `variable_label`, `label_text`, `label`, `title`, `description`, `notes`.

Never extract a label as a column without schema evidence.

### Coding and missing-value evidence

Search custom coding metadata with `kind=dictionary`. The index includes
dictionary-like files such as `.codebook`, `labels.csv`, `value_labels.csv`,
and `coding*.tsv`; `/docs` is the retrievable-document path.

For Stata-backed survey data, keep these outputs distinct:

1. original DTA/codebook variable and value-label definitions;
2. actual frequencies in the current Parquet/download;
3. missingness after conversion.

Raw DTA schema responses can include `variable_labels`,
`variable_value_labels`, `stata_extended_missing_values`, and
`missing_value_note`. Raw DTA extraction preserves `.`, `.a` through `.z` when
present. If Parquet conversion already collapsed extended missing values to
`null`, the letter-specific meaning cannot be reconstructed. Never infer an
exposure/reference direction from numeric order or from those nulls.

## 10. Maintenance

This remote access skill does not authorize service restart, index rebuild,
credential-file access or account changes. Report persistent contract/index
failures to the maintainer with source, file, fields, request shape and error
code; exclude credentials and participant values. Do not point remote agents
at workstation paths or tell them to obtain internal signing secrets.

For an explicitly authorized maintainer, extraction changes must use the
server repository's `scripts/deploy_to_medtimehelp.sh`: local regression gate,
staged-server gate, restart, health/auth checks and authenticated 2/20-row public
acceptance. A staged-only run is not a completed release. Updating a wave-index
generator alone does not update existing indexes; rebuild them with reviewed
backups and recheck public search-to-extraction separately.

## 11. Reporting Checklist

Report:

- source id
- startup permission check result: allowed sources and denied sources relevant to the request
- endpoint and API surface
- complete three-pass query audit (pass, language, exact query, source, `kind`, hit count, accepted/rejected candidates, reason)
- resolved file or SQL relation
- ICD/diagnosis cohort table and code definition for ICU/EHR exports
- verified columns
- row limit only if the user explicitly requested one
- dataset id
- download URL/path
- token was configured, without revealing it
- warnings about wave/cycle/weights/join keys/time windows/table grain
