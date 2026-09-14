# 离线 codebook

`assets/codebook.sqlite` 包含字段、列展开和编码值；可通过 `scripts/ukb.py` 查询，不需要 Excel、原始数据或远程服务。SQLite 中没有参与者行、观测值、访问凭据或个人数据文件。

## 内容与来源

构建日期为 2026-09-06，使用本机已有的两个来源：

- `Web_database/database/query/sources/ukb/00_indexes/ukb_variable_index.csv` 和 `metadata/02_reference_dictionary` 下的字段/编码元数据。
- 原 `medhelp/skills/easyukb-analysis/assets/dataset.data_dictionary.xlsx` 第一工作表的列定义。

仅导入字段和编码表的指定列。没有导入 `num_participants`、个体数据、分析矩阵、RDS、账户信息、application 元数据或完整原始目录。自定义“ICD10 缩减版”工作表未用来替代完整编码体系。

| 表 | 记录数 | 作用 |
| --- | ---: | --- |
| fields | 11,821 | Field ID、标题、单位、类别、编码 ID、instance 体系、说明与版本 |
| columns | 66,368 | 保留 web / easyukb 两套物理列名；不是去重后的唯一变量数 |
| codings | 858 | 编码体系标题与说明 |
| coding_values | 533,289 | 编码值、含义、层级和源表 |
| column_types | 38,655 | 原 easyUKB 字典中的物理存储类型 |
| instance_values | 33 | instance 体系下的索引与说明 |
| provenance | 随输入源记录 | 源文件名称和 SHA-256，用于追溯 |

web 列定义 27,713 条；easyukb 列定义 38,655 条，其中 participant 为 32,612 条。easyukb 其余实体属于事件表/组学等，保留在元数据中，但自动提取命令仅支持 participant 粒度。

字段 `version` 范围为 2000-01-01 至 2025-09-20；这不是 2026 年全量官方更新。此快照中，非零编码 ID 的字段定义均能找到至少一个本地编码值，**不意味着所有未来编码或用户数据版本已覆盖**。每次生成方案另报告选择字段的 `missingCodingIds`。

## 两种列名

同一个 Field ID 的物理列可能为 `21001-0.0` 或 `p21001_i0`。它们按来源分别保存，不能用简单字符串替换推断全部列。`p31` 没有 `_i0` 后缀；多数组单次字段可能为 `p41270_a0`。需要原始列名时查询 `columns`，物理存储类型查 `column_types`。

特别地，此 easyUKB 快照只有单列 `p41270`（元数据类型 string），其日期字段 `p41280` 有 259 个数组列；web 快照的两者各有 259 个数组列。因此不能相信原 skill 声称的固定 `p41270_a0..a259`。没有实际数据格式证据时，不猜测打包字符串的分隔符、序列位置或日期配对。提取仍可原样保留这些列，分析配对必须另行核验。

`--instance 0` 会保留元数据没有 instance 后缀的单次字段；不会为这些字段制造后缀。instance 的医学含义以字段所属体系为准，不把所有 instance 0 泛称为临床基线。

## 编码层级

导出 `spec.yaml` 的 `value_type` 与两个选择/字典 CSV 的 `type` 保存本地 `fields.value_type` 的 UKB 类型编号；编码名称另放 `encoding_title` / `coding_title`，不把“Sex”这样的编码标题当作变量类型。`storage_type` 是字典收录的物理存储类型，未收录时留空，不声称已核验用户文件类型。字典和方案同时提供 `official_field_url`、`official_coding_url`；这些链接仅供核验，不表示脚本已联网。

`coding_values` 的组合键是编码体系加编码值，编码值按字符串保存，避免丢失前导零或把 `-1/-3/-7` 当成通用缺失规则。不同数据编码中，同一数字可能含义不同。`encoding_id=0` 表示非编码字段。

层级编码另保留 `code_id`、`parent_id` 和 `selectable`。检索上位分类时沿层级判断，不能把所有含相同文本的节点都当作可选叶节点。`source_table` 保留整数/字符串/日期/层级来源。`coding_values.csv` 是本次选中字段所用编码体系的完整本地映射，可能比选择清单大。

官方核对入口：[Field 41270](https://biobank.ndph.ox.ac.uk/showcase/field.cgi?id=41270)、[Field 41280](https://biobank.ndph.ox.ac.uk/showcase/field.cgi?id=41280)、[Coding 19](https://biobank.ndph.ox.ac.uk/showcase/coding.cgi?id=19)。每次任务按 [官网核对流程](official-verification.md) 在本地检索后访问，不把旧文档日期当成本次验证。这些是定义与编码页面，不是参与者数据。官网不可达时继续使用本地快照并标注未核验；列展开数量仍应以用户实际发布版本、实体元数据和物理 schema 共同确定。

## SQLite 查询

```sql
SELECT * FROM fields WHERE field_id='21001';
SELECT layout,entity,colname,instance,array_index
FROM columns WHERE field_id='41270'
ORDER BY layout,CAST(instance AS INTEGER),CAST(array_index AS INTEGER);
SELECT * FROM coding_values WHERE encoding_id='19' AND value='I210';
```

数据库设计为只读使用。更新时用 `scripts/build_codebook.py --reference-dir ... --web-index ... --easy-dictionary ... --out /new/codebook.sqlite` 生成新快照并核验差异；不要直接覆盖源数据或混入参与者值。重建需 Python `openpyxl`。
