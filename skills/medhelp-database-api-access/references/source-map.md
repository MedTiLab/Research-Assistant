# Source Map

Use this map when a user asks for a database by name, alias, or research concept. After choosing a source, call `$medhelp-database-api-access` for routing, auth, API mechanics, and downloads.

This is a routing map, not a permission grant. On startup, call
`GET /api/v1/sources` with the current Bearer token and treat the returned
source IDs as the only searchable/downloadable databases for that token. Always
filter candidates from this map through the startup allow-list before telling a
user a database can be queried or downloaded.

## Permission Groups And Download Boundaries

| Group id | Label | Downloadable only if `/api/v1/sources` includes |
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

If a chosen source is absent from the startup source list, do not query, export,
build, or download it. The API rejects forbidden sources with
`403 DATABASE_ACCESS_DENIED`. Tell the user which group/source needs admin
permission or a broader PAT.

## Chinese Social, Household, Labor, Health

| Source ID | Skill | Use for |
| --- | --- | --- |
| `cfps` | `$cfps-skill` | CFPS / 中国家庭追踪调查; family panel, household economy, individual and family dynamics |
| `cgss` | `$cgss-skill` | CGSS / 中国综合社会调查; social attitudes, values, class, trust, governance, repeated cross-sections |
| `charls` | `$charls-skill` | CHARLS / 中国健康与养老追踪调查; China HRS-family aging panel, 45+, cognition, retirement, health |
| `class` | `$class-skill` | CLASS / 中国老年社会追踪调查; social participation, family support, health, care, and 2014-2023 waves |
| `chfs` | `$chfs-skill` | CHFS / 中国家庭金融调查; assets, liabilities, housing, insurance, financial behavior |
| `chip` | `$chip-skill` | CHIP / 中国家庭收入调查; income distribution, poverty, inequality, employment income |
| `chns` | `$chns-skill` | CHNS / 中国健康与营养调查; diet, physical activity, anthropometry, household/community environment |
| `clds` | `$clds-skill` | CLDS / 中国劳动力动态调查; labor, migration, employment, household/community labor context |
| `clhls` | `$clhls-skill` | CLHLS / 中国老年健康影响因素跟踪调查; oldest-old, longevity, mortality, ADL, cognition |
| `css` | `$css-skill` | CSS / 中国社会状况综合调查; social conditions, social quality, wellbeing, governance |

## Aging And Longitudinal Surveys

| Source ID | Skill | Use for |
| --- | --- | --- |
| `hrs` | `$hrs-skill` | US Health and Retirement Study |
| `elsa` | `$elsa-skill` | English Longitudinal Study of Ageing |
| `klosa` | `$klosa-skill` | Korean Longitudinal Study of Aging |
| `lasi` | `$lasi-skill` | Longitudinal Ageing Study in India |
| `mhas` | `$mhas-skill` | Mexican Health and Aging Study |
| `share` | `$share-skill` | Survey of Health, Ageing and Retirement in Europe |

## Public Health And Biobank

| Source ID | Skill | Use for |
| --- | --- | --- |
| `nhanes` | `$nhanes-skill` | NHANES cycles, labs, exam, diet, survey weights |
| `gshs` | `$medhelp-database-api-access` | CDC / WHO Global School-based Student Health Survey; verify survey-specific questions, country/year and complex-survey design |
| `ukb` | `$ukb-skill` | UK Biobank field IDs, instances, arrays, matched omics when present |

## ICU And EHR

| Source ID | Skill | Use for |
| --- | --- | --- |
| `mimiciii` | `$mimiciii-skill` | MIMIC-III v1.4 ICU/EHR tables and concepts |
| `mimiciv` | `$mimiciv-skill` | MIMIC-IV v1.0 core, hosp, icu modules |
| `mimiciv31` | `$mimiciv31-skill` | MIMIC-IV v3.1 and MIMIC-IV-ED semantics |
| `eicu` | `$eicu-skill` | eICU Collaborative Research Database |
| `sicdb` | `$sicdb-skill` | SICdb v1.0.8 ICU/intermediate-care stays, relative-time events, and decoded reference views |
| `nwicu` | `$nwicu-skill` | Northwestern ICU data |
| `pic` | `$pic-skill` | Paediatric Intensive Care data |
| `inspire` | `$inspire-skill` | INSPIRE perioperative medicine, anesthesia, surgery, intraoperative monitoring, and postoperative outcomes |

## Oncology

| Source ID | Skill | Use for |
| --- | --- | --- |
| `gco` | `$medhelp-database-api-access` | GCO/GLOBOCAN Cancer Today/Tomorrow, CI5plus, HDI linkage, ASR, burden, and projections; query-only through `/api/v1/gco/*` |
| `seer` | `$seer-skill` | SEER Research Data, 17 Registries, 2000-2023 case-level cancer registry analyses |
