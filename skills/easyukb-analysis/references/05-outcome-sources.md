# 多源结局整合（4 源优先级）

UKB 疾病结局必须用 **4 个数据源** 整合，单源会漏诊 30-40%。本文给出每个源的提取函数与合并模式。

## 4 源优先级

```
Algorithmically defined  >  First occurrences  >  Hospital diagnoses (ICD10/9)  >  Self-report
   (UKB 已审核算法)         (UKB 已整合首发)        (HES 住院记录)              (问卷)
```

合并时**任一为 1 即为 1**（`pmax(..., na.rm=TRUE)`），日期/年龄**取最早**（`pmin(..., na.rm=TRUE)`）。

## 源 1：Algorithmically defined outcomes（p42xxx）

UKB 已用算法整合的结局字段。MI=p42000，Stroke=p42006，All_ischemic_stroke=p42008，T2D=p130708 等。

```r
df_mi_alg <- Algorithmically_defined_outcomes(
  outcome_field = "p42000_i0",
  date_field    = "p42001_i0"
)
# 输出：eid, MI_diagnosis, MI_date
```

底层：`Algorithmically_defined_outcomes_Extract.R`。

## 源 2：First occurrences（p131xxx）

UKB 已整合的"首发"字段，按 ICD10 章节为粒度（如 p131286 = 糖尿病首发日期）。

```r
df_dm_fo <- First_occurrences_single_disease_diagnosis(
  disease = "Diabetes",
  field   = "p131286_i0"
)
# 输出：eid, Diabetes_diagnosis, Diabetes_date, Diabetes_age

# 批量
df_fo <- First_occurrences_multiple_disease_diagnosis(
  disease_list = c("Diabetes", "IHD", "Stroke"),
  field_list   = c("p131286_i0", "p131296_i0", "p131360_i0")
)
```

## 源 3：Hospital inpatient ICD10（p41270 + p41280）

HES（Hospital Episode Statistics）住院记录，所有 ICD10 主诊断 + 配套日期。

```r
df_ihd_hes <- Hospital_inpatient_Diagnoses_date(
  disease_list = c("IHD", "MI"),
  icd_list = list(
    IHD = c("I20","I21","I22","I23","I24","I25"),
    MI  = c("I21","I22")
  )
)
# 输出：eid, IHD_diagnosis, IHD_date, MI_diagnosis, MI_date
```

**ICD10 写法**：用 `"I21"` 匹配 I21.0/I21.1/.../I21.9 全部；不要写 `"I21.0"`（清洗后已去点号）。

### 配套函数

| 函数 | 用途 |
|------|------|
| `Hospital_inpatient_Diagnoses` | 仅返回 `_diagnosis`（无日期） |
| `Hospital_inpatient_Diagnoses_date_ICD10` | 显式 ICD10 版本 |
| `Hospital_inpatient_Diagnoses_date_ICD9` | ICD9（p41271/p41281） |
| `Hospital_inpatient_Diagnoses_date_list` | long 格式 `eid \| icd10 \| date` |

### OPCS-4 手术（同模式）

```r
df_pci <- Hospital_operative_Diagnoses_date(
  disease_list = "PCI",
  icd_list     = list(PCI = c("K49","K50","K75"))
)
```

### 癌症登记（p40006 + p40005）

```r
df_lung_ca <- Hospital_cancer_Diagnoses_date(
  disease_list = "Lung_cancer",
  icd_list     = list(Lung_cancer = c("C33","C34"))
)
```

## 源 4：Self-report

### 4a：Touchscreen 自报（p6150/p6153/p6177/p2443 等）

```r
df_self_p6150 <- Self_report_diagnosis_p6150()
# 输出：heart_attack/angina/stroke/high_blood_pressure 二值

df_drug_p6177 <- Self_report_drug_p6177_p6153()
# 输出：BP_med/lipid_med/insulin/OAD 二值

df_dr <- Self_report_DR_diagnosis()
df_health_rating <- Self_report_Overall_health_rating()
```

直接字段提取：

```r
df_p2976 <- Common_data_extraction(id = "p2976_i0", name = "diabetes_age_self")
```

### 4b：Verbal interview 自报（p20001/20002/20003/20004 系列）

每个字段 6 个配套函数：

```r
# p20002：自报非癌症疾病
df_p20002_diag <- p20002_verbal_interview_diagnosis(
  disease_codes = c(1220, 1473),  # 糖尿病 + 1 型糖尿病
  name          = "Diabetes_self"
)
df_p20002_age  <- p20002_disease_age(
  disease_codes = c(1220, 1473),
  name          = "Diabetes_self"
)
df_p20002_date <- p20002_disease_date(...)

# 一次性提取诊断+年龄+日期
df_p20002_full <- p20002_Verbal_interview_disease_age_date(
  disease_codes = c(1220, 1473),
  name          = "Diabetes_self"
)
```

p20001-p20004 对照：

| 字段 | 含义 | coding |
|------|------|--------|
| p20001 | 自报癌症 | 3 |
| p20002 | 自报非癌症 | 6 |
| p20003 | 自报服药 | 4 |
| p20004 | 自报手术 | 5 |

每个有 `_data` / `_Extract_Convert` / `_Verbal_interview_disease_age_date` / `_disease_age` / `_disease_date` / `_verbal_interview_diagnosis` 6 个函数。

## 死因（p40000/p40001）

```r
df_death_cvd <- death_diagnosis(
  icd_list = c("I00","I01","I02","I20","I21","I22","I60","I61","I63","I64")
)
# 输出：eid, CVD_death_diagnosis, CVD_death_date
```

底层用 `time_Extract()` 已生成的 `death_cause_id0/1`。

## ICD9 历史诊断

```r
df_old <- ICD9_41271_41281(
  icd9_list = c("250"),
  name      = "Diabetes_ICD9"
)
```

## 4 源整合（合并核心）

### `combine_diseases_and_date(df_list, disease_name)` ★

```r
df_dm_combined <- combine_diseases_and_date(
  df_list = list(
    df_dm_eastwood,  # Diabetes_Comprehensive_diagnosis 输出
    df_dm_fo,        # First occurrences
    df_dm_hes,       # Hospital ICD10
    df_dm_self       # Self-report p20002 + p2976
  ),
  disease_name = "Diabetes"
)
# 输出：eid, Diabetes_diagnosis, Diabetes_date
```

合并规则：
- `Diabetes_diagnosis = pmax(各源 _diagnosis, na.rm=TRUE)`（任一 = 1 → 1；全 NA → NA；否则 0）
- `Diabetes_date = pmin(各源 _date, na.rm=TRUE)`（取最早）

### `combine_diseases_and_age()` 同理（基于年龄列）

### `combine_all_diseases_age/date(df_list)`

自动扫描所有 `_diagnosis`/`_age|_date` 列对，批量合并所有病种。适合一次处理 10+ 病种。

## 整合后追加随访列

```r
final <- combine_disease_ages(df_time, list(df_dm, df_ihd, df_stroke))
# 内部：cbind + process_age_dataframe → 自动生成 *_outcome_age + *_followup_years
```

## 综合诊断（直接给出最终结果）

某些疾病已有专门的综合诊断函数：

```r
df_dm_full <- Diabetes_Comprehensive_diagnosis()
# 输出：Diabetes_type (T1/T2/GDM/Possible/Prediabetes/No/Uncertain),
#       Diabetes_diagnosis, Diabetes_diagnosis_age

df_ht <- diagnose_baseline_hypertension()
# 输出：baseline_hypertension, baseline_hypertension_source
```

**铁律**：糖尿病分类不要单字段，**必须用 `Diabetes_Comprehensive_diagnosis()`**（Eastwood 2016 算法，UKB 公认标准）。
