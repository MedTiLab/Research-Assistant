# easyUKB 完整函数手册（自动从源码提取）

**总览**：扫描 `easyUKB/R/` 下 220 个 .R 文件，提取 218 个函数定义，其中 182 个 `@export`。

> 本文档由 `_tmp_scripts/generate_function_manual.py` 直接从 R 源码 roxygen 注释自动生成。每个函数包含：完整签名、@param 参数说明、@return 返回值、@examples 用法（若源码中有）。

---

## 速查目录（按字母排序）

| 函数 | 文件 | 导出 | 标题 |
|------|------|------|------|
| [`.onAttach`](#-onattach) | zzz.R |  |  |
| [`.onLoad`](#-onload) | zzz.R |  |  |
| [`add_col`](#add-col) | add_col.R | ✓ |  |
| [`age_sex_income`](#age-sex-income) | age_sex_income.R | ✓ | 年龄、性别和收入数据处理函数 |
| [`Alcohol_intake_frequency`](#alcohol-intake-frequency) | Alcohol_intake_frequency.R | ✓ | 酒精摄入频率数据处理函数 |
| [`Alcohol_status`](#alcohol-status) | Alcohol_status.R | ✓ | 饮酒状态数据处理函数 |
| [`Algorithmically_defined_outcomes_Extract`](#algorithmically-defined-outcomes-extract) | Algorithmically_defined_outcomes_Extract.R | ✓ | 提取算法定义的结局数据  从UK Biobank数据中提取算法定义的结局数据 |
| [`batch_cindex_analysis`](#batch-cindex-analysis) | batch_cindex_analysis.R | ✓ | 批量计算C指数函数  对多个变量进行批量C指数计算，适用于生存数据 |
| [`batch_impute`](#batch-impute) | batch_impute.R | ✓ | 批量缺失值插补处理函数  该函数对 UK Biobank 蛋白质组学数据进行批量缺失值插补处理，实现完整的插补分析流程。 |
| [`batch_merge_data`](#batch-merge-data) | batch_merge_data.R | ✓ | 批量数据合并函数 |
| [`batch_merge_data_optimized`](#batch-merge-data-optimized) | batch_merge_data_optimized.R | ✓ | 批量数据合并优化函数 |
| [`batch_roc_analysis`](#batch-roc-analysis) | batch_roc_analysis.R | ✓ | 批量ROC分析函数 对多个变量和结局进行批量ROC分析，计算AUC、最佳截断点等指标 |
| [`batch_survival_analysis`](#batch-survival-analysis) | batch_survival_analysis.R |  |  |
| [`blood_baseline_time_p3166`](#blood-baseline-time-p3166) | blood_baseline_time_p3166.R |  |  |
| [`blood_biochemistry`](#blood-biochemistry) | blood_biochemistry.R | ✓ | 血液生化数据处理函数 |
| [`blood_count`](#blood-count) | blood_count.R | ✓ | 血常规数据处理函数 |
| [`blood_pressure_data`](#blood-pressure-data) | blood_pressure_data.R | ✓ | 血压数据提取与合并函数  该函数从 UK Biobank 数据文件中提取参与者的血压测量数据（收缩压 p4080 和 舒 |
| [`blood_time`](#blood-time) | blood_time.R | ✓ | 血液采集日期处理与计算函数  该函数处理 UK Biobank 血液采集日期字段（p3166）的原始数据，对多列日期记录 |
| [`calc_free_testosterone_ve`](#calc-free-testosterone-ve) | calculate_Derive_Blood_Indices.R |  |  |
| [`calc_uacr`](#calc-uacr) | calc_uacr.R | ✓ | 计算尿白蛋白肌酐比值（UACR）  从 UK Biobank 数据中提取尿白蛋白（ualb，单位 mg/L）和尿肌酐（u |
| [`calc_uacr`](#calc-uacr) | calculate_recode_scores.R |  |  |
| [`calculate_abdominal_obesity`](#calculate-abdominal-obesity) | calculate_abdominal_obesity.R | ✓ | 从UK Biobank提取数据并计算腹型肥胖（返回完整数据） |
| [`calculate_All_Derived_Indices`](#calculate-all-derived-indices) | calculate_All_Derived_Indices.R | ✓ | 一站式计算 UK Biobank 所有可用的血液与体型衍生指标 |
| [`calculate_ASM`](#calculate-asm) | calculate_ASM.R | ✓ | 计算附肢骨骼肌质量 (ASM) |
| [`calculate_BioAge_Acceleration`](#calculate-bioage-acceleration) | calculate_BioAge_Acceleration.R | ✓ | 计算生物年龄加速（残差）并识别极端衰老/年轻个体 |
| [`calculate_BioAges`](#calculate-bioages) | calculate_BioAges.R | ✓ | 计算多种生物年龄指标（KDM、PhenoAge、HD） |
| [`calculate_BMI_group`](#calculate-bmi-group) | calculate_BMI_group.R | ✓ | 按种族划分的 BMI 分组 |
| [`calculate_CCR`](#calculate-ccr) | calculate_CCR.R | ✓ | 计算肌酐与胱抑素 C 比值 (CCR) 及标准化 NCCR |
| [`calculate_CKD_stage`](#calculate-ckd-stage) | calculate_CKD_stage.R | ✓ | 慢性肾脏病(CKD)分期与风险分类函数 |
| [`calculate_CKM_stage`](#calculate-ckm-stage) | calculate_CKM_stage.R | ✓ | 计算心血管‑肾脏‑代谢（CKM）综合征分期  整合 UK Biobank 多项健康指标，依据 CKM 框架对参与者进行分 |
| [`calculate_CSPV`](#calculate-cspv) | calculate_CSPV.R | ✓ | 计算生理变异性综合得分 (CSPV) |
| [`calculate_delta_eGFR`](#calculate-delta-egfr) | calculate_delta_eGFR.R | ✓ | 计算肌酐与胱抑素 C 估算肾小球滤过率的差值 (delta_eGFR_cysc_scr) |
| [`calculate_delta_rank`](#calculate-delta-rank) | Process_Delta_Rank_Matrix.R |  |  |
| [`calculate_Derive_Blood_Indices`](#calculate-derive-blood-indices) | calculate_Derive_Blood_Indices.R | ✓ | 血常规与血生化数据计算多种衍生指标  一次性提取指定实例的血常规、血生化、基线年龄与性别字段，自动计算 30+ 种临床常 |
| [`calculate_Dyslipidemia`](#calculate-dyslipidemia) | calculate_Dyslipidemia.R | ✓ | 提取 UK Biobank 血脂并判定异常 |
| [`calculate_eCRF`](#calculate-ecrf) | calculate_eCRF.R | ✓ | 估计心肺健康 (eCRF) 及分组 |
| [`calculate_eGDR`](#calculate-egdr) | calculate_eGDR.R | ✓ | 计算估计葡萄糖处理率 (eGDR) |
| [`calculate_ePWV`](#calculate-epwv) | calculate_ePWV.R | ✓ | 计算估计脉搏波速度 (ePWV) |
| [`calculate_exact_age`](#calculate-exact-age) | time_Extract.R |  |  |
| [`calculate_framingham_ukb`](#calculate-framingham-ukb) | calculate_framingham_ukb.R | ✓ | 计算 UK Biobank 数据的 Framingham 10年冠心病风险评分  该函数根据 ATP III 版本的 F |
| [`calculate_GOLD_BioAge_NHANES`](#calculate-gold-bioage-nhanes) | calculate_GOLD_BioAge_NHANES.R | ✓ | 计算 GOLD BioAge (NHANES 队列) |
| [`calculate_GOLD_BioAge_UKB`](#calculate-gold-bioage-ukb) | calculate_GOLD_BioAge_UKB.R | ✓ | 计算 GOLD BioAge (UK Biobank 队列) |
| [`calculate_GOLD_MetAge`](#calculate-gold-metage) | calculate_GOLD_MetAge.R | ✓ | 计算 GOLD MetAge（代谢组学生物年龄） |
| [`calculate_GOLD_ProtAge`](#calculate-gold-protage) | calculate_GOLD_ProtAge.R | ✓ | 计算 GOLD ProtAge 及相关衰老指标  包括22 种蛋白质，蛋白质数据应为标准化值（均值为 0，标准差为 1） |
| [`calculate_IR_indices`](#calculate-ir-indices) | calculate_IR_indices.R | ✓ | 计算七项胰岛素抵抗指数  基于空腹 TG、Glucose、HDL-C、BMI、腰围、身高，计算 7 个 IR 指标。 所 |
| [`calculate_Light_BioAge_NHANES`](#calculate-light-bioage-nhanes) | calculate_Light_BioAge_NHANES.R | ✓ |  |
| [`calculate_Light_BioAge_UKB`](#calculate-light-bioage-ukb) | calculate_Light_BioAge_UKB.R | ✓ | 计算 Light BioAge (UK Biobank 队列) |
| [`calculate_metabolic_syndrome`](#calculate-metabolic-syndrome) | calculate_metabolic_syndrome.R | ✓ | 计算代谢综合征（MetS）诊断  依据 AHA 代谢综合征标准，整合 UK Biobank 的腰围、血压、血脂、血糖信息 |
| [`calculate_MHO`](#calculate-mho) | calculate_MHO.R | ✓ | 肥胖代谢异质性 (MHO) 表型分类 |
| [`calculate_missing_rate`](#calculate-missing-rate) | calculate_missing_rate.R | ✓ | 计算数据框的行缺失率与列缺失率 |
| [`calculate_obesity_indices`](#calculate-obesity-indices) | calculate_obesity_indices.R | ✓ | 计算九种肥胖相关体型指标  基于 UK Biobank 的人体测量和血脂数据，计算论文 (Wang et al.,PUB |
| [`calculate_PhenotypicAge`](#calculate-phenotypicage) | calculate_PhenotypicAge.R | ✓ | 计算 Levine Phenotypic Age 表型年龄 |
| [`calculate_Prevent_CVD_Risk`](#calculate-prevent-cvd-risk) | calculate_Prevent_CVD_Risk.R | ✓ | 计算 PREVENT 心血管疾病风险  该函数整合 UK Biobank 的多个表型数据，并基于 AHA PREVENT |
| [`calculate_recode_scores`](#calculate-recode-scores) | calculate_recode_scores.R | ✓ | 计算2型糖尿病RECODe 10年心血管风险评分  该函数计算2型糖尿病并发症风险方程（RECODe）的六种心血管结局的 |
| [`calculate_RPP`](#calculate-rpp) | calculate_RPP.R | ✓ | 计算心率压力积 (RPP) |
| [`calculate_SHR`](#calculate-shr) | calculate_SHR.R | ✓ | 计算应激性高血糖比值（SHR）  从 UK Biobank 数据中提取空腹血糖（Glucose，单位 mmol/L）和  |
| [`check_medication`](#check-medication) | Diabetes_Comprehensive_diagnosis.R |  |  |
| [`classify_bmi`](#classify-bmi) | calculate_BMI_group.R |  |  |
| [`clean_medication_data`](#clean-medication-data) | Self_report_drug_p10005.R |  |  |
| [`clean_medication_data`](#clean-medication-data) | Self_report_drug_p6154_p10004.R |  |  |
| [`combine_disease_ages`](#combine-disease-ages) | combine_disease_ages.R | ✓ | 合并基于发病年龄的疾病诊断数据与时间变量  将多个由 `combine_diseases_and_age` 等函数生成的 |
| [`combine_disease_dates`](#combine-disease-dates) | combine_disease_dates.R | ✓ | 合并疾病诊断日期数据与时间变量  将多个已提取的疾病结果数据框（通常由 `combine_diseases_and_da |
| [`Common_data_extraction`](#common-data-extraction) | Common_data_extraction.R | ✓ | 通用数据提取函数 |
| [`compute_accel`](#compute-accel) | calculate_BioAge_Acceleration.R |  |  |
| [`convert_codes_to_names`](#convert-codes-to-names) | Diabetes_Comprehensive_diagnosis.R |  |  |
| [`convert_dates_to_binary`](#convert-dates-to-binary) | convert_dates_to_binary.R | ✓ |  |
| [`convert_number_to_date`](#convert-number-to-date) | convert_number_to_date.R | ✓ |  |
| [`convert_p20001_to_coding`](#convert-p20001-to-coding) | convert_p20001_to_coding.R | ✓ |  |
| [`convert_p20002_to_coding`](#convert-p20002-to-coding) | convert_p20002_to_coding.R | ✓ |  |
| [`convert_p20003_to_coding`](#convert-p20003-to-coding) | convert_p20003_to_coding.R | ✓ |  |
| [`convert_p20004_to_coding`](#convert-p20004-to-coding) | convert_p20004_to_coding.R | ✓ |  |
| [`convert_p40006_ultimate`](#convert-p40006-ultimate) | convert_p40006_ultimate.R | ✓ |  |
| [`convert_p41270_ultimate`](#convert-p41270-ultimate) | convert_p41270_ultimate.R | ✓ |  |
| [`convert_p41271_ultimate`](#convert-p41271-ultimate) | ICD9_41271_41281.R | ✓ |  |
| [`convert_p41272_ultimate`](#convert-p41272-ultimate) | convert_p41272_ultimate.R | ✓ |  |
| [`create_coding_dict`](#create-coding-dict) | create_coding_dict.R | ✓ |  |
| [`create_disease_diagnosis`](#create-disease-diagnosis) | create_disease_diagnosis.R | ✓ |  |
| [`create_med_col_name`](#create-med-col-name) | Self_report_drug_p10005.R |  |  |
| [`create_med_col_name`](#create-med-col-name) | Self_report_drug_p6154_p10004.R |  |  |
| [`create_medication_column`](#create-medication-column) | Diabetes_Comprehensive_diagnosis.R |  |  |
| [`create_overall_auc_summary_table`](#create-overall-auc-summary-table) | create_overall_auc_summary_table.R | ✓ | 多数据集ROC分析AUC汇总表生成函数 |
| [`dex_eGFR`](#dex-egfr) | dex_eGFR.R | ✓ | 肾功能估算函数 |
| [`Diabetes_Comprehensive_diagnosis`](#diabetes-comprehensive-diagnosis) | Diabetes_Comprehensive_diagnosis.R | ✓ | 综合糖尿病诊断函数 |
| [`Diabetes_duration`](#diabetes-duration) | Diabetes_duration.R | ✓ | 糖尿病病程计算函数 |
| [`diagnose_baseline_hypertension`](#diagnose-baseline-hypertension) | diagnose_baseline_hypertension.R | ✓ | 诊断基线高血压状态并计算已知病程年数  整合 UK Biobank 多来源数据，包括首次发生记录、死亡登记、住院诊断、  |
| [`diagnose_hypertension_byBP`](#diagnose-hypertension-bybp) | diagnose_hypertension_byBP.R | ✓ | 基于血压测量值诊断高血压 |
| [`disease_to_var`](#disease-to-var) | family_illnesses.R |  |  |
| [`eGFR_FAS_age`](#egfr-fas-age) | eGFR_FAS_age.R | ✓ |  |
| [`eGFR_FAS_height`](#egfr-fas-height) | eGFR_FAS_height.R | ✓ |  |
| [`electronic_device_use`](#electronic-device-use) | electronic_device_use.R | ✓ | 电子设备使用数据处理函数 |
| [`error`](#error) | calculate_BioAge_Acceleration.R |  |  |
| [`extract_FEV1_Best`](#extract-fev1-best) | extract_FEV1_Best.R | ✓ | 提取 FEV1（第1秒用力呼气量）的最佳值 |
| [`extract_instance`](#extract-instance) | calculate_CSPV.R |  |  |
| [`extract_protein_data`](#extract-protein-data) | extract_protein_data.R | ✓ | 蛋白组数据过滤与插补  读取或接收蛋白数据集，删除缺失率高于阈值的蛋白， 并剔除缺失蛋白数量过多的样本。可选择对剩余缺失 |
| [`extract_sleep_durations`](#extract-sleep-durations) | extract_sleep_durations.R | ✓ | 提取自报与实际睡眠时长  从 UK Biobank 同时获取参与者自报的每天睡眠小时数（p1160）和 过去一个月实际每 |
| [`family_illnesses`](#family-illnesses) | family_illnesses.R | ✓ | 家族疾病史数据处理函数 |
| [`family_survival_status`](#family-survival-status) | family_survival_status.R | ✓ | 家庭成员生存状态数据处理函数 |
| [`Fasting_time`](#fasting-time) | Fasting_time.R | ✓ | 禁食时间数据处理函数 |
| [`filter_protein_pairs`](#filter-protein-pairs) | filter_protein_pairs.R | ✓ | 筛选蛋白质互作对矩阵  根据非零值比例筛选蛋白对，保留比例在指定阈值范围内的互作对。 |
| [`fit_one`](#fit-one) | Statistics_lm.R |  |  |
| [`generate_validation_report`](#generate-validation-report) | generate_validation_report.R | ✓ |  |
| [`Genetic_principal_components`](#genetic-principal-components) | Genetic_principal_components.R | ✓ | 遗传主成分数据提取函数 |
| [`get_data_path`](#get-data-path) | data_config.R | ✓ | 获取当前数据路径 Get current data path |
| [`get_disease_names`](#get-disease-names) | merge_disease_dataframes.R |  |  |
| [`get_mode`](#get-mode) | Proteomics_covariate.R |  |  |
| [`get_ukb_path`](#get-ukb-path) | data_config.R |  | 获取数据路径（内部辅助函数） Get data path (internal helper)  返回当前设置的数据路径， |
| [`Hand_grip_strength_kg`](#hand-grip-strength-kg) | Hand_grip_strength_kg.R | ✓ | 提取 UK Biobank 握力数据并计算平均握力 |
| [`handle_special_values`](#handle-special-values) | handle_special_values.R | ✓ |  |
| [`has_medication`](#has-medication) | Self_report_drug_p10005.R |  |  |
| [`has_medication`](#has-medication) | Self_report_drug_p6154_p10004.R |  |  |
| [`hba1c_mmol_to_pct`](#hba1c-mmol-to-pct) | calculate_recode_scores.R |  |  |
| [`Healthy_diet_score`](#healthy-diet-score) | Healthy_diet_score.R | ✓ | 计算UK Biobank健康饮食得分  基于UK Biobank基线数据，计算7个健康饮食指标（水果、蔬菜、鱼类、加工肉 |
| [`Healthy_sleep_score`](#healthy-sleep-score) | Healthy_sleep_score.R | ✓ | 健康睡眠评分计算函数 |
| [`Hospital_cancer_Diagnoses`](#hospital-cancer-diagnoses) | Hospital_cancer_Diagnoses.R | ✓ |  |
| [`Hospital_cancer_Diagnoses_date`](#hospital-cancer-diagnoses-date) | Hospital_cancer_Diagnoses_date.R | ✓ |  |
| [`Hospital_cancer_Diagnoses_date_list`](#hospital-cancer-diagnoses-date-list) | Hospital_cancer_Diagnoses_date_list.R | ✓ |  |
| [`Hospital_inpatient_Diagnoses`](#hospital-inpatient-diagnoses) | Hospital_inpatient_Diagnoses.R | ✓ |  |
| [`Hospital_inpatient_Diagnoses_date`](#hospital-inpatient-diagnoses-date) | Hospital_inpatient_Diagnoses_date.R | ✓ |  |
| [`Hospital_inpatient_Diagnoses_date_ICD10`](#hospital-inpatient-diagnoses-date-icd10) | Hospital_inpatient_Diagnoses_date_ICD10.R | ✓ | 住院诊断日期ICD10编码处理函数 |
| [`Hospital_inpatient_Diagnoses_date_ICD9`](#hospital-inpatient-diagnoses-date-icd9) | Hospital_inpatient_Diagnoses_date_ICD9.R | ✓ | 住院诊断日期ICD9编码处理函数 |
| [`Hospital_inpatient_Diagnoses_date_list`](#hospital-inpatient-diagnoses-date-list) | Hospital_inpatient_Diagnoses_date_list.R | ✓ |  |
| [`Hospital_inpatient_Diagnoses_date_list_ICD9`](#hospital-inpatient-diagnoses-date-list-icd9) | ICD9_41271_41281.R | ✓ |  |
| [`Hospital_inpatient_Diagnoses_ICD9`](#hospital-inpatient-diagnoses-icd9) | ICD9_41271_41281.R | ✓ |  |
| [`Hospital_operative_Diagnoses`](#hospital-operative-diagnoses) | Hospital_operative_Diagnoses.R | ✓ |  |
| [`Hospital_operative_Diagnoses_date`](#hospital-operative-diagnoses-date) | Hospital_operative_Diagnoses_date.R | ✓ |  |
| [`Hospital_operative_Diagnoses_date_list`](#hospital-operative-diagnoses-date-list) | Hospital_operative_Diagnoses_date_list.R | ✓ |  |
| [`impute_mice`](#impute-mice) | impute_mice.R | ✓ | 多重插补链式方程（MICE）缺失值插补函数  该函数使用多重插补链式方程（Multivariate Imputation |
| [`impute_protein`](#impute-protein) | extract_protein_data.R |  | 内部函数：均值/中位数插补  对数据框中除 eid 列外的所有列进行均值或中位数插补。 |
| [`impute_rf`](#impute-rf) | impute_rf.R | ✓ | 随机森林缺失值插补函数  该函数使用随机森林（Random Forest）算法对 UK Biobank 蛋白质组学数据中 |
| [`merge_col`](#merge-col) | merge_col.R | ✓ |  |
| [`merge_disease_dataframes`](#merge-disease-dataframes) | merge_disease_dataframes.R | ✓ | 疾病数据框合并函数 |
| [`merge_disease_sources`](#merge-disease-sources) | merge_disease_sources.R | ✓ |  |
| [`mmol_to_mgdl`](#mmol-to-mgdl) | calculate_framingham_ukb.R |  |  |
| [`mmol_to_mgdl`](#mmol-to-mgdl) | calculate_recode_scores.R |  |  |
| [`newVb`](#newvb) | newVb.R | ✓ |  |
| [`NMR_process`](#nmr-process) | NMR_process.R | ✓ | 处理英国生物银行 (UK Biobank) NMR 代谢组数据  该函数负责完整的 NMR 代谢组数据处理流程： 1.  |
| [`obesity`](#obesity) | obesity.R | ✓ | 肥胖数据处理函数 |
| [`p20001_data`](#p20001-data) | p20001_data.R | ✓ |  |
| [`p20001_disease_age`](#p20001-disease-age) | p20001_disease_age.R | ✓ |  |
| [`p20001_disease_date`](#p20001-disease-date) | p20001_disease_date.R | ✓ |  |
| [`p20001_Extract_Convert`](#p20001-extract-convert) | p20001_Extract_Convert.R | ✓ |  |
| [`p20001_verbal_interview_diagnosis`](#p20001-verbal-interview-diagnosis) | p20001_verbal_interview_diagnosis.R | ✓ |  |
| [`p20001_Verbal_interview_disease_age_date`](#p20001-verbal-interview-disease-age-date) | p20001_Verbal_interview_disease_age_date.R | ✓ |  |
| [`p20002_data`](#p20002-data) | p20002_data.R | ✓ |  |
| [`p20002_disease_age`](#p20002-disease-age) | p20002_disease_age.R | ✓ |  |
| [`p20002_disease_date`](#p20002-disease-date) | p20002_disease_date.R | ✓ |  |
| [`p20002_Extract_Convert`](#p20002-extract-convert) | p20002_Extract_Convert.R | ✓ |  |
| [`p20002_verbal_interview_diagnosis`](#p20002-verbal-interview-diagnosis) | p20002_verbal_interview_diagnosis.R | ✓ |  |
| [`p20002_Verbal_interview_disease_age_date`](#p20002-verbal-interview-disease-age-date) | p20002_Verbal_interview_disease_age_date.R | ✓ |  |
| [`p20003_data`](#p20003-data) | p20003_data.R | ✓ |  |
| [`p20003_disease_medicine`](#p20003-disease-medicine) | p20003_disease_medicine.R | ✓ |  |
| [`p20003_Extract_Convert`](#p20003-extract-convert) | p20003_Extract_Convert.R | ✓ |  |
| [`p20004_data`](#p20004-data) | p20004_data.R | ✓ |  |
| [`p20004_disease_age`](#p20004-disease-age) | p20004_disease_age.R | ✓ |  |
| [`p20004_disease_date`](#p20004-disease-date) | p20004_disease_date.R | ✓ |  |
| [`p20004_Extract_Convert`](#p20004-extract-convert) | p20004_Extract_Convert.R | ✓ |  |
| [`p20004_verbal_interview_batch`](#p20004-verbal-interview-batch) | p20004_verbal_interview_batch.R | ✓ |  |
| [`p20004_Verbal_interview_operation_age_date`](#p20004-verbal-interview-operation-age-date) | p20004_Verbal_interview_operation_age_date.R | ✓ |  |
| [`p20006_data`](#p20006-data) | p20006_data.R | ✓ |  |
| [`p20007_data`](#p20007-data) | p20007_data.R | ✓ |  |
| [`p20008_data`](#p20008-data) | p20008_data.R | ✓ |  |
| [`p20009_data`](#p20009-data) | p20009_data.R | ✓ |  |
| [`p20010_data`](#p20010-data) | p20010_data.R | ✓ |  |
| [`p20011_data`](#p20011-data) | p20011_data.R | ✓ |  |
| [`p2966_i0`](#p2966-i0) | p2966_i0.R | ✓ |  |
| [`p2976_i0`](#p2976-i0) | p2976_i0.R | ✓ |  |
| [`p3627_i0`](#p3627-i0) | p3627_i0.R | ✓ |  |
| [`p3894_i0`](#p3894-i0) | p3894_i0.R | ✓ |  |
| [`p40005_data`](#p40005-data) | p40005_data.R | ✓ |  |
| [`p40006_data`](#p40006-data) | p40006_data.R | ✓ |  |
| [`p4056_i0`](#p4056-i0) | p4056_i0.R | ✓ |  |
| [`p41270_data`](#p41270-data) | p41270_data.R | ✓ |  |
| [`p41271_data`](#p41271-data) | ICD9_41271_41281.R | ✓ |  |
| [`p41272_data`](#p41272-data) | p41272_data.R | ✓ |  |
| [`p41280_data`](#p41280-data) | p41280_data.R | ✓ |  |
| [`p41281_data`](#p41281-data) | ICD9_41271_41281.R | ✓ |  |
| [`p41282_data`](#p41282-data) | p41282_data.R | ✓ |  |
| [`p6150_i0`](#p6150-i0) | p6150_i0.R | ✓ |  |
| [`p6153_i0`](#p6153-i0) | p6153_i0.R | ✓ |  |
| [`p6177_i0`](#p6177-i0) | p6177_i0.R | ✓ |  |
| [`parse_method_parameters`](#parse-method-parameters) | parse_method_parameters.R | ✓ |  |
| [`plot_single_survival_curve`](#plot-single-survival-curve) | plot_single_survival_curve.R | ✓ | 绘制单个蛋白质互作对生存曲线（带保存功能） |
| [`plot_summary`](#plot-summary) | plot_summary.R | ✓ | 绘制生存分析结果汇总图  创建汇总统计图，展示分析结果的基因数量和显著性分布 |
| [`plot_top_survival_curves`](#plot-top-survival-curves) | plot_top_survival_curves.R | ✓ | 绘制前N个显著基因的生存曲线  根据Cox回归分析结果，绘制显著基因的Kaplan-Meier生存曲线 |
| [`plot_volcano`](#plot-volcano) | plot_volcano.R | ✓ | 绘制生存分析结果的火山图  从Cox回归分析结果创建火山图，可视化基因的风险比和显著性 |
| [`predict_recode_cv`](#predict-recode-cv) | calculate_recode_scores.R |  |  |
| [`Pregnancy`](#pregnancy) | Pregnancy.R | ✓ | 提取怀孕状态 (p3140) |
| [`process_age_dataframe`](#process-age-dataframe) | process_age_dataframe.R | ✓ |  |
| [`process_date_dataframe`](#process-date-dataframe) | process_date_dataframe.R | ✓ |  |
| [`Process_Delta_Rank_Matrix`](#process-delta-rank-matrix) | Process_Delta_Rank_Matrix.R | ✓ | Delta Rank矩阵计算函数 |
| [`process_family_illnesses_fast`](#process-family-illnesses-fast) | family_illnesses.R |  |  |
| [`Proteomics_covariate`](#proteomics-covariate) | Proteomics_covariate.R | ✓ | 蛋白组学协变量提取函数 |
| [`Pulse_rate`](#pulse-rate) | Pulse_rate.R | ✓ | 提取脉搏率  提取指定实例的自动脉搏读数 (p102)、血压测量时脉搏 (p95) 以及单独脉搏 (p4194)。 优先 |
| [`read_disease_data`](#read-disease-data) | calculate_comorbidity.R |  |  |
| [`remove_by_missing`](#remove-by-missing) | remove_by_missing.R | ✓ | 根据缺失率阈值删除行和列  先删除缺失率超过指定阈值的列（特征），再在剩余列基础上删除缺失率超过指定阈值的行（样本）。  |
| [`safe_bind_rows`](#safe-bind-rows) | safe_bind_rows.R | ✓ | 安全合并两个数据框（只保留共有列）  安全地合并两个数据框，只保留共有的列，并可选添加来源标识 |
| [`safe_div`](#safe-div) | calculate_Derive_Blood_Indices.R |  | 安全除法（分母为 0 或 NA 时返回 NA） |
| [`SBP_DBP`](#sbp-dbp) | SBP_DBP.R | ✓ | 计算收缩压、舒张压及派生指标（自动血压优先，手动补充）  提取指定实例的自动血压读数（p4079/p4080）与手动血压 |
| [`Self_report_diagnosis_p6150`](#self-report-diagnosis-p6150) | Self_report_diagnosis_p6150.R | ✓ | 自我报告疾病诊断函数（p6150） |
| [`Self_report_DR_diagnosis`](#self-report-dr-diagnosis) | Self_report_DR_diagnosis.R | ✓ | 糖尿病视网膜病变自我报告诊断函数 |
| [`Self_report_drug_p10005`](#self-report-drug-p10005) | Self_report_drug_p10005.R | ✓ | 自我报告药物使用数据处理函数（p10005） |
| [`Self_report_drug_p6154_p10004`](#self-report-drug-p6154-p10004) | Self_report_drug_p6154_p10004.R | ✓ | 自我报告药物使用数据处理函数（p6154和p10004） |
| [`Self_report_drug_p6177_p6153`](#self-report-drug-p6177-p6153) | Self_report_drug_p6177_p6153.R | ✓ | 自我报告药物使用数据处理函数（p6177和p6153） |
| [`set_data_path`](#set-data-path) | data_config.R | ✓ | 设置默认数据路径 Set default data path |
| [`Sleep`](#sleep) | Sleep.R | ✓ | 睡眠数据处理函数 |
| [`Smoking_status`](#smoking-status) | Smoking_status.R | ✓ | 吸烟状态数据处理函数 |
| [`Statistics_lm`](#statistics-lm) | Statistics_lm.R | ✓ | 批量一元线性回归  对数据框中指定的因变量（Y）和自变量（X）进行所有配对回归，可加入协变量， 提供缺失值处理选项，并在 |
| [`sun_exposure_data`](#sun-exposure-data) | sun_exposure_data.R | ✓ | 提取日晒相关变量数据  从UK Biobank数据中提取日晒相关变量，包括户外时间、肤色、晒黑程度等 |
| [`time_Extract`](#time-extract) | time_Extract.R | ✓ | 时间信息提取与处理  从 UK Biobank 数据中提取并整合多种时间相关信息，包括抽血时间（最多四次）、死亡时间、失 |
| [`UKB_Assessment_Centre`](#ukb-assessment-centre) | UKB_Assessment_Centre.R | ✓ | UK Biobank 评估中心分类  从 UK Biobank 数据中提取评估中心（p54_i0）信息，并根据评估中心名 |
| [`UKB_Assessment_Centre_gard`](#ukb-assessment-centre-gard) | UKB_Assessment_Centre_gard.R | ✓ | UK Biobank 评估中心地理坐标数据  返回 UK Biobank 全部 29 个评估中心（含试点、影像及重复评估 |
| [`ukb_data_prepare`](#ukb-data-prepare) | ukb_data_prepare.R | ✓ | 拆分 UKB CSV 文件为带 eid 列的数据块 Split UKB CSV files into chunks wi |
| [`umol_to_mgdl_creat`](#umol-to-mgdl-creat) | calculate_recode_scores.R |  |  |
| [`validate_age_calculation`](#validate-age-calculation) | time_Extract.R |  |  |
| [`Vitamin_and_mineral_supplements_minerals`](#vitamin-and-mineral-supplements-minerals) | Vitamin_and_mineral_supplements.R | ✓ | 矿物质及其他膳食补充剂使用情况提取  从 UK Biobank 数据中提取矿物质及其他膳食补充剂使用情况，根据原始编码变 |
| [`Vitamin_and_mineral_supplements_minerals`](#vitamin-and-mineral-supplements-minerals) | Vitamin_and_mineral_supplements_minerals.R | ✓ | 矿物质及膳食补充剂使用情况提取函数 |
| [`Vitamin_and_mineral_supplements_vitamins`](#vitamin-and-mineral-supplements-vitamins) | Vitamin_and_mineral_supplements_vitamins.R | ✓ | 维生素补充剂使用情况提取  从 UK Biobank 数据中提取维生素补充剂使用情况，根据原始编码变量 p6155_i0 |
| [`Waist_circumference`](#waist-circumference) | Waist_circumference.R | ✓ | 获取UK Biobank腰围数据  该函数用于从UK Biobank数据集中提取指定索引的腰围测量值。 |

---

## 函数详情

### Alcohol_intake_frequency

**文件**: `R/Alcohol_intake_frequency.R`　**导出**: 是 ✓

**功能**: 酒精摄入频率数据处理函数

**描述**: 处理来自英国生物银行 p1558 字段的酒精摄入频率数据。 将原始编码转换为有意义的标签，并创建具有正确顺序的因子变量。

**签名**:

```r
Alcohol_intake_frequency(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回处理后的酒精摄入频率数据框

**示例**（来自源码 @examples）:

```r
# result <- Alcohol_intake_frequency(path = "./data")
```

---

### Alcohol_status

**文件**: `R/Alcohol_status.R`　**导出**: 是 ✓

**功能**: 饮酒状态数据处理函数

**描述**: 处理来自英国生物银行 p20117 字段的饮酒状态数据。 将原始编码转换为有意义的标签。

**签名**:

```r
Alcohol_status(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据目录的路径
- `instance`: 整数型，评估实例编号，默认 0（基线）

**返回**: 返回处理后的饮酒状态数据框

**示例**（来自源码 @examples）:

```r
# result <- Alcohol_status(path = "./data", instance = 0)
```

---

### Algorithmically_defined_outcomes_Extract

**文件**: `R/Algorithmically_defined_outcomes_Extract.R`　**导出**: 是 ✓

**功能**: 提取算法定义的结局数据  从UK Biobank数据中提取算法定义的结局数据

**签名**:

```r
Algorithmically_defined_outcomes_Extract(path = NULL)
```

**参数**:

- `path`: 数据路径，包含00.字段目录子目录

**返回**: 列表，包含Date（日期数据）和Diagnosis（二分类诊断数据）

---

### Common_data_extraction

**文件**: `R/Common_data_extraction.R`　**导出**: 是 ✓

**功能**: 通用数据提取函数

**描述**: 根据提供的字段ID提取和合并英国生物银行数据。 这是一个用于批量数据提取和列重命名的通用函数。 支持根据提供的字段ID列表从UK Biobank数据目录中提取数据， 并将提取的列重命名为用户指定的名称。

**签名**:

```r
Common_data_extraction(path = NULL, id, name)
```

**参数**:

- `path`: UK Biobank 数据目录的路径
- `id`: 要提取的 UK Biobank 字段ID字符向量
- `name`: 要重命名提取列的名称字符向量（必须与id长度相同）

**返回**: 返回提取数据并重命名列后的数据框

**示例**（来自源码 @examples）:

```r
# result <- Common_data_extraction(path = "./data", id = c("p1558_i0"), name = c("Alcohol_intake_frequency"))
```

---

### Diabetes_Comprehensive_diagnosis

**文件**: `R/Diabetes_Comprehensive_diagnosis.R`　**导出**: 是 ✓

**功能**: 综合糖尿病诊断函数

**描述**: 实现基于 Eastwood et al. (2016) 的综合糖尿病诊断算法，用于 UK Biobank 数据。 将参与者分类为多个糖尿病类别，包括1型糖尿病、2型糖尿病、妊娠糖尿病和糖尿病前期， 综合使用自我报告数据、药物记录和血液检测结果（HbA1c）。

**签名**:

```r
Diabetes_Comprehensive_diagnosis(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回包含综合糖尿病分类的数据框，包括： - 1型糖尿病分类 - 2型糖尿病分类 - 妊娠糖尿病分类 - 糖尿病前期分类 - 总体糖尿病状态 - 诊断日期（若有）

**示例**（来自源码 @examples）:

```r
# result <- Diabetes_Comprehensive_diagnosis(path = "./data")
# 查看糖尿病分类
# table(result$Diabetes_status)
```

---

### create_medication_column

**文件**: `R/Diabetes_Comprehensive_diagnosis.R`　**导出**: 否（internal）

**签名**:

```r
create_medication_column(data, original_col, drug_pattern)
```

---

### convert_codes_to_names

**文件**: `R/Diabetes_Comprehensive_diagnosis.R`　**导出**: 否（internal）

**签名**:

```r
convert_codes_to_names(codes, coding_dict)
```

---

### check_medication

**文件**: `R/Diabetes_Comprehensive_diagnosis.R`　**导出**: 否（internal）

**签名**:

```r
check_medication(codes)
```

---

### Diabetes_duration

**文件**: `R/Diabetes_duration.R`　**导出**: 是 ✓

**功能**: 糖尿病病程计算函数

**描述**: 通过结合自我报告的糖尿病诊断年龄（p2976）和口头访谈首次诊断年龄（p20002）来计算糖尿病病程。 当两个日期都有值时，使用较早的日期。

**签名**:

```r
Diabetes_duration(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回包含基线年龄、诊断年龄和糖尿病病程的数据框

**示例**（来自源码 @examples）:

```r
# result <- Diabetes_duration(path = "./data")
```

---

### Fasting_time

**文件**: `R/Fasting_time.R`　**导出**: 是 ✓

**功能**: 禁食时间数据处理函数

**描述**: 处理来自英国生物银行 p74 字段的禁食时间数据。 提取血液样本采集前的禁食小时数。

**签名**:

```r
Fasting_time(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据目录的路径
- `instance`: 整数型，评估实例编号，默认 0（基线）

**返回**: 返回包含禁食时间（小时）的数据框

**示例**（来自源码 @examples）:

```r
# result <- Fasting_time(path = "./data")
# result <- Fasting_time(path = "./data", instance = 2)
```

---

### Genetic_principal_components

**文件**: `R/Genetic_principal_components.R`　**导出**: 是 ✓

**功能**: 遗传主成分数据提取函数

**描述**: 从英国生物银行 p22009 字段提取遗传主成分。 返回最多40个遗传主成分；通常使用前20个作为协变量。

**签名**:

```r
Genetic_principal_components(path = NULL,n=20)
```

**参数**:

- `path`: UK Biobank 数据目录的路径
- `n`: 要返回的主成分数量（默认值为20）

**返回**: 返回包含遗传主成分（PC1到PCn）的数据框

**示例**（来自源码 @examples）:

```r
# result <- Genetic_principal_components(path = "./data", n = 20)
```

---

### Hand_grip_strength_kg

**文件**: `R/Hand_grip_strength_kg.R`　**导出**: 是 ✓

**功能**: 提取 UK Biobank 握力数据并计算平均握力

**描述**: 根据指定的评估实例（Instance）从 UK Biobank 数据中提取左手"p46_"与右手握力"p47_"， 将测量值为 0 的记录视为“未完成测量”并转为缺失值 `NA`，随后计算平均握力。 如果仅有一侧手数值有效，则直接使用该侧数值作为平均握力。

**签名**:

```r
Hand_grip_strength_kg(path = NULL, instance = 0)
```

**参数**:

- `instance`: 整数，指定评估实例，可取 0, 1, 2, 3。默认值为 0。 

**返回**: 一个 数据框，包含以下列： \describe{ \item{eid}{参与者的唯一标识符。} \item{Hand_grip_strength_left}{左手握力（单位：kg）。原始为 0 的值已替换为 `NA`。} \item{Hand_grip_strength_right}{右手握力（单位：kg）。原始为 0 的值已替换为 `NA`。} \item{Average_hand_grip_strength}{平均握力（单位：kg）。计算规则： 双手均有效（非缺失）时取左右手均值；仅左手有效时取左手值； 仅右手有效时取右手值；双手均缺失时返回 `NA`。} }

**示例**（来自源码 @examples）:

```r
\dontrun{
# 获取影像学访视握力数据
imaging_grip <- Hand_grip_strength_kg(path = "/data/ukb", instance = 2)
}
```

---

### Healthy_diet_score

**文件**: `R/Healthy_diet_score.R`　**导出**: 是 ✓

**功能**: 计算UK Biobank健康饮食得分  基于UK Biobank基线数据，计算7个健康饮食指标（水果、蔬菜、鱼类、加工肉类、未加工红肉、全谷物、精制谷物）的达标情况， 并依据至少4项达标定义健康饮食得分和二分类结局。参考Lourida等(2019)和Said等(2018)的研究。 参考文献1：Lourida I, Hannon E, Littlejohns TJ, Langa KM, Hyppönen E, Kuzma E, Llewellyn DJ. Association of Lifestyle and Genetic Risk With Incidence of Dementia. JAMA. 2019 Aug 6;322(5):430-437. doi: 10.1001/jama.2019.9879IF: 55.0 Q1 . PMID: 31302669; PMCID: PMC6628594. 参考文献2：每种食物的单位换算参考 Said MA, Verweij N, van der Harst P. Associations of Combined Genetic and Lifestyle Risks With Incident Cardiovascular Disease and Diabetes in the UK Biobank Study. JAMA Cardiol. 2018 Aug 1;3(8):693-702. doi: 10.1001/jamacardio.2018.1717. PMID: 29955826; PMCID: PMC6143077.

**签名**:

```r
Healthy_diet_score(path = NULL, i = 0)
```

**参数**:

- `path`: UK Biobank数据路径，用于`get_ukb_path()`和`batch_merge_data_optimized()`函数。
- `i`: 数据实例索引，默认为0，用于指定字段的实例编号。

**返回**: 返回一个数据框，包含： \item{eid}{参与者唯一标识} \item{Fruit_servings_day}{水果达标：1=≥3份/天，0=不达标，NA=无法确定} \item{Vegetable_servings_day}{蔬菜达标：1=≥3份/天，0=不达标，NA=无法确定} \item{Fish_servings_week}{鱼类达标：1=≥2份/周，0=不达标，NA=无法确定} \item{Processed_meats_serving_week}{加工肉类达标：1=≤1份/周，0=不达标，NA=无法确定} \item{Unprocessed_meats_servings_week}{未加工红肉达标：1=≤1.5份/周，0=不达标，NA=无法确定} \item{Whole_grains_servings_day}{全谷物达标：1=≥3份/天，0=不达标，NA=无法确定} \item{Refined_grains_servings_day}{精制谷物达标：1=≤1.5份/天，0=不达标，NA=无法确定} \item{Healthy_diet_score}{健康饮食总分（0-7），缺失项忽略} \item{Healthy_diet_binary}{健康饮食二分类：1=总分≥4，0=总分<4}

**示例**（来自源码 @examples）:

```r
\dontrun{
diet_data <- Healthy_diet_score(path = "/path/to/ukb/data", i = 0)
head(diet_data)
}
```

---

### Healthy_sleep_score

**文件**: `R/Healthy_sleep_score.R`　**导出**: 是 ✓

**功能**: 健康睡眠评分计算函数

**描述**: 基于五个低风险睡眠因素计算健康睡眠评分（0-5分）： 睡眠时型、睡眠时长、失眠、打鼾和日间嗜睡。 分类：最优(5)、良好(4)、中等(3)、较差(2)、极差(0-1)。 低风险睡眠因素定义： • 早期时间类型（早晨型或偏向早晨型） • 每天睡眠时间为7-8小时 • 从不或很少出现失眠症状 • 无自我报告的打鼾 • 无频繁的日间嗜睡（从不/很少或有时） 每个低风险因素得1分，高风险因素得0分，总分0-5分。

**签名**:

```r
Healthy_sleep_score(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回包含健康睡眠评分和睡眠质量分类的数据框

**示例**（来自源码 @examples）:

```r
# result <- Healthy_sleep_score(path = "./data")
```

---

### Hospital_cancer_Diagnoses

**文件**: `R/Hospital_cancer_Diagnoses.R`　**导出**: 是 ✓

**签名**:

```r
Hospital_cancer_Diagnoses(path = NULL)
```

---

### Hospital_cancer_Diagnoses_date

**文件**: `R/Hospital_cancer_Diagnoses_date.R`　**导出**: 是 ✓

**签名**:

```r
Hospital_cancer_Diagnoses_date(p40006, p40005, disease_codes, disease_name)
```

---

### Hospital_cancer_Diagnoses_date_list

**文件**: `R/Hospital_cancer_Diagnoses_date_list.R`　**导出**: 是 ✓

**签名**:

```r
Hospital_cancer_Diagnoses_date_list(p40006, p40005, disease_list)
```

---

### Hospital_inpatient_Diagnoses

**文件**: `R/Hospital_inpatient_Diagnoses.R`　**导出**: 是 ✓

**签名**:

```r
Hospital_inpatient_Diagnoses(path = NULL)
```

---

### Hospital_inpatient_Diagnoses_date

**文件**: `R/Hospital_inpatient_Diagnoses_date.R`　**导出**: 是 ✓

**签名**:

```r
Hospital_inpatient_Diagnoses_date(p41270, p41280, disease_codes, disease_name)
```

---

### Hospital_inpatient_Diagnoses_date_ICD10

**文件**: `R/Hospital_inpatient_Diagnoses_date_ICD10.R`　**导出**: 是 ✓

**功能**: 住院诊断日期ICD10编码处理函数

**描述**: 从英国生物银行住院记录中提取诊断数据，并根据ICD10编码进行疾病分类。 整合p41270（住院诊断）和p41280（诊断日期）数据，将日期转换为标准格式。

**签名**:

```r
Hospital_inpatient_Diagnoses_date_ICD10(path = NULL, disease_list)
```

**参数**:

- `path`: UK Biobank 数据目录的路径
- `disease_list`: 疾病列表，包含疾病名称和对应的ICD10编码

**返回**: 返回包含各疾病诊断状态和诊断日期的数据框

**示例**（来自源码 @examples）:

```r
# disease_list <- list(
#   "Hypertension" = c("I10", "I15"),
#   "Diabetes" = c("E10", "E11")
# )
# result <- Hospital_inpatient_Diagnoses_date_ICD10(path = "./data", disease_list = disease_list)
```

---

### Hospital_inpatient_Diagnoses_date_ICD9

**文件**: `R/Hospital_inpatient_Diagnoses_date_ICD9.R`　**导出**: 是 ✓

**功能**: 住院诊断日期ICD9编码处理函数

**描述**: 从英国生物银行住院记录中提取诊断数据，并根据ICD9编码进行疾病分类。 整合p41271（住院诊断）和p41281（诊断日期）数据，将日期转换为标准格式。

**签名**:

```r
Hospital_inpatient_Diagnoses_date_ICD9(path = NULL, disease_list)
```

**参数**:

- `path`: UK Biobank 数据目录的路径
- `disease_list`: 疾病列表，包含疾病名称和对应的ICD9编码

**返回**: 返回包含各疾病诊断状态和诊断日期的数据框

**示例**（来自源码 @examples）:

```r
# disease_list <- list(
#   "Hypertension" = c("I10", "I15"),
#   "Diabetes" = c("E10", "E11")
# )
# result <- Hospital_inpatient_Diagnoses_date_ICD9(path = "./data", disease_list = disease_list)
```

---

### Hospital_inpatient_Diagnoses_date_list

**文件**: `R/Hospital_inpatient_Diagnoses_date_list.R`　**导出**: 是 ✓

**签名**:

```r
Hospital_inpatient_Diagnoses_date_list(p41270, p41280, disease_list)
```

---

### Hospital_operative_Diagnoses

**文件**: `R/Hospital_operative_Diagnoses.R`　**导出**: 是 ✓

**签名**:

```r
Hospital_operative_Diagnoses(path = NULL)
```

---

### Hospital_operative_Diagnoses_date

**文件**: `R/Hospital_operative_Diagnoses_date.R`　**导出**: 是 ✓

**签名**:

```r
Hospital_operative_Diagnoses_date(p41272, p41282, disease_codes, disease_name)
```

---

### Hospital_operative_Diagnoses_date_list

**文件**: `R/Hospital_operative_Diagnoses_date_list.R`　**导出**: 是 ✓

**签名**:

```r
Hospital_operative_Diagnoses_date_list(p41272, p41282, disease_list)
```

---

### p41281_data

**文件**: `R/ICD9_41271_41281.R`　**导出**: 是 ✓

**签名**:

```r
p41281_data(path)
```

---

### p41271_data

**文件**: `R/ICD9_41271_41281.R`　**导出**: 是 ✓

**签名**:

```r
p41271_data(path)
```

---

### convert_p41271_ultimate

**文件**: `R/ICD9_41271_41281.R`　**导出**: 是 ✓

**签名**:

```r
convert_p41271_ultimate(data, path)
```

---

### Hospital_inpatient_Diagnoses_ICD9

**文件**: `R/ICD9_41271_41281.R`　**导出**: 是 ✓

**签名**:

```r
Hospital_inpatient_Diagnoses_ICD9(path = NULL)
```

---

### Hospital_inpatient_Diagnoses_date_list_ICD9

**文件**: `R/ICD9_41271_41281.R`　**导出**: 是 ✓

**签名**:

```r
Hospital_inpatient_Diagnoses_date_list_ICD9(p41271, p41281, disease_list)
```

---

### NMR_process

**文件**: `R/NMR_process.R`　**导出**: 是 ✓

**功能**: 处理英国生物银行 (UK Biobank) NMR 代谢组数据  该函数负责完整的 NMR 代谢组数据处理流程： 1. 检查并安装必要的包 (`ukbnmr`)。 2. 检查指定目录下是否已有处理好的 RDS 文件 (`processed_nmr.rds`)： - 如果存在，直接读取并返回；同时检查配套的 CSV 结果文件，若缺失则从 RDS 中补生成。 - 如果不存在，从原始数据开始提取、质控、校正技术变异，生成并保存所有结果文件。

**签名**:

```r
NMR_process(path = NULL)
```

**参数**:

- `path`: 可选，UK Biobank 数据存放的根目录。 

**返回**: 一个列表，包含以下处理后的对象： \item{biomarkers}{处理后的代谢物浓度矩阵 (data.table)} \item{biomarker_qc_flags}{代谢物质控标记 (data.table)} \item{sample_processing}{样本处理质控信息 (data.table)} \item{log_offset}{对数偏移量 (data.table)} \item{outlier_plate_detection}{离群板检测结果 (data.table)} \item{algorithm_version}{使用的算法版本 (整数)}

**示例**（来自源码 @examples）:

```r
\dontrun{
processed <- NMR_process(path = "F:/UKB_data")
head(processed$biomarkers)
}
```

---

### Pregnancy

**文件**: `R/Pregnancy.R`　**导出**: 是 ✓

**功能**: 提取怀孕状态 (p3140)

**描述**: 从 UK Biobank 中提取指定实例的怀孕状态，并清洗不确定/空值为缺失。

**签名**:

```r
Pregnancy(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 根目录，默认 NULL 自动获取路径。
- `instance`: 整数，实例号 (0/1/2/3)，默认 0。 

**返回**: 包含 eid 和 Pregnant 列的数据框。 \itemize{ \item \code{eid}：参与者 ID。 \item \code{Pregnant}：0 = 未怀孕，1 = 怀孕，NA 为缺失。 }

**示例**（来自源码 @examples）:

```r
\dontrun{
preg_baseline <- Pregnancy(instance = 0)
}
```

---

### Process_Delta_Rank_Matrix

**文件**: `R/Process_Delta_Rank_Matrix.R`　**导出**: 是 ✓

**功能**: Delta Rank矩阵计算函数

**描述**: 该函数用于计算蛋白质互作网络的Delta Rank矩阵。基于给定的蛋白质表达秩矩阵和蛋白质-蛋白质相互作用（PPI）网络，该函数筛选出两个节点均存在于秩矩阵中的互作对，并计算每个样本中每个互作对的Delta Rank值（δ）。Delta Rank定义为互作对中两个蛋白质在样本内的表达秩之差（rank(node1) - rank(node2)）。 主要步骤： 1. 数据验证与提取：验证输入秩矩阵的格式，提取样本ID和蛋白质名称 2. PPI网络筛选：从输入的PPI网络中筛选出两个节点均存在于秩矩阵中的互作对 3. Delta Rank计算：对于每个筛选后的互作对，在每个样本中计算两个蛋白质表达秩的差值

**签名**:

```r
Process_Delta_Rank_Matrix(rank_matrix,ppi)
```

**参数**:

- `rank_matrix`: 数据框或矩阵，包含蛋白质表达秩数据。第一列应为样本ID（列名需为"eid"），后续各列为蛋白质表达秩值，列名为蛋白质名称
- `ppi`: 数据框，包含蛋白质-蛋白质相互作用网络信息。必须包含node1和node2两列，分别表示互作对中的两个蛋白质名称

**返回**: 返回一个矩阵，其中行表示蛋白质互作对（格式为"node1_node2"），列表示样本（样本ID作为列名）。矩阵中的每个值为对应样本中该互作对的Delta Rank（δ）

**示例**（来自源码 @examples）:

```r
# rank_matrix <- read.csv("protein_rank_matrix.csv")
# ppi <- read.csv("ppi_network.csv")
# result <- Process_Delta_Rank_Matrix(rank_matrix, ppi)
```

---

### calculate_delta_rank

**文件**: `R/Process_Delta_Rank_Matrix.R`　**导出**: 否（internal）

**签名**:

```r
calculate_delta_rank(rank_mat, ppi_df)
```

---

### Proteomics_covariate

**文件**: `R/Proteomics_covariate.R`　**导出**: 是 ✓

**功能**: 蛋白组学协变量提取函数

**描述**: 提取蛋白组学的技术因素协变量和常见人口统计学、生活方式协变量。 包括：样本处理延迟时间、批次、抽血季节、评估中心、遗传主成分、禁食时间、年龄、性别、收入、种族、汤森剥夺指数、教育程度、肥胖状态、吸烟状态和饮酒状态等。

**签名**:

```r
Proteomics_covariate(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回包含多种协变量的数据框，包括： - eid: 参与者ID - Processing_Delay: 平均处理延迟天数 - Batch: 批次众数 - Season: 抽血季节 - Assessment_Centre: 评估中心 - 遗传主成分（PC1-PC20） - Fasting_time: 禁食时间 - 年龄、性别、种族、教育、肥胖、吸烟、饮酒等协变量

**示例**（来自源码 @examples）:

```r
# result <- Proteomics_covariate(path = "./data")
```

---

### get_mode

**文件**: `R/Proteomics_covariate.R`　**导出**: 否（internal）

**签名**:

```r
get_mode(x)
```

---

### Pulse_rate

**文件**: `R/Pulse_rate.R`　**导出**: 是 ✓

**功能**: 提取脉搏率  提取指定实例的自动脉搏读数 (p102)、血压测量时脉搏 (p95) 以及单独脉搏 (p4194)。 优先使用自动脉搏的平均值，若缺失则使用血压测量脉搏的平均值，再缺失则使用单独脉搏读数。

**签名**:

```r
Pulse_rate(path = NULL, instance = 0)
```

**参数**:

- `path`: 数据路径，默认自动获取 UK Biobank 数据路径。
- `instance`: 整数，实例号 (0/1/2/3)，默认 0。

**返回**: 数据框，包含 eid 和 Pulse_rate（单位：bpm）。

---

### SBP_DBP

**文件**: `R/SBP_DBP.R`　**导出**: 是 ✓

**功能**: 计算收缩压、舒张压及派生指标（自动血压优先，手动补充）  提取指定实例的自动血压读数（p4079/p4080）与手动血压读数（p94/p93）， 优先使用自动血压，若自动读数缺失则用手动血压补充。计算平均动脉压、脉压。

**签名**:

```r
SBP_DBP(path = NULL, instance = 0)
```

**参数**:

- `path`: 数据路径，默认自动获取。
- `instance`: 整数，实例号 (0/1/2/3)，默认 0。

**返回**: 数据框，包含 eid, SBP, DBP, Pulse_pressure, Mean_arterial_pressure。

---

### Self_report_DR_diagnosis

**文件**: `R/Self_report_DR_diagnosis.R`　**导出**: 是 ✓

**功能**: 糖尿病视网膜病变自我报告诊断函数

**描述**: 提取英国生物银行中参与者自我报告的糖尿病相关眼病诊断信息。 从p5901字段（糖尿病相关眼病诊断年龄）提取数据，处理多个实例的诊断年龄， 计算首次诊断年龄并生成诊断状态标志。

**签名**:

```r
Self_report_DR_diagnosis(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回包含糖尿病视网膜病变诊断信息的数据框： - eid: 参与者ID - Diabetic_eye_disease_age: 糖尿病相关眼病首次诊断年龄 - Diabetic_eye_disease_diagnosis: 诊断状态（1=有诊断，NA=无诊断或缺失）

**示例**（来自源码 @examples）:

```r
# result <- Self_report_DR_diagnosis(path = "./data")
```

---

### Self_report_diagnosis_p6150

**文件**: `R/Self_report_diagnosis_p6150.R`　**导出**: 是 ✓

**功能**: 自我报告疾病诊断函数（p6150）

**描述**: 从英国生物银行提取p6150及相关字段的自我报告疾病诊断信息。 包括高血压、心脏病发作、中风和心绞痛的诊断状态和诊断年龄。 整合多个数据源，合并重复诊断信息。

**签名**:

```r
Self_report_diagnosis_p6150(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回包含多种心血管疾病诊断信息的数据框： - eid: 参与者ID - high_blood_pressure: 高血压诊断状态 - heart_attack: 心脏病发作诊断状态 - stroke: 中风诊断状态 - angina: 心绞痛诊断状态 - 各疾病对应的诊断年龄

**示例**（来自源码 @examples）:

```r
# result <- Self_report_diagnosis_p6150(path = "./data")
```

---

### Self_report_drug_p10005

**文件**: `R/Self_report_drug_p10005.R`　**导出**: 是 ✓

**功能**: 自我报告药物使用数据处理函数（p10005）

**描述**: 处理来自英国生物银行 p10005 字段的自我报告药物使用数据。 该字段包含用于戒烟、便秘、胃灼热和过敏的药物信息。 解析药物使用情况，创建各药物类别的二进制变量和汇总变量。

**签名**:

```r
Self_report_drug_p10005(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回包含药物使用信息的数据框： - eid: 参与者ID - Omeprazole_use: 奥美拉唑使用状态（胃药） - Laxatives_use: 泻药使用状态 - Stomach_medication_use: 消化系统药物使用状态 - Antihistamines_use: 抗组胺药使用状态（过敏药） - Nicotine_use: 尼古丁替代疗法使用状态（戒烟）

**示例**（来自源码 @examples）:

```r
# result <- Self_report_drug_p10005(path = "./data")
```

---

### clean_medication_data

**文件**: `R/Self_report_drug_p10005.R`　**导出**: 否（internal）

**签名**:

```r
clean_medication_data(med_string)
```

---

### has_medication

**文件**: `R/Self_report_drug_p10005.R`　**导出**: 否（internal）

**签名**:

```r
has_medication(med_string, medication)
```

---

### create_med_col_name

**文件**: `R/Self_report_drug_p10005.R`　**导出**: 否（internal）

**签名**:

```r
create_med_col_name(med)
```

---

### Self_report_drug_p6154_p10004

**文件**: `R/Self_report_drug_p6154_p10004.R`　**导出**: 是 ✓

**功能**: 自我报告药物使用数据处理函数（p6154和p10004）

**描述**: 处理来自英国生物银行 p6154 和 p10004 字段的自我报告药物使用数据。 p6154字段包含缓解疼痛、便秘、胃灼热的药物信息，p10004字段包含类似药物信息。 整合两个数据源，解析药物使用情况，创建各药物类别的二进制变量和汇总变量。

**签名**:

```r
Self_report_drug_p6154_p10004(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回包含药物使用信息的数据框： - eid: 参与者ID - 各药物使用状态（Aspirin_use, Ibuprofen_use, Paracetamol_use, Codeine_use等） - 药物类别汇总变量（Pain_medication_use, Stomach_medication_use, NSAID_medication_use）

**示例**（来自源码 @examples）:

```r
# result <- Self_report_drug_p6154_p10004(path = "./data")
```

---

### clean_medication_data

**文件**: `R/Self_report_drug_p6154_p10004.R`　**导出**: 否（internal）

**签名**:

```r
clean_medication_data(med_string)
```

---

### has_medication

**文件**: `R/Self_report_drug_p6154_p10004.R`　**导出**: 否（internal）

**签名**:

```r
has_medication(med_string, medication)
```

---

### create_med_col_name

**文件**: `R/Self_report_drug_p6154_p10004.R`　**导出**: 否（internal）

**签名**:

```r
create_med_col_name(med)
```

---

### Self_report_drug_p6177_p6153

**文件**: `R/Self_report_drug_p6177_p6153.R`　**导出**: 是 ✓

**功能**: 自我报告药物使用数据处理函数（p6177和p6153）

**描述**: 处理来自英国生物银行 p6177 和 p6153 字段的自我报告药物使用数据。 p6177字段包含胆固醇、血压或糖尿病药物信息，p6153字段包含胆固醇、血压、糖尿病药物或外源性激素信息。 整合两个数据源，合并重复的药物使用信息。

**签名**:

```r
Self_report_drug_p6177_p6153(path = NULL,instance = 0)
```

**参数**:

- `path`: UK Biobank 数据目录的路径
- `instance`: 整数型，评估实例编号，默认 0（基线）

**返回**: 返回包含药物使用信息的数据框： - eid: 参与者ID - blood_pressure_med: 血压药物使用状态 - cholesterol_lowering_med: 降胆固醇药物使用状态 - insulin: 胰岛素使用状态 - any_cvd_med: 心血管疾病药物使用状态 - 外源性激素使用状态

**示例**（来自源码 @examples）:

```r
# result <- Self_report_drug_p6177_p6153(path = "./data",instance = 0)
```

---

### Sleep

**文件**: `R/Sleep.R`　**导出**: 是 ✓

**功能**: 睡眠数据处理函数

**描述**: 处理来自英国生物银行 p1160、p1170、p1180、p1190、p1200、p1210、p1220 字段的睡眠相关数据。 提取睡眠时长、失眠情况、睡眠时型和其他睡眠特征。

**签名**:

```r
Sleep(path = NULL,instance = 0)
```

**参数**:

- `path`: UK Biobank 数据目录的路径
- `instance`: 整数型，评估实例编号，默认 0（基线） 

**返回**: 返回包含处理后的睡眠特征数据框： - Sleep_duration: 平均每日睡眠时长 - Insomnia: 失眠症状频率 - Morning/evening_person(chronotype): 睡眠时型偏好 - Nap_during_day: 白天小睡频率 - Getting_up_in_morning: 起床难易度 - Snoring: 打鼾频率 - Daytime_dozing/sleeping: 日间嗜睡程度

**示例**（来自源码 @examples）:

```r
# result <- Sleep(path = "./data")
```

---

### Smoking_status

**文件**: `R/Smoking_status.R`　**导出**: 是 ✓

**功能**: 吸烟状态数据处理函数

**描述**: 处理来自英国生物银行 p20116 和 p3456 字段的吸烟状态数据。 提取当前吸烟状态和每日香烟消费量。

**签名**:

```r
Smoking_status(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据目录的路径
- `instance`: 整数型，评估实例编号，默认 0（基线）

**返回**: 返回包含吸烟状态和每日香烟消费量的数据框

**示例**（来自源码 @examples）:

```r
# result <- Smoking_status(path = "./data", instance = 0)
```

---

### Statistics_lm

**文件**: `R/Statistics_lm.R`　**导出**: 是 ✓

**功能**: 批量一元线性回归  对数据框中指定的因变量（Y）和自变量（X）进行所有配对回归，可加入协变量， 提供缺失值处理选项，并在结果中报告每个模型因缺失值损失的有效样本量。

**签名**:

```r
Statistics_lm(data, y_cols, x_cols, covars = character(0), na_action = c("na.omit", "na.fail", "na.exclude"), check_missing = TRUE, show_progress = TRUE, parallel = FALSE, n_cores = 1, keep_models = TRUE)
```

**参数**:

- `data`: 合并后的数据框。
- `y_cols`: 因变量列名向量。
- `x_cols`: 自变量列名向量。
- `covars`: 协变量列名向量，默认 `character(0)`。
- `na_action`: 缺失值处理方法，可选 `"na.omit"`（默认，仅使用完全观测）、 `"na.fail"`（遇缺失即报错）、`"na.exclude"`（类似 na.omit 但保留残差长度）。 传入字符串，内部自动转换为对应函数。
- `check_missing`: 逻辑值，运行前是否打印全数据缺失扫描摘要，默认 `TRUE`。
- `show_progress`: 逻辑值，是否显示进度条。
- `parallel`: 逻辑值，是否并行计算。
- `n_cores`: 整数，并行核心数。
- `keep_models`: 逻辑值，是否在返回值中保留完整的 `lm` 模型对象。 默认 `TRUE`。若设为 `FALSE`，则仅保留统计量结果，模型对象将被丢弃， 可大幅降低内存占用（当配对数量巨大时推荐使用）。 

**返回**: 列表，包含 `models` 和 `results`。 - `models`：若 `keep_models = TRUE`，为与结果行一一对应的 `lm` 对象列表， 拟合失败时对应位置为 `NA`；若 `keep_models = FALSE`，则为空列表。 - `results`：数据框，包含模型统计量及 `n_missing` 列（因变量缺失被排除的样本数）。

**示例**（来自源码 @examples）:

```r
\dontrun{
res <- Statistics_lm(dat, y_vars, x_vars, covars = c("age"),
na_action = "na.omit", check_missing = TRUE,
keep_models = FALSE)
head(res$results)
}
```

---

### fit_one

**文件**: `R/Statistics_lm.R`　**导出**: 否（internal）

**签名**:

```r
fit_one(i)
```

---

### UKB_Assessment_Centre

**文件**: `R/UKB_Assessment_Centre.R`　**导出**: 是 ✓

**功能**: UK Biobank 评估中心分类  从 UK Biobank 数据中提取评估中心（p54_i0）信息，并根据评估中心名称将其归类为英格兰（England）、威尔士（Wales）或苏格兰（Scotland）。

**签名**:

```r
UKB_Assessment_Centre(path = NULL)
```

**参数**:

- `path`: 数据路径，用于读取 UK Biobank 原始数据。

**返回**: 返回一个 tibble 数据框，包含以下列： \item{Assessment_Centre}{原始评估中心名称} \item{Region_NS}{原始评估中心按照南北划分为两组} \item{Assessment_Country}{分类后的国家/地区，因子型，水平为 England、Wales、Scotland}

**示例**（来自源码 @examples）:

```r
\dontrun{
centre_data <- UKB_Assessment_Centre(path = "data/ukb")
}
```

---

### UKB_Assessment_Centre_gard

**文件**: `R/UKB_Assessment_Centre_gard.R`　**导出**: 是 ✓

**功能**: UK Biobank 评估中心地理坐标数据  返回 UK Biobank 全部 29 个评估中心（含试点、影像及重复评估中心）的 英国国家网格坐标（British National Grid）及中心信息。

**签名**:

```r
UKB_Assessment_Centre_gard()
```

**返回**: 一个 \code{data.frame}，包含以下列： \itemize{ \item \code{centre_id}: 中心编号 \item \code{centre_name}: 中心完整名称 \item \code{short_name}: 中心简称 \item \code{gridx}: 英国国家网格 Easting（东距） \item \code{gridy}: 英国国家网格 Northing（北距） }

**示例**（来自源码 @examples）:

```r
centres <- UKB_Assessment_Centre_gard()
head(centres)
```

---

### Vitamin_and_mineral_supplements_minerals

**文件**: `R/Vitamin_and_mineral_supplements.R`　**导出**: 是 ✓

**功能**: 矿物质及其他膳食补充剂使用情况提取  从 UK Biobank 数据中提取矿物质及其他膳食补充剂使用情况，根据原始编码变量 p6179_i0 生成六种矿物质/补充剂的二元指示变量。 特殊处理：“None of the above” 将所有变量设为 0；“Prefer not to answer” 将所有变量设为 NA。

**签名**:

```r
Vitamin_and_mineral_supplements_minerals(path = NULL)
```

**参数**:

- `path`: 数据路径，用于读取 UK Biobank 原始数据。

**返回**: 返回一个 tibble 数据框，包含以下列： \item{Fish_oil_supplements}{是否服用鱼油（包括鳕鱼肝油）补充剂（1=是，0=否，NA=不愿回答）} \item{Glucosamine_supplements}{是否服用氨基葡萄糖补充剂} \item{Calcium_supplements}{是否服用钙补充剂} \item{Zinc_supplements}{是否服用锌补充剂} \item{Iron_supplements}{是否服用铁补充剂} \item{Selenium_supplements}{是否服用硒补充剂}

**示例**（来自源码 @examples）:

```r
\dontrun{
mineral_data <- Vitamin_and_mineral_supplements_minerals(path = "data/ukb")
}
```

---

### Vitamin_and_mineral_supplements_minerals

**文件**: `R/Vitamin_and_mineral_supplements_minerals.R`　**导出**: 是 ✓

**功能**: 矿物质及膳食补充剂使用情况提取函数

**描述**: 从英国生物银行(UK Biobank)数据中提取矿物质及其他膳食补充剂的使用情况。 基于p6179_i0字段的原始数据，通过字符串匹配识别参与者是否使用各类矿物质补充剂。 返回包含6种矿物质补充剂（鱼油、氨基葡萄糖、钙、锌、铁、硒）使用状态的二值变量。

**签名**:

```r
Vitamin_and_mineral_supplements_minerals(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径，该路径下应包含ID.xlsx及相应的RDS数据文件

**返回**: 返回一个tibble数据框，包含以下列： - eid: 参与者唯一标识符 - Fish_oil_supplements: 鱼油（含鳕鱼肝油）使用状态（1=使用，0=未使用，NA=拒绝回答或缺失） - Glucosamine_supplements: 氨基葡萄糖使用状态（1=使用，0=未使用，NA=拒绝回答或缺失） - Calcium_supplements: 钙补充剂使用状态（1=使用，0=未使用，NA=拒绝回答或缺失） - Zinc_supplements: 锌补充剂使用状态（1=使用，0=未使用，NA=拒绝回答或缺失） - Iron_supplements: 铁补充剂使用状态（1=使用，0=未使用，NA=拒绝回答或缺失） - Selenium_supplements: 硒补充剂使用状态（1=使用，0=未使用，NA=拒绝回答或缺失）

**示例**（来自源码 @examples）:

```r
\dontrun{
mineral_data <- Vitamin_and_mineral_supplements_minerals(path = "data/ukb")
}
```

---

### Vitamin_and_mineral_supplements_vitamins

**文件**: `R/Vitamin_and_mineral_supplements_vitamins.R`　**导出**: 是 ✓

**功能**: 维生素补充剂使用情况提取  从 UK Biobank 数据中提取维生素补充剂使用情况，根据原始编码变量 p6155_i0 生成七种维生素/叶酸/复合维生素的二元指示变量。 特殊处理：“None of the above” 将所有变量设为 0；“Prefer not to answer” 将所有变量设为 NA。

**签名**:

```r
Vitamin_and_mineral_supplements_vitamins(path = NULL)
```

**参数**:

- `path`: 数据路径，用于读取 UK Biobank 原始数据。

**返回**: 返回一个 tibble 数据框，包含以下列： \item{Vitamin_A_supplements}{是否服用维生素 A 补充剂（1=是，0=否，NA=不愿回答）} \item{Vitamin_B_supplements}{是否服用维生素 B 补充剂} \item{Vitamin_C_supplements}{是否服用维生素 C 补充剂} \item{Vitamin_D_supplements}{是否服用维生素 D 补充剂} \item{Vitamin_E_supplements}{是否服用维生素 E 补充剂} \item{Folic_acid_supplements}{是否服用叶酸补充剂} \item{Multivitamins_supplements}{是否服用复合维生素补充剂}

**示例**（来自源码 @examples）:

```r
\dontrun{
vitamin_data <- Vitamin_and_mineral_supplements_vitamins(path = "data/ukb")
}
```

---

### Waist_circumference

**文件**: `R/Waist_circumference.R`　**导出**: 是 ✓

**功能**: 获取UK Biobank腰围数据  该函数用于从UK Biobank数据集中提取指定索引的腰围测量值。

**签名**:

```r
Waist_circumference(path = NULL, i = 0)
```

**参数**:

- `path`: 字符型，UK Biobank数据的根目录路径。若为NULL，则通过 \code{get_ukb_path} 自动获取。
- `i`: 数值型，索引值，用于构建数据ID，默认为0。 

**返回**: 返回一个数据框，包含腰围相关的测量数据。

**示例**（来自源码 @examples）:

```r
\dontrun{
# 获取默认索引的腰围数据
waist_data <- Waist_circumference()

# 指定路径和索引
waist_data <- Waist_circumference(path = "/path/to/ukb", i = 1)
}
```

---

### add_col

**文件**: `R/add_col.R`　**导出**: 是 ✓

**签名**:

```r
add_col(data, colname = NULL, value = NULL, condition = NULL, position = NULL)
```

---

### age_sex_income

**文件**: `R/age_sex_income.R`　**导出**: 是 ✓

**功能**: 年龄、性别和收入数据处理函数

**描述**: 处理来自英国生物银行 p31（性别）、p21003（年龄）和 p738（收入）字段的人口统计数据。 返回清理和因子化的人口统计变量。

**签名**:

```r
age_sex_income(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回包含年龄、性别和收入因子的数据框

**示例**（来自源码 @examples）:

```r
# result <- age_sex_income(path = "./data")
```

---

### batch_cindex_analysis

**文件**: `R/batch_cindex_analysis.R`　**导出**: 是 ✓

**功能**: 批量计算C指数函数  对多个变量进行批量C指数计算，适用于生存数据

**签名**:

```r
batch_cindex_analysis(OS, proteins, time_col, status_col, predictors = NULL, method = "HZ", verbose = TRUE, seed = 123)
```

**参数**:

- `OS`: 数据框，包含生存时间和生存状态（必须包含 `time_col` 和 `status_col` 指定的列）
- `proteins`: 数据框，包含蛋白质表达变量（与 `OS` 通过 `eid` 列合并）
- `time_col`: 字符，生存时间变量名
- `status_col`: 字符，生存状态变量名（通常1=事件，0=删失）
- `predictors`: 字符向量，预测变量名。如果为NULL，则使用除生存时间和状态外的所有数值型变量
- `method`: C指数计算方法，"HZ" (Harrell's C) 或 "Uno" (Uno's C)
- `verbose`: 是否显示详细进度信息，默认为TRUE
- `seed`: 随机种子，用于重抽样，默认为123

**返回**: 包含以下内容的列表： - cindex_results: 所有变量的C指数结果数据框 - best_predictors: 按C指数排序的前n个最佳预测变量

**示例**（来自源码 @examples）:

```r
\dontrun{
cindex_results <- batch_cindex_analysis(
OS = OS_data,
proteins = protein_data,
time_col = "OS.time",
status_col = "OS",
predictors = NULL,
method = "HZ",
verbose = TRUE
)
}
```

---

### batch_impute

**文件**: `R/batch_impute.R`　**导出**: 是 ✓

**功能**: 批量缺失值插补处理函数  该函数对 UK Biobank 蛋白质组学数据进行批量缺失值插补处理，实现完整的插补分析流程。 首先计算每个蛋白质变量的缺失率，根据设定的阈值筛选保留的蛋白质（默认缺失率≤20%）， 然后对筛选后的数据同时应用多种插补方法（均值、中位数、KNN、MICE、随机森林）， 并将各方法插补结果保存为CSV文件。该函数为缺失值处理提供了一站式解决方案， 便于用户比较不同插补方法的效果。

**签名**:

```r
batch_impute(data, threshold = 20)
```

**参数**:

- `data`: 数据框，包含 eid 列（样本唯一标识符）和多个蛋白质表达量列的数据。 数据框中可能包含不同程度的缺失值。
- `threshold`: 数值，缺失率阈值（百分比），默认为 20。只有缺失率低于或等于 该阈值的蛋白质变量才会被保留进行后续插补分析，缺失率过高的 变量将被剔除。 

**返回**: 返回一个命名列表，包含以下元素： \itemize{ \item original: 原始完整数据框，未做任何处理 \item filtered: 根据缺失率阈值筛选后的数据框，仅包含保留的蛋白质列 \item mean: 使用均值插补后的完整数据框 \item median: 使用中位数插补后的完整数据框 \item knn: 使用K近邻（KNN）算法插补后的完整数据框 \item mice: 使用MICE多重插补后的第一个完整数据集 \item rf: 使用随机森林算法插补后的完整数据框 } 同时，函数会在工作目录下生成多个输出文件： - protein_missing_rate.xlsx: 各蛋白质的缺失率统计表 - proteins_filtered.csv: 筛选后的原始数据 - proteins_mean_imputed.csv: 均值插补结果 - proteins_median_imputed.csv: 中位数插补结果 - proteins_knn_imputed.csv: KNN插补结果 - proteins_mice_imputed.csv: MICE插补结果 - proteins_rf_imputed.csv: 随机森林插补结果

**示例**（来自源码 @examples）:

```r
\dontrun{
# 假设 protein_data 是包含 eid 和多个蛋白质列的数据框
# 执行批量插补，保留缺失率≤20%的蛋白质
impute_results <- batch_impute(data = protein_data, threshold = 20)

# 查看筛选后的数据维度
dim(impute_results$filtered)

# 比较不同插补方法的结果
head(impute_results$mean)
head(impute_results$rf)
}
```

---

### batch_merge_data

**文件**: `R/batch_merge_data.R`　**导出**: 是 ✓

**功能**: 批量数据合并函数

**描述**: 根据字段ID列表批量合并多个英国生物银行数据文件。 使用 left_join 通过 eid（参与者ID）合并数据。

**签名**:

```r
batch_merge_data(path = NULL, id_list)
```

**参数**:

- `path`: UK Biobank 数据目录的路径
- `id_list`: 要合并的字段ID向量（例如：c("p21001", "p21002")）

**返回**: 返回包含所有指定字段按eid合并后的数据框

**示例**（来自源码 @examples）:

```r
# result <- batch_merge_data(path = "./data", id_list = c("p21001", "p21002"))
```

---

### batch_merge_data_optimized

**文件**: `R/batch_merge_data_optimized.R`　**导出**: 是 ✓

**功能**: 批量数据合并优化函数

**描述**: batch_merge_data 函数的优化版本，一次性读取文件并缓存。 对于合并来自同一文件的多个字段更加高效。

**签名**:

```r
batch_merge_data_optimized(data_path = NULL, id_list)
```

**参数**:

- `data_path`: UK Biobank 数据目录的路径
- `id_list`: 要合并的字段ID向量（例如：c("p21001", "p21002")）

**返回**: 返回包含所有指定字段按eid合并后的数据框

**示例**（来自源码 @examples）:

```r
# result <- batch_merge_data_optimized(data_path = "./data", id_list = c("p21001", "p21002"))
```

---

### batch_roc_analysis

**文件**: `R/batch_roc_analysis.R`　**导出**: 是 ✓

**功能**: 批量ROC分析函数 对多个变量和结局进行批量ROC分析，计算AUC、最佳截断点等指标

**签名**:

```r
batch_roc_analysis(data, outcome, predictors = NULL, positive_class = "1", plot_roc = FALSE, plot_n = 10, combine_plot = FALSE, save_plot = FALSE, plot_path = "ROC_plots", verbose = TRUE, seed = 123)
```

**参数**:

- `data`: 数据框，包含所有变量和结局
- `outcome`: 字符向量，结局变量名
- `predictors`: 字符向量，预测变量名。如果为NULL，则使用除结局外的所有数值型变量
- `positive_class`: 阳性类别（字符型），默认为"1"
- `plot_roc`: 是否绘制ROC曲线图，默认为TRUE
- `plot_n`: 当plot_roc为TRUE时，绘制前n个变量的ROC曲线，默认为10
- `combine_plot`: 是否将所有ROC曲线合并到一张图中，默认为TRUE
- `save_plot`: 是否保存ROC曲线图，默认为FALSE
- `plot_path`: 保存图片的路径
- `verbose`: 是否显示详细进度信息，默认为TRUE
- `seed`: 随机种子，用于重抽样，默认为123

**返回**: 包含以下内容的列表： - roc_results: 所有变量的ROC结果数据框 - best_predictors: 按AUC排序的前n个最佳预测变量 - roc_plots: ROC曲线图列表（如果plot_roc=TRUE） - combined_plot: 合并的ROC曲线图（如果combine_plot=TRUE）

---

### batch_survival_analysis

**文件**: `R/batch_survival_analysis.R`　**导出**: 否（internal）

**签名**:

```r
batch_survival_analysis(proteins, OS, covariates = NULL, grouping_method = "median", quantile_threshold = 0.5, time_unit = "years", output_dir = "./survival_results", plot_top_n = 10, plot_individual = FALSE, plot_combined = TRUE, verbose = TRUE)
```

---

### blood_baseline_time_p3166

**文件**: `R/blood_baseline_time_p3166.R`　**导出**: 否（internal）

**签名**:

```r
blood_baseline_time_p3166(path = NULL,instance=0)
```

---

### blood_biochemistry

**文件**: `R/blood_biochemistry.R`　**导出**: 是 ✓

**功能**: 血液生化数据处理函数

**描述**: 处理英国生物银行的血液生化数据。 从血液检测Excel文件中提取所有血液生化测量指标。

**签名**:

```r
blood_biochemistry(path = NULL,instance=0)
```

**参数**:

- `path`: UK Biobank 数据目录的路径
- `instance`: 整数，实例号 (0/1/2/3)，默认 0。

**返回**: 返回包含血液生化测量指标的数据框： - 各种生化标记物（如胆固醇、葡萄糖、肝功能检测等） - 每个变量以测量值和单位命名

**示例**（来自源码 @examples）:

```r
# result <- blood_biochemistry(path = "./data")
```

---

### blood_count

**文件**: `R/blood_count.R`　**导出**: 是 ✓

**功能**: 血常规数据处理函数

**描述**: 处理英国生物银行的血常规（全血细胞计数）数据。 从血液检测Excel文件中提取所有血常规测量指标。

**签名**:

```r
blood_count(path = NULL,instance=0)
```

**参数**:

- `path`: UK Biobank 数据目录的路径
- `instance`: 整数，实例号 (0/1/2/3)，默认 0。

**返回**: 返回包含血常规测量指标的数据框： - 各种血液学标记物（如血红蛋白、白细胞、血小板等） - 每个变量以测量值和单位命名

**示例**（来自源码 @examples）:

```r
# result <- blood_count(path = "./data")
```

---

### blood_pressure_data

**文件**: `R/blood_pressure_data.R`　**导出**: 是 ✓

**功能**: 血压数据提取与合并函数  该函数从 UK Biobank 数据文件中提取参与者的血压测量数据（收缩压 p4080 和 舒张压 p4079）。函数根据指定的评估实例（instance）自动匹配对应的字段ID， 从多个数据文件中读取相应列，并按 eid 合并为一个完整的数据框。 同时，函数将 UK Biobank 特有的缺失值编码（-1 表示"不适用"，-3 表示"不愿回答"） 转换为标准的 NA 值，便于后续分析。

**签名**:

```r
blood_pressure_data(path = NULL, instances=0)
```

**参数**:

- `path`: 字符串，指定 UK Biobank 数据文件的根目录路径。该目录应包含 ID.xlsx 文件（记录字段ID与文件名的对应关系）以及各字段的 .rds 数据文件。
- `instances`: 整数或字符串，评估实例编号，默认为 0（基线评估）。 用于指定提取哪一次评估的血压数据。 

**返回**: 返回一个合并后的数据框，包含以下列： \itemize{ \item eid: 参与者的唯一标识符 \item p4080_iX_aX: 收缩压测量值（mmHg），X 对应实例和测量次数 \item p4079_iX_aX: 舒张压测量值（mmHg），X 对应实例和测量次数 } 其中，原始编码为 -1（不适用）和 -3（不愿回答）的值已被替换为 NA。 如果未找到匹配的数据，函数将返回 NULL 并发出警告。

**示例**（来自源码 @examples）:

```r
\dontrun{
# 提取基线评估（instance 0）的血压数据
bp_data <- blood_pressure_data(path = "/path/to/ukb_data", instances = 0)

# 查看数据结构
str(bp_data)
head(bp_data)

# 计算平均收缩压（忽略NA）
mean(bp_data$p4080_i0_a0, na.rm = TRUE)
}
```

---

### blood_time

**文件**: `R/blood_time.R`　**导出**: 是 ✓

**功能**: 血液采集日期处理与计算函数  该函数处理 UK Biobank 血液采集日期字段（p3166）的原始数据，对多列日期记录进行 清洗、格式转换和汇总计算。函数首先将字符型日期转换为 Date 类型，处理 "Not performed" 等特殊值，然后对同一参与者的多个采血日期记录进行合并：如果所有日期相同则直接返回， 如果存在多个不同日期则计算平均值。该函数为血液生物标志物分析提供标准化的时间变量。

**签名**:

```r
blood_time(dt, date_pattern = "p3166_i0_a")
```

**参数**:

- `dt`: 数据框，包含 eid 列和多个 p3166 相关的日期列（如 p3166_i0_a0, p3166_i0_a1 等）。 这些列通常包含字符型日期或特殊值（如 "Not performed"）。
- `date_pattern`: 字符串，用于匹配日期列名的正则表达式模式， 默认为 "p3166_i0_a"（匹配基线评估的采血日期列）。 

**返回**: 返回一个包含两列的数据框： \itemize{ \item eid: 参与者的唯一标识符 \item blood_time: 处理后的血液采集日期（Date 类型）。 对于同一参与者： - 如果所有日期记录均为 NA，返回 NA - 如果所有非 NA 日期相同，返回该日期 - 如果存在多个不同日期，返回这些日期的平均值 } 返回的日期可用于计算生物标志物的采集时间、批次效应校正或作为时间变量。

**示例**（来自源码 @examples）:

```r
\dontrun{
# 假设 raw_data 包含 eid 和多个 p3166 日期列
raw_data <- data.frame(
eid = c(1, 2, 3),
p3166_i0_a0 = c("2020-01-15", "Not performed", "2019-06-20"),
p3166_i0_a1 = c("2020-01-15", NA, "2019-08-15"),
stringsAsFactors = FALSE
)

# 处理采血日期
blood_dates <- blood_time(dt = raw_data, date_pattern = "p3166_i0_a")

# 查看结果
print(blood_dates)

# 参与者1的两个日期相同，返回该日期
# 参与者2的"Not performed"被转为NA，最终返回NA
# 参与者3有两个不同日期，返回平均值（约2019-07-18）
}
```

---

### calc_uacr

**文件**: `R/calc_uacr.R`　**导出**: 是 ✓

**功能**: 计算尿白蛋白肌酐比值（UACR）  从 UK Biobank 数据中提取尿白蛋白（ualb，单位 mg/L）和尿肌酐（ucreat，单位 μmol/L）， 计算尿白蛋白肌酐比值，并同时提供两种常用单位的结果（mg/g 和 mg/mmol）。

**签名**:

```r
calc_uacr(instance = 0, path = NULL)
```

**参数**:

- `instance`: 整数值，表示测量的实例索引（默认为 0）。
- `path`: 字符型，UK Biobank 数据目录路径。 

**返回**: 返回一个数据框，包含以下列： \item{eid}{参与者唯一标识符。} \item{ualb_mg_L}{尿白蛋白，单位 mg/L。} \item{ucreat_umol_L}{尿肌酐，单位 μmol/L。} \item{uacr_mg_g}{尿白蛋白肌酐比值，单位 mg/g 肌酐。} \item{uacr_mg_mmol}{尿白蛋白肌酐比值，单位 mg/mmol 肌酐。}  当尿肌酐 ≤ 0 或任一变量缺失时，UACR 结果为 NA。

**示例**（来自源码 @examples）:

```r
\dontrun{
# 提取第一次测量（instance=0）
res <- calc_uacr(instance = 0)
head(res)
}
```

---

### calculate_ASM

**文件**: `R/calculate_ASM.R`　**导出**: 是 ✓

**功能**: 计算附肢骨骼肌质量 (ASM)

**描述**: 基于经验公式估算人体四肢骨骼肌质量总和 (Appendicular Skeletal Muscle Mass, ASM)， 适用于大规模流行病学研究，其结果与双能 X 射线吸收法 (DXA) 的一致性已得到验证。  公式： \deqn{ ASM = 0.193 \times weight (kg) + 0.107 \times height (cm) - 4.157 \times sex (male=1, female=2) - 0.037 \times age (years) - 2.631 }  其中性别编码与 UK Biobank 原始字段 \code{p31} 的映射为：Male → 1，Female → 2。 年龄字段来自 \code{p21003_i{instance}}，负值视为缺失。

**签名**:

```r
calculate_ASM(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据根目录，默认自动获取。
- `instance`: 评估实例编号 (0/1/2/3)，默认 0（基线）。 

**返回**: 一个数据框，包含： \item{eid}{参与者 ID} \item{ASM}{附肢骨骼肌质量 (kg)}

**示例**（来自源码 @examples）:

```r
\dontrun{
asm <- calculate_ASM(path = "./ukb", instance = 0)
summary(asm$ASM)
}
```

---

### calculate_All_Derived_Indices

**文件**: `R/calculate_All_Derived_Indices.R`　**导出**: 是 ✓

**功能**: 一站式计算 UK Biobank 所有可用的血液与体型衍生指标

**描述**: 从指定实例提取人体测量、血生化、血常规、年龄和性别，自动生成 150+ 个临床常用衍生变量，包含血脂、炎症、肝肾、激素、体型、 胰岛素抵抗、体成分、比值类等。返回的数据框包含以下衍生变量：  **血脂与脂蛋白** - **RC**: 残余胆固醇 (mmol/L)，公式 `TC - LDL - HDL`（负值设为 NA），代表富含甘油三酯脂蛋白及其残粒中的胆固醇总量。 - **nonHDL**: 非高密度脂蛋白胆固醇 (mmol/L)，公式 `TC - HDL`，包含所有致动脉粥样硬化脂蛋白颗粒中的胆固醇。 - **VLDL**: 极低密度脂蛋白胆固醇估计值 (mmol/L)，公式 `TG / 2.2`（仅当 TG < 4.5 mmol/L 时有效），反映肝脏合成的富含甘油三酯的脂蛋白。 - **LDL_Friedewald**: Friedewald 公式估算的低密度脂蛋白胆固醇 (mmol/L)，公式 `TC - HDL - TG/2.2`（TG > 4.5 时置 NA），间接估算 LDL-C 水平。 - **TC_HDL_ratio**: 总胆固醇与高密度脂蛋白比值，公式 `TC / HDL`，评估动脉粥样硬化风险的经典指标。 - **LDL_HDL_ratio**: 低密度脂蛋白与高密度脂蛋白比值，公式 `LDL / HDL`，反映促动脉粥样硬化与抗动脉粥样硬化脂蛋白的平衡。 - **TG_HDL_ratio**: 甘油三酯与高密度脂蛋白比值，公式 `TG / HDL`，胰岛素抵抗的替代标志物。 - **ApoB_ApoA**: 载脂蛋白 B 与载脂蛋白 A1 比值，公式 `APOB / APOA`，反映致动脉粥样硬化与抗动脉粥样硬化颗粒数量的平衡。 - **ApoB_HDL_ratio**: 载脂蛋白 B 与 HDL 胆固醇比值，公式 `APOB / HDL`，综合评估脂蛋白致动脉粥样硬化风险。 - **nonHDL_ApoB_ratio**: 非 HDL 胆固醇与载脂蛋白 B 比值，公式 `nonHDL / APOB`，值越小提示 LDL 颗粒越小而致密。 - **RC_mg**: 残余胆固醇 (mg/dL)，公式 `RC * 38.67`，以临床常用单位表示。 - **LDL_mg**: 低密度脂蛋白胆固醇 (mg/dL)，公式 `LDL * 38.67`，以临床常用单位表示。 - **RC_category**: RC 临床二分类（因子：low_group / high_group），RC ≥ 30 mg/dL 为高组，< 30 为低组。 - **LDL_category**: LDL 临床二分类（因子：low_group / high_group），LDL ≥ 100 mg/dL 为高组，< 100 为低组。 - **combine_group**: RC 与 LDL 不一致性联合分组（因子），分为 `RC<30/LDL<100`、`RC<30/LDL>=100`、`RC>=30/LDL<100`（不一致组）、`RC>=30/LDL>=100`。 - **lbLDL**: 大浮力低密度脂蛋白胆固醇 (mg/dL 尺度)，公式 `1.43 × LDL - 0.14 × (ln(TG) × LDL) - 8.99`。 - **sdLDL**: 小致密低密度脂蛋白胆固醇 (mg/dL 尺度)，公式 `LDL - lbLDL`，致动脉粥样硬化能力最强的高风险亚组分。 - **sdLDLC_lbLDLC**: 小致密 LDL-C 与大浮力 LDL-C 比值，公式 `sdLDL / lbLDL`，反映 LDL 颗粒谱向高风险亚型偏移的程度。 - **sdLDL_LDL**: 小致密 LDL-C 占总 LDL-C 比率，公式 `sdLDL / LDL`，用于评估 LDL 颗粒的平均大小，比率越高提示颗粒越小越危险。  **生化、炎症与激素** - **SUA_Scr**: 血清尿酸与肌酐比值 (mg/dL / mg/dL)，公式 `(URATE [umol/L] / 88.42) / (CREA [umol/L] / 88.42)`，评估经肾功能校正后的尿酸负荷。 - **HbA1c_IFCC**: IFCC 标准化的糖化血红蛋白百分比 (%)，公式 `(HBA1C [mmol/mol] / 10.929) + 2.15`，将 IFCC 单位转换为临床常用的 DCCT 百分比单位。 - **De_Ritis**: De Ritis 比值，公式 `AST / ALT`，>1 提示酒精性肝病或肝硬化，<1 提示非酒精性脂肪肝。 - **GGT_ALT**: γ-谷氨酰转移酶与丙氨酸氨基转移酶比值，公式 `GGT / ALT`，辅助鉴别酒精性与非酒精性肝损伤。 - **ALBI**: 白蛋白‑胆红素评分，公式 `log10(TBIL [μmol/L]) * 0.66 - ALB [g/L] * 0.085`，评估慢性肝病严重程度和预后。 - **FIB4**: 肝纤维化‑4 指数，公式 `(年龄[岁] * AST [U/L]) / (PLT [10⁹/L] * √ALT [U/L])`，非侵入性评估肝纤维化程度。 - **APRI**: AST 与血小板比值指数，公式 `(AST / 40) / PLT [10⁹/L] * 100`，筛查显著肝纤维化的简易指标。 - **NLR**: 中性粒细胞与淋巴细胞比值，公式 `NEU / LYM`，反映全身炎症与免疫状态平衡。 - **PLR**: 血小板与淋巴细胞比值，公式 `PLT / LYM`，系统性炎症与血栓风险的标志物。 - **LMR**: 淋巴细胞与单核细胞比值，公式 `LYM / MONO`，反映宿主免疫监视与炎症反应平衡。 - **SII**: 全身免疫炎症指数，公式 `PLT * NEU / LYM`，综合反映炎症、免疫与血栓状态。 - **PNI**: 预后营养指数，公式 `ALB [g/L] + 5 * LYM [10⁹/L]`，评估营养状态和免疫功能。 - **Inflammatory_score**: 炎症评分（无单位 Z 分数之和），公式 `z_CRP + z_WBC`，基于 C 反应蛋白与白细胞计数的标准化值，综合评估全身性炎症状态，分值越高提示炎症负荷越重。 - **CONUT**: 控制营养状况评分（0‑12 分），基于白蛋白、总胆固醇、淋巴细胞计数的半定量评分，筛查营养不良及其严重程度。 - **free_testosterone**: 游离睾酮估计值 (pmol/L)，采用 Vermeulen 线性近似公式 `(T - 0.00497*SHBG - 0.0241*(ALB/10)) * 1000`，反映生物可利用的活性睾酮水平。 - **hsCRP_risk**: 高敏 C 反应蛋白风险分层（因子：Low / Intermediate / High），切点 <1、1‑3、>3 mg/L，评估心血管残余炎症风险。 - **vitD_status**: 维生素 D 状态（因子：Deficiency / Insufficiency / Sufficiency），切点 <25、25‑50、>50 nmol/L。 - **hyperuricemia**: 高尿酸血症（Yes / No），男性 >420 μmol/L 或女性 >360 μmol/L 为阳性。 - **LpA_high**: 脂蛋白(a) 风险分层（High / Normal），Lp(a) ≥ 125 nmol/L 为高风险。  **体型与肥胖指标** - **BMI**: 体质指数 (kg/m²)，公式 `体重(kg) / 身高(m)²`，原字段值，核心肥胖指标。 - **WC**: 腰围 (cm)，原字段值，反映腹部脂肪蓄积。 - **WWI**: 体重调整腰围指数 (cm/√kg)，公式 `WC / sqrt(Weight)`，新型中心性肥胖指标。 - **WHtR**: 腰高比 (cm/cm)，公式 `WC / Height`，简单易用的中心性肥胖指标。 - **CI**: 圆锥指数，公式 `WC(m) / (0.109 * sqrt(体重(kg) / 身高(m)))`，评估腹部脂肪分布的几何指标。 - **RFM**: 相对脂肪质量指数（%），分性别：男性 `64 - 20*(身高(m)/WC(m))`，女性 `76 - 20*(身高(m)/WC(m))`，估算全身脂肪百分比。 - **CMI**: 心脏代谢指数，公式 `WHtR * (TG [mmol/L] / HDL [mmol/L])`，联合中心性肥胖与血脂异常的综合风险指标。 - **MCMI**: 改良心脏代谢指数，公式 `ln[TG(mg/dL) × 血糖(mg/dL) / HDL(mg/dL)] × WC(cm) / Height(cm)`，在原始 CMI 基础上引入空腹血糖以更好地捕捉胰岛素抵抗，综合评估腹部肥胖、血脂异常与糖代谢紊乱。 - **LAP**: 脂质积累产物，分性别：男性 `(WC[cm]-65) * TG[mmol/L]`，女性 `(WC[cm]-58) * TG[mmol/L]`，反映脂质过度蓄积。 - **VAI**: 内脏肥胖指数，分性别：男性 `(WC/(39.68+1.88*BMI)) * (TG/1.03) * (1.31/HDL)`，女性 `(WC/(36.58+1.89*BMI)) * (TG/0.81) * (1.52/HDL)`，评估内脏脂肪功能异常。 - **ABSI**: 体型指数，公式 `WC(m) / (BMI^(2/3) * 身高(m)^(1/2))`，考虑身高与 BMI 的标准化腰围。 - **BRI**: 身体圆度指数，公式 `364.2 - 365.5 * sqrt(1 - ((WC(m)/(2π))² / (0.5*身高(m))²))`，基于椭圆模型评估身体形态。 - **WWR**: 体重腰围比 (kg/cm)，公式 `Weight / WC`，评估体重与腹部脂肪的关系。 - **WHT.5R**: 腰围/身高^0.5 指数 (cm/√cm)，公式 `WC / sqrt(Height)`，新型归一化腰围指标。 - **BHR**: 腰臀比，公式 `WC / Hip`，评估体脂分布的经典指标。  **胰岛素抵抗与血糖相关指标** - **TyG**: 甘油三酯‑葡萄糖指数，公式 `ln[TG(mg/dL) × 血糖(mg/dL) / 2]`，胰岛素抵抗的替代标志。 - **TyG_BMI**: TyG 与 BMI 的乘积，`TyG * BMI`，增强胰岛素抵抗识别的肥胖修正指数。 - **TyG_WC**: TyG 与腰围的乘积，`TyG * WC`，结合中心性肥胖的 IR 指数。 - **TyG_WHtR**: TyG 与腰高比的乘积，`TyG * WHtR`，结合体型比例的 IR 指数。 - **TG_HDL**: 甘油三酯与高密度脂蛋白胆固醇比值 (mg/dL / mg/dL)，公式 `TG_mg / HDL_mg`，IR 及心血管风险的简易标志。 - **METS_IR**: 代谢性胰岛素抵抗评分，公式 `ln[(2*Glu_mg + TG_mg) * BMI] / ln(HDL_mg)`，基于代谢参数的 IR 指数。 - **SPISE**: 单点胰岛素敏感性估计器，公式 `600 * (HDL_mg^0.185) / (TG_mg^0.2 * BMI^1.338)`，用于评估胰岛素敏感性。 - **HGI**: 血红蛋白糖化指数 (%)，公式 `HbA1c - Predicted_HbA1c`，其中 Predicted_HbA1c 为当前样本中 HbA1c 对空腹血糖的线性回归预测值；反映个体糖化倾向，正值表示实际 HbA1c 高于根据血糖预期的水平。 - **TyG_ABSI**: TyG 与 ABSI 的乘积，`TyG * ABSI`，结合体型指数与 IR。 - **TyG_BRI**: TyG 与 BRI 的乘积，`TyG * BRI`，结合身体圆度与 IR。 - **TyG_CI**: TyG 与 CI 的乘积，`TyG * CI`，结合圆锥指数与 IR。 - **TyG_RFM**: TyG 与 RFM 的乘积，`TyG * RFM`，结合相对脂肪质量与 IR。 - **TyG_WWI**: TyG 与 WWI 的乘积，`TyG * WWI`，结合体重调整腰围与 IR。 - **TyG_HDL**: TyG 与 HDL 胆固醇 (mg/dL) 的比值，`TyG / HDL_mg`，IR 与脂蛋白保护因素的交互。 - **TyHGB**: 甘油三酯‑高密度脂蛋白胆固醇‑葡萄糖体指数，公式 `TG [mmol/L] / HDL [mmol/L] + 0.7 × GLU [mmol/L] + 0.1 × BMI [kg/m²]`，联合血脂、血糖与肥胖指标，综合评估胰岛素抵抗与代谢健康。 - **WTI**: 腰围甘油三酯指数 (cm·mmol/L)，公式 `WC * TG`，腹部肥胖与血脂的复合指标。 - **WHH**: 腰高比与糖化血红蛋白乘积，公式 `WHtR * HBA1C [%]`，联合中心性肥胖与血糖控制的指标。 - **FGHR**: 空腹血糖与糖化血红蛋白比值，公式 `GLU [mmol/L] / HBA1C [%]`，评估短期与长期血糖水平的平衡。 - **HbA1c_HDL**: 糖化血红蛋白与 HDL 胆固醇比值 (% / mmol/L)，公式 `HBA1C / HDL`，血糖与保护性脂蛋白的联合标志。 - **FBG_HDL**: 空腹血糖与 HDL 胆固醇比值 (mmol/L / mmol/L)，公式 `GLU / HDL`，胰岛素抵抗相关指标。 - **WBC_HDL**: 白细胞计数与 HDL 比值 (10⁹/L / mmol/L)，公式 `WBC / HDL`，炎症与脂蛋白交互的标志。 - **hsCRP_HDL**: 超敏 C 反应蛋白与 HDL 比值 (mg/L / mmol/L)，公式 `CRP / HDL`，心血管残余风险标志。 - **UHR**: 尿酸与 HDL 比值 (μmol/L / mmol/L)，公式 `URATE / HDL`，代谢异常与脂蛋白保护的综合指标。 - **AC**: 致动脉粥样硬化系数，公式 `nonHDL / HDL`，反映致动脉粥样硬化与抗动脉粥样硬化胆固醇的平衡。 - **PHR**: 高密度脂蛋白胆固醇比值，公式 `HDL / TC`，HDL 占总胆固醇的比例。 - **AIP**: 血浆动脉粥样硬化指数，公式 `log10(TG [mmol/L] / HDL [mmol/L])`，评估脂蛋白颗粒大小及动脉粥样硬化风险。 - **IAI**: 炎性动脉粥样硬化指数，公式 `AIP × hs-CRP / 10`，其中 `AIP = log10(TG [mmol/L] / HDL [mmol/L])`，hs‑CRP 单位为 mg/L；综合血脂致动脉粥样硬化潜能与系统性炎症水平，全面反映动脉粥样硬化风险。 - **LCI**: 脂蛋白联合指数，公式 `TC * TG * LDL / HDL`，综合血脂异常信息。 - **NHHR**: 非 HDL 与 HDL 比值，公式 `nonHDL / HDL`，等同于 AC。 - **CHOLINDEX**: 胆固醇指数 (mg/dL 尺度)，当 TG < 400 mg/dL 时公式为 `LDL - HDL`，当 TG ≥ 400 mg/dL 时公式为 `LDL - HDL + TG/5`，综合评估致动脉粥样硬化脂蛋白与保护性脂蛋白的差值。 - **CHG**: 胆固醇‑高密度脂蛋白‑葡萄糖指数，公式 `ln[(TC(mg/dL) × 血糖(mg/dL)) / HDL(mg/dL)]`，联合血脂与血糖的新型代谢风险指标，预测 2 型糖尿病及心血管疾病。 - **CHG_BMI**: CHG 与体质指数的乘积，公式 `CHG * BMI`，将全身性肥胖信息纳入代谢风险评估。 - **CHG_WC**: CHG 与腰围的乘积，公式 `CHG * WC`，将中心性肥胖信息纳入代谢风险评估。 - **CTI**: C 反应蛋白‑甘油三酯葡萄糖指数，公式 `CRP * TyG`，炎症与胰岛素抵抗的乘积标志。 - **RCII**: 残余胆固醇炎症指数 (mmol/L·mg/L)，公式 `RC * CRP`，残余胆固醇与炎症的协同指标。 - **WPR**: 白细胞与血小板比值，公式 `WBC / PLT`，炎症与凝血平衡的简单指标。 - **PWR**: 血小板与白细胞比值，公式 `PLT / WBC`，WPR 的倒数。 - **Hgb_Cr**: 血红蛋白肌酐比值，公式 `HGB / CREA`，评估贫血与肾脏功能的联合指标。 - **HHR**: 血细胞比容血红蛋白比值，公式 `HCT / HGB`，辅助红细胞形态鉴别。 - **HAR**: 血红蛋白与年龄比值，公式 `HGB / 年龄`，贫血与老年的综合标志。 - **HB_HCT**: 血红蛋白与血细胞比容比值，公式 `HGB / HCT`，计算平均红细胞血红蛋白浓度的基础。 - **HMI**: 血红蛋白与平均红细胞体积比值，公式 `HGB / MCV`，用于贫血类型的辅助鉴别。 - **HPR**: 血红蛋白血小板比值，公式 `HGB / PLT`，贫血与血小板状态的联合评估。 - **eAG**: 估计平均血糖 (mg/dL)，公式 `28.7 × HbA1c(%) − 46.7`，其中 `HbA1c(%) = HbA1c(mmol/mol)/10.929 + 2.15`，根据 HbA1c 推算的持续血糖水平。 - **HbA1c_HB**: 糖化血红蛋白与血红蛋白比值 (\% per g/dL)，公式 `HbA1c(%) / HGB`，其中 HbA1c(%) = (HBA1C [mmol/mol] / 10.929) + 2.15，HGB 单位为 g/dL；反映单位血红蛋白所承载的糖基化程度，常用于评估糖代谢异常的风险。  **体成分与能量代谢** - **BSA_DuBois**: 体表面积 (m²)，DuBois 公式 `0.007184 * 体重^0.425 * 身高^0.725`。 - **BSA_Stevenson**: 体表面积 (m²)，Stevenson 公式 `0.0061*身高 + 0.0128*体重 - 0.1529`。 - **TBW_watson**: 全身水分 (L)，Watson 公式，分性别：男性 `2.447 - 0.09156*年龄 + 0.1074*身高 + 0.3362*体重`，女性 `-2.097 + 0.1069*身高 + 0.2466*体重`。 - **TBW_hume**: 全身水分 (L)，Hume 公式，分性别：男性 `0.194786*身高 + 0.296785*体重 - 14.012934`，女性 `0.34454*身高 + 0.183809*体重 - 35.270121`。 - **BMR_Mifflin**: 基础代谢率 (kcal/day)，Mifflin-St Jeor 方程，分性别：男性 `10*体重 + 6.25*身高 - 5*年龄 + 5`，女性 `10*体重 + 6.25*身高 - 5*年龄 - 161`。 - **BMR_Harris**: 基础代谢率 (kcal/day)，Harris-Benedict 方程，分性别：男性 `88.362 + 13.397*体重 + 4.799*身高 - 5.677*年龄`，女性 `447.593 + 9.247*体重 + 3.098*身高 - 4.330*年龄`。 - **BF**: 体脂率 (%)，Deurenberg 公式 `1.20*BMI + 0.23*年龄 - 10.8*(sex=="Male") - 5.4`。 - **BFM**: 体脂质量 (kg)，公式 `体重 * BF/100`。 - **FFM**: 去脂体重 (kg)，公式 `体重 - BFM`。

**签名**:

```r
calculate_All_Derived_Indices(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据根目录，默认自动获取。
- `instance`: 血生化/人体测量实例（0/1/2/3），默认 0。 

**返回**: 一个数据框，包含 eid 以及上述所有衍生变量，并保留用于计算的部分原始变量。

---

### calculate_BMI_group

**文件**: `R/calculate_BMI_group.R`　**导出**: 是 ✓

**功能**: 按种族划分的 BMI 分组

**描述**: 依据参与者详细种族（亚洲 vs 非亚洲）应用不同的 BMI 阈值进行分类。  亚洲标准（世界卫生组织西太平洋地区）： \itemize{ \item 体重过轻：< 18.5 kg/m² \item 体重正常：18.5 – 22.9 kg/m² \item 超重：23.0 – 27.4 kg/m² \item 肥胖：≥ 27.5 kg/m² }  非亚洲标准（世界卫生组织）： \itemize{ \item 体重过轻：< 18.5 kg/m² \item 体重正常：18.5 – 24.9 kg/m² \item 超重：25.0 – 29.9 kg/m² \item 肥胖：≥ 30.0 kg/m² }

**签名**:

```r
calculate_BMI_group(path = NULL, instance = 0, asian_ethnicities = c( "Indian", "Pakistani", "Bangladeshi", "Chinese", "Any other Asian background", "Asian or Asian British" ), default_group = c("White", "Asian"))
```

**参数**:

- `path`: UK Biobank 数据根目录，默认自动获取。
- `instance`: 评估实例 (0/1/2/3)，默认 0。
- `asian_ethnicities`: 字符向量，用于定义哪些详细种族应使用亚洲 BMI 标准。 默认包含常见南亚、东亚及“其他亚洲背景”等。
- `default_group`: 对于种族信息缺失的参与者，默认归入哪个组。 \code{"White"} 使用非亚洲标准，\code{"Asian"} 使用亚洲标准。 

**返回**: 一个数据框，包含： \item{eid}{参与者 ID} \item{BMI}{体质指数 (kg/m²)} \item{BMI_group}{BMI 分组（因子）：Underweight / Normal weight / Overweight / Obesity}

**示例**（来自源码 @examples）:

```r
\dontrun{
bmi_data <- calculate_BMI_group(instance = 0)
table(bmi_data$BMI_group)
}
```

---

### classify_bmi

**文件**: `R/calculate_BMI_group.R`　**导出**: 否（internal）

**签名**:

```r
classify_bmi(bmi, asian)
```

---

### calculate_BioAge_Acceleration

**文件**: `R/calculate_BioAge_Acceleration.R`　**导出**: 是 ✓

**功能**: 计算生物年龄加速（残差）并识别极端衰老/年轻个体

**签名**:

```r
calculate_BioAge_Acceleration(data, chronological_age, biological_age, sex = NULL, id = "eid", extreme_threshold = 1.5, method = c("linear", "lowess", "direct"))
```

**参数**:

- `data`: 数据框
- `chronological_age`: 实际年龄列名
- `biological_age`: 生物学年龄列名（如 "PhenoAge"）
- `sex`: 性别列名，若为 NULL 则在全体中计算（默认）
- `id`: 个体 ID 列名，默认 "eid"
- `extreme_threshold`: Z 分数阈值，默认 1.5，用于定义极端衰老和极端年轻的样本
- `method`: 计算方法。`"linear"`：线性回归残差（默认）；`"lowess"`：局部加权回归残差（LOWESS/LOESS）；`"direct"`：直接差值（生物学年龄 - 实际年龄） 

**返回**: 原数据框，新增列： - age_accel: 生物学年龄加速（残差，观测值 - 预测值） - accel_status: "Accelerated" / "Decelerated" / "Normal" - z_score: 基于 age_accel 分层的标准化分数（Z 分数） - extreme_ageotype: "Extreme Aged" / "Extreme Youthful" / "Normal"

**示例**（来自源码 @examples）:

```r
df <- data.frame(eid=1:5, age=c(50,60,70,55,65),
pheno=c(52,58,75,53,70), sex=c("M","F","F","M","F"))
res <- calculate_BioAge_Acceleration(df, "age", "pheno", sex="sex", method="linear")
```

---

### compute_accel

**文件**: `R/calculate_BioAge_Acceleration.R`　**导出**: 否（internal）

**签名**:

```r
compute_accel(sub_df)
```

---

### error

**文件**: `R/calculate_BioAge_Acceleration.R`　**导出**: 否（internal）

**签名**:

```r
error(e)
```

---

### calculate_BioAges

**文件**: `R/calculate_BioAges.R`　**导出**: 是 ✓

**功能**: 计算多种生物年龄指标（KDM、PhenoAge、HD）

**描述**: 基于 UK Biobank 数据，通过 NHANES III 训练集计算三种主流生物年龄指标： - KDM (Klemera-Doubal Method) 生物年龄及其延伸版（包含 FEV1） - PhenoAge（表型年龄，Levine 2018） - HD（稳态失调，Homeostatic Dysregulation）

**签名**:

```r
calculate_BioAges(path = NULL,instance=0)
```

**参数**:

- `path`: UK Biobank 数据所在根目录或 rds 文件路径。若为 `NULL`，则尝试从环境变量或默认路径获取。
- `instance`: 整数，实例号 (0/1/2/3)，默认 0。 

**返回**: 一个 data.frame，包含以下列： - eid：样本 ID - 原始生物标志物及人口学变量 - KDM, KDM_Advance：KDM 生物年龄及其加速值 - KDM_original, KDM_Advance_original：含 FEV1 的原始 KDM 生物年龄及加速值 - PhenoAge, PhenoAge_Advance：表型年龄及其加速值 - HD, HD_Log：稳态失调指标及其对数值

**示例**（来自源码 @examples）:

```r
\dontrun{
bio_ages <- calculate_BioAges(path = "/path/to/ukb")
head(bio_ages)
}
```

---

### calculate_CCR

**文件**: `R/calculate_CCR.R`　**导出**: 是 ✓

**功能**: 计算肌酐与胱抑素 C 比值 (CCR) 及标准化 NCCR

**描述**: 肌酐 (Creatinine) 是肌肉代谢产物，血液水平与肌肉量相关； 胱抑素 C (Cystatin C) 由有核细胞恒定产生，经肾小球滤过，主要反映肾功能。 CCR 联合了肌肉质量与肾功能信息，可辅助评估肌少症、衰弱或肾功能受损风险。  公式： \deqn{CCR = \frac{Cr\ (mg/dL)}{CysC\ (mg/L)}}  标准化 CCR (NCCR) 进一步考虑体重： \deqn{NCCR = \frac{Cr\ (mg/dL) \times 10}{CysC\ (mg/L) \times Weight\ (kg)}}  单位转换：UK Biobank 原始肌酐为 μmol/L，1 mg/dL = 88.42 μmol/L，故 \eqn{Cr\ (mg/dL) = \frac{Cr\ (μmol/L)}{88.42}}。 胱抑素 C 原始单位即 mg/L，无需转换。

**签名**:

```r
calculate_CCR(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据根目录，默认自动获取。
- `instance`: 评估实例编号 (0/1/2/3)，默认 0。 

**返回**: 数据框，包含： \item{eid}{参与者 ID} \item{CCR}{肌酐与胱抑素 C 比值} \item{NCCR}{标准化肌酐与胱抑素 C 比值 (×10 / 体重)}

**示例**（来自源码 @examples）:

```r
\dontrun{
ccr <- calculate_CCR(path = "./ukb", instance = 0)
summary(ccr$CCR)
}
```

---

### calculate_CKD_stage

**文件**: `R/calculate_CKD_stage.R`　**导出**: 是 ✓

**功能**: 慢性肾脏病(CKD)分期与风险分类函数

**描述**: 根据估算肾小球滤过率(eGFR)和(可选)尿白蛋白肌酐比(UACR)， 对CKD进行分期、风险分层或生成适用于CKM综合征的分类变量。 提供三种处理模式： \itemize{ \item \strong{simple}：仅依据eGFR进行简易分期(G1~G5)、二分类及高风险判定。 \item \strong{kdigo_risk}：基于KDIGO 2024指南的eGFR-UACR联合风险分层(低/中/高/极高风险)。 \item \strong{ckm_categories}：专为心血管-肾脏-代谢(CKM)综合征设计，识别中高危CKD和极高危CKD。 当未提供UACR时采用简化版(文献4)；提供UACR时采用精确版(文献5)。 }

**签名**:

```r
calculate_CKD_stage(path = NULL, instance = 0, egfr_col = "eGFR_EPI_2021_scr", uacr_col = NULL, method = c("simple", "kdigo_risk", "ckm_categories"))
```

**参数**:

- `path`: UK Biobank 数据所在路径，默认 NULL 将自动获取路径。
- `instances`: 整数，用于指定 UK Biobank 数据的重复测量实例，默认 0（基线）。
- `egfr_col`: 字符，eGFR列名，默认为"eGFR_EPI_2021_scr"，支持任何eGFR估算公式结果(如CKD-EPI 2021 scr/cysC、MDRD等)。
- `uacr_col`: 字符或NULL，UACR列名，单位为mg/g。若为NULL则仅基于eGFR进行分析，默认NULL。
- `method`: 字符，选择分类方法，可选"simple"、"kdigo_risk"或"ckm_categories"。 

**返回**: 返回原始数据框，并附加与所选方法对应的新列： \describe{ \item{method = "simple"}{ \itemize{ \item \code{ckd_stage_simple}：eGFR分期(字符型)，G1~G5，G3a/G3b细分。 \item \code{ckd_binary_simple}：CKD与否(字符型，"CKD"或"No CKD")，以eGFR<60为界。 \item \code{ckd_high_risk_simple}：是否高风险(字符型)，以eGFR<30为界。 } } \item{method = "kdigo_risk"}{ \itemize{ \item \code{kdigo_risk}：KDIGO风险等级(字符型)，取值"Low Risk"、"Moderate Risk"、"High Risk"或"Very High Risk"。 \item \code{egfr_category}：eGFR分期(G1~G5)。 \item \code{uacr_category}：UACR分级(A1/A2/A3)。 } } \item{method = "ckm_categories"}{ \itemize{ \item \code{ckd_moderate_high_ckm}：逻辑型，TRUE表示存在中高危CKD(对应CKM 2期)。 \item \code{ckd_very_high_ckm}：逻辑型，TRUE表示存在极高危CKD(对应CKM 3期)。 当uacr_col=NULL时，采用简易定义(eGFR 30-59为中高危，eGFR<30为极高危)。 当提供uacr_col时，采用KDIGO风险矩阵的精确定义。 } } }

**示例**（来自源码 @examples）:

```r
\dontrun{
# 假设数据框为 kidney_function，包含eGFR_EPI_2021_scr和uacr_mg_g列
# 简易分期
data1 <- calculate_CKD_stage(kidney_function,
egfr_col = "eGFR_EPI_2021_scr",
method = "simple")
# 完整KDIGO风险分层
data2 <- calculate_CKD_stage(kidney_function,
egfr_col = "eGFR_EPI_2021_cysC",
uacr_col = "uacr_mg_g",
method = "kdigo_risk")
# CKM专用(无UACR，简化版)
data3 <- calculate_CKD_stage(kidney_function,
egfr_col = "eGFR_EPI_2021_scr",
method = "ckm_categories")
# CKM专用(含UACR，精确版)
data4 <- calculate_CKD_stage(kidney_function,
egfr_col = "eGFR_EPI_2021_scr",
uacr_col = "uacr_mg_g",
method = "ckm_categories")
}
```

---

### calculate_CKM_stage

**文件**: `R/calculate_CKM_stage.R`　**导出**: 是 ✓

**功能**: 计算心血管‑肾脏‑代谢（CKM）综合征分期  整合 UK Biobank 多项健康指标，依据 CKM 框架对参与者进行分期， 同时标记代谢综合征状态。支持自定义亚洲种族列表用于超重/肥胖阈值 及腹型肥胖腰围标准，并可选择不同的 CKD 分期计算方法以及用于 CKD 评估的 eGFR 与 UACR 变量名。

**签名**:

```r
calculate_CKM_stage(path=NULL, instance = 0, egfr_col = "eGFR_EPI_2021_scr", uacr_col = "uacr_mg_g", tg_threshold = 1.7, asian_ethnicities = c( "Indian", "Pakistani", "Bangladeshi", "Chinese", "Any other Asian background", "Asian or Asian British" ), abdominal_obesity_criteria = c("AHA_metabolic", "IDF"), abdominal_obesity_asian_ethnicities = c( "Indian", "Pakistani", "Bangladeshi", "Chinese", "Any other Asian background", "Asian or Asian British" ), ckd_method = c("ckm_categories", "simple", "kdigo_risk"))
```

**参数**:

- `path`: 字符型，UK Biobank 数据文件所在路径。 若为 `NULL`，将通过内部函数自动获取默认路径。
- `instance`: 整数型，评估实例编号，默认 `0`（基线评估）。
- `egfr_col`: 字符型，用于 CKD 分期的估算肾小球滤过率 (eGFR) 列名，默认为 `"eGFR_EPI_2021_scr"`。
- `uacr_col`: 字符型，用于 CKD 分期的尿白蛋白肌酐比值 (UACR, mg/g) 列名，默认为 `"uacr_mg_g"`。 当 `ckd_method = "simple"` 时可忽略。
- `tg_threshold`: 数字型，用于确定高脂血症的甘油三酯的阈值
- `asian_ethnicities`: 字符向量，定义用于判断亚洲人种超重/肥胖 （BMI ≥ 23）的种族类别。默认包含南亚、 东亚及“其他亚洲背景”等常见分组。
- `abdominal_obesity_criteria`: 字符型，腹型肥胖诊断标准。可选 `"AHA_metabolic"`（AHA代谢综合征标准， 默认）或 `"IDF"`（国际糖尿病联盟标准）。
- `abdominal_obesity_asian_ethnicities`: 字符向量，腹型肥胖中亚洲特异腰围阈值所适用 的种族类别。默认与 `asian_ethnicities` 相同。
- `ckd_method`: 字符型，CKD 分期计算方法。可选 `"ckm_categories"`（CKM 分期专用分类， 默认）、`"simple"`（简单 eGFR 分期）或 `"kdigo_risk"`（KDIGO 风险分层）。 

**返回**: 一个数据框，包含所有 CKM 相关中间变量及最终分期结果。 \describe{ \item{eid}{参与者编号} \item{BMI}{体质指数 (kg/m²)} \item{overweight_obesity}{超重/肥胖标志（亚洲人群 BMI ≥ 23，其余 ≥ 25）} \item{abdominal_obesity}{腹型肥胖标志} \item{Prediabetes、Diabetes_covariate、hyperglycemia}{血糖状态（前期、糖尿病、高血糖）} \item{hypertension}{基线高血压状态} \item{high_TG、low_HDL}{血脂异常组分} \item{ckd_moderate_high_ckm、ckd_very_high_ckm}{CKD 风险级别（取决于 `ckd_method`）} \item{prevent_high_risk}{10 年心血管疾病风险 ≥ 20\% 标志} \item{mets_components、mets}{代谢综合征阳性组分计数（0‑5）及诊断（≥3 项）} \item{ckm_stage}{CKM 分期（0‑3）} }

---

### calculate_CSPV

**文件**: `R/calculate_CSPV.R`　**导出**: 是 ✓

**功能**: 计算生理变异性综合得分 (CSPV)

**描述**: 基于多次访视的收缩压、脉率和 BMI 计算个体内变异系数 (CV)， 并通过三分位数离散评分法（0‑3 分）或 PCA 加权连续评分法生成生理变异性综合得分。  离散法： \deqn{BPV = \frac{SD_{SBP}}{Mean_{SBP}},\quad PRV = \frac{SD_{PR}}{Mean_{PR}},\quad BWV = \frac{SD_{BMI}}{Mean_{BMI}}} 对每个 CV 取最高三分位数为 1 分，其余为 0 分，总分 = BPV_score + PRV_score + BWV_score。  连续法（PCA）： 对三个 CV 进行主成分分析，提取第一主成分作为加权连续得分。

**签名**:

```r
calculate_CSPV(path = NULL, instances = c(0, 1, 2, 3), method = "discrete")
```

**参数**:

- `path`: UK Biobank 数据根目录，默认自动获取。
- `instances`: 用于计算变异性的访视实例编号，默认 c(0,1,2,3)。
- `method`: 评分方法，"discrete" (默认) 或 "continuous"。 

**返回**: 数据框，包含 eid 及以下列： \item{BPV}{收缩压变异系数} \item{PRV}{脉率变异系数} \item{BWV}{BMI 变异系数} \item{CSPV_discrete}{离散综合得分 (0‑3)} \item{CSPV_continuous}{PCA 连续得分 (仅当 method = "continuous" 时返回)}

---

### extract_instance

**文件**: `R/calculate_CSPV.R`　**导出**: 否（internal）

**签名**:

```r
extract_instance(inst)
```

---

### calculate_Derive_Blood_Indices

**文件**: `R/calculate_Derive_Blood_Indices.R`　**导出**: 是 ✓

**功能**: 血常规与血生化数据计算多种衍生指标  一次性提取指定实例的血常规、血生化、基线年龄与性别字段，自动计算 30+ 种临床常用衍生指标，仅返回最终衍生变量。

**签名**:

```r
calculate_Derive_Blood_Indices(path = NULL, instance = 0)
```

**参数**:

- `path`: 字符型，UK Biobank 数据根目录，默认自动获取。
- `instance`: 整数型，血常规与血生化测量实例，默认 0（基线）。 

**返回**: 一个数据框，包含 eid 及下列衍生变量： \item{RC}{残余胆固醇 (mmol/L)} \item{nonHDL}{非高密度脂蛋白胆固醇 (mmol/L)} \item{VLDL}{极低密度脂蛋白胆固醇估计值 (mmol/L)} \item{LDL_Friedewald}{Friedewald 公式估算 LDL-C (mmol/L)} \item{TC_HDL_ratio}{总胆固醇与 HDL 比值} \item{LDL_HDL_ratio}{LDL 与 HDL 比值} \item{TG_HDL_ratio}{甘油三酯与 HDL 比值} \item{ApoB_ApoA}{载脂蛋白 B 与 A1 比值} \item{ApoB_HDL_ratio}{载脂蛋白 B 与 HDL 比值} \item{nonHDL_ApoB_ratio}{非 HDL 胆固醇与 ApoB 比值} \item{RC_mg}{残余胆固醇 (mg/dL)} \item{LDL_mg}{LDL-C (mg/dL)} \item{RC_category}{RC 二分类} \item{LDL_category}{LDL 二分类} \item{combine_group}{RC 与 LDL 联合分组} \item{De_Ritis}{De Ritis 比值} \item{GGT_ALT}{GGT/ALT 比值} \item{ALBI}{白蛋白-胆红素评分} \item{FIB4}{肝纤维化-4 指数} \item{APRI}{AST 与血小板比值指数} \item{NLR}{中性粒细胞与淋巴细胞比值} \item{PLR}{血小板与淋巴细胞比值} \item{LMR}{淋巴细胞与单核细胞比值} \item{SII}{全身免疫炎症指数} \item{PNI}{预后营养指数} \item{CONUT}{控制营养状况评分} \item{free_testosterone}{游离睾酮估计值 (pmol/L)，简化公式} \item{hsCRP_risk}{高敏 CRP 风险分层} \item{vitD_status}{维生素 D 状态} \item{hyperuricemia}{高尿酸血症 (Yes/No)} \item{LpA_high}{脂蛋白(a) 风险分层}

**示例**（来自源码 @examples）:

```r
\dontrun{
derived <- calculate_Derive_Blood_Indices(instance = 0)
head(derived)
}
```

---

### safe_div

**文件**: `R/calculate_Derive_Blood_Indices.R`　**导出**: 否（internal）

**功能**: 安全除法（分母为 0 或 NA 时返回 NA）

**签名**:

```r
safe_div(num, den)
```

---

### calc_free_testosterone_ve

**文件**: `R/calculate_Derive_Blood_Indices.R`　**导出**: 否（internal）

**签名**:

```r
calc_free_testosterone_ve(T, SHBG, ALB)
```

---

### calculate_Dyslipidemia

**文件**: `R/calculate_Dyslipidemia.R`　**导出**: 是 ✓

**功能**: 提取 UK Biobank 血脂并判定异常

**描述**: 通过 easyUKB::blood_biochemistry 提取甘油三酯(TG)和HDL-C， 按性别判定高甘油三酯血症与低HDL-C，返回原始值及二分类异常指标。

**签名**:

```r
calculate_Dyslipidemia(path=NULL, tg_threshold = 1.7)
```

**参数**:

- `path`: 字符，UK Biobank 数据根目录。
- `tg_threshold`: 数值，甘油三酯阈值，默认和公认一般为1.7，而ukb中存在非空腹测量的情况，也可以视情况降低，没有统一标准。 

**返回**: data.table，包含列： \itemize{ \item eid：参与者标识号 \item TG_mmolL：甘油三酯 (mmol/L) \item HDL_mmolL：HDL-C (mmol/L) \item high_TG：逻辑型，TG ≥ 1.7 mmol/L \item low_HDL：逻辑型，按性别判定低HDL-C (男<1.0, 女<1.3 mmol/L) }

**示例**（来自源码 @examples）:

```r
\dontrun{
lipids <- calculate_lipids_ukb(path = "/path/to/ukb")
}
```

---

### calculate_GOLD_BioAge_NHANES

**文件**: `R/calculate_GOLD_BioAge_NHANES.R`　**导出**: 是 ✓

**功能**: 计算 GOLD BioAge (NHANES 队列)

**描述**: 基于 GOLD BioAge 框架，利用年龄及 9 个临床生物标志物计算生物年龄。 公式: GOLD BioAge = Age + 5.2691*Creatinine + 0.5797*Glucose + 0.3389*MCV + 2.6445*RDW - 4.7358*Albumin + 0.0260*ALP - 0.2032*LYM_pct + 0.4459*WBC + 0.0608*GGT - 53.6287

**签名**:

```r
calculate_GOLD_BioAge_NHANES(data)
```

**参数**:

- `data`: 数据框，必须包含列: \itemize{ \item eid - 参与者标识 \item Age - 年龄 (years) \item Creatinine - 血清肌酐 (mg/dL) \item Glucose - 血糖 (mmol/L) \item MCV - 平均红细胞容积 (fL) \item RDW - 红细胞分布宽度 (%) \item Albumin - 白蛋白 (g/dL) \item ALP - 碱性磷酸酶 (U/L) \item LYM_pct - 淋巴细胞百分比 (%) \item WBC - 白细胞计数 (1000 cells/μL) \item GGT - γ-谷氨酰转移酶 (U/L) } 

**返回**: 数据框，包含: \itemize{ \item eid - 参与者标识 \item Age - 原始年龄 \item GOLD_BioAge - 计算得到的 GOLD BioAge (years) \item GOLD_BioAge_Difference - 生物年龄与实际年龄的差值 }

**示例**（来自源码 @examples）:

```r
# 假设 df 包含所需列且单位正确
result <- calculate_GOLD_BioAge_NHANES(df)
```

---

### calculate_GOLD_BioAge_UKB

**文件**: `R/calculate_GOLD_BioAge_UKB.R`　**导出**: 是 ✓

**功能**: 计算 GOLD BioAge (UK Biobank 队列)

**签名**:

```r
calculate_GOLD_BioAge_UKB(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据根目录路径。
- `instance`: 实例编号，默认为 0（基线）。 

**返回**: 数据框，包含以下列： \item{eid}{参与者编号} \item{Age}{实际年龄 (years)} \item{GOLD_BioAge}{GOLD BioAge (years)} \item{GOLD_BioAge_Difference}{生物年龄与日历年龄的差值 (years)}

**示例**（来自源码 @examples）:

```r
\dontrun{
result <- calculate_GOLD_BioAge_UKB(path = "~/ukb_data", instance = 0)
head(result)
}
```

---

### calculate_GOLD_MetAge

**文件**: `R/calculate_GOLD_MetAge.R`　**导出**: 是 ✓

**功能**: 计算 GOLD MetAge（代谢组学生物年龄）

**描述**: 基于 Hao et al. (2025) GOLD BioAge 框架中的代谢组学模型，使用 NMR 代谢组学数据计算生物年龄。 公式包含 26 个代谢物指标与年龄，系数来自 Supplementary Table 9。 Age：年龄（年） S_HDL_FC_pct：小 HDL 中游离胆固醇占总脂质百分比（%） S_LDL_CE_pct：小 LDL 中胆固醇酯占总脂质百分比（%） L_LDL_CE_pct：大 LDL 中胆固醇酯占总脂质百分比（%） IDL_CE_pct：IDL 中胆固醇酯占总脂质百分比（%） XS_VLDL_PL_pct：极小 VLDL 中磷脂占总脂质百分比（%） L_VLDL_TG_pct：大 VLDL 中甘油三酯占总脂质百分比（%） S_HDL_CE：小 HDL 中胆固醇酯（mmol/L） XXL_VLDL_TG：乳糜微粒和极大 VLDL 中甘油三酯（mmol/L） GlycA：糖蛋白乙酰基（mmol/L） Albumin：白蛋白（g/L） Creatinine：肌酐（mmol/L） Acetone：丙酮（mmol/L） Acetoacetate：乙酰乙酸（mmol/L） bOHbutyrate：3-羟基丁酸（mmol/L） Lactate：乳酸（mmol/L） Tyr：酪氨酸（mmol/L） Phe：苯丙氨酸（mmol/L） Val：缬氨酸（mmol/L） Gly：甘氨酸（mmol/L） Omega_6_by_Omega_3：ω-6/ω-3 脂肪酸比值 LA_pct：亚油酸占总脂肪酸百分比（%） LA：亚油酸（mmol/L） Omega_3：ω-3 脂肪酸（mmol/L） Unsaturation：脂肪酸不饱和度 VLDL_size：VLDL 颗粒平均直径（nm） Glucose_Lactate：葡萄糖乳酸比值或浓度  参考文献:Hao M, et al. Advanced Science 2025, 12, e01765 Gompertz Law-Based Biological Age (GOLD BioAge): A Simple and Practical Measurement of Biological Ageing to Capture Morbidity and Mortality Risks

**签名**:

```r
calculate_GOLD_MetAge(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据根目录路径。 

**返回**: 数据框，包含原始 ID、年龄、MetAge 以及差值（MetAge - Age）。

**示例**（来自源码 @examples）:

```r
\dontrun{
# NMR 代谢组学数据框 nmr_df 已包含所需列和年龄
result <- calculate_GOLD_MetAge(nmr_df)
head(result)
}
```

---

### calculate_GOLD_ProtAge

**文件**: `R/calculate_GOLD_ProtAge.R`　**导出**: 是 ✓

**功能**: 计算 GOLD ProtAge 及相关衰老指标  包括22 种蛋白质，蛋白质数据应为标准化值（均值为 0，标准差为 1） 参考文献: Hao M, et al. Advanced Science 2025, 12, e01765 Gompertz Law-Based Biological Age (GOLD BioAge): A Simple and Practical Measurement of Biological Ageing to Capture Morbidity and Mortality Risks

**签名**:

```r
calculate_GOLD_ProtAge(path = NULL)
```

**参数**:

- `path`: 数据路径。 

**返回**: 数据框，包含以下列： \item{eid}{参与者编号} \item{Age}{实际年龄 (years)} \item{Gold_Protein_Age}{GOLD 蛋白质组学生物年龄 (years)} \item{Protein_Age_Difference}{生物年龄与实际年龄的差值 (years)} \item{Cardio_Age_Difference}{心血管代谢相关蛋白的衰老贡献 (years)} \item{Inflam_Age_Difference}{炎症相关蛋白的衰老贡献 (years)} \item{Neuro_Age_Difference}{神经相关蛋白的衰老贡献 (years)} \item{Onco_Age_Difference}{肿瘤相关蛋白的衰老贡献 (years)}

**示例**（来自源码 @examples）:

```r
result <- calculate_GOLD_ProtAge(path = "~/ukb_data")
head(result)
```

---

### calculate_IR_indices

**文件**: `R/calculate_IR_indices.R`　**导出**: 是 ✓

**功能**: 计算七项胰岛素抵抗指数  基于空腹 TG、Glucose、HDL-C、BMI、腰围、身高，计算 7 个 IR 指标。 所有血脂、血糖结果由 mmol/L 转为 mg/dL 后参与计算，非正值记为缺失。

**签名**:

```r
calculate_IR_indices(path = NULL, instance = 0)
```

**参数**:

- `path`: 数据路径，默认自动获取。
- `instance`: 评估实例编号（0 或 1），默认 0。 

**返回**: tibble，含 eid 及 TyG, TyG_BMI, TyG_WC, TyG_WHtR, TG_HDL, METS_IR, SPISE。

---

### calculate_Light_BioAge_NHANES

**文件**: `R/calculate_Light_BioAge_NHANES.R`　**导出**: 是 ✓

**签名**:

```r
calculate_Light_BioAge_NHANES(data)
```

**参数**:

- `data`: 数据框，必须包含列： \itemize{ \item eid - 参与者标识 \item Age - 年龄 (years) \item Creatinine - 血清肌酐 (mg/dL) \item Glucose - 血糖 (mmol/L) \item CRP - C 反应蛋白 (mg/dL)，函数内部自动取自然对数 } 

**返回**: 数据框，包含： \itemize{ \item eid - 参与者标识 \item Age - 原始年龄 \item Light_BioAge - 计算得到的 Light BioAge (years) \item Light_BioAge_Difference - 生物年龄与年龄的差值 }

**示例**（来自源码 @examples）:

```r
# 假设 df 包含所需列且单位正确
result <- calculate_Light_BioAge_NHANES(df)
```

---

### calculate_Light_BioAge_UKB

**文件**: `R/calculate_Light_BioAge_UKB.R`　**导出**: 是 ✓

**功能**: 计算 Light BioAge (UK Biobank 队列)

**签名**:

```r
calculate_Light_BioAge_UKB(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据根目录路径。
- `instance`: 实例编号，默认为 0。 

**返回**: 数据框，包含以下列： \item{eid}{参与者编号} \item{Age}{实际年龄 (years)} \item{Light_BioAge}{GOLD Light BioAge (years)} \item{Light_BioAge_Difference}{生物年龄与年龄的差值 (years)}

**示例**（来自源码 @examples）:

```r
\dontrun{
result <- calculate_Light_BioAge_UKB(path = "~/ukb_data", instance = 0)
head(result)
}
```

---

### calculate_MHO

**文件**: `R/calculate_MHO.R`　**导出**: 是 ✓

**功能**: 肥胖代谢异质性 (MHO) 表型分类

**描述**: 利用已有的代谢综合征诊断组件（血压、甘油三酯、HDL、血糖），并结合 \code{\link{calculate_BMI_group}} 按种族输出的 BMI 分组， 将参与者分为四种 BMI‑代谢表型： \itemize{ \item MHNW：代谢健康的正常体重 \item MUNW：代谢不健康的正常体重 \item MHOO：代谢健康的超重/肥胖 \item MUOO：代谢不健康的超重/肥胖 }  代谢不健康的定义：在以下四项代谢组分中满足 **≥2 项**： \itemize{ \item 血压升高：SBP ≥ 130 mmHg 或 DBP ≥ 85 mmHg 或使用降压药 \item 血糖控制受损：空腹血糖 ≥ 5.6 mmol/L 或 HbA1c ≥ 6.0% 或使用降糖药 \item 甘油三酯升高：TG ≥ 1.7 mmol/L 或使用降脂药 \item 低 HDL‑C：男性 < 1.03 mmol/L，女性 < 1.29 mmol/L 或使用降脂药 } 注：此处高血糖组件直接使用 \code{calculate_metabolic_syndrome} 中的定义 （糖尿病或前期），其阈值可能比严格 MHO 定义的 ≥5.6 mmol/L 或 ≥6.0% 更保守。  BMI 分组采用种族自适应标准（由 \code{calculate_BMI_group} 确定）： \itemize{ \item 亚洲人群：正常 18.5‑22.9，超重 23.0‑27.4，肥胖 ≥27.5 kg/m² \item 非亚洲人群：正常 18.5‑24.9，超重 25.0‑29.9，肥胖 ≥30.0 kg/m² } 体重过轻（BMI < 18.5）的参与者将被排除（表型设为 \code{NA}）。

**签名**:

```r
calculate_MHO(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据根目录，默认自动获取。
- `instance`: 评估实例 (0/1/2/3)，默认 0（基线）。 

**返回**: 数据框，包含列： \item{eid}{参与者 ID} \item{BMI}{体质指数 (kg/m²)} \item{BMI_group_race}{种族自适应 BMI 分组（因子：Underweight / Normal weight / Overweight / Obesity）} \item{BMI_group_mho}{用于 MHO 分类的简化分组（Normal weight / Overweight_Obesity）} \item{metabolically_unhealthy}{代谢不健康（逻辑型）} \item{MHO_phenotype}{四分类表型（MHNW / MUNW / MHOO / MUOO）}

**示例**（来自源码 @examples）:

```r
\dontrun{
mho_data <- calculate_MHO(path = "./ukb", instance = 0)
table(mho_data$MHO_phenotype)
}
```

---

### calculate_PhenotypicAge

**文件**: `R/calculate_PhenotypicAge.R`　**导出**: 是 ✓

**功能**: 计算 Levine Phenotypic Age 表型年龄

**签名**:

```r
calculate_PhenotypicAge(path=NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据根目录路径。
- `instance`: 实例编号，默认为 0（基线评估）。 

**返回**: 数据框，包含以下列： \item{eid}{参与者编号} \item{Age}{日历年龄 (years)} \item{PhenoAge}{Levine Phenotypic Age (years)} \item{PhenoAge_Difference}{表型年龄与日历年龄的差值 (years)}

**示例**（来自源码 @examples）:

```r
\dontrun{
result <- calculate_PhenotypicAge_Levine_UKB(path = "~/ukb_data", instance = 0)
head(result)
}
```

---

### calculate_Prevent_CVD_Risk

**文件**: `R/calculate_Prevent_CVD_Risk.R`　**导出**: 是 ✓

**功能**: 计算 PREVENT 心血管疾病风险  该函数整合 UK Biobank 的多个表型数据，并基于 AHA PREVENT 方程 批量计算每位参与者的 10 年及 30 年心血管疾病风险（包括总 CVD、ASCVD、 心力衰竭、冠心病和卒中）。

**签名**:

```r
calculate_Prevent_CVD_Risk(path = NULL, instances = 0)
```

**参数**:

- `path`: UK Biobank 数据所在路径，默认 NULL 将自动获取路径。
- `instances`: 整数，用于指定 UK Biobank 数据的重复测量实例，默认 0（基线）。 

**返回**: 一个列表，包含两个数据框： \item{Prevent_Risk_10yr}{10 年风险估计表} \item{Prevent_Risk_30yr}{30 年风险估计表}

---

### calculate_RPP

**文件**: `R/calculate_RPP.R`　**导出**: 是 ✓

**功能**: 计算心率压力积 (RPP)

**描述**: 心率压力积 (Rate-Pressure Product, RPP) 是心率 (HR) 与收缩压 (SBP) 的乘积， 用于反映心脏在泵血过程中的负荷和心肌耗氧量。该值越高，表示心脏负担越大。  公式： \deqn{RPP = HR \times SBP} 其中： - \eqn{HR} 为静息心率（bpm），取自自动血压测量同步记录的两次脉率（p102）的均值。 - \eqn{SBP} 为平均收缩压（mmHg），从两次自动血压（p4080）读数中计算获得。 若两次自动测量中仅有一次有效，则直接使用该次测量值；若两次均缺失，则 RPP 设为 `NA`。

**签名**:

```r
calculate_RPP(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据根目录，默认自动获取。
- `instance`: 测量实例编号 (0/1/2/3)，默认 0，与血压及脉率字段的实例保持一致。 

**返回**: 数据框，包含： \item{eid}{参与者 ID} \item{RPP}{心率压力积 (bpm * mmHg)}

**示例**（来自源码 @examples）:

```r
\dontrun{
rpp <- calculate_RPP(path = "./ukb", instance = 0)
summary(rpp$RPP)
}
```

---

### calculate_SHR

**文件**: `R/calculate_SHR.R`　**导出**: 是 ✓

**功能**: 计算应激性高血糖比值（SHR）  从 UK Biobank 数据中提取空腹血糖（Glucose，单位 mmol/L）和 HbA1c（单位 mmol/mol）， 先将 HbA1c 转换为 NGSP 单位（%），再计算 SHR。

**签名**:

```r
calculate_SHR(path = NULL,instance = 0)
```

**参数**:

- `instance`: 整数值，表示测量实例索引（默认为 0，即基线测量）。
- `path`: 字符型，UK Biobank 数据目录路径，通常无需手动指定。 

**返回**: 返回一个数据框，包含以下列： \item{eid}{参与者唯一标识符。} \item{glucose_mmol_L}{空腹血糖，单位 mmol/L。} \item{hba1c_mmol_mol}{HbA1c，单位 mmol/mol。} \item{hba1c_percent}{转换后的 HbA1c，单位 \%（NGSP）。} \item{SHR}{应激性高血糖比值，计算公式为 glucose / (1.59 * HbA1c\% - 2.59)。}  当空腹血糖或 HbA1c 缺失，或分母 ≤ 0 时，SHR 为 NA。

**示例**（来自源码 @examples）:

```r
\dontrun{
# 提取基线 SHR
SHR_data <- calculate_SHR(instance = 0)
head(SHR_data)
}
```

---

### calculate_abdominal_obesity

**文件**: `R/calculate_abdominal_obesity.R`　**导出**: 是 ✓

**功能**: 从UK Biobank提取数据并计算腹型肥胖（返回完整数据）

**描述**: 封装 easyUKB 的数据提取函数（ethnicity, Waist_circumference, age_sex_income）， 自动按 eid 合并，基于腰围、性别、种族和所选国际标准判定腹型肥胖， 并返回所有提取到的原始变量及判定结果。

**签名**:

```r
calculate_abdominal_obesity(path=NULL, instance=0, criteria = c("AHA_metabolic", "IDF"), asian_ethnicities = c("Indian", "Pakistani", "Bangladeshi", "Chinese", "Any other Asian background", "Asian or Asian British"), default_group = c("White", "Asian"))
```

**参数**:

- `path`: 字符，UK Biobank 数据根目录。
- `instance`: 整数，数据实例（0, 1, 2, 3），传递给腰围和年龄/性别/收入提取函数。
- `criteria`: 字符，腹型肥胖判定标准： \itemize{ \item "AHA_metabolic"（默认）：男≥102/女≥88 cm，亚裔男≥90/女≥80 cm。 \item "IDF"：男≥94/女≥80 cm，亚裔男≥90/女≥80 cm。 }
- `asian_ethnicities`: 字符向量，定义南亚/东亚裔的种族名称，默认涵盖UK Biobank中所有亚裔分类。
- `default_group`: 字符，种族缺失时的默认处理组，可选"White"（默认）或"Asian"。 

**返回**: data.table，包含以下列： \itemize{ \item eid：参与者标识号 \item Ethnicity_detail：详细种族分类（来自 easyUKB::ethnicity） \item Waist_circumference：腰围(cm)（来自 easyUKB::Waist_circumference） \item Age：年龄（来自 easyUKB::age_sex_income） \item Sex：性别（Male/Female）（来自 easyUKB::age_sex_income） \item Income：收入（来自 easyUKB::age_sex_income） \item abdominal_obesity：腹型肥胖判定（逻辑型） } 注意：仅保留三个数据源中 eid 均有的个体。

**示例**（来自源码 @examples）:

```r
\dontrun{
result <- calculate_abdominal_obesity(
path = "/path/to/ukb",
instance = 2,
criteria = "AHA_metabolic"
)
head(result)
}
```

---

### read_disease_data

**文件**: `R/calculate_comorbidity.R`　**导出**: 否（internal）

**签名**:

```r
read_disease_data(filepath)
```

---

### calculate_delta_eGFR

**文件**: `R/calculate_delta_eGFR.R`　**导出**: 是 ✓

**功能**: 计算肌酐与胱抑素 C 估算肾小球滤过率的差值 (delta_eGFR_cysc_scr)

**描述**: 基于血清肌酐 (Scr) 和胱抑素 C (CysC) 分别估算的肾小球滤过率 (eGFR) 之间的差异， 用于评估肾功能评估的不一致性，识别可能存在的非肾小球滤过因素对肌酐水平的干扰。  差值定义为： \deqn{delta\_eGFRcysc\_scr = eGFR_{CysC} - eGFR_{Scr}}  其中： - \eqn{eGFR_{Scr}} 采用 CKD‑EPI 2021 肌酐公式计算； - \eqn{eGFR_{CysC}} 采用 CKD‑EPI 2021 胱抑素 C 公式计算。 所有 eGFR 单位均为 mL/min/1.73 m²。  临床意义： - 若 \code{delta_eGFR_cysc_scr} 显著为负（如 < -10），可能提示肌肉量减少、炎症等 因素导致基于肌酐的 eGFR 高估了实际肾功能； - 若差值接近零或较小，则认为两种方法评估结果一致。

**签名**:

```r
calculate_delta_eGFR(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据根目录，默认自动获取。 

**返回**: 一个数据框，包含： \item{eid}{参与者 ID} \item{delta_eGFR_cysc_scr}{肌酐‑胱抑素 C eGFR 差值 (mL/min/1.73 m²)}

**示例**（来自源码 @examples）:

```r
\dontrun{
delta <- calculate_delta_eGFR(path = "./ukb")
summary(delta$delta_eGFR_cysc_scr)
}
```

---

### calculate_eCRF

**文件**: `R/calculate_eCRF.R`　**导出**: 是 ✓

**功能**: 估计心肺健康 (eCRF) 及分组

**描述**: 基于 Jackson 等人的性别特异非运动回归模型计算 eCRF (METs)， 并进一步按年龄和性别调整后的五分位数分为低、中、高三个心肺健康等级。  男性公式： \deqn{eCRF = 21.2870 + 0.1654 \cdot age - 0.0023 \cdot age^{2} - 0.2318 \cdot BMI - 0.0337 \cdot WC - 0.0390 \cdot rHR + 0.6351 \cdot MVPA - 0.4263 \cdot smoking}  女性公式： \deqn{eCRF = 14.7873 + 0.1159 \cdot age - 0.0017 \cdot age^{2} - 0.1534 \cdot BMI - 0.0085 \cdot WC - 0.0364 \cdot rHR + 0.5987 \cdot MVPA - 0.2994 \cdot smoking}  其中： \itemize{ \item age：年龄（岁） \item BMI：体质指数 (kg/m²) \item WC：腰围 (cm) \item rHR：静息心率 (bpm)，自动血压测量同步的两次脉搏读数取均值 \item MVPA：中度及以上体力活动，每周至少一次为 1，否则 0 \item smoking：当前吸烟为 1，否则 0 }

**签名**:

```r
calculate_eCRF(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据根目录，默认自动获取。
- `instance`: 访视实例 (0/1/2/3)，默认 0。 

**返回**: 数据框，包含列： \item{eid}{参与者 ID} \item{eCRF}{估计心肺功能 (METs)} \item{cardioresp_fitness_status}{心肺健康分组：Low / Medium / High}

**示例**（来自源码 @examples）:

```r
\dontrun{
result <- calculate_eCRF(path = "./ukb", instance = 0)
head(result)
}
```

---

### calculate_eGDR

**文件**: `R/calculate_eGDR.R`　**导出**: 是 ✓

**功能**: 计算估计葡萄糖处理率 (eGDR)

**描述**: eGDR (Estimated Glucose Disposal Rate) 是一种基于腰围、高血压状态和糖化血红蛋白 的胰岛素抵抗替代指标，单位 mg/kg/min。该指标无需复杂检测，适用于大规模流行病学研究， 数值越低提示胰岛素抵抗越严重。  公式： \deqn{eGDR = 21.158 - (0.09 \times WC) - (3.407 \times HTN) - (0.551 \times HbA1c)}  其中： - \eqn{WC} 为腰围 (cm)； - \eqn{HTN} 为高血压状态，1 = 有高血压，0 = 无高血压，由 `diagnose_baseline_hypertension` 函数定义； - \eqn{HbA1c} 为糖化血红蛋白百分比 (%)，原始 UK Biobank 单位为 mmol/mol， 需按 \code{(HbA1c\_mmol / 10.929) + 2.15} 转换。

**签名**:

```r
calculate_eGDR(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据根目录，默认自动获取。
- `instance`: 评估实例编号 (0/1/2/3)，默认 0（基线）。 

**返回**: 一个数据框，包含： \item{eid}{参与者 ID} \item{eGDR}{估计葡萄糖处理率 (mg/kg/min)}

**示例**（来自源码 @examples）:

```r
\dontrun{
egdr <- calculate_eGDR(path = "./ukb", instance = 0)
summary(egdr$eGDR)
}
```

---

### calculate_ePWV

**文件**: `R/calculate_ePWV.R`　**导出**: 是 ✓

**功能**: 计算估计脉搏波速度 (ePWV)

**描述**: 依据 Greve 等人 (2016) 推导的公式，利用年龄和平均动脉压 (MAP) 估计主动脉脉搏波速度，用于大规模流行病学研究中的心血管风险评估。  原始公式： \deqn{ ePWV = 9.587 - 0.402 \times age + 4.560 \times 10^{-3} \times age^{2} - 2.621 \times 10^{-5} \times age^{2} \times MAP + 3.176 \times 10^{-3} \times age \times MAP - 1.832 \times 10^{-2} \times MAP } 其中 \eqn{age} 为年龄（岁），\eqn{MAP} 为平均动脉压 (mmHg)， 由公式 \eqn{MAP = DBP + (SBP - DBP)/3} 获得。

**签名**:

```r
calculate_ePWV(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据根目录，默认自动获取。
- `instance`: 血压测量实例编号 (0/1/2/3)，默认 0。 

**返回**: 一个数据框，包含两列： \item{eid}{参与者标识} \item{ePWV}{估计脉搏波速度 (m/s)}

**示例**（来自源码 @examples）:

```r
\dontrun{
epwv_res <- calculate_ePWV(path = "./ukb_data", instance = 0)
head(epwv_res)
}
```

---

### calculate_framingham_ukb

**文件**: `R/calculate_framingham_ukb.R`　**导出**: 是 ✓

**功能**: 计算 UK Biobank 数据的 Framingham 10年冠心病风险评分  该函数根据 ATP III 版本的 Framingham 风险评分公式，计算每个参与者的 10年冠心病（CHD）风险。Framingham 风险评分是经典的心血管风险评估工具， 基于年龄、性别、总胆固醇、HDL胆固醇、收缩压、高血压治疗状态、吸烟状态和 糖尿病状态等危险因素。胆固醇值默认为 mmol/L（函数内部自动转换为 mg/dL）。

**签名**:

```r
calculate_framingham_ukb(data, id_col = "eid", age_col = "age", sex_col = "sex", tc_col = "tc", hdl_col = "hdl", sbp_col = "sbp", bp_tx_col = "bp_tx", smoking_col = "smoking", diabetes_col = "diabetes", output_suffix = "framingham", cholesterol_unit = "mmol/L")
```

**参数**:

- `data`: 数据框，包含计算所需的变量。
- `id_col`: 参与者ID列名，默认为 "eid"。
- `age_col`: 年龄列名（岁），默认为 "age"。
- `sex_col`: 性别列名，值应为 "Male"/"Female" 或 "male"/"female"（不区分大小写）。
- `tc_col`: 总胆固醇列名（mmol/L），默认为 "tc"。
- `hdl_col`: HDL胆固醇列名（mmol/L），默认为 "hdl"。
- `sbp_col`: 收缩压列名（mmHg），默认为 "sbp"。
- `bp_tx_col`: 高血压治疗状态列名（逻辑型或0/1，TRUE/1表示接受治疗）。
- `smoking_col`: 当前吸烟状态列名，应为 "yes"/"no" 或 1/0（1=当前吸烟者）。
- `diabetes_col`: 糖尿病诊断列名，应为 "yes"/"no" 或 1/0（1=糖尿病患者）。
- `output_suffix`: 新列名的后缀，默认为 "framingham"。
- `cholesterol_unit`: 胆固醇单位，"mmol/L"（默认）或 "mg/dL"。如为 "mg/dL" 则不转换。 

**返回**: 原始数据框附加以下三列： \item{Framingham_score}{积分评分（整数）。} \item{Framingham_risk_percent}{10年风险百分比。} \item{Framingham_risk_category}{风险等级："Low"（低危）、"Intermediate"（中危）、"High"（高危）。}

**示例**（来自源码 @examples）:

```r
\dontrun{
ukb_data <- data.frame(
eid = 1:5,
age = c(45, 60, 55, 70, 50),
sex = c("Male", "Female", "Male", "Female", "Male"),
tc = c(5.2, 6.0, 4.8, 7.2, 5.5),      # mmol/L
hdl = c(1.3, 1.5, 1.1, 1.8, 1.2),     # mmol/L
sbp = c(130, 145, 120, 160, 135),
bp_tx = c(0, 1, 0, 1, 0),
smoking = c("no", "yes", "no", "no", "yes"),
diabetes = c(0, 0, 1, 0, 0)
)
result <- calculate_framingham_ukb(ukb_data)
}
```

---

### mmol_to_mgdl

**文件**: `R/calculate_framingham_ukb.R`　**导出**: 否（internal）

**签名**:

```r
mmol_to_mgdl(x)
```

---

### calculate_metabolic_syndrome

**文件**: `R/calculate_metabolic_syndrome.R`　**导出**: 是 ✓

**功能**: 计算代谢综合征（MetS）诊断  依据 AHA 代谢综合征标准，整合 UK Biobank 的腰围、血压、血脂、血糖信息， 对参与者进行代谢综合征诊断。支持自定义亚洲种族腰围阈值及甘油三酯临界值。

**签名**:

```r
calculate_metabolic_syndrome(path = NULL, instance = 0, tg_threshold = 1.7, abdominal_obesity_criteria = c("AHA_metabolic", "IDF"), asian_ethnicities = c( "Indian", "Pakistani", "Bangladeshi", "Chinese", "Any other Asian background", "Asian or Asian British" ))
```

**参数**:

- `path`: 字符型，UK Biobank 数据文件路径，默认自动获取。
- `instance`: 整数型，评估实例编号，默认 0（基线）。
- `tg_threshold`: 数值型，甘油三酯升高阈值（mmol/L），默认 1.7。
- `abdominal_obesity_criteria`: 字符型，腹型肥胖诊断标准，可选 `"AHA_metabolic"`（默认）或 `"IDF"`。
- `asian_ethnicities`: 字符向量，用于亚洲腹型肥胖阈值的种族类别。 默认包含常见南亚、东亚及“其他亚洲背景”等。 

**返回**: 一个数据框，包含以下列： \item{eid}{参与者编号} \item{abdominal_obesity}{腹型肥胖（逻辑型）} \item{hypertension}{高血压（逻辑型）} \item{high_TG}{高甘油三酯（逻辑型）} \item{low_HDL}{低高密度脂蛋白胆固醇（逻辑型）} \item{hyperglycemia}{高血糖（糖尿病或前期，逻辑型）} \item{mets_components}{满足的代谢综合征组分个数（0~5）} \item{mets}{代谢综合征诊断（满足 ≥3 项为 TRUE）}

**示例**（来自源码 @examples）:

```r
\dontrun{
mets_data <- calculate_metabolic_syndrome(instance = 0)
table(mets_data$mets)
}
```

---

### calculate_missing_rate

**文件**: `R/calculate_missing_rate.R`　**导出**: 是 ✓

**功能**: 计算数据框的行缺失率与列缺失率

**签名**:

```r
calculate_missing_rate(data, exclude_cols = "eid")
```

**参数**:

- `data`: 数据框 (data.frame)
- `exclude_cols`: 字符向量，在计算行缺失率时排除的列名（例如 "eid"）。列缺失率仍计算所有列。 

**返回**: 一个列表，包含： \item{row_missing}{每行的缺失比例（数值向量，名称对应行号）} \item{col_missing}{每列的缺失比例（数值向量，名称对应列名）}

**示例**（来自源码 @examples）:

```r
df <- data.frame(a = c(1, NA, 3), b = c(NA, NA, 2), c = c(1, 2, 3))
miss <- calculate_missing_rate(df)
miss$row_missing
miss$col_missing
```

---

### calculate_obesity_indices

**文件**: `R/calculate_obesity_indices.R`　**导出**: 是 ✓

**功能**: 计算九种肥胖相关体型指标  基于 UK Biobank 的人体测量和血脂数据，计算论文 (Wang et al.,PUBMEDID:41353132 BMC Public Health, 2026) 中比较的 9 项指标： BMI, WWI, WHtR, CI, RFM, CMI, LAP, VAI, WC。 所有血脂指标使用 mmol/L，无需额外转换。性别用于不同公式。

**签名**:

```r
calculate_obesity_indices(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据路径，默认自动获取。
- `instance`: 评估实例编号（0,1,2,3），默认 0。 

**返回**: 一个 tibble，包含 eid 以及 BMI, WWI, WHtR, CI, RFM, CMI, LAP, VAI, WC 九列。

---

### calculate_recode_scores

**文件**: `R/calculate_recode_scores.R`　**导出**: 是 ✓

**功能**: 计算2型糖尿病RECODe 10年心血管风险评分  该函数计算2型糖尿病并发症风险方程（RECODe）的六种心血管结局的10年风险： 动脉粥样硬化性心血管疾病（ASCVD）、心肌梗死、卒中、充血性心力衰竭、 心血管死亡和全因死亡。需要的变量包括：年龄、性别、种族（黑人）、 吸烟状态、收缩压、HbA1c、总胆固醇、HDL胆固醇、血清肌酐、尿白蛋白、 尿肌酐、高血压治疗、他汀类药物使用、抗凝剂使用和心血管疾病史。  该函数不进行缺失值插补。如果任何所需变量缺失，该变量在线性预测器中的 贡献设为0（系数贡献=0）。这可能引入偏倚，建议用户在调用此函数前 适当处理缺失数据。

**签名**:

```r
calculate_recode_scores(data, id_col = "eid", age_col = "Age", sex_col = "Sex", ethnicity_col = NULL, black_col = "Ethnicity_black", smoking_col = "Smoking_status", sbp_col = "SBP", hba1c_col = "HbA1c(mmol/mol)", tc_col = "TC(mmol/L)", hdl_col = "HDL-C(mmol/L)", creatinine_col = "Cr(umol/L)", ualb_col = "Microalbumin_in_urine", ucreat_col = "Creatinine_in_urine", bp_tx_col = "blood_pressure_med", statin_col = "cholesterol_lowering_med", anticoagulant_col = NULL, cvd_history_col = "cvd_history", uacr_default = NULL, anticoagulant_default = 0, output_suffix = "recode")
```

**参数**:

- `data`: 数据框，包含所需的变量。
- `id_col`: 参与者ID列名，默认为 "eid"。
- `age_col`: 年龄列名（岁），默认为 "Age"。
- `sex_col`: 性别列名，值应为 "Male"/"Female" 或 "male"/"female"（不区分大小写）。
- `ethnicity_col`: 种族列名（用于定义黑人种族）。如果值包含 "Black" 或 "African" （不区分大小写），则 Black 设为 1。如果已有二分类 Black 变量，设为 NULL 并提供 black_col。
- `black_col`: 可选，预定义的二分类黑人种族变量列名（1=黑人，0=其他）。 如果提供，ethnicity_col 将被忽略。
- `smoking_col`: 当前吸烟状态列名，应为 "yes"/"no" 或 1/0（1=当前吸烟者）。
- `sbp_col`: 收缩压列名（mmHg），默认为 "SBP"。
- `hba1c_col`: HbA1c列名（mmol/mol），默认为 "HbA1c(mmol/mol)"。
- `tc_col`: 总胆固醇列名（mmol/L），默认为 "TC(mmol/L)"。
- `hdl_col`: HDL胆固醇列名（mmol/L），默认为 "HDL-C(mmol/L)"。
- `creatinine_col`: 血清肌酐列名（umol/L），默认为 "Cr(umol/L)"。
- `ualb_col`: 尿白蛋白列名（mg/L），默认为 "Microalbumin_in_urine"。
- `ucreat_col`: 尿肌酐列名（umol/L），默认为 "Creatinine_in_urine"。
- `bp_tx_col`: 高血压治疗列名（二分类：1=接受治疗，0=未接受）。
- `statin_col`: 他汀类药物使用列名（二分类：1=使用，0=未使用）。
- `anticoagulant_col`: 可选，抗凝剂使用列名（二分类：1=使用，0=未使用）。 如果未提供，假设所有患者未使用抗凝剂（0）。
- `cvd_history_col`: 心血管疾病史列名（二分类：1=有，0=无）。
- `uacr_default`: 可选，当尿白蛋白或肌酐缺失时使用的UACR（mg/g）默认值。 如果为 NULL（默认），当无法计算时UACR设为NA。
- `anticoagulant_default`: 如果未提供抗凝剂列时的默认值，默认为 0。
- `output_suffix`: 新列名的后缀，默认为 "recode"。 

**返回**: 原始数据框附加以下六列： \item{ASCVD_risk}{10年动脉粥样硬化性心血管疾病（非致死性心梗或卒中）风险。} \item{MI_risk}{10年致死或非致死性心肌梗死风险。} \item{Stroke_risk}{10年致死或非致死性卒中风险。} \item{CHF_risk}{10年充血性心力衰竭风险。} \item{CV_mortality_risk}{10年心血管死亡风险。} \item{AllCause_risk}{10年全因死亡风险。}

**示例**（来自源码 @examples）:

```r
\dontrun{
# UK Biobank样例数据
ukb_data <- data.frame(
eid = 1:5,
Age = c(60, 65, 55, 70, 50),
Sex = c("Female", "Male", "Male", "Female", "Male"),
Ethnicity = c("White", "Black", "Asian", "White", "Other"),
Smoking_status = c("Never", "Current", "Previous", "Never", "Current"),
SBP = c(138, 155, 139, 158, 117),
`HbA1c(mmol/mol)` = c(35.7, 46.7, 51.7, 46.9, 121.4),
`TC(mmol/L)` = c(4.213, 4.098, 5.027, NA, 3.321),
`HDL-C(mmol/L)` = c(1.807, 1.082, NA, NA, 1.233),
`Cr(umol/L)` = c(57.2, 73.4, 76.2, NA, 46.1),
Microalbumin_in_urine = c(10, 20, 5, 15, 30),
Creatinine_in_urine = c(8000, 7500, 9000, 8200, 6000),
blood_pressure_med = c(1, 0, 1, 1, 0),
cholesterol_lowering_med = c(1, 1, NA, NA, NA),
Coronary_heart_disease = c(0, 0, 0, 0, 0),
Stroke_TIA = c(0, 0, 0, 0, 0),
Heart_failure = c(0, 0, 0, 0, 0),
Peripheral_vascular_disease = c(0, 0, 0, 0, 0)
)

# 创建CVD病史变量（示例：以上任一疾病）
ukb_data$cvd_history <- as.integer(
ukb_data$Coronary_heart_disease | ukb_data$Stroke_TIA |
ukb_data$Heart_failure | ukb_data$Peripheral_vascular_disease
)

result <- calculate_recode_scores(
data = ukb_data,
age_col = "Age",
sex_col = "Sex",
ethnicity_col = "Ethnicity",
smoking_col = "Smoking_status",
sbp_col = "SBP",
hba1c_col = "HbA1c(mmol/mol)",
tc_col = "TC(mmol/L)",
hdl_col = "HDL-C(mmol/L)",
creatinine_col = "Cr(umol/L)",
ualb_col = "Microalbumin_in_urine",
ucreat_col = "Creatinine_in_urine",
bp_tx_col = "blood_pressure_med",
statin_col = "cholesterol_lowering_med",
anticoagulant_col = NULL,
cvd_history_col = "cvd_history"
)

head(result[, c("eid", "ASCVD_risk", "MI_risk", "AllCause_risk")])
}
```

---

### hba1c_mmol_to_pct

**文件**: `R/calculate_recode_scores.R`　**导出**: 否（internal）

**签名**:

```r
hba1c_mmol_to_pct(x)
```

---

### mmol_to_mgdl

**文件**: `R/calculate_recode_scores.R`　**导出**: 否（internal）

**签名**:

```r
mmol_to_mgdl(x)
```

---

### umol_to_mgdl_creat

**文件**: `R/calculate_recode_scores.R`　**导出**: 否（internal）

**签名**:

```r
umol_to_mgdl_creat(x)
```

---

### calc_uacr

**文件**: `R/calculate_recode_scores.R`　**导出**: 否（internal）

**签名**:

```r
calc_uacr(ualb, ucreat)
```

---

### predict_recode_cv

**文件**: `R/calculate_recode_scores.R`　**导出**: 否（internal）

**签名**:

```r
predict_recode_cv(age, sbp, hba1c, tot_chol, hdl, creatinine, uacr, female = 0, black = 0, smoking = 0, cvd_history = 0, bp_med = 0, statin = 0, anticoagulant = 0)
```

---

### combine_disease_ages

**文件**: `R/combine_disease_ages.R`　**导出**: 是 ✓

**功能**: 合并基于发病年龄的疾病诊断数据与时间变量  将多个由 `combine_diseases_and_age` 等函数生成的年龄结果数据框 按 `eid` 对齐合并，附加基线时间变量，最后调用 `process_age_dataframe` 进行年龄数据标准化与随访时间计算。

**签名**:

```r
combine_disease_ages(time = NULL, ...)
```

**参数**:

- `time`: 数据框，必须包含列 `eid`、`baseline_age`、`baseline_date`、 `blood_time0`、`blood_time_age`、`outcome_age`、`outcome_time`。
- `...`: 一个或多个数据框，每个对应一种疾病的年龄分析结果， 且**必须包含 `eid` 列**。 

**返回**: 处理后的数据框，包含所有疾病的年龄诊断列、标准化年龄变量及随访年数。

---

### combine_disease_dates

**文件**: `R/combine_disease_dates.R`　**导出**: 是 ✓

**功能**: 合并疾病诊断日期数据与时间变量  将多个已提取的疾病结果数据框（通常由 `combine_diseases_and_date` 等函数生成） 按行合并，并附加基线时间变量，最后调用 `process_date_dataframe` 进行日期标准化 与随访时间计算。

**签名**:

```r
combine_disease_dates(time=NULL, ...)
```

**参数**:

- `time`: 数据框，必须包含列 `eid`、`baseline_age`、`baseline_date`、 `blood_time0`、`blood_time_age`、`outcome_age`、`outcome_time`。
- `...`: 一个或多个数据框，每个对应一种疾病的分析结果（不含 `eid` 列）， 行数必须与 `time` 的行数一致，且按相同顺序排列。 

**返回**: 处理后的数据框，包含所有疾病诊断列、转换后的日期列以及随访年数等。

---

### convert_dates_to_binary

**文件**: `R/convert_dates_to_binary.R`　**导出**: 是 ✓

**签名**:

```r
convert_dates_to_binary(data)
```

---

### convert_number_to_date

**文件**: `R/convert_number_to_date.R`　**导出**: 是 ✓

**签名**:

```r
convert_number_to_date(df)
```

---

### convert_p20001_to_coding

**文件**: `R/convert_p20001_to_coding.R`　**导出**: 是 ✓

**签名**:

```r
convert_p20001_to_coding(data, path)
```

---

### convert_p20002_to_coding

**文件**: `R/convert_p20002_to_coding.R`　**导出**: 是 ✓

**签名**:

```r
convert_p20002_to_coding(data, path)
```

---

### convert_p20003_to_coding

**文件**: `R/convert_p20003_to_coding.R`　**导出**: 是 ✓

**签名**:

```r
convert_p20003_to_coding(data, path)
```

---

### convert_p20004_to_coding

**文件**: `R/convert_p20004_to_coding.R`　**导出**: 是 ✓

**签名**:

```r
convert_p20004_to_coding(data, path)
```

---

### convert_p40006_ultimate

**文件**: `R/convert_p40006_ultimate.R`　**导出**: 是 ✓

**签名**:

```r
convert_p40006_ultimate(data, path)
```

---

### convert_p41270_ultimate

**文件**: `R/convert_p41270_ultimate.R`　**导出**: 是 ✓

**签名**:

```r
convert_p41270_ultimate(data, path)
```

---

### convert_p41272_ultimate

**文件**: `R/convert_p41272_ultimate.R`　**导出**: 是 ✓

**签名**:

```r
convert_p41272_ultimate(data, path)
```

---

### create_coding_dict

**文件**: `R/create_coding_dict.R`　**导出**: 是 ✓

**签名**:

```r
create_coding_dict(code6)
```

---

### create_disease_diagnosis

**文件**: `R/create_disease_diagnosis.R`　**导出**: 是 ✓

**签名**:

```r
create_disease_diagnosis(Date_df, disease_codes, disease_name)
```

---

### create_overall_auc_summary_table

**文件**: `R/create_overall_auc_summary_table.R`　**导出**: 是 ✓

**功能**: 多数据集ROC分析AUC汇总表生成函数

**描述**: 为多个数据集的ROC分析结果生成汇总统计表格。 计算并汇总每个数据集中基因/蛋白质互作对的AUC统计量， 包括均值、中位数、极值、AUC>0.6和AUC>0.7的基因数量等指标。

**签名**:

```r
create_overall_auc_summary_table(roc_results_list, dataset_names)
```

**参数**:

- `roc_results_list`: ROC分析结果列表，每个元素是一个包含AUC、P值等结果的数据框
- `dataset_names`: 数据集名称向量，与roc_results_list一一对应

**返回**: 返回一个data.frame，包含以下汇总统计列： - Dataset: 数据集名称 - N_Genes_Total: 总基因/互作对数量 - N_Genes_Valid: 有效AUC值的数量 - Mean_AUC: AUC均值 - Median_AUC: AUC中位数 - Min_AUC: AUC最小值 - Max_AUC: AUC最大值 - N_Genes_AUC_gt_0_7: AUC>0.7的基因数量 - N_Genes_AUC_gt_0_6: AUC>0.6的基因数量 - N_Genes_Significant: 经BH校正后显著的基因数量 - Top_Gene: AUC最高的基因名称 - Top_AUC: 最高AUC值 - Top_Gene_P_value: 最高AUC基因的P值

**示例**（来自源码 @examples）:

```r
\dontrun{
roc_results1 <- data.frame(Gene = c("A_B", "C_D"), AUC = c(0.75, 0.68), P_value_vs_0.5 = c(0.01, 0.05))
roc_results2 <- data.frame(Gene = c("A_B", "E_F"), AUC = c(0.72, 0.65), P_value_vs_0.5 = c(0.02, 0.08))
summary_table <- create_overall_auc_summary_table(list(roc_results1, roc_results2), c("Dataset1", "Dataset2"))
}
```

---

### set_data_path

**文件**: `R/data_config.R`　**导出**: 是 ✓

**功能**: 设置默认数据路径 Set default data path

**签名**:

```r
set_data_path(path = NULL)
```

**参数**:

- `path`: 数据目录路径
- `path`: Path to data directory

---

### get_data_path

**文件**: `R/data_config.R`　**导出**: 是 ✓

**功能**: 获取当前数据路径 Get current data path

**签名**:

```r
get_data_path()
```

---

### get_ukb_path

**文件**: `R/data_config.R`　**导出**: 否（internal）

**功能**: 获取数据路径（内部辅助函数） Get data path (internal helper)  返回当前设置的数据路径，若未设置则报错。 Returns the current data path, or throws an error if not set.

**签名**:

```r
get_ukb_path(path = NULL)
```

**参数**:

- `path`: 用户显式传入的路径，若为 NULL 则使用全局设置

**返回**: 字符型，标准化的路径

---

### dex_eGFR

**文件**: `R/dex_eGFR.R`　**导出**: 是 ✓

**功能**: 肾功能估算函数

**描述**: 根据英国生物银行数据计算多种肾小球滤过率（eGFR）估算值。 使用多种公式计算肾功能，包括： - Cockcroft-Gault 公式 - EPI 2021 肌酐公式 - EPI 2021 胱抑素C公式 - MDRD 公式 - FAS 年龄调整公式 - FAS 身高调整公式

**签名**:

```r
dex_eGFR(path = NULL,instance = 0)
```

**参数**:

- `path`: UK Biobank 数据目录的路径
- `instance`: 整数型，评估实例编号，默认 0（基线）,只能算0或1。

**返回**: 返回包含多种eGFR估算值的数据框： - eid: 参与者ID - eGFR_EPI_2021_scr: EPI 2021 肌酐公式估算的eGFR - eGFR_EPI_2021_cysC: EPI 2021 胱抑素C公式估算的eGFR - eGFR_MDRDc: MDRD公式估算的eGFR - eGFR_Cockcroft_Gault: Cockcroft-Gault公式估算的eGFR - eGFR_FAS_age: FAS年龄调整公式估算的eGFR - eGFR_FAS_height: FAS身高调整公式估算的eGFR

**示例**（来自源码 @examples）:

```r
# result <- dex_eGFR(path = "./data")
```

---

### diagnose_baseline_hypertension

**文件**: `R/diagnose_baseline_hypertension.R`　**导出**: 是 ✓

**功能**: 诊断基线高血压状态并计算已知病程年数  整合 UK Biobank 多来源数据，包括首次发生记录、死亡登记、住院诊断、 口头访谈、触摸屏自报病史、血压测量及降压药使用情况，综合判定参与者 在基线时是否患有高血压，并尽可能估算确诊以来的年数。

**签名**:

```r
diagnose_baseline_hypertension(path = NULL,instance=0)
```

**参数**:

- `path`: 字符型，UK Biobank 数据文件所在路径。若留空（`NULL`）则自动获取默认路径。
- `instance`: 整数型，指定用于口头访谈诊断数据的实例编号，默认为 0 （基线评估）。 

**返回**: 一个数据框，包含以下三列： \describe{ \item{eid}{参与者编号。} \item{baseline_hypertension}{逻辑值，`TRUE` 表示基线时已患有高血压。} \item{baseline_hypertension_years}{数值型，基线时已知高血压患病年数； 若患病但病程无法确定则返回 `NA`，未患病返回 `0`。} }

---

### diagnose_hypertension_byBP

**文件**: `R/diagnose_hypertension_byBP.R`　**导出**: 是 ✓

**功能**: 基于血压测量值诊断高血压

**描述**: 提取 UK Biobank 多次血压测量值，计算每个实例的平均 SBP 和 DBP， 按 AHA 标准（SBP ≥130 或 DBP ≥80 mmHg）判定高血压，并返回综合诊断结果。

**签名**:

```r
diagnose_hypertension_byBP(path = NULL, instances = 0)
```

**参数**:

- `path`: UK Biobank 数据根目录。
- `instances`: 默认 0 用于兼容原有参数（函数内部会处理所有可用实例）。 

**返回**: data.table，包含 eid 和 hypertension 逻辑列（任一有效测量实例满足标准即为 TRUE，全缺失则为 NA）。

---

### eGFR_FAS_age

**文件**: `R/eGFR_FAS_age.R`　**导出**: 是 ✓

**签名**:

```r
eGFR_FAS_age(data, scr_mg.dl)
```

---

### eGFR_FAS_height

**文件**: `R/eGFR_FAS_height.R`　**导出**: 是 ✓

**签名**:

```r
eGFR_FAS_height(data, scr_mg.dl)
```

---

### electronic_device_use

**文件**: `R/electronic_device_use.R`　**导出**: 是 ✓

**功能**: 电子设备使用数据处理函数

**描述**: 处理英国生物银行的电子设备使用数据。 提取手机使用模式、免提设备使用、电脑游戏频率等相关变量。

**签名**:

```r
electronic_device_use(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回包含电子设备使用指标的数据框： - Length_of_mobile_phone_use: 手机使用年限 - Weekly_usage: 每周手机使用时间 - Hands_free_use: 免提设备使用频率 - Use_change: 与两年前相比手机使用变化 - Use_side: 通常使用手机的头部侧边 - Computer_games: 玩电脑游戏频率

**示例**（来自源码 @examples）:

```r
# result <- electronic_device_use(path = "./data")
```

---

### extract_FEV1_Best

**文件**: `R/extract_FEV1_Best.R`　**导出**: 是 ✓

**功能**: 提取 FEV1（第1秒用力呼气量）的最佳值

**描述**: 从 UK Biobank 数据中提取三次可接受 FEV1 测量值，取其中的最大值作为该受试者的代表值。 该做法符合肺功能测试的标准化要求（选取最佳可接受努力结果）。

**签名**:

```r
extract_FEV1_Best(path = NULL, instance = 0)
```

**参数**:

- `path`: 字符，UK Biobank 数据根目录路径。若为 `NULL` 则使用默认路径。
- `instance`: 实例编号，表示评估轮次（0 = 基线，1 = 第一次复查，等等）。默认为 0。 

**返回**: 一个数据框，包含5列： \item{eid}{参与者标识符} \item{FEV1_a0}{单位：升 (L)，第一次测量值} \item{FEV1_a1}{单位：升 (L)，第二次测量值} \item{FEV1_a2}{单位：升 (L)，第三次测量值} \item{FEV1}{单位：升 (L)，为三次测量中的最大值（若有缺失则为 NA）}

**示例**（来自源码 @examples）:

```r
\dontrun{
fev1 <- extract_FEV1_Best(path = "/path/to/ukb", instance = 0)
head(fev1)
}
```

---

### extract_protein_data

**文件**: `R/extract_protein_data.R`　**导出**: 是 ✓

**功能**: 蛋白组数据过滤与插补  读取或接收蛋白数据集，删除缺失率高于阈值的蛋白， 并剔除缺失蛋白数量过多的样本。可选择对剩余缺失值进行均值或中位数插补。

**签名**:

```r
extract_protein_data(path = NULL, instance = 0, data = NULL, threshold_protein = 20, threshold_sample = 50, impute = c("none", "mean", "median"))
```

**参数**:

- `path`: 字符型，数据根目录路径。若 `data` 为 NULL，将从该路径拼接文件名读取数据。
- `instance`: 数值或字符，实例编号，用于构造文件名（默认 0）。
- `data`: 可选，数据框。若直接传入数据，则忽略 `path` 和 `instance`。
- `threshold_protein`: 数值，蛋白缺失率阈值（百分比），高于此值的蛋白将被删除（默认 20）。
- `threshold_sample`: 数值，样本缺失比例阈值（百分比），在保留蛋白中缺失比例超过该值的样本将被删除（默认 50）。
- `impute`: 字符，插补方法，可选 `"none"`（不插补，默认）、`"mean"`、`"median"`。 

**返回**: 返回一个列表： \item{filtered_data}{过滤（及插补）后的数据框。} \item{stats}{列表，包含原始/删除的蛋白数和样本数。}

**示例**（来自源码 @examples）:

```r
\dontrun{
result <- filter_protein_data(path = "你的数据路径", instance = 0)
str(result$filtered_data)
print(result$stats)
}
```

---

### impute_protein

**文件**: `R/extract_protein_data.R`　**导出**: 否（internal）

**功能**: 内部函数：均值/中位数插补  对数据框中除 eid 列外的所有列进行均值或中位数插补。

**签名**:

```r
impute_protein(data, method = c("mean", "median"))
```

**参数**:

- `data`: 数据框，必须包含 eid 列。
- `method`: 插补方法，`"mean"` 或 `"median"`。

**返回**: 插补完成的数据框。

---

### extract_sleep_durations

**文件**: `R/extract_sleep_durations.R`　**导出**: 是 ✓

**功能**: 提取自报与实际睡眠时长  从 UK Biobank 同时获取参与者自报的每天睡眠小时数（p1160）和 过去一个月实际每晚睡眠分钟数（p30445），两者均转为数值型，无法 转换或缺失时返回 NA。

**签名**:

```r
extract_sleep_durations(path = NULL, instance = 0, hours = 6)
```

**参数**:

- `path`: 字符型，UK Biobank 数据文件路径，默认自动获取。
- `instance`: 整数型，测量实例索引，默认为 0（基线），仅用于 p1160。
- `hours`: 整数型，睡眠过少的阈值，默认6小时。 

**返回**: 一个数据框，包含以下列： \item{eid}{参与者唯一标识符。} \item{self_reported_sleep_hours}{自报每日睡眠时长（小时），来源 p1160。} \item{actual_sleep_minutes}{实际每晚睡眠时长（分钟），来源 p30445。}

**示例**（来自源码 @examples）:

```r
\dontrun{
sleep <- extract_sleep_durations(instance = 0,hours = 6)
}
```

---

### family_illnesses

**文件**: `R/family_illnesses.R`　**导出**: 是 ✓

**功能**: 家族疾病史数据处理函数

**描述**: 处理英国生物银行的家族疾病史数据。 提取父亲、母亲和兄弟姐妹的疾病史，为每种疾病和疾病类别组合创建二值变量。

**签名**:

```r
family_illnesses(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回包含三个数据框的列表： - Family_history: 所有疾病的综合家族史 - Father: 父亲的疾病史 - Mother: 母亲的疾病史 变量包括： - 心脏病、中风、高血压 - 慢性支气管炎/肺气肿、阿尔茨海默病/痴呆 - 糖尿病、帕金森病、严重抑郁症 - 肺癌、肠癌、乳腺癌、前列腺癌 - 髋部骨折 - 组合类别：心血管疾病、癌症、神经退行性疾病、呼吸系统疾病

**示例**（来自源码 @examples）:

```r
# result <- family_illnesses(path = "./data")
```

---

### disease_to_var

**文件**: `R/family_illnesses.R`　**导出**: 否（internal）

**签名**:

```r
disease_to_var(disease)
```

---

### process_family_illnesses_fast

**文件**: `R/family_illnesses.R`　**导出**: 否（internal）

**签名**:

```r
process_family_illnesses_fast(dt, illness_col, prefix)
```

---

### family_survival_status

**文件**: `R/family_survival_status.R`　**导出**: 是 ✓

**功能**: 家庭成员生存状态数据处理函数

**描述**: 处理英国生物银行的家庭成员生存状态数据。 提取父亲和母亲的生存状态、年龄或去世年龄，以及近亲非意外死亡信息。

**签名**:

```r
family_survival_status(path = NULL)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回包含家庭成员生存状态的数据框： - 父亲：生存状态、当前年龄、去世年龄、最终状态、最终年龄 - 母亲：生存状态、当前年龄、去世年龄、最终状态、最终年龄 - 近亲非意外死亡标志 - 父母至少一人去世标志

**示例**（来自源码 @examples）:

```r
# result <- family_survival_status(path = "./data")
```

---

### filter_protein_pairs

**文件**: `R/filter_protein_pairs.R`　**导出**: 是 ✓

**功能**: 筛选蛋白质互作对矩阵  根据非零值比例筛选蛋白对，保留比例在指定阈值范围内的互作对。

**签名**:

```r
filter_protein_pairs(pair_matrix, lower_threshold = 20, upper_threshold = 80)
```

**参数**:

- `pair_matrix`: 蛋白质互作对矩阵，行为样本，列为蛋白对，值为表达秩差（或其他数值）
- `lower_threshold`: 非零值比例的下限（百分比），默认为20
- `upper_threshold`: 非零值比例的上限（百分比），默认为80

**返回**: 返回包含筛选结果的列表，包括非零比例向量、筛选后的矩阵、保留的列索引等

---

### generate_validation_report

**文件**: `R/generate_validation_report.R`　**导出**: 是 ✓

**签名**:

```r
generate_validation_report(validation_results, valid_codes)
```

---

### handle_special_values

**文件**: `R/handle_special_values.R`　**导出**: 是 ✓

**签名**:

```r
handle_special_values(x)
```

---

### impute_mice

**文件**: `R/impute_mice.R`　**导出**: 是 ✓

**功能**: 多重插补链式方程（MICE）缺失值插补函数  该函数使用多重插补链式方程（Multivariate Imputation by Chained Equations, MICE）算法 对 UK Biobank 蛋白质组学数据中的缺失值进行插补。MICE 是一种基于迭代的方法， 通过为每个变量构建条件分布模型，循环迭代直至收敛来估计缺失值。 该方法能够生成多个完整数据集，便于后续分析中考虑插补的不确定性。

**签名**:

```r
impute_mice(data, m = 5, maxit = 5, method = "pmm")
```

**参数**:

- `data`: 数据框，包含 eid 列（样本标识符）和多个蛋白质表达量列的数据。 数据框中可能包含缺失值（NA）。
- `m`: 整数，多重插补的次数，默认为 5。生成 m 个不同的完整数据集， 用于后续分析中合并结果或评估插补不确定性。
- `maxit`: 整数，每次插补的最大迭代次数，默认为 5。控制链式方程的收敛迭代次数。
- `method`: 字符串，插补方法，默认为 "pmm"（预测均值匹配）。 其他可选方法包括 "norm"（正态分布）、"logreg"（逻辑回归）等。 

**返回**: 返回一个列表，包含以下元素： \itemize{ \item single_imputation: 第一个插补后的完整数据框（m=1 的结果）， 包含 eid 列和所有蛋白质列 \item all_imputations: 包含所有 m 个插补后数据框的列表， 每个元素都是一个完整的数据框 \item mice_object: MICE 算法返回的原始对象，包含收敛诊断信息、 插补模型等，可用于进一步分析 }

**示例**（来自源码 @examples）:

```r
\dontrun{
# 创建示例数据
data <- data.frame(
eid = c(1, 2, 3),
protein1 = c(1.2, NA, 3.4),
protein2 = c(NA, 2.3, 4.5)
)
# 执行 MICE 插补，生成 5 个完整数据集
imputed <- impute_mice(data, m = 5, maxit = 5)
# 查看第一个插补数据集
head(imputed$single_imputation)
# 查看所有插补数据集的数量
length(imputed$all_imputations)
}
```

---

### impute_rf

**文件**: `R/impute_rf.R`　**导出**: 是 ✓

**功能**: 随机森林缺失值插补函数  该函数使用随机森林（Random Forest）算法对 UK Biobank 蛋白质组学数据中的缺失值进行插补。 随机森林是一种基于集成学习的非参数方法，通过构建多棵决策树并利用树之间的相关性来估计缺失值。 该方法能够捕捉变量之间的复杂非线性关系，适用于高维蛋白质数据的缺失值处理。

**签名**:

```r
impute_rf(data, maxiter = 10, ntree = 100)
```

**参数**:

- `data`: 数据框，包含 eid 列（样本标识符）和多个蛋白质表达量列的数据。 数据框中可能包含缺失值（NA）。
- `maxiter`: 整数，最大迭代次数，默认为 10。控制随机森林插补算法的收敛迭代次数。
- `ntree`: 整数，随机森林中树的数量，默认为 100。树的数量越多，插补精度通常越高， 但计算时间也会相应增加。 

**返回**: 返回一个列表，包含以下元素： \itemize{ \item imputed_data: 经过插补后的完整数据框，包含 eid 列和所有蛋白质列， 缺失值已被估计值替换 \item oob_error: 袋外误差（Out-of-bag error），用于评估插补质量的指标 }

**示例**（来自源码 @examples）:

```r
\dontrun{
# 创建示例数据
data <- data.frame(
eid = c(1, 2, 3),
protein1 = c(1.2, NA, 3.4),
protein2 = c(NA, 2.3, 4.5)
)
# 执行随机森林插补
result <- impute_rf(data, maxiter = 10, ntree = 100)
# 查看插补后的数据
head(result$imputed_data)
# 查看袋外误差
print(result$oob_error)
}
```

---

### merge_col

**文件**: `R/merge_col.R`　**导出**: 是 ✓

**签名**:

```r
merge_col(df1, df2, id_col = "eid")
```

---

### merge_disease_dataframes

**文件**: `R/merge_disease_dataframes.R`　**导出**: 是 ✓

**功能**: 疾病数据框合并函数

**描述**: 合并两个包含疾病诊断信息的数据框。 对于共同的疾病诊断列，执行并集逻辑（任一数据框有诊断则结果为1）， 并计算合并后的最短随访时间。

**签名**:

```r
merge_disease_dataframes(df1, df2, keep_base_cols = TRUE, base_cols = NULL)
```

**参数**:

- `df1`: 第一个数据框，包含疾病诊断和随访信息
- `df2`: 第二个数据框，包含疾病诊断和随访信息
- `keep_base_cols`: 是否保留基础列（默认为TRUE）
- `base_cols`: 基础列向量（默认为包含eid、baseline_age等）

**返回**: 返回合并后的数据框，共同疾病列执行并集逻辑

**示例**（来自源码 @examples）:

```r
# df1 <- data.frame(eid = 1:3, Diabetes_diagnosis = c(1, 0, NA), Diabetes_followup_years = c(5, 3, NA))
# df2 <- data.frame(eid = 1:3, Diabetes_diagnosis = c(0, 1, 1), Diabetes_followup_years = c(2, 6, 4))
# result <- merge_disease_dataframes(df1, df2)
```

---

### get_disease_names

**文件**: `R/merge_disease_dataframes.R`　**导出**: 否（internal）

**签名**:

```r
get_disease_names(col_names)
```

---

### merge_disease_sources

**文件**: `R/merge_disease_sources.R`　**导出**: 是 ✓

**签名**:

```r
merge_disease_sources(questionnaire_var, age_diagnosis_var)
```

---

### newVb

**文件**: `R/newVb.R`　**导出**: 是 ✓

**签名**:

```r
newVb(data, new_col, ...)
```

---

### obesity

**文件**: `R/obesity.R`　**导出**: 是 ✓

**功能**: 肥胖数据处理函数

**描述**: 处理来自英国生物银行 p21001 字段的肥胖数据（体质指数BMI）。 将BMI分类为体重不足、正常体重、超重和肥胖。

**签名**:

```r
obesity(path = NULL, instance = 0)
```

**参数**:

- `path`: UK Biobank 数据目录的路径

**返回**: 返回包含以下信息的数据框： - BMI: 原始体质指数值 - Obesity_state: 分类为体重不足、正常体重、超重或肥胖

**示例**（来自源码 @examples）:

```r
# result <- obesity(path = "./data")
```

---

### p20001_Extract_Convert

**文件**: `R/p20001_Extract_Convert.R`　**导出**: 是 ✓

**签名**:

```r
p20001_Extract_Convert(path = NULL, instances=0)
```

---

### p20001_Verbal_interview_disease_age_date

**文件**: `R/p20001_Verbal_interview_disease_age_date.R`　**导出**: 是 ✓

**签名**:

```r
p20001_Verbal_interview_disease_age_date(p20001_df, p20006_df, p20007_df, disease_codes, disease_name)
```

---

### p20001_data

**文件**: `R/p20001_data.R`　**导出**: 是 ✓

**签名**:

```r
p20001_data(path = NULL, instances=0)
```

---

### p20001_disease_age

**文件**: `R/p20001_disease_age.R`　**导出**: 是 ✓

**签名**:

```r
p20001_disease_age(p20001_df, p20007_df, disease_codes, disease_name)
```

---

### p20001_disease_date

**文件**: `R/p20001_disease_date.R`　**导出**: 是 ✓

**签名**:

```r
p20001_disease_date(p20001_df, p20006_df, disease_codes, disease_name)
```

---

### p20001_verbal_interview_diagnosis

**文件**: `R/p20001_verbal_interview_diagnosis.R`　**导出**: 是 ✓

**签名**:

```r
p20001_verbal_interview_diagnosis(path = NULL,disease_list,instances=0)
```

---

### p20002_Extract_Convert

**文件**: `R/p20002_Extract_Convert.R`　**导出**: 是 ✓

**签名**:

```r
p20002_Extract_Convert(path = NULL, instances = 0)
```

---

### p20002_Verbal_interview_disease_age_date

**文件**: `R/p20002_Verbal_interview_disease_age_date.R`　**导出**: 是 ✓

**签名**:

```r
p20002_Verbal_interview_disease_age_date(p20002_df, p20008_df, p20009_df, disease_codes, disease_name)
```

---

### p20002_data

**文件**: `R/p20002_data.R`　**导出**: 是 ✓

**签名**:

```r
p20002_data(path = NULL, instances = 0)
```

---

### p20002_disease_age

**文件**: `R/p20002_disease_age.R`　**导出**: 是 ✓

**签名**:

```r
p20002_disease_age(p20002_df, p20009_df, disease_codes, disease_name)
```

---

### p20002_disease_date

**文件**: `R/p20002_disease_date.R`　**导出**: 是 ✓

**签名**:

```r
p20002_disease_date(p20002_df, p20008_df, disease_codes, disease_name)
```

---

### p20002_verbal_interview_diagnosis

**文件**: `R/p20002_verbal_interview_diagnosis.R`　**导出**: 是 ✓

**签名**:

```r
p20002_verbal_interview_diagnosis(path = NULL, disease_list, instances = 0)
```

---

### p20003_Extract_Convert

**文件**: `R/p20003_Extract_Convert.R`　**导出**: 是 ✓

**签名**:

```r
p20003_Extract_Convert(path = NULL, instances = 0)
```

---

### p20003_data

**文件**: `R/p20003_data.R`　**导出**: 是 ✓

**签名**:

```r
p20003_data(path = NULL, instances = 0)
```

---

### p20003_disease_medicine

**文件**: `R/p20003_disease_medicine.R`　**导出**: 是 ✓

**签名**:

```r
p20003_disease_medicine(p20003_df, disease_codes, disease_name)
```

---

### p20004_Extract_Convert

**文件**: `R/p20004_Extract_Convert.R`　**导出**: 是 ✓

**签名**:

```r
p20004_Extract_Convert(path = NULL, instances = 0)
```

---

### p20004_Verbal_interview_operation_age_date

**文件**: `R/p20004_Verbal_interview_operation_age_date.R`　**导出**: 是 ✓

**签名**:

```r
p20004_Verbal_interview_operation_age_date(p20004_df, p20010_df, p20011_df, disease_codes, disease_name)
```

---

### p20004_data

**文件**: `R/p20004_data.R`　**导出**: 是 ✓

**签名**:

```r
p20004_data(path = NULL, instances = 0)
```

---

### p20004_disease_age

**文件**: `R/p20004_disease_age.R`　**导出**: 是 ✓

**签名**:

```r
p20004_disease_age(p20004_df, p20011_df, disease_codes, disease_name)
```

---

### p20004_disease_date

**文件**: `R/p20004_disease_date.R`　**导出**: 是 ✓

**签名**:

```r
p20004_disease_date(p20004_df, p20010_df, disease_codes, disease_name)
```

---

### p20004_verbal_interview_batch

**文件**: `R/p20004_verbal_interview_batch.R`　**导出**: 是 ✓

**签名**:

```r
p20004_verbal_interview_batch(path = NULL, disease_list, instances = 0)
```

---

### p20006_data

**文件**: `R/p20006_data.R`　**导出**: 是 ✓

**签名**:

```r
p20006_data(path = NULL, instances = 0)
```

---

### p20007_data

**文件**: `R/p20007_data.R`　**导出**: 是 ✓

**签名**:

```r
p20007_data(path = NULL, instances=0)
```

---

### p20008_data

**文件**: `R/p20008_data.R`　**导出**: 是 ✓

**签名**:

```r
p20008_data(path = NULL, instances = 0)
```

---

### p20009_data

**文件**: `R/p20009_data.R`　**导出**: 是 ✓

**签名**:

```r
p20009_data(path = NULL, instances = 0)
```

---

### p20010_data

**文件**: `R/p20010_data.R`　**导出**: 是 ✓

**签名**:

```r
p20010_data(path = NULL, instances = 0)
```

---

### p20011_data

**文件**: `R/p20011_data.R`　**导出**: 是 ✓

**签名**:

```r
p20011_data(path = NULL, instances = 0)
```

---

### p2966_i0

**文件**: `R/p2966_i0.R`　**导出**: 是 ✓

**签名**:

```r
p2966_i0(path = NULL)
```

---

### p2976_i0

**文件**: `R/p2976_i0.R`　**导出**: 是 ✓

**签名**:

```r
p2976_i0(path = NULL)
```

---

### p3627_i0

**文件**: `R/p3627_i0.R`　**导出**: 是 ✓

**签名**:

```r
p3627_i0(path = NULL)
```

---

### p3894_i0

**文件**: `R/p3894_i0.R`　**导出**: 是 ✓

**签名**:

```r
p3894_i0(path = NULL)
```

---

### p40005_data

**文件**: `R/p40005_data.R`　**导出**: 是 ✓

**签名**:

```r
p40005_data(path = NULL, instances = 0)
```

---

### p40006_data

**文件**: `R/p40006_data.R`　**导出**: 是 ✓

**签名**:

```r
p40006_data(path = NULL, instances = 0)
```

---

### p4056_i0

**文件**: `R/p4056_i0.R`　**导出**: 是 ✓

**签名**:

```r
p4056_i0(path = NULL)
```

---

### p41270_data

**文件**: `R/p41270_data.R`　**导出**: 是 ✓

**签名**:

```r
p41270_data(path)
```

---

### p41272_data

**文件**: `R/p41272_data.R`　**导出**: 是 ✓

**签名**:

```r
p41272_data(path)
```

---

### p41280_data

**文件**: `R/p41280_data.R`　**导出**: 是 ✓

**签名**:

```r
p41280_data(path)
```

---

### p41282_data

**文件**: `R/p41282_data.R`　**导出**: 是 ✓

**签名**:

```r
p41282_data(path)
```

---

### p6150_i0

**文件**: `R/p6150_i0.R`　**导出**: 是 ✓

**签名**:

```r
p6150_i0(path = NULL)
```

---

### p6153_i0

**文件**: `R/p6153_i0.R`　**导出**: 是 ✓

**签名**:

```r
p6153_i0(path = NULL, instance = 0)
```

---

### p6177_i0

**文件**: `R/p6177_i0.R`　**导出**: 是 ✓

**签名**:

```r
p6177_i0(path = NULL, instance = 0)
```

---

### parse_method_parameters

**文件**: `R/parse_method_parameters.R`　**导出**: 是 ✓

**签名**:

```r
parse_method_parameters(method_params, required_params)
```

---

### plot_single_survival_curve

**文件**: `R/plot_single_survival_curve.R`　**导出**: 是 ✓

**功能**: 绘制单个蛋白质互作对生存曲线（带保存功能）

**签名**:

```r
plot_single_survival_curve(data, pair_column, time, status, cutoff = 0, time_unit = "years", output_dir = NULL)
```

**参数**:

- `data`: 数据框
- `pair_column`: 列名
- `time`: 生存时间列名
- `status`: 生存状态列名
- `cutoff`: 截断值
- `time_unit`: 时间单位（用于x轴标签）
- `output_dir`: 输出目录（用于保存图片）

**返回**: 返回ggplot2对象，同时自动保存图片（如果提供了output_dir）

---

### plot_summary

**文件**: `R/plot_summary.R`　**导出**: 是 ✓

**功能**: 绘制生存分析结果汇总图  创建汇总统计图，展示分析结果的基因数量和显著性分布

**签名**:

```r
plot_summary(results, output_dir)
```

**参数**:

- `results`: Cox回归分析结果数据框，需包含p_value和p_adj_bh列
- `output_dir`: 输出目录，用于保存图片

**返回**: 无返回值，图片保存到指定目录

**示例**（来自源码 @examples）:

```r
\dontrun{
results <- data.frame(
p_value = c(0.001, 0.01, 0.0001, 0.1, 0.05),
p_adj_bh = c(0.01, 0.05, 0.001, 0.5, 0.1)
)
plot_summary(results, "./plots/")
}
```

---

### plot_top_survival_curves

**文件**: `R/plot_top_survival_curves.R`　**导出**: 是 ✓

**功能**: 绘制前N个显著基因的生存曲线  根据Cox回归分析结果，绘制显著基因的Kaplan-Meier生存曲线

**签名**:

```r
plot_top_survival_curves(top_genes, survival_curves_data, time_unit, output_dir)
```

**参数**:

- `top_genes`: 要绘制的显著基因向量
- `survival_curves_data`: 生存曲线数据列表，每个元素包含km_fit和group
- `time_unit`: 时间单位字符，如"years"、"months"
- `output_dir`: 输出目录，用于保存图片

**返回**: 无返回值，图片保存到指定目录

**示例**（来自源码 @examples）:

```r
\dontrun{
top_genes <- c("GeneA", "GeneB", "GeneC")
plot_top_survival_curves(top_genes, survival_data, "years", "./plots/")
}
```

---

### plot_volcano

**文件**: `R/plot_volcano.R`　**导出**: 是 ✓

**功能**: 绘制生存分析结果的火山图  从Cox回归分析结果创建火山图，可视化基因的风险比和显著性

**签名**:

```r
plot_volcano(results, output_dir)
```

**参数**:

- `results`: Cox回归分析结果数据框，需包含hr、p_value和p_adj_bh列
- `output_dir`: 输出目录，用于保存图片

**返回**: 无返回值，图片保存到指定目录

**示例**（来自源码 @examples）:

```r
\dontrun{
results <- data.frame(
hr = c(1.2, 0.8, 1.5, 0.9),
p_value = c(0.001, 0.01, 0.0001, 0.1),
p_adj_bh = c(0.01, 0.05, 0.001, 0.5)
)
plot_volcano(results, "./plots/")
}
```

---

### process_age_dataframe

**文件**: `R/process_age_dataframe.R`　**导出**: 是 ✓

**签名**:

```r
process_age_dataframe(df)
```

---

### process_date_dataframe

**文件**: `R/process_date_dataframe.R`　**导出**: 是 ✓

**签名**:

```r
process_date_dataframe(df)
```

---

### remove_by_missing

**文件**: `R/remove_by_missing.R`　**导出**: 是 ✓

**功能**: 根据缺失率阈值删除行和列  先删除缺失率超过指定阈值的列（特征），再在剩余列基础上删除缺失率超过指定阈值的行（样本）。 支持在计算行缺失率时排除指定列（如 ID 列）。返回处理后的数据框，并可选择打印删除信息。

**签名**:

```r
remove_by_missing(data, max_col_missing = NULL, max_row_missing = NULL, exclude_cols = "eid", verbose = TRUE)
```

**参数**:

- `data`: 输入数据框。
- `max_col_missing`: 列缺失率阈值，0~1之间的数值。缺失率超过该值的列将被删除。默认 NULL 表示不删除任何列。
- `max_row_missing`: 行缺失率阈值，0~1之间的数值。在剩余列上缺失率超过该值的行将被删除。默认 NULL 表示不删除任何行。
- `exclude_cols`: 字符向量，计算行缺失率时需要排除的列名（这些列不会被删除，也不会影响行缺失率的计算）。
- `verbose`: 逻辑值，是否打印删除信息。默认 TRUE。 

**返回**: 一个列表，包含： \item{data}{处理后的数据框} \item{removed_cols}{被删除的列名（字符向量）} \item{removed_rows}{被删除的行索引或行名（取决于原始行名）}

**示例**（来自源码 @examples）:

```r
df <- data.frame(
eid = 1:5,
x = c(1, NA, 3, NA, 5),
y = c(NA, NA, 2, 3, 4),
z = c(1, 2, NA, NA, NA)
)
# 删除缺失率 > 0.5 的列，再删除剩余列上缺失率 > 0.5 的行（排除 eid 参与行缺失计算）
result <- remove_by_missing(df, max_col_missing = 0.5, max_row_missing = 0.5, exclude_cols = "eid")
result$data
result$removed_cols
result$removed_rows
```

---

### safe_bind_rows

**文件**: `R/safe_bind_rows.R`　**导出**: 是 ✓

**功能**: 安全合并两个数据框（只保留共有列）  安全地合并两个数据框，只保留共有的列，并可选添加来源标识

**签名**:

```r
safe_bind_rows(df1, df2, add_source = FALSE, source_names = c("df1", "df2"))
```

**参数**:

- `df1`: 第一个数据框
- `df2`: 第二个数据框
- `add_source`: 是否添加来源列（默认 FALSE）
- `source_names`: 来源列的值，当 add_source = TRUE 时需提供长度为2的字符向量

**返回**: 合并后的数据框

---

### sun_exposure_data

**文件**: `R/sun_exposure_data.R`　**导出**: 是 ✓

**功能**: 提取日晒相关变量数据  从UK Biobank数据中提取日晒相关变量，包括户外时间、肤色、晒黑程度等

**签名**:

```r
sun_exposure_data(path = NULL)
```

**参数**:

- `path`: 数据路径，包含00.字段目录子目录

**返回**: 数据框，包含处理后的日晒相关变量

---

### time_Extract

**文件**: `R/time_Extract.R`　**导出**: 是 ✓

**功能**: 时间信息提取与处理  从 UK Biobank 数据中提取并整合多种时间相关信息，包括抽血时间（最多四次）、死亡时间、失访时间、基线时间、出生日期等。 该函数会读取字段目录中的 time.xlsx 文件，批量合并原始数据，然后： \itemize{ \item 提取抽血时间（p3166_i*_a）并转换为日期； \item 提取死亡日期、死亡年龄、主要死因（ICD10），处理多实例并去重； \item 提取失访日期（p191）和基线日期（p53_i0）、基线年龄（p21003_i0）； \item 计算抽血时的年龄（基于基线年龄和抽血日期差）； \item 根据死亡时间、失访时间或默认日期（2025-08-01）确定结局时间（outcome_time）； \item 基于出生年份和月份（p34、p52）生成出生日期（假设每月15日），并计算结局年龄（outcome_age）； \item 验证计算出的基线年龄与原始基线年龄的一致性。 }

**签名**:

```r
time_Extract(path = NULL)
```

**参数**:

- `path`: 字符型，数据根目录路径。该路径下应包含 UK Biobank 原始数据文件（如 .rds 或 .csv）以及一个子目录 "00.字段目录/time.xlsx"，该 Excel 文件包含要提取的时间相关字段 ID。

**返回**: 返回一个 tibble 数据框，包含以下列（部分主要列）： \item{eid}{参与者唯一标识符} \item{baseline_age}{基线年龄（原始值）} \item{baseline_date}{基线日期（p53_i0）} \item{lost_follow_date}{失访日期（p191）} \item{blood_time0}{第一次抽血日期（p3166_i0_a）} \item{blood_time1}{第二次抽血日期} \item{blood_time2}{第三次抽血日期} \item{blood_time3}{第四次抽血日期} \item{blood_time_age}{第一次抽血时的年龄（基于基线年龄计算）} \item{death_time}{死亡日期（优先 p40000_i0，其次 p40000_i1）} \item{death_age}{死亡年龄（优先 p40007_i0，其次 p40007_i1）} \item{death_cause_id0}{主要死因 ICD10 编码（优先 p40001_i0，其次 p40001_i1）} \item{death_cause_id1}{次要死因 ICD10 编码（优先 p40001_i1，其次 p40001_i0）} \item{Year_of_birth}{出生年份（p34）} \item{Month_of_birth}{出生月份（p52，已转换为数字）} \item{outcome_time}{结局时间（按优先级取死亡时间、失访时间或默认日期 2025-08-01）} \item{outcome_age}{结局年龄（基于出生日期和 outcome_time 精确计算）}

**示例**（来自源码 @examples）:

```r
\dontrun{
# 假设数据存放在 "/data/ukb" 目录下，且该目录包含 "00.字段目录/time.xlsx"
time_data <- time_Extract(path = "/data/ukb")
}
```

---

### calculate_exact_age

**文件**: `R/time_Extract.R`　**导出**: 否（internal）

**签名**:

```r
calculate_exact_age(birth_date, event_date)
```

---

### validate_age_calculation

**文件**: `R/time_Extract.R`　**导出**: 否（internal）

**签名**:

```r
validate_age_calculation(data)
```

---

### ukb_data_prepare

**文件**: `R/ukb_data_prepare.R`　**导出**: 是 ✓

**功能**: 拆分 UKB CSV 文件为带 eid 列的数据块 Split UKB CSV files into chunks with eid column  此函数读取指定数据路径（或通过 \code{set_data_path()} 设置的路径）下的所有 CSV 文件， 将每个数据集拆分为最多包含 \code{chunk_size} 个变量（不包括强制列 'eid'）的数据块， 并将每个块保存为 RDS 文件。同时保存映射表（CSV 和可选的 Excel 文件）以记录每个变量位于哪个 RDS 文件中。 可选择在处理后删除原始 CSV 文件以释放磁盘空间。

**签名**:

```r
ukb_data_prepare(path = NULL, output_dir = NULL, chunk_size = 80, start_number = 1, verbose = TRUE, save_excel = TRUE, remove_csv = FALSE)
```

**参数**:

- `path`: 包含 UKB CSV 文件的目录路径。若为 \code{NULL}，则使用 \code{set_data_path()} 设置的路径。 Character. Path to the directory containing the UKB CSV files. If \code{NULL}, the function uses the path previously set by \code{set_data_path()}.
- `output_dir`: RDS 文件及映射表的保存目录。默认与 \code{path} 相同。
- `chunk_size`: 每个数据块包含的变量数（不含 'eid'）。默认为 80。
- `start_number`: 生成的rds文件编号的默认顺序。默认为从1开始，data_1.rds。
- `verbose`: 是否打印进度信息。默认为 TRUE。
- `save_excel`: 是否同时保存 Excel 文件 \code{ID.xlsx}，包含 RDS 文件名与变量名的映射。默认为 TRUE。
- `remove_csv`: 是否在处理后删除原始 CSV 文件。默认为 FALSE。

**返回**: 不可见地返回变量映射的数据框。映射表同时保存为 CSV 文件 \code{variable_mapping.csv}， 若 \code{save_excel = TRUE}，则另存为 Excel 文件 \code{ID.xlsx} 在输出目录中。 The mapping is also saved as a CSV file named \code{variable_mapping.csv} and,

---

### .onLoad

**文件**: `R/zzz.R`　**导出**: 否（internal）

**签名**:

```r
.onLoad(libname, pkgname)
```

---

### .onAttach

**文件**: `R/zzz.R`　**导出**: 否（internal）

**签名**:

```r
.onAttach(libname, pkgname)
```

---

