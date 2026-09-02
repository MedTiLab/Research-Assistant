# easyUKB 函数手册（13 模块 / 220 文件）

> 按模块分组的函数速查 + 关键参数 + 关键实现。详细源码细节见 `easyUKB_comprehensive_guide.md` 第 3 章。

## 模块 A：基础设施（5 文件）

| 函数 | 作用 | 关键参数 |
|------|------|---------|
| `set_data_path` | 设全局路径 | `path` |
| `get_ukb_path` | 取全局路径 | `path = NULL` |
| `ukb_data_prepare` | 切片大宽表 | `raw_data_path, output_dir, chunk_size=80` |
| `Common_data_extraction` | 提取+改名 | `path=NULL, id, name` |
| `batch_merge_data_optimized` | 字段→文件→列引擎 | `data_path, id_list` |

## 模块 B：ID/编码/特殊值（10 文件）

| 函数 | 作用 |
|------|------|
| `handle_special_values(x)` | -1/-3/-7/-10、"Do not know"、"Prefer not to answer" → NA |
| `convert_p41270_ultimate(data)` | ICD10 主诊断清洗（正则 + 去点号 + data_coding_19 校验） |
| `convert_p41272_ultimate(data)` | OPCS-4 手术清洗（data_coding_240） |
| `convert_p40006_ultimate(data)` | 癌症 ICD10 清洗 |
| `convert_p20001_to_coding(x)` | 自报癌症 meaning→code |
| `convert_p20002_to_coding(x)` | 自报非癌症 meaning→code |
| `convert_p20003_to_coding(x)` | 自报服药 meaning→code |
| `convert_p20004_to_coding(x)` | 自报手术 meaning→code |
| `create_coding_dict(coding_id, path=NULL)` | 读 dataset.codings.xlsx → named vector |
| `convert_dates_to_binary(df, date_cols, ref_date)` | 日期对照参考日转 0/1 |
| `convert_number_to_date(x, origin="1970-01-01")` | 数值天→Date |

## 模块 C：时间/随访骨架（4 文件）

### `time_Extract(path = NULL, death_default = "2025-08-01")` ★核心

返回列：

| 列 | 含义 |
|----|------|
| `baseline_age` | p21003_i0 基线年龄 |
| `baseline_date` | p53_i0 基线日期 |
| `outcome_time` | 死亡日 > 失访日 > death_default |
| `outcome_age` | outcome_time - baseline_date + baseline_age |
| `blood_time0~3` | 四次回访采血日（p3166_i0~i3） |
| `blood_time_age` | 采血时年龄 |
| `death_cause_id0/1` | 主/次死亡原因 ICD10 |

| 函数 | 作用 |
|------|------|
| `process_age_dataframe(df)` | 扫描 `_diagnosis`/`_age` 列对 → 生成 `_outcome_age` + `_followup_years` |
| `process_date_dataframe(df)` | 同上但基于 `_date` 列（`difftime / 365.25`） |
| `blood_time(path)` / `blood_baseline_time_p3166(path)` | 单独提取采血时间 |

## 模块 D：人口学/社会经济（10 文件）

| 函数 | 作用 |
|------|------|
| `age_sex_income(path)` | 年龄+性别+收入（p21003_i0/p31/p738_i0） |
| `ethnicity(path)` | p21000_i0 → 5 大类 + White/non-White 二分 |
| `education(path)` | p6138_i0 → ISCED 或 University 二分 |
| `employment(path)` | p6142_i0 → 在职/退休/失业/学生/其他 |
| `Townsend_deprivation_index(path)` | p189 连续 |
| `UKB_Assessment_Centre(path)` | p54_i0 → 中心+国家+南北 |
| `UKB_Assessment_Centre_gard(path)` | 同上 + 29 个中心 BNG 坐标 |
| `Genetic_principal_components(path, n=20)` | p22009_a1..a40 |
| `Pregnancy(path)` | p3140_i0 妊娠状态 |
| `family_illnesses(path)` | 父/母/兄弟姐妹疾病史展开 → `list(Family_history, Father, Mother)` |
| `family_survival_status(path)` | 父母生存状态/年龄/去世年龄 |

## 模块 E：生活方式（11 文件）

| 函数 | 作用 |
|------|------|
| `Smoking_status(path, instance=0)` | Never/Previous/Current/Unknown |
| `Alcohol_intake_frequency(path)` | p1558_i0 频率 |
| `Alcohol_status(path)` | p20117_i0 Never/Previous/Current |
| `Sleep(path)` | p1160/p1170/p1180/p1200 全套 |
| `Healthy_sleep_score(path)` | 5 维度评分（睡眠 7-8h + 早晨倾向 + 无失眠 + 不打鼾 + 无白天嗜睡） |
| `extract_sleep_durations(path)` | 单独 p1160 各 instance |
| `Physical_activity(path)` | MET-h/周（基于 p884/p894/p904/p914） |
| `IPAQ_activity_group(path)` | Low/Moderate/High |
| `Healthy_diet_score(path)` | 7 项饮食 0-7 分 |
| `Vitamin_and_mineral_supplements*(path)` | 维生素/矿物质补充剂（3 个相关函数） |

## 模块 F：环境暴露（6 文件）

| 函数 | 作用 |
|------|------|
| `air_pollution(path)` | p24003-p24019 PM2.5/PM10/NO2 |
| `greenspace(path)` | p24500-p24508 绿地/水域 |
| `residential_noise_pollution(path)` | p24020-p24024 噪音 |
| `Water_quality_assessment(path)` | 水质 |
| `sun_exposure_data(path)` | 阳光暴露（含特殊值处理） |
| `electronic_device_use(path)` | 手机/电视/电脑时长 |

## 模块 G：体测/生理/血压（7 文件）

| 函数 | 作用 |
|------|------|
| `obesity(path, instance=0)` | BMI + Underweight/Normal/Overweight/Obese |
| `Waist_circumference(path)` | p48_i0 |
| `Hand_grip_strength_kg(path)` | 左右手均值 |
| `SBP_DBP(path, instance=0)` | 优先自动血压计均值，缺失补人工读数 |
| `Pulse_rate(path)` | p102 两次均值 |
| `blood_pressure_data(path)` | 完整 BP 字段 |
| `extract_FEV1_Best(path)` | p3063 三次取 max |

## 模块 H：血/代谢/肾功能（10 文件）

| 函数 | 作用 |
|------|------|
| `blood_biochemistry(path, instance=0)` | 30+ 项血生化批量提取 |
| `blood_count(path, instance=0)` | 血常规 |
| `Fasting_time(path)` | p74_i0 |
| `dex_eGFR(df, formula)` | 6 个 eGFR 公式：EPI2021_scr / EPI2021_cysC / MDRD / CG / FAS_age / FAS_height |
| `eGFR_FAS_age(scr, age, sex)` | FAS-age 独立公式 |
| `eGFR_FAS_height(scr, height, sex)` | FAS-height |
| `calc_uacr(ualb_mg_L, ucreat_umol_L)` | 尿白蛋白肌酐比 = ualb × 8840 / ucreat |
| `calculate_delta_eGFR(df, t1_col, t2_col, date1_col, date2_col)` | 两次 eGFR 差值 + 年化下降率 |
| `calculate_CKD_stage(eGFR)` | KDIGO G1-G5 |

## 模块 I：衍生指标（27 个 `calculate_*`）

| 函数 | 输出 |
|------|------|
| `calculate_obesity_indices(path)` | BMI/WWI/WHtR/CI/RFM/CMI/LAP/VAI/WC（9 项） |
| `calculate_IR_indices(df)` | TyG/TyG_BMI/TyG_WC/TyG_WHtR/METS_IR/eHOMA-IR/eGDR（7 项） |
| `calculate_metabolic_syndrome(df, criterion="NCEP_ATPIII")` | MetS + 5 组件 |
| `calculate_MHO(df)` | MHNW/MUNW/MHOO/MUOO |
| `calculate_abdominal_obesity(df)` | 男 WC≥90 / 女 WC≥80 (IDF 亚洲) |
| `calculate_Dyslipidemia(df)` | NCEP ATP III 血脂异常 |
| `calculate_ASM(df)` | 四肢肌肉量 |
| `calculate_BMI_group(BMI)` | 4 档因子 |
| `calculate_CCR(scr, ucreat, uvol_h)` | 肌酐清除率 |
| `calculate_CSPV(df)` | CSPV 指数 |
| `calculate_CKM_stage(df)` | CKM 0-4 期 |
| `calculate_Derive_Blood_Indices(df)` | NLR/PLR/SII/SIRI/AISI 炎症指数 |
| `calculate_SHR(glucose, hba1c_mmolmol)` | 应激性高血糖比 |
| `calculate_RPP(hr, sbp)` | 心率压力积 |
| `calculate_ePWV(age, MBP)` | 估计 PWV |
| `calculate_eCRF(df)` | 估计心肺适能 |
| `calculate_eGDR(df)` | 估计 GDR（Williams 1980） |
| `calculate_framingham_ukb(df)` | Framingham 10yr CVD |
| `calculate_Prevent_CVD_Risk(df)` | AHA PREVENT 10/30yr |
| `calculate_PhenotypicAge(df)` | Levine 2018（**CRP 需除 10 转 mg/dL**） |
| `calculate_BioAges(df)` | KDM/PhenoAge/Homeostatic |
| `calculate_BioAge_Acceleration(df)` | BioAge 加速 + 残差 |
| `calculate_GOLD_BioAge_NHANES/UKB(df)` | GOLD 生物年龄 |
| `calculate_GOLD_MetAge/ProtAge(df)` | GOLD 代谢/蛋白年龄 |
| `calculate_Light_BioAge_NHANES/UKB(df)` | 轻量 BioAge |
| `calculate_recode_scores(df)` | RECODe T2D-CVD 6 个 10yr 风险 |
| `calculate_All_Derived_Indices(path)` | **一站式 60+ 衍生变量** |
| `calculate_comorbidity(df, disease_cols)` | 共病数量 + 二值 |
| `calculate_missing_rate(df, exclude_cols="eid")` | row + col 缺失率 |

## 模块 J：蛋白组学（10 文件）

| 函数 | 作用 |
|------|------|
| `extract_protein_data(path, instance=0)` | Olink ~3000 蛋白 NPX |
| `Proteomics_covariate(path)` | plate/batch/storage/season/center |
| `build_protein_pair_matrix(data, protein_pairs, data_type)` | 蛋白对矩阵 |
| `gene_pair_matrix_single(data, protein_pairs, data_type)` | 单数据集版本 |
| `prepare_protein_pair_matrix_single(data, protein_pairs)` | scale + matrix |
| `Process_Delta_Rank_Matrix(data, ...)` | Delta-Rank 转换 |
| `filter_protein_pairs(pair_matrix, lower=20, upper=80)` | 按非零比例筛选 |
| `extract_common_significant_pairs(results_list, ...)` | 跨数据集取交集 |
| `find_consistent_high_auc_genes_overall(results_list, ..., auc_threshold=0.6)` | 一致高 AUC |
| `NMR_process(path, output_path)` | NMR 技术变异校正（ukbnmr） |

## 模块 K：4 大结局源（35 文件）

详见 `references/05-outcome-sources.md`。核心函数：

| 函数族 | 用途 |
|--------|------|
| `First_occurrences_single_disease_diagnosis` | p131xxx 单病种首发 |
| `First_occurrences_multiple_disease_diagnosis` | 多病批量 |
| `Hospital_inpatient_Diagnoses(_date)(_ICD10/_ICD9)(_list)` | HES ICD10/9 |
| `Hospital_operative_Diagnoses(_date)(_ICD10)(_list)` | OPCS-4 |
| `Hospital_cancer_Diagnoses(_date)(_ICD10)(_list)` | 癌症登记 |
| `Algorithmically_defined_outcomes(_Extract)` | p42xxx |
| `death_diagnosis(path, icd_list)` | 死因匹配 |
| `Self_report_diagnosis_p6150` | 触摸屏自报疾病 |
| `Self_report_drug_p10005/p6154_p10004/p6177_p6153` | 触摸屏自报药 |
| `Self_report_DR_diagnosis` | DR 自报 |
| `Self_report_Overall_health_rating` | 自评健康 |
| `p2000X_*` 系列（4×6 = 24 函数） | 口头访谈自报 |
| `pXXXX_i0` 系列 | 触摸屏字段直接提取 |
| `ICD9_41271_41281` | ICD9 历史诊断 |

## 模块 L：多源结局合并（10 文件）

| 函数 | 作用 |
|------|------|
| `combine_diseases_and_age(df_list, disease_name)` | ★多源年龄合并 |
| `combine_diseases_and_date(df_list, disease_name)` | ★多源日期合并 |
| `combine_all_diseases_age/date(df_list)` | 批量自动合并 |
| `combine_disease_ages(df_time, ...)` | 接 time 表 + 批量年龄结果 |
| `merge_disease_dataframes(df1, df2, keep_base_cols=TRUE)` | OR 合并诊断 + pmin 合并随访 |
| `merge_disease_sources(q_var, age_var)` | 两源 case_when |
| `merge_col(df1, df2, id_col="eid")` | data.table fcase OR 合并 |
| `cbind_list_to_dataframe(list_of_df)` | 按 rownames cbind |
| `safe_bind_rows(df1, df2, add_source=FALSE)` | 共有列 bind_rows |

## 模块 M：综合诊断（3 文件）

| 函数 | 算法 |
|------|------|
| `Diabetes_Comprehensive_diagnosis(path)` | ★Eastwood 2016（Type1/Type2/GDM/Possible/Prediabetes/No/Uncertain） |
| `Diabetes_duration(path)` | baseline_age - 多源诊断年龄 min |
| `diagnose_baseline_hypertension(path)` | HES I10-I15 + p6150 + p20002 + BP + 降压药 4 源 |
| `diagnose_hypertension_byBP(sbp, dbp, criterion="AHA")` | AHA ≥130/80 或 ACC ≥140/90 |

## 模块 N：统计/插补/缺失（17 文件）

| 函数 | 作用 |
|------|------|
| `Statistics_lm(df, x, y, covariates)` | 单线性回归 |
| `batch_survival_analysis(data, exposures, time, status, covariates)` | 批量 Cox |
| `batch_roc_analysis(data, predictors, outcome)` | 批量 ROC |
| `batch_cindex_analysis(data, predictors, time, status, method=c("HZ","Uno"))` | 批量 C-index |
| `perform_univariate_cox(data, pair_columns, time, status)` | 单变量 Cox |
| `perform_univariate_cox_adjusted(...)` | 调整版 |
| `perform_overall_roc_analysis(data, pair_columns, outcome)` | 批量 AUC |
| `perform_differential_analysis(data, pair_columns, group_var)` | t 检验 |
| `perform_batch_linear_regression(...)` | 批量 lm |
| `find_optimal_cutoff(data, predictor, outcome, method="youden")` | Youden 截断点 |
| `save_cox_results(results, dataset_name, output_dir="./02.cox_univariate/")` | 保存 CSV |
| `plot_single_survival_curve(data, pair_column, time, status, cutoff=0, time_unit="years")` | KM 曲线 |
| `plot_top_survival_curves(top_genes, survival_curves_data, time_unit, output_dir)` | top-N KM 拼图 |
| `plot_summary(results, output_dir)` | 汇总条形图 |
| `plot_volcano(results, output_dir)` | 火山图 |
| `impute_mean/median(data)` | 均值/中位数 |
| `impute_knn(data, k=5)` | VIM::kNN |
| `impute_mice(data, m=5, maxit=5, method="pmm")` | mice 多重插补 |
| `impute_rf(data, maxiter=10, ntree=100)` | missForest |
| `batch_impute(data, methods=c("median","knn","rf","mice"))` | 调度器 |
| `remove_by_missing(data, max_col_missing, max_row_missing, exclude_cols="eid")` | 按缺失率删行列 |

## 模块 O：辅助工具

| 函数 | 作用 |
|------|------|
| `add_col(data, ...)` | 批量 mutate |
| `newVb(data, new_col, ...)` | case_when 动态新列 |
| `parse_method_parameters(method_params, required_params)` | 解析 "k=5,maxit=10" |
| `create_summary_table(results)` | 可发表汇总表 |
| `create_overall_auc_summary_table(...)` | AUC 汇总 |
| `generate_validation_report(validation_results, valid_codes)` | ICD 验证报告 |
| `Derived_Variable_Description` | rda 对象：所有衍生变量的字段依赖与单位 |

## 二进制数据对象（未读源码，仅知用途）

- `easyUKB/data/sysdata.rda`：内部 coding 表（含 `data_coding_19/240/3/6/4/5` 等）
- `easyUKB/data/Derived_Variable_Description.rda`：衍生变量字典
