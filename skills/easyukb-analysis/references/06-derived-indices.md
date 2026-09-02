# 衍生指标（27 个 `calculate_*` 函数）

UKB 派生变量"工厂"，在已有基线变量上一键产出临床/代谢/生物年龄指标。

## 调用范式

多数函数内部先 `Common_data_extraction()` 拉所需字段再 mutate；少数接收已有 df 作为输入。

```r
# 模式 A：自包含（带 path）
df_obesity <- calculate_obesity_indices(path = NULL)  # 用全局 set_data_path

# 模式 B：传入已有 df
df_ir <- calculate_IR_indices(df_with_glucose_tg_hdl_bmi)
```

## 一站式调度器

```r
# 60+ 衍生变量一次产出
df_all <- calculate_All_Derived_Indices(path = NULL)
```

依次调用 `calculate_obesity_indices`、`calculate_IR_indices`、`calculate_metabolic_syndrome`、`calculate_Derive_Blood_Indices` 等。

## 肥胖指数（9 项）

```r
df_obesity <- calculate_obesity_indices()
```

| 指标 | 公式 |
|------|------|
| BMI | weight / height² |
| WWI | WC / sqrt(weight) |
| WHtR | WC / height |
| CI | Conicity Index |
| RFM | 64 − 20×height/WC + 12×sex（Woolcott） |
| CMI | (TG/HDL) × WHtR |
| LAP | (WC−65 男 / WC−58 女) × TG |
| VAI | 性别相关复合公式 |
| WC | 腰围 |

依赖字段：p31, p21001, p48, p50, p21002, p30870, p30760。

## 胰岛素抵抗（7 项）

```r
df_ir <- calculate_IR_indices(df)   # df 需有 glucose/HbA1c/TG/HDL/BMI/WC/SBP/DBP/sex
```

| 指标 | 公式 |
|------|------|
| TyG | ln(TG × Glucose / 2) |
| TyG_BMI | TyG × BMI |
| TyG_WC | TyG × WC |
| TyG_WHtR | TyG × WHtR |
| METS_IR | ln(2×Glucose + TG) × BMI / ln(HDL) |
| eHOMA-IR | 经验公式 |
| eGDR | 同 `calculate_eGDR` |

## 代谢综合征

```r
df_mets <- calculate_metabolic_syndrome(df, criterion = "NCEP_ATPIII")
# 返回 MetS + 5 个组件：hypertension/high_TG/low_HDL/hyperglycemia/abdominal_obesity
```

`calculate_MHO(df)` 进一步切 MHNW/MUNW/MHOO/MUOO（依赖 MetS 4 组件 + BMI 排除 underweight）。

## 血脂异常

```r
df_dl <- calculate_Dyslipidemia(df)
# NCEP ATP III：TC ≥6.22 / TG ≥2.26 / LDL ≥4.14 / HDL <1.04 男 1.30 女 / 服降脂药
```

## eGFR 6 公式

```r
df_egfr <- dex_eGFR(
  df,
  formula = c("EPI2021_scr","EPI2021_cysC","MDRD","CG","FAS_age","FAS_height")
)
# 输入需有：age, sex, p30700_i0 (Cr µmol/L), 可选 p30720_i0 (CysC mg/L), height
# 输出：eGFR_EPI2021_scr / eGFR_EPI2021_cysC / eGFR_MDRD / eGFR_CG / eGFR_FAS_age / eGFR_FAS_height

df_ckd <- calculate_CKD_stage(df_egfr$eGFR_EPI2021_scr)  # G1-G5
```

## 炎症/血常规衍生

```r
df_inflam <- calculate_Derive_Blood_Indices(df_with_cbc)
# NLR = Neutrophil/Lymphocyte
# PLR = Platelet/Lymphocyte
# SII = Platelet×Neutrophil/Lymphocyte
# SIRI = Monocyte×Neutrophil/Lymphocyte
# AISI = Neutrophil×Monocyte×Platelet/Lymphocyte
```

## 血糖应激

```r
df_shr <- calculate_SHR(glucose, hba1c_mmolmol)
# SHR = Glucose / (1.59 × HbA1c% − 2.59)
# HbA1c% = mmol/mol/10.929 + 2.15
```

## 血流动力学

```r
df_rpp  <- calculate_RPP(hr, sbp)               # 心率压力积
df_pwv  <- calculate_ePWV(age, MBP)             # 估计 PWV (Reference Values 2010)
df_crf  <- calculate_eCRF(df)                   # 估计心肺适能
df_gdr  <- calculate_eGDR(df)                   # 估计 GDR (Williams 1980)
```

## CVD 风险评分

```r
df_fram    <- calculate_framingham_ukb(df)        # Framingham 10yr
df_prevent <- calculate_Prevent_CVD_Risk(df)      # AHA PREVENT 10yr + 30yr
# 内部用 preventr 包；他汀识别用 12 个 p20003 编码
df_recode  <- calculate_recode_scores(df)         # RECODe T2D-CVD 6 个 10yr
# **注意**：RECODe 不做插补，缺失变量贡献设 0
```

## 生物年龄

### PhenoAge（Levine 2018）

```r
df_pa <- calculate_PhenotypicAge(df_with_10biomarkers)
# **重要**：CRP 输入需 /10（mg/L→mg/dL）
```

依赖：Albumin, Creatinine, Glucose, CRP, ALP, Lymphocyte %, MCV, RDW, WBC, age。

### 综合 BioAge

```r
df_ba    <- calculate_BioAges(df)
# 输出 KDM_BioAge / PhenoAge / Homeostatic_Dysregulation

df_acc   <- calculate_BioAge_Acceleration(df, time_age_col = "baseline_age")
# 输出 BioAge_residual (regress out chronological age)
```

### GOLD 系列

```r
df_gold_n <- calculate_GOLD_BioAge_NHANES(df)
df_gold_u <- calculate_GOLD_BioAge_UKB(df)
df_gold_m <- calculate_GOLD_MetAge(df_nmr)        # 代谢年龄
df_gold_p <- calculate_GOLD_ProtAge(df_olink)     # 蛋白年龄
```

### 轻量版

```r
df_light_n <- calculate_Light_BioAge_NHANES(df)
df_light_u <- calculate_Light_BioAge_UKB(df)
```

## CKM 分期（AHA 2023）

```r
df_ckm <- calculate_CKM_stage(df)   # 0-4 期
```

## 共病

```r
df_comorbid <- calculate_comorbidity(df, disease_cols = c("HT","DM","CKD","CHD"))
# 输出 comorbidity_count + comorbidity ≥2 二值
```

## SPISE（不在 easyUKB 内置，但常用）

```r
df$SPISE <- 600 * (df$HDL*38.67)^0.185 / ((df$TG*88.57)^0.2 * df$BMI^1.338)
df$SPISE_z <- scale(df$SPISE)[, 1]
df$SPISE_T <- factor(ntile(df$SPISE, 3), labels = c("T1","T2","T3"))
```

## 缺失率

```r
mr <- calculate_missing_rate(df, exclude_cols = "eid")
# 返回 list(row_missing, col_missing)
mr$col_missing[mr$col_missing > 0.2]  # 缺失率 >20% 的列
```

## 衍生变量字典

```r
data(Derived_Variable_Description, package = "easyUKB")
# 查衍生变量的字段依赖与单位
```

## 常见单位换算

| 变量 | UKB 单位 | 公式单位 | 系数 |
|------|---------|---------|------|
| HDL/LDL/TC | mmol/L | mg/dL | × 38.67 |
| TG | mmol/L | mg/dL | × 88.57 |
| Glucose | mmol/L | mg/dL | × 18 |
| Creatinine | µmol/L | mg/dL | / 88.4 |
| HbA1c | mmol/mol | % | /10.929 + 2.15 |
| CRP | mg/L | mg/dL | / 10 |
