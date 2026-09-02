---
name: easyukb-analysis
description: UK Biobank (UKB) data extraction + epidemiological association analysis using the `easyUKB` R package. Use when the user wants to (a) extract phenotype/field data from UKB raw data (must first ask user for UKB_rawdata absolute path, then query ALL expanded field IDs from `dataset.data_dictionary.xlsx` such as `p41270_a0..a259`), or (b) build exposure/covariate/outcome variables, integrate multi-source outcomes (Algorithmically defined > First occurrences > Hospital ICD10 > Self-report), compute derived indices (SPISE, MetS, eGFR, PhenoAge, etc.), or run Cox / logistic / RCS / multi-state / mediation analyses on the UKB 500K cohort. Triggers on phrases like "提取 X 表型", "取某个字段数据", "查 UKB 字段 ID", "UKB 关联分析", "easyUKB", "UK Biobank", "SPISE", "CMM", "心脏代谢共病", "ICD10 提取", "时间骨架 time_Extract", "Cox 回归 UKB", and on requests to write code that uses `set_data_path()`, `Common_data_extraction()`, `batch_merge_data_optimized()`, `time_Extract()`, `combine_diseases_and_age/date()`, or any `calculate_*`/`First_occurrences_*`/`Hospital_*`/`p2000*`/`p131*` function family.
---

# easyUKB Analysis Skill

为 UKB 队列研究提供"暴露 + 协变量 + 结局 → 关联模型"的全流程代码工厂。基于 `easyUKB/R/` 下 **220 个 R 源文件、218 个函数定义（182 个 @export）** 的逐文件阅读，目标是让"我想分析 X 暴露和 Y 结局"直接转化为可运行、可复现的 R 代码。

## ⚠️ 写代码前必须查函数手册（绝不凭印象）

**任何需要调用 easyUKB 函数的代码生成，都必须先查 [`references/09-all-functions-manual.md`](references/09-all-functions-manual.md)。**

该手册由脚本 `_tmp_scripts/gen_manual_v2.py` 直接从 R 源码 roxygen 注释提取，包含：
- 每个函数的**真实签名**（参数名/默认值）
- `@param` 参数说明
- `@return` 返回值
- `@examples` 使用示例
- 是否导出

### 常见“凭记忆”错误黑名单（已发生过，不要重蹈）

| 错误写法 | 正确写法 | 根据 |
|---------|---------|------|
| `set_ukb_path(path)` | `set_data_path(path)` | `R/data_config.R` 源码 |
| `get_ukb_path()` | `get_data_path()` | 同上；`get_ukb_path()` 是 internal helper，不要直接调 |
| `id_idx[['id']]` | `id_idx[['ID']]` | `ID.xlsx` 列名是大写 `ID` 和 `name` |
| `batch_merge_data_optimized(ids = ...)` | `batch_merge_data_optimized(data_path, id_list)` | 源码参数名为 `id_list` |
| `Common_data_extraction(id_list = ...)` | `Common_data_extraction(path, id, name)` | 源码参数名为 `id` + `name`（长度须相等） |
| `convert_p41270_ultimate(df)` | `convert_p41270_ultimate(data, path)` 返回 `list(data, validation)` | 不返回长表；就地去点号，源码需 path 读 code/data_coding_19.tsv |

### 检查清单（代码交付前逐条验证）

- [ ] 所有 `easyUKB` 函数调用都在 [`09-all-functions-manual.md`](references/09-all-functions-manual.md) 里查到了真实签名
- [ ] 参数名与源码一致（不是猜的）
- [ ] 参数顺序 / 可选性 / 默认值 与手册一致
- [ ] 返回值类型理解正确（data.frame? tibble? list? data.table?）
- [ ] 如果函数变量包含 `path = NULL`，调用前已 `set_data_path()`

### 查询粗略用法

```bash
# 按函数名查（包含参数名、返回、示例）
grep -A 30 "### 函数名$" <SKILL_DIR>/references/09-all-functions-manual.md

# 查看所有带某关键词的函数
grep "^|" <SKILL_DIR>/references/09-function-index.csv | grep -i "关键词"
```

## When to apply

- 用户提到 `easyUKB` 包或 UK Biobank。
- 用户给出"暴露 + 结局"对（如 SPISE → IHD/Stroke/T2D/CMM、BMI → 死亡、PM2.5 → CVD 等）。
- 用户需要从 UKB 字段（`p<id>_i<instance>_a<array>` 命名）提取数据。
- **用户提出"我想提取 X 表型/X 字段的数据"**（例如："帮我提取 ICD10 住院诊断"、"提取血压数据"、"取 BMI 和糖化血红蛋白"）。
- 用户提到任何 `set_data_path` / `Common_data_extraction` / `batch_merge_data` / `time_Extract` / `Diabetes_Comprehensive_diagnosis` / `combine_diseases_and_*` / `calculate_*` 函数。
- 用户复现 SPISE-CMM 流程（31 个步骤脚本 s01.R-s31.R）。

## ★强制前置条件：必须先问用户两个问题

**任何 "提取数据" 类请求触发此 skill 时，必须先完成以下两件事，缺一不可：**

### Q1：UKB 原始数据路径（`UKB_rawdata` 文件夹的绝对路径）

> ✅ **本 skill 内置字段字典** (`assets/dataset.data_dictionary.xlsx`，5MB，~38,656 行公开元数据)。用户**只需提供一个路径**：UKB_rawdata 数据文件夹。不需要额外提供字典路径。
>
> `lookup_fields.py` 默认使用内置字典；如需使用不同版本字典，可用 `--dict <xlsx>` 覆盖。

如果用户未在请求中明确提供路径，先停下并向用户索取：

> 其中应包含 `ID.xlsx`（字段→RDS 文件索引）、切片 `data1_*.rds` 等。`dataset.data_dictionary.xlsx` **不需要你提供**，skill 已内置。

- 路径用正斜杠（`K:/...`）或双反斜杠（`K:\\...`），避免 Windows 转义。
- 路径里中文目录是允许的，但写代码必须用 `"K:/UKB文章/..."` 格式。
- 拿到路径后，**所有代码顶部都要包含** `set_data_path("<用户给的路径>")`。

### Q2：要提取的表型（如未指定字段 ID，需先查字典）

用户可能只说"提取 ICD10 诊断"或"取吸烟状态"，不知道字段 ID。这时必须**先从 `dataset.data_dictionary.xlsx` 查全 ID**（见下方工作流 A）。

**禁止凭记忆给单个字段 ID 就直接出代码**（如只给 `p41270_i0` 而漏掉 `p41270_a1..a259`）。

## 工作流 A：表型→字段查询→数据提取（最常见入口）

当用户说"提取 X 表型"或"取 X 字段数据"时，**严格** 按下列 6 步：

### 1. 确认路径
如果用户未给出 UKB_rawdata 路径，按上方 Q1 索取。

### 2. 解析表型 → 候选字段名

根据用户的中文/英文表型名，从 UKB 字段字典中确定要查的字段。常见示例：

| 用户说 | 字段族（部分） |
|--------|---------------|
| "ICD10 住院诊断" | `p41270` + `p41280`（日期） |
| "ICD9 住院诊断" | `p41271` + `p41281` |
| "OPCS-4 手术" | `p41272` + `p41282` |
| "癌症登记" | `p40006` + `p40005` + `p40011`/`p40012` |
| "自报疾病" | `p20002` + `p20008`（年龄）+ `p20010`（日期）|
| "血压" | `p4079` + `p4080` + `p93` + `p94` |
| "血生化" | `p30600`–`p30890` |
| "血常规" | `p30000`–`p30290` |
| "BMI" | `p21001` |
| "年龄/性别" | `p21003` + `p31` |
| "吸烟" | `p20116`（status）+ `p1239`/`p1249`（频率） |
| "饮酒" | `p20117` + `p1558` |
| "教育" | `p6138` |
| "PM2.5/空气污染" | `p24003`–`p24019` |
| "绿地" | `p24500`–`p24508` |
| "睡眠" | `p1160` + `p1170` + `p1180` + `p1200` |
| "基线日期" | `p53` |
| "死亡" | `p40000` + `p40001` + `p40002` |
| "失访" | `p191` |
| "采血时间" | `p3166` |
| "首发疾病" | `p131xxx`（具体见首发疾病表） |

> ⚠️ 不要凭记忆完整列出所有 array，**必须用第 3 步从字典查全**。

### 3. 从 `dataset.data_dictionary.xlsx` 查全所有展开后的字段 ID

UKB 一个 FieldID（如 41270）会展开成多个具体列（`p41270_a0` 到 `p41270_a259`，共 260 列）。**必须查全**，否则会丢失大部分诊断记录。

推荐用 Python 脚本扫字典（PowerShell 中文路径乱码；R 不在 PATH）：

```python
import openpyxl, re
wb = openpyxl.load_workbook(r'<UKB_rawdata>/dataset.data_dictionary.xlsx', read_only=True)
ws = wb['全部字段']   # 或第一个 sheet（也叫 'ȫ������' 编码错乱时）
headers = next(ws.iter_rows(values_only=True))  # ID, title, Instance, Array, ...

# 例：查 FieldID 41270 的所有 _aXX
fid = '41270'
pattern = re.compile(rf'^p{fid}(_i\d+)?(_a\d+)?$')
for row in ws.iter_rows(values_only=True):
    if row[0] and pattern.match(str(row[0])):
        print(row[0], '|', row[1])
```

字典字段列（重要）：`ID` / `title` / `Instance` / `Array` / `name` / `units` / `folder_path` / `coding_name`。

查全后产出形如：
```r
icd10_fields <- paste0('p41270_a', 0:259)
icd10_dates  <- paste0('p41280_a', 0:259)
```

### 4. 字段存在性验证（防止字段缺失/版本差异）

```r
library(easyUKB); library(readxl)
set_data_path('<用户给的路径>')

id_idx <- read_excel(file.path(get_data_path(), 'ID.xlsx'))
required <- c(icd10_fields, icd10_dates)
missing  <- setdiff(required, id_idx[['ID']])
if (length(missing)) {
  message('Fields not present in this dataset (will be skipped):')
  print(missing)
}
required <- intersect(required, id_idx[['ID']])
```

### 5. 用 easyUKB 提取数据

根据表型类型选合适的入口：

| 任务 | 推荐函数 |
|------|---------|
| 简单字段提取 + 重命名 | `Common_data_extraction(id=..., name=...)` |
| 大量字段、不需要重命名 | `batch_merge_data_optimized(data_path, id_list)` |
| ICD10 全套住院诊断 | `Hospital_inpatient_Diagnoses_date(icd_list=...)` |
| 时间骨架（基线日/年龄/随访止） | `time_Extract()` |
| 糖尿病综合诊断 | `Diabetes_Comprehensive_diagnosis()` |
| BMI 分组 / 肥胖 | `obesity()` + `calculate_obesity_indices()` |
| 血压 | `SBP_DBP()` |
| 吸烟 | `Smoking_status()` |
| 多源结局合并 | `combine_diseases_and_age/date()` |

模板：
```r
library(easyUKB); library(dplyr); library(readxl)
set_data_path('<用户给的 UKB_rawdata 绝对路径>')

# 查字典 + 验证（步骤 3-4，略）

# 提取
df <- Common_data_extraction(
  id   = required,           # 已查全 + 已验证存在
  name = required            # 或自定义短名向量
)
```

### 6. 输出与下一步

- 把结果存为 RDS：`saveRDS(df, '<工作目录>/output/<phenotype>_raw.rds')`
- 报告：提取 N 个字段、N 个 eid、各字段缺失率
- 引导用户："接下来要做关联分析吗？需要告诉我暴露/结局/协变量。"

---

## 工作流 B：完整关联分析（5 步）

在工作流 A 完成后，按以下顺序构建分析数据集：

1. **路径与时间骨架**
   - 顶部调用 `set_data_path("<用户路径>")`
   - 提取 `df_time <- time_Extract()`（产出 `baseline_age`、`baseline_date`、`outcome_time`、`outcome_age`、`blood_time0~3`、`death_cause_id0/1`）
2. **暴露变量**
   - 单字段：`Common_data_extraction(id = c("p..."), name = c("..."))`
   - 多字段：`batch_merge_data_optimized(data_path, id_list)`
   - 衍生指标：调用模块 I 的 `calculate_*` 函数（详见 `references/03-functions.md`）
3. **协变量（M2 标准 21 项集）**
   - 调用 `references/04-spise-cmm-workflow.md` 6.3 表中列出的 14 个函数，`reduce(..., full_join, by="eid")` 合并
4. **结局（多源整合，强制四源优先级）**
   - 顺序：Algorithmically defined → First occurrences → Hospital ICD10 → Self-report
   - 合并器：`combine_diseases_and_age()` 或 `combine_diseases_and_date()`
   - 诊断列用 `pmax(..., na.rm=TRUE)`，年龄/日期用 `pmin(..., na.rm=TRUE)`
5. **模型**
   - 三层嵌套：crude / M1(age+sex) / M2(全协变量)
   - 暴露同时给连续 z-score 与三/四分位
   - 视结局类型选 `survival::coxph` / `glm(family=binomial)` / `rms::cph + rcs()` / `mstate::msprep` / `mediation::mediate`

## 11 条铁律（必须遵守）

1. **字段命名**：`p<id>_i<instance>_a<array>`；instance 0=基线（默认）；i1/i2/i3 样本急剧缩减。
2. **`instance = 0` 默认**：除非研究问题明确要求纵向。
3. **绝不一次性 `readRDS()` 整张大表**：先 `ukb_data_prepare(chunk_size=80)` 切片，再按需读取。
4. **特殊值处理**：数值用 `handle_special_values()` → NA；分类可显式保留 `"Unknown"`（如 `Smoking_status`、`family_survival_status`）。
5. **ICD10 必须去点号**：`convert_p41270_ultimate()` 已内建；自己写时 `gsub("\\.", "", code)`。匹配代码用 `"I21"` 而非 `"I21.0"`。
6. **结局四源整合**：禁止单源；用 `combine_diseases_and_date()` 合并 Algorithmic/First occurrences/HES/Self-report，避免漏诊 30-40%。
7. **多源年龄/日期合并**：诊断用 `pmax(..., na.rm=TRUE)`（任一为 1 即为 1）；年龄/日期用 `pmin(..., na.rm=TRUE)`（取最早）。
8. **糖尿病必须用 `Diabetes_Comprehensive_diagnosis()`**：Eastwood 2016 算法；禁用单字段（仅 p2443 或仅 HbA1c）。
9. **时间骨架优先级**：`time_Extract()` 的 `outcome_time` = 死亡日 > 失访日 > `death_default`（默认 `"2025-08-01"`）。
10. **协变量标准集（21 项 M2）**：Age, Sex, Ethnicity, Townsend, Education, Employment, Income, Smoking, Alcohol, PA, Sleep, Diet, eGFR, family_history_cvd, SBP, DBP, HbA1c, BP_med, lipid_med。
11. **暴露双形式**：每个分析跑 z-score 连续 + 三/四分位（最低组为参考），用于 p-trend 和剂量反应。

## 默认环境约定

- **数据路径必须由用户提供**（不要假定 `K:/UKB文章/...`）。常见结构：
  ```
  <UKB_rawdata>/
  ├── dataset.data_dictionary.xlsx   # 字段目录（必查）
  ├── dataset.codings.xlsx           # 编码表
  ├── ID.xlsx                        # 字段→RDS 文件索引（切片后生成）
  ├── time.xlsx                      # 时间相关字段索引
  ├── Blood assays.xlsx              # 血生化字段索引
  ├── First occurrences.xlsx         # 首发疾病字段索引
  ├── olink.xlsx / NMR.xlsx          # 蛋白/代谢组索引
  └── 00.字段目录/data1_*.rds        # 80 字段/片切片
  ```
- 包源码：`easyUKB/R/`（220 文件，需用户本地安装 `library(easyUKB)`）
- SPISE-CMM 示例：`easyUKB包流程示例/`（31 个 s*.R 脚本）
- 综合手册：`easyUKB_comprehensive_guide.md`（79KB UTF-8，6.1 万字）

## 渐进式查阅 references

只在需要时读取对应的 references 文件（避免一次加载全部）：

| 任务/问题 | 读取文件 |
|----------|---------|
| **查任何 easyUKB 函数的真实签名/参数/返回** | `references/09-all-functions-manual.md` ★★★ （218 个函数、182 个导出，从源码 roxygen 自动提取）|
| 查函数索引 CSV 快查名/文件/参数 | `references/09-function-index.csv` |
| **查字段 ID、查字典、展开 array** | `references/00-field-lookup.md` ★ |
| 解释 UKB 字段命名/Instance/编码规则 | `references/01-field-system.md` |
| 提取/读取数据，路径与切片 | `references/02-data-extraction.md` |
| 查特定函数的分类/分组（后续补充） | `references/03-functions.md` |
| 复现 SPISE-CMM 完整流程 | `references/04-spise-cmm-workflow.md` |
| 多源结局整合（4 源优先级、合并器） | `references/05-outcome-sources.md` |
| 衍生指标（27 个 `calculate_*`：SPISE/MetS/eGFR/PhenoAge 等） | `references/06-derived-indices.md` |
| 模型代码模板（Cox/logistic/RCS/mstate/mediation/敏感性） | `references/07-modeling-templates.md` |
| 错误排查与调试 | `references/08-troubleshooting.md` |

## 输出规范

- 代码：可直接 `Rscript` 运行；显式 `library(easyUKB)`、`library(dplyr)`、`library(survival)`。
- 路径：**所有代码顶部必须有** `set_data_path("<用户提供的绝对路径>")`；用正斜杠避免转义问题。
- 字段：先用 `dataset.data_dictionary.xlsx` 查全所有展开字段（`_iX_aY`），再用 `ID.xlsx` 验证字段存在。
- 输入字段验证：`required %in% readxl::read_excel(file.path(get_data_path(),"ID.xlsx"))[["id"]]`。
- 输出表：用 `create_summary_table()` 或自定义函数产出含 HR/95%CI/P/FDR 的可发表表格。
- 报告时差异化"读源码"vs"按使用上下文推断"vs"仅知函数名"——保持诚实。

## 风格

- 中文回答，保持"缜密且热忱"基调（详见 `SOUL.md`）。
- 不偷懒：写代码前核对字段 ID、instance 编号、coding 表映射。
- 拒绝跳过字段验证或编码核对。
- 模型设定不合理时温和但坚定地给出流行病学方法论建议。
