# GCO/GLOBOCAN Database Workflow Reference

## 1. Access Modes

Use the MedHelp API when the Agent environment reports a connected database API:

```text
GET  /api/v1/gco/metadata
POST /api/v1/gco/query
```

The protected runtime supplies `MEDHELP_DATABASE_API_URL` and `MEDHELP_DATABASE_API_TOKEN`.
Never expose the token in chat, logs, scripts, notebooks, or saved methods notes. GCO is query-only:
do not call dataset build or download endpoints.

Use this root only as a local fallback:

```text
~/database/reference_assets/gco-iarc-who-int-population
```

In Python:

```python
from pathlib import Path

ROOT = Path.home() / "database/reference_assets/gco-iarc-who-int-population"
```

## 2. Local Fallback File Map

Cancer Today:

```text
downloads/gco_tables_2022/core/gco_incidence_mortality_all_ages_2022.csv
downloads/gco_tables_2022/core/gco_incidence_mortality_age_specific_2022.csv
downloads/gco_tables_2022/core/gco_prevalence_all_ages_2022.csv
downloads/gco_tables_2022/core/gco_population_demographics_by_age_2022_2050.csv
downloads/gco_tables_2022/core/gco_cancer_site_rankings_and_most_common_total_2022.csv
```

GLOBOCAN metadata:

```text
downloads/gco_tables_2022/metadata/cancers.csv
downloads/gco_tables_2022/metadata/populations.csv
downloads/gco_tables_2022/metadata/predefined_populations.csv
downloads/gco_tables_2022/metadata/methods.json
```

Cancer Tomorrow:

```text
downloads/gco_tomorrow_2022/core/gco_tomorrow_predictions_all_ages_2022_2050.csv
```

UNDP HDI:

```text
downloads/hdi/HDR21-22_Composite_indices_complete_time_series.csv
downloads/hdi/HDR21-22_Statistical_Annex_HDI_Table.xlsx
```

CI5plus:

```text
downloads/ci5plus/summary/data.csv
downloads/ci5plus/summary/cancer_dict.csv
downloads/ci5plus/summary/id_dict.csv
downloads/ci5plus/detailed/data.csv
downloads/ci5plus/detailed/cancer_dict.csv
downloads/ci5plus/detailed/id_dict.csv
```

Fact sheets:

```text
downloads/cancer_factsheets_2022/
downloads/population_factsheets_2022/
downloads/population_groups_2022/
```

## 3. MedHelp API Contract

Metadata kinds:

```text
catalog
cancers
populations
population_groups
ci5plus_summary_cancers
ci5plus_summary_registries
ci5plus_detailed_cancers
ci5plus_detailed_registries
```

Example metadata lookup:

```http
GET /api/v1/gco/metadata?kind=cancers&q=breast&limit=20
```

Example guarded query:

```json
{
  "dataset": "today_all_ages",
  "columns": ["country_code", "country_iso3", "country_label", "cancer_code", "sex", "type", "total", "asr", "api_url"],
  "filters": {
    "cancer_code": 20,
    "sex": 2,
    "type": 0,
    "country_code": {"lt": 900}
  },
  "orderBy": [{"field": "asr", "direction": "desc"}],
  "limit": 500,
  "offset": 0
}
```

Supported filter forms:

```json
{"cancer_code": 20}
{"cancer_code": [20, 23]}
{"age": {"ne": 19}}
{"year": {"between": [2010, 2017]}}
{"year": {"gte": 2010, "lte": 2017}}
{"country_code": {"lt": 900}}
{"cancer_label": {"contains": "breast"}}
{"country_iso3": {"is_null": false}}
```

The response supplies `totalMatches`, `returned`, `nextOffset`, `records`, `provenance`,
and scientific `guardrails`. Continue with `nextOffset` only when the analysis genuinely needs
more rows. The maximum page size is 20,000. `ci5plus_detailed` requires a `cancer_code` or
`id_code` filter.

## 4. Core Field Dictionary

Cancer Today incidence/mortality/prevalence:

| Field | Meaning |
| --- | --- |
| `type`, `type_label` | 0 incidence, 1 mortality, 2 prevalence |
| `sex`, `sex_label` | 0 both sexes, 1 males, 2 females |
| `country_code`, `country_iso3`, `country_label` | population identifier |
| `cancer_code`, `cancer_label`, `icd` | cancer identifier |
| `age_start_code`, `age_end_code`, `age_group_label` | age range |
| `prev_time` | prevalence duration for prevalence rows |
| `total` | cases, deaths, or prevalent cases |
| `total_pop` | denominator population |
| `asr` | age-standardized rate |
| `crude_rate` | crude rate |
| `cum_risk`, `cum_risk_74` | cumulative risk |
| `api_url` | source API URL |

Cancer Tomorrow:

| Field | Meaning |
| --- | --- |
| `cases_pred` | projected case/death count |
| `cases_base` | 2022 baseline |
| `change`, `percent` | absolute and percent change |
| `population_percent` | change due to population change |
| `risk_percent` | change due to risk trend; 0 in the local default scenario |

CI5plus:

| Field | Meaning |
| --- | --- |
| `id_code` | registry or registry-by-ethnicity identifier |
| `sex` | 1 male, 2 female |
| `cancer_code` | CI5plus cancer code |
| `age` | 1 = 0-4, ..., 18 = 85+, 19 = missing age |
| `cases` | incident cases |
| `py` | person-years / population-years |
| `year` | calendar year |

## 5. Generic Python Templates

Connected API request without exposing the token:

```python
import json
import os
import urllib.request

base = os.environ["MEDHELP_DATABASE_API_URL"].rstrip("/")
token = os.environ["MEDHELP_DATABASE_API_TOKEN"]
body = {
    "dataset": "today_all_ages",
    "filters": {"cancer_code": 20, "sex": 2, "type": 0, "country_code": {"lt": 900}},
    "limit": 500,
}
request = urllib.request.Request(
    base + "/api/v1/gco/query",
    data=json.dumps(body).encode("utf-8"),
    method="POST",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
)
with urllib.request.urlopen(request, timeout=120) as response:
    payload = json.load(response)
```

Prefer the bundled `scripts/gco_api_client.py` for ordinary use. The following direct-file
templates are local fallback examples only.

Set database root:

```python
from pathlib import Path
import pandas as pd

ROOT = Path.home() / "database/reference_assets/gco-iarc-who-int-population"
GCO = ROOT / "downloads" / "gco_tables_2022"
```

Find a GLOBOCAN cancer code:

```python
cancers = pd.read_csv(GCO / "metadata" / "cancers.csv")
print(cancers[cancers["label"].str.contains("breast|lung|cervix", case=False, na=False)])
```

Read all-ages burden for any cancer:

```python
today = pd.read_csv(
    GCO / "core" / "gco_incidence_mortality_all_ages_2022.csv",
    usecols=["type", "sex", "country_code", "country_iso3", "country_label",
             "hdi_label", "cancer_code", "cancer_label", "total", "asr", "api_url"],
)

cancer_code = 20  # replace after checking metadata/cancers.csv
burden = today[(today["cancer_code"] == cancer_code) & (today["country_code"] < 900)]
```

Call GCO API for a continuous age range:

```python
import requests

url = "https://gco.iarc.fr/gateway_prod/api/globocan/v3/2022/data/rate/0/0/all/20/?ages_group=6_13"
payload = requests.get(url, timeout=60).json()
age_30_69 = pd.DataFrame(payload["dataset"])
```

Merge numeric HDI:

```python
hdi = pd.read_csv(
    ROOT / "downloads" / "hdi" / "HDR21-22_Composite_indices_complete_time_series.csv",
    usecols=["iso3", "country", "hdicode", "hdi_2021"],
).rename(columns={"iso3": "country_iso3", "hdi_2021": "hdi"})

merged = burden.merge(hdi.dropna(subset=["hdi"]), on="country_iso3", how="inner")
```

Read Cancer Tomorrow:

```python
tomorrow = pd.read_csv(
    ROOT / "downloads" / "gco_tomorrow_2022" / "core" / "gco_tomorrow_predictions_all_ages_2022_2050.csv"
)
projection = tomorrow[(tomorrow["cancer_code"] == cancer_code) & (tomorrow["year"] == 2050)]
```

Read CI5plus for trend analysis:

```python
ci5 = pd.read_csv(ROOT / "downloads" / "ci5plus" / "summary" / "data.csv")
ci5_cancers = pd.read_csv(ROOT / "downloads" / "ci5plus" / "summary" / "cancer_dict.csv")
print(ci5_cancers.head())
```

## 6. Generic R Templates

The R examples below are local fallback examples. In connected mode, query JSON with the bundled
Python client, save only the article-specific analysis table in the project, and read that table in R.

```r
library(data.table)
library(jsonlite)

root <- path.expand("~/database/reference_assets/gco-iarc-who-int-population")
gco <- file.path(root, "downloads", "gco_tables_2022")

cancers <- fread(file.path(gco, "metadata", "cancers.csv"))
cancers[grepl("breast|lung|cervix", label, ignore.case = TRUE)]

today <- fread(file.path(gco, "core", "gco_incidence_mortality_all_ages_2022.csv"),
               select = c("type", "sex", "country_code", "country_iso3", "country_label",
                          "hdi_label", "cancer_code", "cancer_label", "total", "asr", "api_url"))

cancer_code <- 20
burden <- today[cancer_code == cancer_code & country_code < 900]

api <- "https://gco.iarc.fr/gateway_prod/api/globocan/v3/2022/data/rate/0/0/all/20/?ages_group=6_13"
payload <- fromJSON(api, flatten = TRUE)
age_30_69 <- as.data.table(payload$dataset)

hdi <- fread(file.path(root, "downloads", "hdi", "HDR21-22_Composite_indices_complete_time_series.csv"),
             select = c("iso3", "country", "hdicode", "hdi_2021"))
setnames(hdi, c("iso3", "hdi_2021"), c("country_iso3", "hdi"))
merged <- merge(burden, hdi[!is.na(hdi)], by = "country_iso3")
```

## 7. Common Analysis Recipes

Country top-N burden:

1. Read all-ages Cancer Today.
2. Filter `country_code < 900`.
3. Filter target `type`, `sex`, and `cancer_code`.
4. Sort by `asr` or `total`.
5. Save top-N CSV and plot.

Country map figure:

1. Read the same GCO country-level table used for analysis.
2. Filter `country_code < 900`; keep population groups separate for region bars/tables,
   not country polygons.
3. Keep `country_iso3`, `country_label`, metric value, `type_label`, `sex_label`,
   `age_group_label`, `cancer_label`, and `api_url` or source file path.
4. Join map geometry by ISO3 and save a join audit table with `country_iso3`,
   `country_label`, `join_status`, and metric value.
5. Use a clear choropleth scale for rates/percent change or proportional symbols for
   counts when area shading would mislead.
6. Add title/subtitle, legend with units, `No data` category, source note, and direct
   labels/callouts for key countries.
7. Check the rendered map at final size: labels readable, legend visible, no overlaps,
   no clipped title/source note, and highlighted countries identifiable.

Region/HDI grouped table:

1. Use population groups from `metadata/predefined_populations.csv`.
2. Filter target rows by those group codes.
3. Keep `total`, `asr`, and key identifiers.
4. Do not mix country rows and group rows unless the table explicitly needs both.

HDI association:

1. Read GCO ASR by country.
2. Merge UNDP `hdi_2021` by ISO3.
3. Use GCO `hdi_label` only for color/category.
4. Fit `asr ~ hdi` if the figure reports beta/p value.

Cancer Tomorrow projection:

1. Read local prediction table.
2. Filter cancer, sex, type, population, and year.
3. Report that the local table is population-change-only.
4. Use `cases_pred`, `cases_base`, `percent`, `population_percent`, and `risk_percent`.

CI5plus EAPC:

1. Choose Summary for broad cancer sites or Detailed for histology/site detail.
2. Exclude `age == 19` unless studying missing-age records.
3. Calculate age-specific rates as `cases / py * 100000`.
4. Apply a stated world standard population to calculate ASR.
5. Fit `log(ASR) ~ year`; EAPC = `100 * (exp(beta) - 1)`.
6. Document registry inclusion and aggregation rules.

## 8. Worked Example Assets

The database contains a cervical-cancer worked example because it was the first article reproduced. Use it only as a template for adapting to other cancer sites.

Scripts:

```text
examples/cervix_uteri_reproduction/reproduce_cervix_uteri_gco.py
examples/cervix_uteri_reproduction/reproduce_figure2_hdi.py
examples/cervix_uteri_reproduction/reproduce_tomorrow_figure4.py
examples/ci5plus_eapc_example/ci5plus_cervix_eapc_summary.py
```

Example outputs:

```text
outputs/cervix_uteri_reproduction/
outputs/ci5plus_eapc_example/
```

When adapting the example, replace:

- GLOBOCAN `cancer_code`
- sex selection
- age range
- population/group codes
- CI5plus cancer code
- file/output names

Do not assume cervical cancer codes for other studies.

## 9. Manual Files

The database-level manual is:

```text
docs/GCO_GLOBOCAN_CI5plus_数据库使用与复现手册.md
```

Update it when adding new data modules, API patterns, or general reusable methods.
