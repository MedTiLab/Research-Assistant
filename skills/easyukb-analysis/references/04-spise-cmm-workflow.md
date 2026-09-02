# SPISE-CMM 完整工作流（31 步骤示例复现模板）

复现 `easyUKB包流程示例/` 下 SPISE 指数 → 心脏代谢共病的全套分析（s01-s31）。本文是其他暴露/结局组合的通用模板。

## 研究设计要素

- **暴露**：SPISE = `600 × HDL_mgdL^0.185 / (TG_mgdL^0.2 × BMI^1.338)`（Paulmichl 2016）
  - UKB 单位换算：HDL mmol/L × 38.67 → mg/dL；TG mmol/L × 88.57 → mg/dL
- **结局（6 个事件）**：
  | 缩写 | 含义 | 编码源 |
  |------|------|--------|
  | T2D | 2 型糖尿病 | `Diabetes_Comprehensive_diagnosis` Type 2 |
  | IHD | 缺血性心脏病 | ICD10 I20-I25 + 首发 p131296/p131298 |
  | Stroke | 中风 | ICD10 I60-I69 + 首发 p131360/p131362/p131364 |
  | FCMD | 首次发生 CMD（T2D/IHD/Stroke 最早） | min |
  | CMM | 心脏代谢共病（≥ 2 种 CMD） | 计数 |
  | All-cause mortality | 全因死亡 | p40000_i0 |
- **设计**：前瞻性队列，基线 2006-2010 至 2025-08-01。

## 入排标准

```r
analysis_df <- analysis_df |>
  dplyr::filter(
    !is.na(SPISE),
    Diabetes_baseline == 0,
    IHD_baseline == 0, Stroke_baseline == 0,
    !is.na(baseline_age),
    baseline_age >= 40, baseline_age <= 70
  )
```

## 协变量 M2 标准 21 项

| 维度 | 变量 | easyUKB 函数 |
|------|------|---------------|
| 人口学 | Age, Sex | `age_sex_income()` |
| 种族 | Ethnicity | `ethnicity()` |
| 社会经济 | Townsend, Education, Employment, Income | `Townsend_deprivation_index()` + `education()` + `employment()` + `age_sex_income()` |
| 生活方式 | Smoking, Alcohol, PA, Sleep, Diet | `Smoking_status()` + `Alcohol_status()` + `Physical_activity()` + `Sleep()` + `Healthy_diet_score()` |
| 肾功能 | eGFR | `dex_eGFR()` |
| 家族史 | family_history_cvd, family_history_diabetes | `family_illnesses()` |
| 血压 | SBP, DBP | `SBP_DBP()` |
| 血生化 | HbA1c | `blood_biochemistry()` |
| 用药 | BP_med, lipid_med | `Self_report_drug_p6177_p6153()` |

## 三层嵌套 Cox 模型

```r
# crude / M1 / M2
fit_crude <- coxph(Surv(time, event) ~ SPISE_z, data = df)
fit_M1    <- coxph(Surv(time, event) ~ SPISE_z + age + sex, data = df)
fit_M2    <- coxph(Surv(time, event) ~ SPISE_z + age + sex + ethnicity +
                     Townsend + education + employment + income +
                     smoking + alcohol + PA + sleep + diet +
                     eGFR + family_history_cvd + SBP + DBP +
                     HbA1c + BP_med + lipid_med, data = df)

# 三分位版（p-trend）
fit_M2_T <- coxph(Surv(time, event) ~ SPISE_T + <covariates>, data = df)
```

## 端到端最小复现脚本

```r
library(easyUKB); library(dplyr); library(purrr); library(survival)

set_data_path("K:/UKB文章/00.easyUKB_AI使用/UKB_rawdata")

# Step 1: 时间骨架
df_time <- time_Extract()

# Step 2: 暴露 SPISE
df_blood <- blood_biochemistry()
df_BMI   <- obesity()
df_spise <- df_blood |>
  inner_join(df_BMI, by = "eid") |>
  mutate(
    HDL_mgdL = HDL * 38.67,
    TG_mgdL  = TG  * 88.57,
    SPISE    = 600 * HDL_mgdL^0.185 / (TG_mgdL^0.2 * BMI^1.338),
    SPISE_z  = scale(SPISE)[, 1],
    SPISE_T  = factor(ntile(SPISE, 3), levels = 1:3, labels = c("T1","T2","T3"))
  )

# Step 3: 协变量（21 项 M2 集）
covariates <- reduce(list(
  age_sex_income(), ethnicity(), Townsend_deprivation_index(),
  education(), employment(), Smoking_status(), Alcohol_status(),
  Physical_activity(), Sleep(), Healthy_diet_score(),
  dex_eGFR(/* args */), family_illnesses()[[1]], SBP_DBP(),
  Self_report_drug_p6177_p6153()
), full_join, by = "eid")

# Step 4: 多源结局 IHD（Algorithmic > First occurrences > HES）
df_ihd_alg <- Algorithmically_defined_outcomes(/* IHD 字段 */)
df_ihd_fo  <- First_occurrences_single_disease_diagnosis(
                 disease = "IHD", field = "p131296_i0")
df_ihd_hes <- Hospital_inpatient_Diagnoses_date(
                 disease_list = "IHD",
                 icd_list = list(IHD = c("I20","I21","I22","I23","I24","I25")))
df_ihd     <- combine_diseases_and_date(
                 list(df_ihd_alg, df_ihd_fo, df_ihd_hes), "IHD")

# Step 5: 总表
final_df <- reduce(list(df_time, df_spise, covariates, df_ihd),
                   full_join, by = "eid") |>
  filter(!is.na(SPISE), baseline_age >= 40, baseline_age <= 70)
final_df <- process_date_dataframe(final_df)

# Step 6: 三层嵌套 Cox
fit_crude <- coxph(Surv(IHD_followup_years, IHD_diagnosis) ~ SPISE_z, final_df)
fit_M1    <- coxph(Surv(IHD_followup_years, IHD_diagnosis) ~ SPISE_z + age + sex, final_df)
fit_M2    <- coxph(Surv(IHD_followup_years, IHD_diagnosis) ~ SPISE_z + age + sex +
                     ethnicity + Townsend + education + employment + income +
                     Smoking_status + Alcohol_status + Physical_activity + Sleep_score +
                     Healthy_diet + eGFR_EPI2021 + family_history_cvd + SBP + DBP +
                     HbA1c + BP_med + lipid_med, final_df)
summary(fit_M2)
```

## 10 个亚组（亚组分析骨架）

```r
subgroups <- list(
  Age          = function(d) d[["baseline_age"]] < 60,
  Sex          = function(d) d[["sex"]] == "Male",
  BMI          = function(d) d[["BMI"]] < 25,
  Smoking      = function(d) d[["smoking"]] == "Current",
  Alcohol      = function(d) d[["alcohol"]] == "Never",
  PA           = function(d) d[["PA"]] == "Low",
  Hypertension = function(d) d[["hypertension"]] == 1,
  Dyslipidemia = function(d) d[["dyslipidemia"]] == 1,
  CKD          = function(d) d[["CKD"]] == 1,
  FamHistCVD   = function(d) d[["family_history_cvd"]] == 1
)

# 每个亚组分两层运行 M2，并报交互 P
for (nm in names(subgroups)) {
  flag <- subgroups[[nm]](final_df)
  fit_high <- coxph(Surv(time, event) ~ SPISE_z + <covariates>, final_df[flag, ])
  fit_low  <- coxph(Surv(time, event) ~ SPISE_z + <covariates>, final_df[!flag, ])
  fit_int  <- coxph(Surv(time, event) ~ SPISE_z * factor(flag) + <covariates>, final_df)
  # 交互 P = anova(fit_M2_no_int, fit_int)
}
```

## 敏感性分析菜单

| 分析 | 实现 |
|------|------|
| 多重插补 | `impute_mice(df, m=5)` → 系数 pool |
| 排除基线 2 年内发病 | `df \|> filter(time > 2)` |
| 排除基线癌症 | `df \|> filter(baseline_cancer == 0)` |
| 调整附加用药 | M2 + OAD + insulin |
| 排除极端值 | winsorize 0.5%-99.5% |
| 按地区/种族分层 | strata(UKB_country) |

## 31 步骤脚本映射（参考用）

| 阶段 | 步骤 | 工作内容 |
|------|------|---------|
| 数据准备 | s01-s06 | 原始字段提取、暴露/结局/协变量构造 |
| 描述性 | s07-s10 | Table 1、暴露分布、缺失模式 |
| 主分析 | s11 | M0/M1/M2 三层 Cox（6 个结局） |
| 非线性 | s12-s14 | RCS、PH 假设检验 |
| 预测 | s13 | ROC、Youden 截断点 |
| 亚组 | s17-s18 | 10 个亚组 × 交互 P |
| 中介 | s19 | 17 候选介质（HbA1c/TG/HDL/CRP 等） |
| 多状态 | s20-s23 | mstate Path A/B（健康→单 CMD→CMM） |
| 敏感性 | s24-s28 | MICE/排除/调整附加 |
| 出图出表 | s29-s31 | Forest / Volcano / Forest / Table |
