---
name: medhelp-database-api-access
description: "Use for MedHelp's remote database API from a MedHelp App agent or another computer: verify Connector/token permissions, route sources, inspect codebooks and Stata labels, preview bounded rows, run background full CSV/Parquet exports, resume downloads, or export ICU/EHR SQL."
---

# MedHelp Database API Access And Router

This skill is the shared access layer for source-specific skills and
the query-only GCO workflow. It is for the public MedHelp database API, with a
checked same-host fallback. It supports two distinct runtime modes:

- **Managed MedHelp App agent:** backend Connector code verifies the current
  account first, then injects the `connected` state, URL, and PAT into that
  account's agent environment.
- **Independent external agent:** the operator configures a PAT in the process
  environment before starting the agent.

This is the unified MedHelp database access/router skill. Use its managed
Connector mode in MedHelp App sessions or its explicitly configured Bearer-token
mode for independent agents.

## Endpoint Priority

Use endpoints in this order:

1. An explicitly injected/configured `MEDHELP_DATABASE_API_URL` or `DATABASE_API_URL`.
2. The public deployment `https://api.medtimehelp.com`.
3. Only when the public health endpoint is unavailable and a same-host service is healthy, `http://127.0.0.1:8787`.

The bundled client performs this public-first selection automatically. Never
send a remote Bearer token to an arbitrary fallback host. Loopback is the only
automatic fallback, and explicit managed Connector configuration is never
silently overridden.

## 0. Required First Step: Connector State, Then Token

When this skill runs inside a MedHelp App agent session, the App injects
`MEDHELP_MANAGED_AGENT_SESSION=1` plus the Connector-owned state
`MEDHELP_DATABASE_API_CONNECTION_STATUS`. The App backend, not the AI, verifies
the PAT against `/api/v1/sources`. Only `connected` is usable. A connected
session also receives `MEDHELP_DATABASE_API_URL` and
`MEDHELP_DATABASE_API_TOKEN`; never print, echo, log, or commit them.

Before any remote API call, check for a token:

```bash
export MEDHELP_DATABASE_API_URL="${MEDHELP_DATABASE_API_URL:-https://api.medtimehelp.com}"
test "${MEDHELP_DATABASE_API_CONNECTION_STATUS:-}" = "connected"
test -n "$MEDHELP_DATABASE_API_TOKEN" || test -n "$DATABASE_API_TOKEN"
```

If neither token variable is set, branch by runtime mode.

### Managed MedHelp App session

If `MEDHELP_MANAGED_AGENT_SESSION=1`, read the Connector status first. Do not
test the PAT yourself or infer its validity from logs, error wording, or the
presence of a saved value.

- `connected`: proceed only if the injected token is also present.
- `not_configured` or `unverified`: stop and ask the user to connect it in
  Settings.
- `invalid_credentials`, `access_denied`, `unavailable`, or
  `invalid_response`: stop and report that exact Connector-owned state.
- missing status: stop and report an outdated/broken Connector injection path.

For every non-connected state, **do not ask the user to paste the PAT into
chat.**
Do not search local `auth.db`, browser storage, Kernel logs, session metadata,
`cloud-auth.json`, or process logs for a PAT or local-session token. Those are
different credentials and reading them cannot repair cloud account injection.

If the status is `connected` but both token variables are absent, stop the
database call and report a credential-injection inconsistency:

```text
数据库连接器状态为“已连接”，但当前 Agent 未收到已验证凭据。这是账户凭据注入故障；请重试会话，无需再次粘贴 PAT。
```

### Independent external agent

If the managed-session marker is absent, tell the operator to configure
`MEDHELP_DATABASE_API_TOKEN` in the agent process environment or a protected
secret store, then restart/retry the agent. Do not ask for the PAT in chat and
do not place a literal PAT in a command, source file, report, or committed
configuration.

After the operator has configured the secret out of band:

```bash
test -n "$MEDHELP_DATABASE_API_TOKEN" || test -n "$DATABASE_API_TOKEN"
AUTH=(-H "Authorization: Bearer ${MEDHELP_DATABASE_API_TOKEN:-$DATABASE_API_TOKEN}")
BASE="${MEDHELP_DATABASE_API_URL:-https://api.medtimehelp.com}"
```

Do not call the public API without a token. Do not print, echo, log, or commit
the token.

### Required Startup Permission Check

After the managed Connector says `connected` (or an independent operator has
configured a token), fetch the current source permission list. This call
determines data scope, not whether the AI thinks the PAT is valid. Do not
search, extract, export, list download choices, or download anything until this
check has produced the allow-list.

```bash
# Prefer the bundled client. On Windows HTTPS it automatically uses
# curl.exe --ssl-no-revoke; elsewhere it uses Python's TLS stack. It bypasses
# HTTP_PROXY/HTTPS_PROXY/ALL_PROXY on every platform.
python3 skills/medhelp-database-api-access/scripts/local_db_api.py \
  api-permissions \
  --base-url "$BASE"

# Manual curl on macOS/Linux:
curl -sS --noproxy api.medtimehelp.com "$BASE/api/v1/sources" "${AUTH[@]}"
```

On Windows, use `curl.exe`, not the PowerShell `curl` alias, and add
`--ssl-no-revoke` to every manual API call:

```powershell
curl.exe --silent --show-error --ssl-no-revoke --noproxy api.medtimehelp.com `
  "$env:MEDHELP_DATABASE_API_URL/api/v1/sources" `
  -H "Authorization: Bearer $env:MEDHELP_DATABASE_API_TOKEN"
```

`--ssl-no-revoke` disables only Schannel's certificate-revocation lookup;
certificate-chain and hostname verification remain enabled. Never replace it
with `-k` or `--insecure`. If organizational policy requires revocation checks,
fix proxy/CRL/OCSP access and force the bundled client to use Python TLS with
`--transport urllib` instead.

The API is a direct mainland-China endpoint. Ignore `HTTP_PROXY`,
`HTTPS_PROXY`, `ALL_PROXY`, and Windows system proxy settings for all API
requests. The bundled client defaults to `--proxy-mode direct`; only use
`--proxy-mode system` when the operator explicitly requires a proxy. For manual
curl calls, always add `--noproxy api.medtimehelp.com`.

Treat the returned `/api/v1/sources` source IDs as the authoritative access
allow-list for the current Bearer token. Do not assume that all
29 cataloged sources (28 extractable sources plus the query-only `gco` source,
as of 2026-08-27)
are available just because they exist in this skill. Cache these four values
for the rest of the task:

```text
ALLOWED_SOURCES = sources returned by /api/v1/sources
DENIED_SOURCES = all known MedHelp sources minus ALLOWED_SOURCES
DOWNLOAD_ALLOWED = ALLOWED_SOURCES minus query-only sources such as gco
GROUP_STATUS = full / partial / none for each permission group below
```

If the same token can call `GET /api/auth/status`, its `user.databaseAccess`,
`user.databaseAccessSummary`, and `permissionGroups` fields can explain the
account-level grant. A PAT/data token may be narrower than the user's account
and may not be allowed to call auth endpoints, so `/api/v1/sources` remains the
startup permission source of truth.

Current permission groups and download boundaries:

| Group id | Label | Source IDs in the group |
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

Group status rules:

| Status | Meaning | What can be downloaded |
| --- | --- | --- |
| `full` | Every source in that group appears in `ALLOWED_SOURCES`. | All source IDs in that group. |
| `partial` | Some but not all source IDs in that group appear in `ALLOWED_SOURCES`. | Only the listed `allowedSources`; never the group's `deniedSources`. |
| `none` | No source IDs in that group appear in `ALLOWED_SOURCES`. | Nothing from that group. |

Download rule: a source can be searched, extracted, exported, or downloaded
only when it appears in the startup source list for the current token. If a
request names a forbidden source, the API returns `403` with code
`DATABASE_ACCESS_DENIED`. For partial-permission tokens, constrain source
pickers, `sources` arrays, ICU/EHR SQL exports, dataset builds, and downloads to
the allowed list. If the startup list is empty, stop and ask the admin to grant
database permissions or issue a broader PAT.

At the start of every task that can touch data, report the permission boundary
briefly before doing API work:

```text
当前 API 权限：
- 可下载：<allowed source ids, grouped if useful>
- 不可下载：<denied source ids or groups>
- 本次只会查询/导出/下载 allowedSources 内的数据。
```

If the user asks for a forbidden database or a forbidden group, do not silently
fall back to another source. Say which requested source is blocked and which
admin action is needed, for example: "当前 PAT 没有 `ukb` 权限，不能下载 UK
Biobank；需要管理员给该账号/PAT 增加 `ukb` 权限或重新签发更宽的 PAT。"

## 1. Remote Endpoint

Remote agents need only the public endpoint. Internal service paths and secret
file locations are deliberately outside this user-facing skill.

```text
Public API base: https://api.medtimehelp.com
```

Remote agents use `https://api.medtimehelp.com` plus Bearer auth. Only the
separate same-host local-access skill may use a trusted loopback endpoint.

## 2. Route First

Build a small decision queue before calling the API.

1. **Intent**
   - `route`: source IDs only
   - `variable_lookup`: fields, labels, variables
   - `dataset_lookup`: files, tables, modules, cycles, waves
   - `schema_check`: confirm real columns
   - `extract`: stored downloadable dataset
   - `ehr_sql_export`: ICU/EHR long-table SQL export
   - `compare`: search several sources and report best fit

2. **Source queue**
   - User named a database -> put that source first.
   - User named a topic -> choose 2-6 likely sources from the Source Matrix below.
   - Topic vague -> start by source family, not the entire catalog.
   - Then filter the queue through `ALLOWED_SOURCES`. Remove forbidden sources
     before query/build/export. If every requested source is forbidden, stop and
     tell the user which permission group/source is missing.

3. **Search queue**
   - Start with exact user terms.
   - Add English/Chinese synonyms, abbreviations, clinical/statistical variants.
   - Use `kind=auto` first.
   - Survey sources -> try `dictionary`, `variables`, `datasets`, `documents`, `overview`.
   - Categorical coding -> call `POST /api/v1/coding/query` with exactly one
     `source` and the selected variable. The API expands codes/labels/aliases
     from the variable index and searches the source's complete published
     codebooks, questionnaires, dictionaries, and cached PDF text. Do not make
     the agent guess a document path or maintain source-specific mappings.
   - ICU/EHR sources -> try `variables`, `datasets`, `concepts`, `joins`, `guardrails`, then SQL catalog preview if exporting.

### Mandatory three-pass discovery protocol

Never treat one query or one successful hit as a complete database search. For
each critical dataset concept and each critical variable/phenotype, run at
least **three materially different search passes** before selecting fields or
reporting that nothing was found:

1. **Exact / anchored pass**: use the user's original wording, exact field or
   code when available, and the original language.
2. **Bilingual semantic-expansion pass**: search both Chinese and English;
   expand abbreviations; add clinical, epidemiologic, statistical, lay, and
   spelling/hyphen variants. Include standard vocabulary such as MeSH, ICD, or
   LOINC terms when relevant.
3. **Source-native structural pass**: use the database's own module, table,
   file, field, instrument, questionnaire, wave/cycle, and version terminology.
   Vary `kind` across the relevant values instead of relying only on `auto`.

Use at least two distinct query expressions in each pass for a critical
concept (normally at least six distinct queries total). Batch calls are fine,
but repeated identical queries do not count. Do not stop after the first good
hit: later passes are required to detect alternative fields, renamed variables,
wave-specific definitions, and more appropriate source tables.

If the three passes are sparse, conflicting, or ambiguous, run a fourth
recovery pass using broader parent concepts, measurement methods, validated
proxies, and official documentation/codebooks. When no source was specified,
apply the passes across 2-6 likely sources that survived the permission gate.

Keep a search-audit table with: pass, language, exact query, source(s), `kind`,
hit count, candidate accepted/rejected, and rejection reason. Deduplicate by
source + physical column/table + wave/version, not label alone. A `not_found`
conclusion is valid only after all three passes plus the relevant documentation
or coding lookup. Freeze the accepted source/variable manifest before extract
or export.

4. **Evidence queue**
   - Dataset keys: `extract_hint.file`, `parquet_rel`, `data_path`, `source_rel_path`, `source_file`, `dataset_path`, `file_path`, `path`, `data_paths`.
   - Variable columns: `extract_hint.columns`, `physical_column`, `preferred_name`, `variable_name`, `field_id`, `colname`, `column_name`, `raw_column_name`, `source_variable_name`, `code`.
   - Labels are not columns: `description_best`, `variable_label`, `label_text`, `label`, `title`, `description`, `notes`.

5. **Extraction queue**
   - Survey/cohort preview: search -> exact file/wave -> schema ->
     `POST /api/v1/extract` with a small explicit `rowCap` -> inspect the
     downloaded contents. Connectivity/regression checks use 2 or 20 rows.
   - Survey/cohort full result: `POST /api/v1/export` -> poll status -> stream
     the completed file to disk. One physical input file supports both CSV and
     Parquet output; honor the user's format choice. Current multi-file
     assembly supports CSV only, subject to safe joins.
   - ICU/EHR: catalog -> SQL preview -> SQL export -> download.

## 3. Source Matrix

| User asks about | Start with sources | Notes |
| --- | --- | --- |
| China family, income, consumption, education, household relationships | `cfps`, `chip`, `chfs` | CFPS panel/family; CHIP income/poverty; CHFS finance/assets |
| China social attitude, class, trust, governance | `cgss`, `css` | Repeated social surveys |
| China aging, cognition, retirement, chronic disease | `charls`, `clhls` | CHARLS 45+; CLHLS oldest-old/longevity |
| China aging and social participation | `class` | CLASS 2014-2023; verify wave-specific coding |
| China nutrition, diet, physical activity | `chns` | Nutrition/community context |
| China labor, migration, employment | `clds` | Labor dynamics |
| HRS-family aging comparisons | `hrs`, `elsa`, `klosa`, `lasi`, `mhas`, `share`, `charls` | Check wave/country constructs |
| US public health, labs, diet, exam, weights | `nhanes` | Check cycle, weights, PSU, strata |
| Global school/student health and behavior | `gshs` | Verify survey-specific questions, country/year, weights, strata and PSU; use this router |
| UK Biobank fields, instances, arrays, omics | `ukb` | Field ID + instance/array semantics |
| ICU/EHR adult and pediatric | `mimiciv31`, `mimiciv`, `mimiciii`, `eicu`, `sicdb`, `nwicu`, `pic` | Use `/api/v1/ehr/*` for long-table SQL export |
| MIMIC-IV latest-like | `mimiciv31`, then `mimiciv` | Do not mix v1.0 and v3.1 schemas without checking |
| MIMIC-III legacy validation | `mimiciii` | Check `SUBJECT_ID`, `HADM_ID`, `ICUSTAY_ID` |
| eICU external validation | `eicu` | Main key is `patientunitstayid` |
| SICdb ICU/intermediate-care validation | `sicdb` | Use `CaseID`/`PatientID`, relative offsets, and decoded reference views; it is not a pure ED database |
| NWICU validation | `nwicu` | Use `nwicu_icu.*` and `nwicu_hosp.*` relations |
| Pediatric ICU | `pic` | PIC/PICU uses uppercase raw table names via `pic_raw.*` |
| Perioperative medicine, anesthesia, surgery, intraoperative monitoring | `inspire` | Use `/api/v1/ehr/*`; verify operation and relative-time keys |
| Cancer epidemiology, GLOBOCAN, ASR, projections | `gco` | Query-only source; use `/api/v1/gco/metadata` and `/api/v1/gco/query`, not dataset extraction/download |
| US cancer registry, incidence, survival, tumor characteristics | `seer` | SEER Research Data, 17 Registries, 2000-2023 |

Full source aliases live in [references/source-map.md](references/source-map.md).

## 4. Golden Path

For normal survey/cohort work:

1. Startup gate: `GET /api/v1/sources` or `api-permissions`; build the
   allowed/denied source list for this token.
2. Filter the requested `source` / `sources` to `ALLOWED_SOURCES`; stop if none
   remain.
3. Run the mandatory three-pass discovery protocol with
   `POST /api/v1/variables/query`, retain the search-audit table, and freeze the
   deduplicated source/variable manifest. A single-query result is not enough.
4. For every categorical variable, `POST /api/v1/coding/query` before recoding
   or interpretation. Use returned attached labels and codebook snippets as
   evidence; follow `text_url` pages when more context is needed.
5. Bind every selected field to its confirmed physical file and wave/version,
   inspect that file's schema, then preview with `POST /api/v1/extract` and an
   explicit `rowCap` (2 or 20 for rechecks). Verify exact columns, file context
   and decoded sample values; a capped result is not a complete dataset.
6. Complete result, when requested: `POST /api/v1/export`, omitting `rowCap`.
   For one physical input file, set `format: "csv"` or `format: "parquet"`
   according to the user's intended use. CSV can be exported directly even
   from a Parquet source file. For multiple files, export separately or use
   supported CSV assembly after verifying join keys.
   Poll `GET /api/v1/export/{id}` until complete. Use
   `POST /api/v1/export/{id}/retry` only after a failed job.
7. Before `GET /api/v1/datasets/{id}/download`, confirm the dataset source(s)
   are still in `ALLOWED_SOURCES`.
8. Stream the download to disk. Resume a partial transfer with HTTP Range;
   never load a complete export into Python/Node memory.
9. Report the chosen format and download path. If the user already has a
   Parquet download and then needs CSV, offer local DuckDB conversion. When
   CSV is requested before export, export CSV directly; do not require an
   intermediate Parquet download or create both formats without user intent.

### Preserve file, field and wave context

For CHARLS, ELSA, HRS, SHARE, KLoSA, LASI, MHAS, CLHLS and CLASS, keep an
ordered selection manifest of source + physical file + exact column +
wave/version + table grain. The same code in another wave is a different
selection. A raw field missing from a curated table requires locating its raw
file, not dropping the field or returning identifiers only.

- Send `selected` as a JSON array, with top-level `file` for one file or
  `{"file": "...", "column": "..."}` objects for explicit file selections.
  Keep requested case and punctuation, including commas, quotes and newlines.
  Do not strip a label embedded in a physical column verified by `/schema`.
  In the client, prefer repeated `--column` or `--selection-file`; legacy
  `--selected` / `--columns` split on commas and are only for simple codes.
- Verify native filename, schema and codebook evidence before assigning a
  wave. Archive directories can mislead: KLoSA `wave1/w02_e.parquet` is wave 2;
  an ELSA wave 0–5 index and SHARE `sharew6` DBS file need their own context.
  MHAS wide wave-prefix columns, CLHLS longitudinal/cross-sectional files and
  LASI pilot/W1 files must not be treated as interchangeable waves.
- Distinguish one row per person with wide wave columns from repeated
  person-wave rows. Use actual person/household and wave/record keys, never a
  universal `ID`. Every explicit `join_on` key must exist in every input;
  never remove a missing wave key to make a join succeed. Keep the first
  selected file as the left-join anchor and verify uniqueness and row counts.
- Do not join independently capped samples, match empty identifiers, overwrite
  overlapping non-key columns, or choose the first ambiguous file. For bounded
  live checks, inspect each file separately; do not remove the cap to bypass a
  rejection. Full research exports require the user's requested scope.
- Success requires every requested field, the correct physical file(s), empty
  errors/unresolved lists, and decoded CSV/Parquet contents matching the
  manifest. HTTP 200, a job ID, or a nonempty file alone is not success. Do not
  silently accept partial multi-source results or a different download format.

Read [references/api.md](references/api.md#6-dataset-build-and-download) for
literal-column examples, output support, response checks and rejection codes.
Keep rechecks metadata-only in reports; small samples do not establish that
all waves, participant values or full-cohort joins have been verified.

For ICU/EHR long-table exports such as MIMIC, eICU, NWICU, and PIC:

1. Startup gate: `GET /api/v1/sources` or `api-permissions`; confirm the
   specific ICU/EHR source is in `ALLOWED_SOURCES`.
2. If the source is not allowed, stop. Do not call `ehr/catalogs`, preview SQL,
   export SQL, or download for that source.
3. `GET /api/v1/ehr/catalogs`
4. Identify the ICD/diagnosis cohort first, then preview it with `POST /api/v1/ehr/sql`
5. Export the cohort-restricted SQL with `POST /api/v1/ehr/sql/export`
6. Before download, confirm the exported dataset source is still allowed.
7. `GET /api/v1/datasets/{id}/download`

Always query/preview first, then export/download.

### Categorical coding gate before analysis

Extraction is not complete when rows have merely downloaded. Before defining, recoding, deriving, analyzing, or interpreting any categorical variable or exposed/event/reference group:

- Call `POST /api/v1/coding/query` automatically with exactly one source and
  variable. This is the primary coding lookup; it searches the source's full
  published reference corpus rather than relying on filenames, a short prefix,
  or a per-variable hand-maintained mapping.
- Treat `coding_status=not_found` as unresolved after corpus search. Report it
  as unverified and stop directional interpretation; do not patch a single
  variable or silently carry coding from another database/version.
- Keep three evidence layers separate: (1) original DTA/codebook variable and
  value-label definitions, (2) actual frequencies in the current Parquet or
  downloaded file, and (3) missingness after format conversion.
- Verify the original codebook/dictionary or value labels, raw value range,
  missing/special codes, and a frequency table from the exact downloaded data.
- Raw DTA schema/extraction can preserve Stata `.`, `.a` through `.z` missing
  markers. If a prior Parquet conversion collapsed `.a/.d/.r/.m` or other
  extended missing values to `null`, report the null frequency but do not
  reconstruct the original letter code or treat all nulls as one documented
  Stata category.
- For multi-wave, multi-batch, multi-year, or repeated-questionnaire sources, verify each wave/batch/year/version separately; never carry one wave's coding into another without evidence.
- Never infer exposed/event/reference direction from numeric order such as `0/1`, `1/2`, or `1/2/3`.
- After recoding, produce a raw-to-derived cross-tabulation, unmapped/contradiction counts, and fail-fast checks for impossible mappings. Record the verification source, date, variables, codes, derivation, and reference group.
- If the original coding or current-data frequency evidence cannot be verified, mark the variable unverified and stop before analysis or directional interpretation.

ICU/EHR export rule: preview requests may use a small `limit`, but export
requests must not add `limit`, `rowLimit`, `row_limit`, `rowCap`, or `row_cap`
unless the user explicitly asks for a capped sample. For MIMIC-III, MIMIC-IV,
MIMIC-IV 3.1, eICU, SICdb, INSPIRE, NWICU, and PIC, the default export is full extraction with
no API-imposed row cap.

Queue-protection rule: full extraction should be full **after cohort narrowing**,
not a blind whole-event-table download. For ICU/EHR work, first use ICD diagnosis
or the source's diagnosis table to define `subject_id`/`hadm_id`/`stay_id`/
`patientunitstayid`, then join event/lab/vital tables to that cohort before
exporting. Do not enqueue broad `chartevents`, `labevents`, `vitalPeriodic`, or
similar large event-table exports until an ICD/diagnosis cohort or another
user-approved cohort filter is in the SQL.

### Full export memory and file semantics

The default `1GB` DuckDB limit is a **working-memory cap**, not an output-size,
row-count, or task-duration limit. DuckDB may spill intermediate state to disk
and write a Parquet/CSV file much larger than 1GB. The isolated worker exits
only after the export succeeds or fails; it does not stop because the result
passes 1GB.

Complete **single-file** exports support both CSV and Parquet directly through
the background worker. "Single-file" describes the physical input selection,
not a required output format. Honor an explicit user choice; otherwise choose
CSV for readable tabular exchange, or Parquet for large datasets and typed
programmatic analysis. Pass `format` explicitly; the client's legacy Parquet
default is not a restriction on CSV support.

CSV does not retain column types: preserve schema information and import
identifier columns as text to avoid losing leading zeros. Parquet generally
uses less disk space and retains types. Do not force Parquet followed by CSV
conversion when CSV is wanted. Convert an existing Parquet file only when
requested, using DuckDB under bounded memory; CSV may require more disk space.

`export-retry` resubmits a failed job. HTTP Range resumes downloading a
completed file. Do not describe either as engine-level compute checkpointing
unless the API explicitly reports a resumable computation checkpoint.

When performing a background export or local format conversion, read
[references/api.md](references/api.md) for the exact request/status/retry and
`parquet-to-csv` commands.

## 5. High-Level API Surface

Use these `/api/v1/*` endpoints first.

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/health` | service info and endpoint index |
| `GET /api/v1/openapi.json` | machine-readable API document |
| `GET /api/v1/sources` | list available database sources |
| `GET\|POST /api/v1/variables/query` | ranked variable candidates |
| `GET\|POST /api/v1/coding/query` | search one variable across a source's complete coding/reference corpus and return original snippets |
| `GET /api/v1/coding/docs/{id}?source=&offset=` | continue reading a matched codebook as pageable text, including PDF text |
| `POST /api/v1/extract` | build a stored downloadable dataset |
| `POST /api/v1/datasets/build` | alias for extract |
| `POST /api/v1/export` | create a background complete CSV/Parquet export; no final row cap unless supplied |
| `GET /api/v1/export/{id}` | read export status, progress, and download URL |
| `POST /api/v1/export/{id}/retry` | retry a failed export request |
| `GET /api/v1/datasets` | list datasets |
| `GET /api/v1/datasets/{id}` | inspect one dataset |
| `GET /api/v1/datasets/{id}/download` | stream CSV or Parquet; supports HTTP Range |
| `GET /api/v1/ehr/catalogs` | list prepared ICU/EHR SQL catalogs |
| `POST /api/v1/ehr/sql` | preview guarded `SELECT/WITH` SQL |
| `POST /api/v1/ehr/sql/export` | export guarded SQL as downloadable dataset |
| `GET /api/v1/gco/metadata` | list/search GCO, GLOBOCAN, CI5plus, and HDI metadata |
| `POST /api/v1/gco/query` | run guarded read-only GCO queries; no dataset download |

Low-level sidecar endpoints (`/search`, `/resolve`, `/schema`, `/extract`) are advanced. Use them only to verify a specific physical file or columns before extracting.

## 6. Remote Quickstart

Use the bundled client for Windows. If running the manual `curl` examples below
on Windows, invoke `curl.exe` and add `--ssl-no-revoke --noproxy
api.medtimehelp.com` to each command. On macOS/Linux, also add `--noproxy
api.medtimehelp.com`.

List sources:

```bash
curl -sS --noproxy api.medtimehelp.com "$BASE/api/v1/sources" "${AUTH[@]}"
```

Search variables:

```bash
curl -sS --noproxy api.medtimehelp.com -X POST "$BASE/api/v1/variables/query" \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"query":"BMI 体重指数","source":"nhanes","limit":10}'
```

Verify a categorical variable against the complete source codebook corpus:

```bash
python3 skills/medhelp-database-api-access/scripts/local_db_api.py coding \
  --base-url "$BASE" --source charls --variable rafinacom
```

Build and download a small preview dataset:

```bash
curl -sS --noproxy api.medtimehelp.com -X POST "$BASE/api/v1/extract" \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"source":"nhanes","selected":["BMXBMI"],"projectName":"nhanes_bmi_demo","rowCap":20}'

curl -L --noproxy api.medtimehelp.com "${AUTH[@]}" \
  -o dataset.csv \
  "$BASE/api/v1/datasets/<dataset_id>/download"
```

## 7. ICU/EHR SQL Export

Supported `source` values:

```text
mimiciii  mimiciv  mimiciv31  eicu  sicdb  inspire  nwicu  pic
```

Do not cap ICU/EHR exports by default. Omit `limit` and all row-cap fields on
`/api/v1/ehr/sql/export` unless the user clearly asks for a limited sample.
If a previous example or habit suggests `limit:100000` or `limit:1000000`,
remove it for production extraction. The API accepts omitted `limit` (or
`all`/`full`/`unlimited`/`全量`) as full export.

Before download, narrow ICU/EHR data through ICD diagnosis whenever possible.
Use a diagnosis/ICD relation to build the cohort, preview the row count/keys,
then export the downstream table joined to that cohort. This keeps the queue
small without silently truncating rows. If the user has not supplied a disease
or ICD code set, ask for it or use a clearly documented ICD definition; do not
start a broad event-table export first.

List catalogs:

```bash
curl -sS --noproxy api.medtimehelp.com "$BASE/api/v1/ehr/catalogs" "${AUTH[@]}"
```

Preview:

```bash
curl -sS --noproxy api.medtimehelp.com -X POST "$BASE/api/v1/ehr/sql" \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"source":"eicu","sql":"select patientunitstayid, gender, age from eicu_raw.patient","limit":5}'
```

Export and download:

```bash
curl -sS --noproxy api.medtimehelp.com -X POST "$BASE/api/v1/ehr/sql/export" \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"source":"mimiciv31","sql":"with cohort as (select distinct subject_id, hadm_id from mimiciv_hosp.diagnoses_icd where icd_code like '\''I50%'\'') select i.subject_id, i.hadm_id, i.stay_id, i.intime, i.outtime from mimiciv_icu.icustays i join cohort c using (subject_id, hadm_id)","projectName":"mimiciv31_icd_cohort_icustays"}'

curl -L --noproxy api.medtimehelp.com "${AUTH[@]}" \
  -o mimiciv31_icustays.csv \
  "$BASE/api/v1/datasets/<dataset_id>/download"
```

Common ICU/EHR relation names:

```sql
-- MIMIC-III
-- diagnosis cohort first
mimiciii_raw.DIAGNOSES_ICD
mimiciii_raw.ICUSTAYS
mimiciii_raw.CHARTEVENTS
mimiciii_raw.LABEVENTS

-- MIMIC-IV 1.0 / 3.1
mimiciv_hosp.diagnoses_icd
mimiciv_icu.icustays
mimiciv_icu.chartevents
mimiciv_hosp.labevents

-- eICU
eicu_raw.diagnosis
eicu_raw.patient
eicu_raw.lab
eicu_raw.vitalPeriodic

-- NWICU
nwicu_hosp.diagnoses_icd
nwicu_icu.icustays
nwicu_icu.chartevents
nwicu_hosp.labevents

-- PIC
pic_raw.DIAGNOSES_ICD
pic_raw.ICUSTAYS
pic_raw.CHARTEVENTS
pic_raw.LABEVENTS
```

SQL guardrails: only `SELECT` or `WITH`; no multiple statements; no write/admin keywords. Use ICD/diagnosis cohort filters first, then table, itemid, and time-window filters for large event tables.

## 8. Python Client

Bundled client:

```text
skills/medhelp-database-api-access/scripts/local_db_api.py
```

Remote usage:

```bash
python3 skills/medhelp-database-api-access/scripts/local_db_api.py \
  api-permissions \
  --base-url https://api.medtimehelp.com
```

If token is missing and the base is public, the client prompts securely via stdin.
The default `--transport auto` selects `curl.exe --ssl-no-revoke` before the
request on Windows HTTPS, so a mutating POST is never retried after an ambiguous
TLS failure. Use `--transport urllib` to require Python TLS, or `--transport
curl` to force curl explicitly.
The default `--proxy-mode direct` ignores system/environment proxies. Use
`--proxy-mode system` only when explicitly required.

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Managed Connector status is not `connected` | Stop and report the exact code-owned status. Ask the user to use “设置 → 连接器 → 数据库 API → 连接并保存”; do not inspect or judge the PAT. |
| Connector says `connected` but token env is missing | Do not ask for or search for the PAT. Report an account credential-injection inconsistency. |
| Token env is missing in an independent external agent | Configure `MEDHELP_DATABASE_API_TOKEN` through the process environment or protected secret store outside chat, then restart/retry the agent. |
| Managed API call returns `401/403` after connection | Treat the Connector state as stale and ask the user to reconnect; do not have the AI diagnose token validity. For an explicit `DATABASE_ACCESS_DENIED` on one source, report the missing source permission. |
| `curl` hits `127.0.0.1` on another computer | Wrong mode. Use `https://api.medtimehelp.com`. |
| Windows curl reports `CRYPT_E_REVOCATION_OFFLINE`, `CERT_TRUST_REVOCATION_STATUS_UNKNOWN`, or a revocation-check failure | Prefer the bundled client with its default `--transport auto`. For a manual call, use `curl.exe --ssl-no-revoke`; keep certificate and hostname verification enabled. |
| Python reports `SSL: UNEXPECTED_EOF_WHILE_READING`, or PowerShell reports that the transport stream/underlying connection was closed | On Windows, stop cycling through TLS versions and use the bundled client, whose automatic Windows transport is `curl.exe --ssl-no-revoke`. If it still fails, diagnose the proxy/firewall; do not use `--insecure`. |
| Windows `curl` runs `Invoke-WebRequest` instead of curl | Invoke `curl.exe` explicitly. |
| Windows asks for a proxy, tries a configured proxy, or fails only when proxy variables are set | Prefer the bundled client with default `--proxy-mode direct`. For manual curl add `--noproxy api.medtimehelp.com`. Do not add proxy credentials. |
| `404` on `/api/v1/resolve` or `/api/v1/schema` | Those are low-level paths without `/api/v1`: use `/resolve` and `/schema`, or stay on Surface A. |
| Huge ICU/EHR export times out | Add source-specific item/table/time filters; preview with `/api/v1/ehr/sql` first. Do not add an arbitrary row limit unless the user asked for a capped sample. |
| ICU/EHR queue gets too large | Build an ICD/diagnosis cohort first and export only rows joined to that cohort; do not start with a broad event-table download. |
| Large survey/cohort export risks OOM | Use separate single-file background exports in the chosen CSV or Parquet format and stream downloads to disk. Current multi-file CSV assembly may materialize rows; the single-file DuckDB memory guarantee does not cover it. Do not enlarge the scope or cap silently. |
| Missing/renamed fields, empty preview, or identifiers only | Stop, compare the full requested manifest with schema and downloaded contents, and report the failing source/file/columns. Do not drop fields and retry as success. |
| Ambiguous wave/file or rejected join | Preserve the explicit file and every required join key; inspect each input separately. See the rejection-code table in `references/api.md`. |
| `UNSUPPORTED_PARQUET_EXPORT` | Multi-file Parquet and unavailable Parquet workers fail explicitly. Use separate supported single-file exports, or obtain agreement to CSV; never rename CSV to Parquet. |
| User cannot read a Parquet file directly | Offer `parquet-to-csv` for the existing download, warning that CSV may be larger; convert locally with bounded DuckDB memory. For a new export, CSV is supported directly. |
| Coding is absent from variable search | Call `/api/v1/coding/query`; it expands aliases and searches all published codebooks/questionnaires/dictionaries, including cached PDF text. If `coding_status=not_found`, mark it unverified instead of adding a one-off mapping. |

## 10. Hard Rules

- Remote default is `https://api.medtimehelp.com`, not localhost.
- In a managed MedHelp Agent, only
  `MEDHELP_DATABASE_API_CONNECTION_STATUS=connected` authorizes API work. This
  status is owned by backend Connector code; never let the AI reinterpret it.
- If that connected state has no injected token, report an injection failure.
  Never ask the user to paste it and never mine local files or logs for account
  or session credentials.
- In an independent external agent, require the operator to configure the PAT
  out of band through an environment variable or protected secret store.
- After token setup, always run the startup permission check with `/api/v1/sources` or `api-permissions`.
- Treat the startup source list as the current token's download/query allow-list; never query, export, or download a source outside that list.
- API tokens can inherit user permissions or be narrower than the user account. The current Bearer token's allow-list wins.
- Never reveal the token in logs, final answers, filenames, or reports.
- On Windows HTTPS, prefer the bundled client (`--transport auto`) or use
  `curl.exe --ssl-no-revoke --noproxy api.medtimehelp.com` manually. Never use
  `-k`/`--insecure`; never retry a mutating POST merely because its TLS result
  was ambiguous.
- Bypass all system/environment proxies for this API by default. Use the
  client's `--proxy-mode system` only on explicit operator instruction.
- Query/search/preview before extraction.
- For every critical dataset concept and variable/phenotype, complete at least
  three materially different search passes (exact, bilingual semantic, and
  source-native structural), normally with at least two distinct query
  expressions per pass. Do not stop at the first hit or claim `not_found`
  before the required passes and documentation/coding checks are complete.
- Preserve a search-audit table containing the pass, language, exact query,
  source, `kind`, hit count, accepted/rejected candidates, and reasons; freeze
  the deduplicated source/variable manifest before extraction.
- For every selected categorical variable, use `/api/v1/coding/query` before
  recoding or directional interpretation. Never replace corpus search with
  source-specific or variable-specific hard-coded mappings.
- Use `rowCap` for high-level `/api/v1/extract`, `rows` for web `/api/extract`,
  and `limit` for low-level `/extract`. Use POST JSON arrays for literal column
  names; do not confuse these routes or their result shapes.
- For complete survey/cohort results, use single-file background CSV or
  Parquet with no `rowCap`, honoring the user's format choice; poll progress
  and stream the file. Current multi-file assembly supports CSV only and must
  preserve every required join key.
- A DuckDB memory limit caps working memory only. Never describe it as a final
  file-size or row-count cap, and never terminate a successful export at 1GB.
- Export requested CSV directly. Local DuckDB conversion is optional for an
  existing Parquet download; do not create both formats without user intent.
- Keep original DTA/codebook definitions, current Parquet frequencies, and
  post-conversion missingness separate. Never infer exposure direction from
  numeric order or from Parquet nulls, and never reconstruct collapsed Stata
  extended-missing letters.
- ICU/EHR export means full extraction by default: do not send `limit`/`rowCap` unless the user explicitly asks for a cap.
- ICU/EHR extraction must prioritize ICD/diagnosis cohorting before download; do not enqueue broad event-table exports without a cohort SQL filter.
- Do not invent source IDs, table names, columns, row counts, join keys, or values.
- Report exact source, endpoint, the complete multi-pass query audit, ICD/diagnosis cohort definition, columns, whether a row limit was explicitly requested, dataset id, and download path.
