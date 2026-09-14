---
name: ukb-extract-analysis
description: 查询和提取 UK Biobank 变量，并按研究问题给出统计建议。先查内置本地 codebook，再核对 UKB 官网；官网不可达时使用本地并标注核验状态。支持 instance/array 展开、Parquet 和 easyUKB RDS 切片提取。
---

# UKB 提取与 easyUKB 分析

把用户的自然语言需求转化为有字段来源、编码解释和完整列选择的可复现提取。由 AI 调用脚本，不需要人工搜索页面或 Desktop 插件。内置的是元数据，不含任何参与者记录。

## 先确定任务

- **查字段或 codebook**：先使用内置数据库，不向用户索要原始数据路径。中文概念转换为英文关键词，分别检索同义词，再按 Field ID 核对官网；不可达则继续使用本地结果。
- **生成提取方案**：确认研究变量、时间点和数据布局，展开实际列；没有原始数据也能完成方案和字典。
- **实际提取**：复用当前对话中已提供的数据路径；仅当路径仍缺失时索取。不得把本机历史路径当作另一用户的数据路径。
- **统计建议**：用户要求时阅读 [analysis.md](references/analysis.md)，根据研究问题、变量定义与可用数据给出模型、协变量、缺失处理和敏感性分析建议；只有元数据时明确哪些判断需提取后确认。
- **执行分析**：用户要求时再执行；调用 easyUKB 函数前查 [函数索引](references/easyukb-function-index.csv) 和 [函数手册](references/easyukb-functions.md)。

`<SKILL_DIR>` 指本 SKILL.md 所在目录，所有脚本相对它定位内置 codebook，可整体移动。下列命令由 AI 执行，替换占位路径并正确引用 shell 参数。

## 字段与编码查询

```sh
python3 "<SKILL_DIR>/scripts/ukb.py" status
python3 "<SKILL_DIR>/scripts/ukb.py" search "body mass index"
python3 "<SKILL_DIR>/scripts/ukb.py" field 21001 --layout web
python3 "<SKILL_DIR>/scripts/ukb.py" field 41270 --layout easyukb
python3 "<SKILL_DIR>/scripts/ukb.py" coding 19 --value I210
```

字段标题、单位、编码 ID、类别、instance/array 和具体列名都以查询结果为准；未知字段或没有命中的编码不能凭记忆补齐。`search`、`coding` 支持 `--limit` 和 `--offset`，总数在 `total` 中。不要把分页第一页当成全部。

[codebook.md](references/codebook.md) 说明来源、版本、SQLite 表结构、两种布局和编码值层级。内置版本是本地元数据快照，不代表用户当前数据实际拥有这些列，也不保证是 UKB 最新发布版本。

## 本地检索后核对官网

字段选择或解释编码时，按 [official-verification.md](references/official-verification.md) 执行：**本地检索 → UKB 官网核对 → 官网不可达时回退本地**。先查询本地候选 Field ID 和 Coding ID，再用可用的网页工具打开官方字段页、编码页，涉及时间点时核对 instance 定义。CLI 的查询和提取保持离线；官网比对由 AI 完成，生成链接不等于核验成功。

官网可用时比较字段定义、单位、类型、编码和 instance/array；记录与本地的差异。连接失败、访问受限或无法读取必要内容时，继续提供本地查询、提取和统计建议，注明“使用本地 codebook，官网未核验”及原因、日期，不反复重试或要求用户解决网络问题。若本地也未收录则标为未知，不猜字段或编码。官网定义用于核对语义，实际提取列仍以用户文件 schema 与所选布局为准。

## 生成完整提取方案

两种布局不可混用：

- `--layout web`：列形式如 `21001-0.0`；来源通常为单个 participant-level Parquet。
- `--layout easyukb`：easyukb-analysis 字典列形式，如 `p21001_i0`、`p31`、`p41280_a0`；适用于 `ID.xlsx` 索引的 RDS 切片，也可用于已采用这些物理列名的 Parquet。

```sh
python3 "<SKILL_DIR>/scripts/ukb.py" plan \
  --fields 31 21001 --layout web --instance 0 \
  --project "Baseline study" --out "/absolute/work/ukb-plan"

python3 "<SKILL_DIR>/scripts/ukb.py" plan \
  --fields 41270 41280 --layout easyukb --all-instances \
  --out "/absolute/work/ukb-diagnosis-plan"
```

必须显式选择 `--instance N` 或 `--all-instances`。命令保留所选时间点下的**全部已收录 array**；不硬编码 array 上限，不只取 a0。省略 instance 后缀的单次字段保留原列名。若只需要个别 array，在已生成的 `spec.yaml` 中按确切 `colname` 删除不需要的变量，并保持 `eid` 和至少一个研究变量；说明选择依据。

诊断代码和日期等配套字段按相同 instance/array 对齐。比较配套字段的实际 array 集合；差异必须报告并查清，不能按行号把两个列表盲目 zip。计划的 `pairingWarnings` 会指出已识别的不一致；尤其此 easyUKB 快照是单列 `p41270` 搭配多个日期列，不能擅自按数组位置解释打包字符串。不要将多个独立数据表直接按 eid 笛卡尔拼接。

脚本输出包括 `spec.yaml`、`selected_variables.csv`、`data_dictionary.csv`、`coding_values.csv`、`field_ids.txt`、`field_ids.R`、`manifest.json`。AI 另将实际官网核对结果或回退原因写入输出目录的 `official_verification.md`，只查询时在回复中说明即可。它们不含参与者数据。`missingCodingIds` 非空时需明确说明编码解释尚未齐备；不将未知编码自动解释为缺失值。

## 从用户本地数据提取

先阅读 [extraction.md](references/extraction.md) 的输入布局与失败条件。

```sh
python3 "<SKILL_DIR>/scripts/ukb.py" extract-parquet \
  --plan "/absolute/work/ukb-plan" \
  --data-file "/user/provided/participant.parquet" \
  --format parquet --limit 20 --out "/absolute/work/ukb-sample"

python3 "<SKILL_DIR>/scripts/ukb.py" extract-rds \
  --plan "/absolute/work/ukb-diagnosis-plan" \
  --raw-root "/user/provided/UKB_rawdata" \
  --limit 20 --out "/absolute/work/ukb-rds-sample"
```

默认导出 20 行样本。用户要全量时显式使用 `--limit 0`；报告实际行数与 limit，不将样本称为全队列。请求变量缺失、ID 索引歧义、重复/空 eid 或 RDS 切片参与者集合不一致时必须失败，不允许 `intersect()` 后静默少提。输出使用新目录，保留历史结果。

提取层保留原始编码、缺失值、列名和类型，不自动计算表型。编码、标签映射和分析层重编码应另建字段并记录规则。聊天中仅报告字段元数据、数量、验证结果和本地文件位置，不打印真实参与者记录。

## easyUKB 分析衔接

保留 218 个函数定义的手册与索引，按需查阅；它是源码注释快照，可能与已安装包版本不同。先核对 `packageVersion()`、导出状态和 `formals()`，再生成调用。

- 提取/重命名：`Common_data_extraction(path = NULL, id, name)`。
- 批量字段：`batch_merge_data_optimized(data_path = NULL, id_list)`。
- 路径配置：`set_data_path(path)`、`get_data_path()`；`ID.xlsx` 使用大写 `ID`，文件映射列为 `name`。
- 时间骨架、疾病定义、SPISE/MetS/eGFR/PhenoAge 等衍生指标：按研究问题选择手册中实际存在的函数，核对输入单位、缺失编码与返回类型。
- Cox/logistic/RCS/多状态/中介分析：按研究设计选择，不默认执行整套流程、不套用固定协变量组合。

旧 skill 中“缺列跳过”“所有研究一律四源合并”“固定随访截止日”和固定 array 数量的规则不沿用。本 skill 的执行说明优先于保留手册中的历史示例。

## 依赖与交付

查询和方案生成仅需 Python 3.9+ 标准库。官网核对使用当前环境可用的网页工具；不可用时按本地回退处理。Parquet 导出需 Python `duckdb`；RDS 提取需 Python `openpyxl`、Rscript 与 R `jsonlite`。RDS 提取脚本直接读取已切片文件，不要求 easyUKB 包激活。只有使用 easyUKB 分析函数时才需要该 R 包。

交付实际执行的命令、选择清单、编码来源、输出路径与验证范围。区分已完成的真实提取、虚构数据测试和仅生成代码。测试命令：`python3 "<SKILL_DIR>/scripts/tests/test_workflow.py"`。
