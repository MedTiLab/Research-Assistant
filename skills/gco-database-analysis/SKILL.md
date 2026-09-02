---
name: gco-database-analysis
description: Analyze GCO/GLOBOCAN cancer epidemiology through the MedHelp query-only API with local and official-API fallbacks. Trigger for Global Cancer Observatory, Cancer Today/Tomorrow, fact sheets, CI5plus, UNDP HDI linkage, cancer burden tables, ASR/ASMR, prevalence, projections, EAPC trends, choropleth maps, or reusable R/Python workflows. The skill is database-general and must not assume a cancer site unless the user specifies one.
---

# GCO Database Analysis

Use this skill as the operating guide for reproducible GCO/GLOBOCAN analyses without manual website interaction. In a connected MedHelp Agent, query the authenticated MedHelp GCO API. Use the local asset tree only when the API connection is unavailable and the local files exist.

Local fallback root:

```text
~/database/reference_assets/gco-iarc-who-int-population
```

Resolve `~` with the current user's home directory. Do not hardcode dated `Documents/Codex/...` workspace paths.

## Core Rule

Use sources in this order:

1. MedHelp GCO query API when `MEDHELP_DATABASE_API_CONNECTION_STATUS=connected` and a protected API token is available.
2. Local fallback files under the root above when the connected API is unavailable.
3. Official GCO API only when the prepared data does not contain the requested table, especially for an exact continuous age range or custom Cancer Tomorrow scenario.

Never call dataset build, extraction, download-ticket, or download endpoints for GCO. The GCO service is query-only. Never print, echo, log, or write API tokens into outputs.

Do not make any cancer site the default. Always identify the cancer from the user request or from `metadata/cancers.csv`.

## Workflow

1. Define the research question:
   - cancer site or all cancers
   - incidence, mortality, prevalence, ranking, projection, HDI association, or trend
   - sex, population scope, year, and age range
2. Resolve codes through `GET /api/v1/gco/metadata`; use the matching local metadata CSV only in fallback mode.
3. Select the correct data module:
   - Cancer Today for 2022 incidence, mortality, prevalence, rankings, and most-common-site analyses
   - Cancer Tomorrow for 2022-2050 projections
   - Fact sheets for PDF summaries
   - UNDP HDI for continuous HDI values
   - CI5plus for historical registry-based incidence trends and EAPC
4. Query only the rows and columns needed through `POST /api/v1/gco/query`; follow `nextOffset` when a valid analysis needs additional pages.
5. Call the official GCO API only for missing age intervals, custom prediction scenarios, or visualization-specific responses not represented locally.
6. Save reproducible outputs: analysis CSV, plot-ready CSV, model/statistics CSV, figure files, and a short methods note.

## MedHelp GCO API

Resolve this skill directory and use the bundled client. It reads `MEDHELP_DATABASE_API_URL` and `MEDHELP_DATABASE_API_TOKEN` from the protected Agent environment:

```bash
python <skill-dir>/scripts/gco_api_client.py metadata --kind cancers --query breast

python <skill-dir>/scripts/gco_api_client.py query \
  --dataset today_all_ages \
  --columns country_code,country_iso3,country_label,cancer_code,cancer_label,sex,type,total,asr,api_url \
  --filters '{"cancer_code":20,"sex":2,"type":0,"country_code":{"lt":900}}' \
  --order-by asr:desc \
  --limit 200
```

Available datasets:

- `today_all_ages`
- `today_age_specific`
- `today_prevalence`
- `today_population`
- `today_rankings`
- `tomorrow_predictions`
- `ci5plus_summary`
- `ci5plus_detailed`
- `undp_hdi_timeseries`

For `ci5plus_detailed`, always provide at least `cancer_code` or `id_code`. Prefer narrower registry/cancer/sex/year queries and paginate rather than requesting a large result at once. Read `references/workflow.md` for filter syntax, metadata kinds, and analysis examples.

## Data Modules

Cancer Today 2022:

```text
downloads/gco_tables_2022/
```

Use for current burden: incidence, mortality, prevalence, age-specific profiles, country/region comparisons, rankings, maps, and most common cancer site tables.

Cancer Tomorrow 2022:

```text
downloads/gco_tomorrow_2022/
```

Use for projections through 2050. The local table is the default `apc_list=` empty population-change-only scenario unless a custom APC scenario is explicitly requested.

Fact sheets:

```text
downloads/cancer_factsheets_2022/
downloads/population_factsheets_2022/
downloads/population_groups_2022/
```

Use for PDF summaries and supplementary reference material.

UNDP HDI:

```text
downloads/hdi/
```

Use when analyses require a continuous HDI x-axis or regression against HDI. GCO metadata only supplies HDI categories.

CI5plus:

```text
downloads/ci5plus/
```

Use for historical registry-based incidence trends. Do not treat CI5plus registry data as national GLOBOCAN estimates unless an explicit registry aggregation rule is defined.

## GCO API Templates

Cancer Today rates:

```text
https://gco.iarc.fr/gateway_prod/api/globocan/v3/2022/data/rate/{type}/{sex}/{population}/{cancer}/?ages_group={start}_{end}
```

Cancer Tomorrow predictions:

```text
POST https://gco.iarc.fr/gateway_prod/api/globocan/v3/2022/data/prediction/{type}/{sex}/{pop_codes}/{cancer_codes}/?ages_group=0_17
body: apc_list=
```

Most-common/ranking:

```text
https://gco.iarc.fr/gateway_prod/api/globocan/v3/2022/data/population/{type}/{sex}/all/all/?ages_group=0_17&top_cancer={1_or_0}&field_key=total&group_CRC={0_or_1}&include_nmsc={0_or_1}&include_nmsc_other={0_or_1}
```

Common GLOBOCAN codes:

- `type`: `0` incidence, `1` mortality, `2` prevalence
- `sex`: `0` both sexes, `1` males, `2` females
- `population`: `all`, one country/group code, or underscore-joined codes
- `cancer`: `all`, one cancer code, or underscore-joined codes

Common age intervals:

- `0_17` = all ages
- `0_7` = 0-39
- `8_17` = 40-85+
- `6_13` = 30-69
- `3_9` = 15-49

## Non-Negotiable Boundaries

- Do not sum or average age-specific ASR, crude rate, or cumulative risk to make a wider age range. Call the API for the exact `ages_group`.
- `total` can be summed only when all rows use the same measure, sex, age, population scope, and cancer definition.
- `country_code >= 900` usually means a population group, not a single country.
- Continuous HDI values come from UNDP, not GCO metadata.
- CI5plus supplies incidence registry trends; mortality trends require a mortality source such as WHO mortality data.
- Cancer Tomorrow default projections are population-change-only unless a custom APC scenario is built.
- Always report data version, source module, cancer/population/sex/age codes, and API URL where applicable.

## Output Standards

For reusable research workflows, produce:

- `*_data.csv`: long analysis table with identifiers and source fields
- `*_plot.csv`: plot-ready table when different from the analysis table
- `*_model.csv` or `*_regression.csv`: statistics used on figures
- figure output as PNG and optionally PDF/SVG
- short Markdown note with data source, inclusion rule, and reproducibility boundary

## Map Figure Standards

When the analysis compares countries or regions, make a map by default unless the user
explicitly asks for tables only or the data cannot be mapped honestly.

Every GCO map must be self-explanatory:

- use country-level rows (`country_code < 900`) for country maps; do not draw population
  group rows as if they were single countries
- join geometry by ISO3 whenever possible and save a join audit with matched, missing,
  and intentionally excluded populations
- show the exact metric and units in the legend, such as `ASR per 100,000`, `cases`,
  `deaths`, `5-year prevalence`, or `percent change`
- include visible title/subtitle text with cancer site, incidence/mortality/prevalence,
  sex, age range, year, and scenario where relevant
- label key countries or regions directly on the map or with callouts; for dense maps,
  label at least the top/bottom countries or user-specified countries and keep labels
  non-overlapping
- include a distinct `No data`/`Not applicable` visual category
- use colorblind-safe sequential or diverging palettes; avoid rainbow/jet palettes and
  document the binning rule when values are binned
- keep typography readable at final export size, with no clipped legend, title, source
  note, callout, or panel label
- for multi-panel maps, use consistent scales unless a deliberate scale change is stated,
  and add panel letters plus a shared legend when appropriate
- export at least PNG plus a vector format (PDF or SVG) for publication-style outputs

Before delivery, inspect the rendered map and confirm that the legend, labels, source
text, and highlighted countries are clear and do not overlap.

## References

Read `references/workflow.md` for detailed file paths, field dictionaries, generic Python/R examples, map workflow checks, and an optional cervical-cancer worked example. Treat the worked example as an example only, not as the default behavior.
