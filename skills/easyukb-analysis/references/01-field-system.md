# UKB Field System

UKB 字段命名规则、Instance/Array 含义、Coding 表使用。

## 字段命名规则

```
p<FieldID>_i<instance>_a<array>
```

| 部分 | 含义 | 示例 |
|------|------|------|
| `p<id>` | UKB FieldID | `p21001` = BMI |
| `_i<n>` | instance（访问期） | `_i0` = 基线，`_i1/i2/i3` = 后续 |
| `_a<n>` | array（同期重复或多选项） | `_a0..a25` 对 ICD10 多次诊断 |

## Instance 含义

| Instance | 含义 | 招募阶段 | N |
|----------|------|---------|---|
| `i0` | 基线 | 2006-2010 | ~500K（全部） |
| `i1` | 第一次回访 | 2012-2013 | ~20K |
| `i2` | 影像扫描 | 2014- | ~60K |
| `i3` | 第二次影像 | 2019- | ~10K |

**铁律**：默认所有暴露/协变量用 `i0`。需要纵向变化时（如 `calculate_delta_eGFR()`）才用 i1+。

## Array 用法举例

| 字段 | array 用途 |
|------|-----------|
| `p41270_a0..a259` | ICD10 主诊断（最多 260 次住院记录） |
| `p41272_a0..a124` | OPCS-4 手术（最多 125 次） |
| `p40006_a0..a21` | 癌症登记 ICD10 |
| `p102_i0_a0/a1` | 脉搏（同期 2 次取均值） |
| `p4080_i0_a0/a1` | SBP 自动测量（同期 2 次） |
| `p93_i0_a0/a1` | SBP 人工测量（同期 2 次） |
| `p6138_i0_a0..a5` | 教育资格（多选展开） |
| `p6150_i0_a0..a3` | 既往诊断（多选） |

## 数据字典文件

`UKB_rawdata/dataset.data_dictionary.xlsx` 通常含多个 sheet：

| Sheet | 内容 |
|-------|------|
| All_fields | 完整字段清单（FieldID, Field, Category, ValueType, Units, Coding, Instances, Array） |
| First_occurrences | 首次发生疾病字段（p131xxx） |
| Algorithmic_outcomes | 算法定义结局（p42xxx） |
| Blood_assays | 血生化（p30600-p30900） |
| Touchscreen | 触摸屏自报字段 |

`UKB_rawdata/dataset.codings.xlsx`：所有 coding 表（每个 coding_id 一个 sheet）。

`UKB_rawdata/ID.xlsx`：字段 → RDS 切片文件名的索引表。

## 常用 Coding 表

| Coding | 用途 |
|--------|------|
| 9 | Sex (0=Female, 1=Male) |
| 19 | ICD10 完整字典 |
| 87 | ICD9 字典 |
| 240 | OPCS-4 手术编码 |
| 3 | Self-report cancer (p20001) |
| 6 | Self-report non-cancer (p20002) |
| 4 | Self-report medication (p20003) |
| 5 | Self-report operation (p20004) |
| 90 | Smoking/Drinking status |
| 100305 | Qualifications / Employment |
| 100294 | Household income |
| 100402 | Alcohol intake frequency |
| 1001 | Ethnic background |

## 常用 UKB FieldID 速查

### 人口学
| 字段 | 名称 |
|------|------|
| p31 | Sex |
| p21003_i0 | Age at recruitment |
| p21000_i0 | Ethnic background |
| p189 | Townsend deprivation index |
| p6138_i0 | Qualifications |
| p6142_i0 | Employment status |
| p738_i0 | Average household income |
| p54_i0 | Assessment centre |
| p22009_a1..a40 | Genetic PC 1-40 |

### 体测
| 字段 | 名称 | 单位 |
|------|------|------|
| p21001_i0 | BMI | kg/m² |
| p21002_i0 | Weight | kg |
| p50_i0 | Standing height | cm |
| p48_i0 | Waist circumference | cm |
| p49_i0 | Hip circumference | cm |
| p46_i0_a0/a1 | Hand grip Left | kg |
| p47_i0_a0/a1 | Hand grip Right | kg |
| p3063_i0_a0/a1/a2 | FEV1 (取 max) | L |

### 血压/脉搏
| 字段 | 名称 |
|------|------|
| p4079_i0_a0/a1 | DBP 自动 |
| p4080_i0_a0/a1 | SBP 自动 |
| p93_i0_a0/a1 | SBP 手动 |
| p94_i0_a0/a1 | DBP 手动 |
| p102_i0_a0/a1 | Pulse rate |

### 生活方式
| 字段 | 名称 |
|------|------|
| p20116_i0 | Smoking status |
| p20117_i0 | Alcohol drinker status |
| p1558_i0 | Alcohol intake frequency |
| p884_i0 | Days walking 10+ min/week |
| p894_i0 | Duration walking (min) |
| p904_i0 | Days moderate PA |
| p914_i0 | Duration moderate PA (min) |
| p1160_i0 | Sleep duration (hour) |
| p1170_i0 | Morning/evening person |
| p1180_i0 | Sleeplessness |
| p1200_i0 | Daytime dozing |

### 血生化（基线 i0）
| 字段 | 名称 | 单位 |
|------|------|------|
| p30750 | HbA1c | mmol/mol |
| p30740 | Glucose | mmol/L |
| p30760 | HDL cholesterol | mmol/L |
| p30780 | LDL direct | mmol/L |
| p30870 | Triglycerides | mmol/L |
| p30690 | Cholesterol total | mmol/L |
| p30710 | C-reactive protein | mg/L |
| p30700 | Creatinine | µmol/L |
| p30720 | Cystatin C | mg/L |
| p30620 | ALT | U/L |
| p30650 | AST | U/L |
| p30730 | GGT | U/L |
| p30880 | Urate | µmol/L |
| p30600 | Albumin | g/L |
| p30630 | Apolipoprotein A | g/L |
| p30640 | Apolipoprotein B | g/L |

### 疾病结局
| 字段 | 名称 |
|------|------|
| p41270_aXXX / p41280_aXXX | ICD10 + 日期 |
| p41271_aXXX / p41281_aXXX | ICD9 + 日期 |
| p41272_aXXX / p41282_aXXX | OPCS-4 + 日期 |
| p40006_aXXX / p40005_aXXX | 癌症 ICD10 + 日期 |
| p131286_i0 | 首发糖尿病日期 |
| p131296_i0 | 首发 IHD 日期 |
| p131298_i0 | 首发 MI 日期 |
| p131360_i0 / p131362_i0 / p131364_i0 | 首发中风（不同亚型）日期 |
| p40000_i0 | Date of death |
| p40001_i0 | Primary cause of death (ICD10) |
| p191 | Date lost to follow-up |
| p2443_i0 | Doctor diagnosed diabetes |
| p6150_i0 | Vascular/heart problems |

## 字段查询代码示例

```r
library(readxl)
dict <- read_excel(file.path(get_data_path(), "dataset.data_dictionary.xlsx"))
dict[dict$FieldID == 21001, ]

# 反查字段所属 RDS
id_idx <- read_excel(file.path(get_data_path(), "ID.xlsx"))
id_idx[id_idx$id == "p21001_i0", ]

# 加载 ICD10 编码字典
icd10_dict <- create_coding_dict("19")
icd10_dict["I21"]  # "Acute myocardial infarction"
```

## 特殊值规约

| UKB 原值 | 含义 | 默认处理 |
|---------|------|---------|
| `-1` | Do not know | NA |
| `-3` | Prefer not to answer | NA |
| `-7` | None of the above | NA（部分函数保留为类别） |
| `-10` | "Less than ..." | 0.5（如 `summer_outdoor_hours`） |
| `"Do not know"` | 字面 | NA |
| `"Prefer not to answer"` | 字面 | NA |
| `""` | 空 | NA |

**显式保留 `"Unknown"` 类别的函数**：`Smoking_status()`、`family_survival_status()` 等。
