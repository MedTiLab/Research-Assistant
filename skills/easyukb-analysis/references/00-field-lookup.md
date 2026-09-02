# 表型 → 字段 ID 查询（核心入口）

> 用户提到"提取 X 表型/字段"时，**第一步必须查字典**，把 UKB FieldID 展开成所有 `p<id>_iX_aY` 列。不要凭记忆只给单个字段而漏掉 array。

## 1. `dataset.data_dictionary.xlsx` 结构

文件位于 `<UKB_rawdata>/dataset.data_dictionary.xlsx`，~ 38,656 行，Sheet 名（GBK 终端会乱码，用 openpyxl 索引）：

| Sheet | 内容 |
|-------|------|
| **全部字段**（sheet 0） | 完整字段清单（已展开 `_iX_aY` 列） |
| participant | 个体级字段（重复元数据） |
| code19_ICD10 | ICD10 编码表 |
| code19_ICD10亚类 | ICD10 亚类 |
| code6_问谈疾病 | p20002 自报非癌症 meaning↔code |
| code6_癌症问谈 | p20001 自报癌症 |
| code240_医院手术 | OPCS-4 编码表 |
| code5_问谈手术 | p20004 自报手术 |

### 列结构（"全部字段" sheet）

```
ID | title | Instance | Array | name | units | folder_path | entity | linkout | type | coding_name
```

- `ID`：UKB 字段名，如 `p41270_a0`、`p21001_i0`、`eid`
- `title`：完整描述，含 instance/array 信息（如 "Diagnoses - ICD10 | Instance 0 | Array 5"）
- `Instance`：0/1/2/3 或空
- `Array`：0..N 或空
- `name`：字段裸名（无 instance/array）
- `units`：单位
- `folder_path`：UKB 分类树路径（如 "Health-related outcomes > Hospital inpatient > Diagnoses"）
- `coding_name`：所用编码表名（对应 codings.xlsx 的 sheet）

## 2. 强制工作流（任何 "提取 X" 请求）

### Step 1：向用户索取 UKB_rawdata 路径

如果用户没说，先停下：

> 请提供 UKB_rawdata 文件夹的绝对路径（例如 `K:/UKB文章/00.easyUKB_AI使用/UKB_rawdata`）。其中应包含 `ID.xlsx`、切片 `data1_*.rds` 等。

拿到后所有代码顶部都要 `set_data_path("<用户给的路径>")`。

> ✅ **字典文件 `dataset.data_dictionary.xlsx` 已内置于 skill 的 `assets/`**（公开元数据，不是个体记录）。用户不需要提供字典路径。`lookup_fields.py` 默认读内置版本；如需使用不同版本可用 `--dict <xlsx>` 覆盖。

### Step 2：把表型映射到 UKB FieldID 候选

参考下方"常用表型 → FieldID 总表"。如果表型不在表里，让用户提供 UKB 官方 FieldID（或描述更具体）。

### Step 3：调用本 skill 的 `lookup_fields.py` 批量查全字段

```bash
# Windows PowerShell 必须用 -X utf8 避免中文路径乱码
# 默认使用 skill 内置字典，用户只需提供 UKB_rawdata 路径 + FieldID 列表
python -X utf8 "<SKILL_DIR>/easyukb-analysis/scripts/lookup_fields.py" \
  "<UKB_rawdata 绝对路径>" \
  41270 41280 21001
```

产出：
- 终端：`[dict source: builtin]` + 命中字段数 + 前 20 行预览
- `extracted_field_ids.txt`：一行一个 ID（`readLines()` 可读）
- `extracted_field_ids.R`：R 向量字符串（`source()` 可读）

字典寻找优先级：`--dict` 参数 > `UKB_DICT_PATH` 环境变量 > skill 内置 (`assets/dataset.data_dictionary.xlsx`) > `<UKB_rawdata>/dataset.data_dictionary.xlsx` > `<UKB_rawdata>/../dataset.data_dictionary.xlsx`。

如果没有脚本可用（如 sandbox 禁用 exec），手写等同代码：

如果没有脚本可用（如 sandbox 禁用 exec），手写等同代码：

```python
import openpyxl, re

UKB = r'<UKB_rawdata>/dataset.data_dictionary.xlsx'
FIELD_IDS = ['41270', '41280']

wb = openpyxl.load_workbook(UKB, read_only=True, data_only=True)
ws = wb.worksheets[0]
headers = [str(h).lower() if h else '' for h in next(ws.iter_rows(values_only=True))]
id_col, ttl_col = headers.index('id'), headers.index('title')

pats = [re.compile(rf'^p{f}(_i\d+)?(_a\d+)?$') for f in FIELD_IDS]
matched = [(str(row[id_col]), row[ttl_col]) for row in ws.iter_rows(values_only=True)
           if row[id_col] and any(p.match(str(row[id_col])) for p in pats)]
print(f'Found {len(matched)} fields')
print('field_ids <- c(' + ', '.join(f'"{m[0]}"' for m in matched) + ')')
```

### Step 4：用 `ID.xlsx` 校验字段在当前数据切片里都存在

```r
library(readxl)
source('extracted_field_ids.R')   # 载入 field_ids（lookup_fields.py 产出）

id_idx <- read_excel(file.path(get_data_path(), 'ID.xlsx'))
missing <- setdiff(field_ids, id_idx[['ID']])
if (length(missing)) {
  message('Fields not in this dataset (skipped):'); print(missing)
}
field_ids <- intersect(field_ids, id_idx[['ID']])
cat('Verified', length(field_ids), 'fields\n')
```

### Step 5：用 easyUKB 提取

```r
library(easyUKB)
set_data_path('<用户给的路径>')

df <- Common_data_extraction(
  id   = field_ids,
  name = field_ids   # 或自定义短名向量
)
# 或：
df <- batch_merge_data_optimized(get_data_path(), field_ids)
```

### Step 6：报告 + 保存

```r
cat('Extracted', ncol(df) - 1, 'fields for', nrow(df), 'individuals\n')
saveRDS(df, file.path('<工作目录>', 'output', '<phenotype>_raw.rds'))
```

并主动询问：是否要继续做关联分析？需要：暴露 / 结局 / 协变量。

## 3. 常用表型 → FieldID 总表（务必查字典确认 array 范围）

### 疾病结局类（多 array）

| 表型 | FieldID 族 | array 范围 |
|------|-----------|-----------|
| ICD10 主诊断 + 日期 | `p41270` + `p41280` | a0..a259 |
| ICD9 主诊断 + 日期 | `p41271` + `p41281` | a0..a46 |
| ICD10 次诊断 + 日期 | `p41202` + `p41262` | 视版本 |
| OPCS-4 手术 + 日期 | `p41272` + `p41282` | a0..a124 |
| 癌症登记 ICD10 + 日期 | `p40006` + `p40005` | a0..a21 |
| 癌症登记组织学 | `p40011`, `p40012` | a0..a21 |
| 死亡日期 + 死因 | `p40000` + `p40001` + `p40002` | i0/i1 |
| 失访日期 + 原因 | `p191` + `p190` | — |
| 首发疾病 | `p131xxx_i0` | 单字段 |

### 人口学/SES

| 表型 | FieldID | 说明 |
|------|---------|------|
| 年龄（基线） | `p21003` | i0..i3 |
| 性别（遗传） | `p22001` | — |
| 性别（自报） | `p31` | — |
| 种族 | `p21000` | i0..i3 |
| Townsend 剥夺指数 | `p189` | — |
| 教育资格 | `p6138` | i0..i3 × a0..a5 |
| 家庭收入 | `p738` | i0..i3 |
| 就业状态 | `p6142` | i0..i3 × a0..a6 |
| 评估中心 | `p54` | i0..i3 |
| 评估日期（基线日期） | `p53` | i0..i3 |
| 出生年/月 | `p34` + `p52` | — |
| 死亡日期 | `p40000` | i0/i1 |
| 遗传 PC | `p22009` | a1..a40 |

### 生活方式

| 表型 | FieldID |
|------|---------|
| 吸烟状态 | `p20116` |
| 吸烟年龄起始 | `p2867` |
| 戒烟年龄 | `p2897` |
| 每日抽烟数 | `p3456` |
| 饮酒状态 | `p20117` |
| 饮酒频率 | `p1558` |
| 红酒/啤酒/烈酒数量/周 | `p1568`, `p1578`, `p1588`, `p1598`, `p1608` |
| 步行天数/周 | `p864` |
| 步行时长/天 | `p874` |
| 中等强度活动天数 | `p884` |
| 中等强度活动时长 | `p894` |
| 剧烈活动天数 | `p904` |
| 剧烈活动时长 | `p914` |
| 睡眠时长 | `p1160` |
| 晨晚倾向 | `p1170` |
| 失眠 | `p1180` |
| 白天嗜睡 | `p1220` |
| 打鼾 | `p1210` |
| 鲜水果摄入 | `p1309` |
| 鲜蔬菜摄入 | `p1289` |
| 鱼摄入（油性/非油性） | `p1329`, `p1339` |
| 红肉摄入 | `p1349`, `p1369`, `p1379`, `p1389`, `p1399` |
| 处理肉摄入 | `p1349` |
| 谷物（全/精制） | `p1438`, `p1448` |
| 维生素补充 | `p6155` |
| 矿物质补充 | `p6179` |

### 体测/生理

| 表型 | FieldID |
|------|---------|
| 身高 | `p50` |
| 体重 | `p21002` |
| BMI（已算） | `p21001` |
| 腰围 | `p48` |
| 臀围 | `p49` |
| 体脂率（生物电阻抗） | `p23099` |
| ASM（四肢肌肉） | `p23123` |
| 握力左/右 | `p46` / `p47` |
| 收缩压自动 | `p4080` |
| 舒张压自动 | `p4079` |
| 收缩压人工 | `p93` |
| 舒张压人工 | `p94` |
| 脉搏 | `p102` |
| FEV1（最佳） | `p3063` |
| FVC（最佳） | `p3062` |
| 峰流速 | `p3064` |

### 血生化（基线 i0；少数 i1）

| 表型 | FieldID | 单位 |
|------|---------|------|
| HbA1c | `p30750` | mmol/mol |
| 空腹血糖 | `p30740` | mmol/L |
| HDL-C | `p30760` | mmol/L |
| LDL-C | `p30780` | mmol/L |
| 总胆固醇 | `p30690` | mmol/L |
| 甘油三酯 | `p30870` | mmol/L |
| ApoA1 | `p30630` | g/L |
| ApoB | `p30640` | g/L |
| Lp(a) | `p30790` | nmol/L |
| 肌酐 | `p30700` | µmol/L |
| 胱抑素 C | `p30720` | mg/L |
| 尿素 | `p30670` | mmol/L |
| 尿酸 | `p30880` | µmol/L |
| ALT/AST/GGT/ALP | `p30620`/`p30650`/`p30730`/`p30610` | U/L |
| 总胆红素 / 直接胆红素 | `p30840` / `p30660` | µmol/L |
| 白蛋白 | `p30600` | g/L |
| 总蛋白 | `p30860` | g/L |
| CRP | `p30710` | mg/L |
| IGF-1 | `p30770` | nmol/L |
| 维生素 D | `p30890` | nmol/L |
| 睾酮 | `p30850` | nmol/L |
| SHBG | `p30830` | nmol/L |
| 雌二醇 | `p30800` | pmol/L |
| 钙 | `p30680` | mmol/L |
| 磷酸盐 | `p30810` | mmol/L |

### 血常规（基线 i0；i1 也可）

| 表型 | FieldID |
|------|---------|
| WBC 总数 | `p30000` |
| 中性粒细胞计数/% | `p30140` / `p30200` |
| 淋巴细胞计数/% | `p30120` / `p30180` |
| 单核细胞计数/% | `p30130` / `p30190` |
| 嗜酸/嗜碱粒细胞 | `p30150`/`p30210`, `p30160`/`p30220` |
| RBC | `p30010` |
| Hb | `p30020` |
| HCT | `p30030` |
| MCV/MCH/MCHC | `p30040`/`p30050`/`p30060` |
| RDW | `p30070` |
| 血小板 | `p30080` |
| MPV | `p30100` |
| PDW | `p30110` |
| 网织红细胞 % | `p30240` |

### 尿生化

| 表型 | FieldID |
|------|---------|
| 尿肌酐 | `p30510` |
| 尿微量白蛋白 | `p30500` |
| 尿钠 | `p30530` |
| 尿钾 | `p30520` |

### 环境暴露

| 表型 | FieldID |
|------|---------|
| PM2.5（2010） | `p24006` |
| PM2.5 absorbance | `p24007` |
| PM10 | `p24005` |
| NO2 / NOx | `p24003` / `p24004` |
| 主要道路距离 | `p24010` |
| 噪音 16h/夜 | `p24021` / `p24023` |
| 绿地 1000m / 300m | `p24500` / `p24501` |
| 水域 1000m / 300m | `p24508` / `p24507` |
| 距海岸距离 | `p24508` |

### 自报疾病/服药/手术

| 表型 | FieldID 族 | 含义 |
|------|-----------|------|
| 自报癌症 | `p20001` + `p20007`（年龄）+ `p20009`（年） | coding 3 |
| 自报非癌症 | `p20002` + `p20008` + `p20010` | coding 6 |
| 自报服药 | `p20003` | coding 4 |
| 自报手术 | `p20004` + `p20011`（年龄）+ `p20013` | coding 5 |
| 触摸屏既往诊断 | `p6150` | 多选 |
| 触摸屏服药女性 | `p6153` | 多选 |
| 触摸屏服药男性 | `p6177` | 多选 |
| 糖尿病自报 | `p2443` |
| 高血压诊断年龄 | `p2966`, `p3627` |
| 糖尿病诊断年龄 | `p2976` |
| 中风诊断年龄 | `p4056` |

### 家族史

| 表型 | FieldID |
|------|---------|
| 父亲疾病 | `p20107` |
| 母亲疾病 | `p20110` |
| 兄弟姐妹疾病 | `p20111` |
| 父亲存活 | `p1797` |
| 母亲存活 | `p1835` |
| 父亲去世年龄 | `p1807` |
| 母亲去世年龄 | `p3526` |
| 父亲患病/去世年龄 | `p2946` |
| 母亲患病/去世年龄 | `p1845` |
| 全同胞数 | `p1873` + `p1883` |

### 蛋白组（Olink）

字段族 `p30900`（蛋白名作为后缀），完整列表见 `<UKB_rawdata>/olink.xlsx`。用 `extract_protein_data()` 一次性提取。

### NMR 代谢组

字段族 `p23400-p23649`，完整列表见 `<UKB_rawdata>/NMR.xlsx`。用 `NMR_process()` 校正后再分析。

## 4. 字段命名小结

| 模式 | 例 | 含义 |
|------|-----|------|
| `p<id>` | `p189` | 单值字段（如 Townsend） |
| `p<id>_iX` | `p21001_i0` | 多次访问、每次单值 |
| `p<id>_aY` | `p41270_a5` | 单次访问、多次重复 |
| `p<id>_iX_aY` | `p102_i0_a1` | 多次访问 × 多次重复 |

## 5. 完整示例：提取 ICD10 主诊断 + 日期

```python
# 1) 查字典展开所有 ID
import openpyxl, re
UKB = r'<用户给的 UKB_rawdata 路径>/dataset.data_dictionary.xlsx'
wb = openpyxl.load_workbook(UKB, read_only=True)
ws = wb.worksheets[0]
headers = [h for h in next(ws.iter_rows(values_only=True))]
id_col = headers.index('ID')

pats = [re.compile(r'^p41270(_a\d+)?$'),
        re.compile(r'^p41280(_a\d+)?$')]
matched = []
for row in ws.iter_rows(values_only=True):
    rid = row[id_col]
    if rid and any(p.match(str(rid)) for p in pats):
        matched.append(str(rid))

print(f'{len(matched)} fields')
open('ids.txt','w').write('\\n'.join(matched))
```

```r
# 2) 用 easyUKB 提取
library(easyUKB); library(readxl)
set_data_path('<用户给的 UKB_rawdata 路径>')

field_ids <- readLines('ids.txt')

# 验证
id_idx <- read_excel(file.path(get_data_path(), 'ID.xlsx'))
field_ids <- intersect(field_ids, id_idx[['ID']])
cat('Verified', length(field_ids), 'fields\n')

# 提取
df_icd10 <- Common_data_extraction(id = field_ids, name = field_ids)

# 清洗 ICD10（去点号 + 与 coding 19 校验）
df_clean <- convert_p41270_ultimate(df_icd10)

saveRDS(df_clean, 'output/icd10_diagnoses_clean.rds')
```

## 6. 常见坑

| 坑 | 修复 |
|----|------|
| 只用 `p41270_i0`，漏 array | 用正则匹配 `p41270` 开头的全部行 |
| 给 `p21001_a0`（BMI 没 array） | BMI 是单值，只有 `p21001_i0..i3` |
| 写 `p41270.0` / `p41270-i0` | 严格 `p<id>_iX_aY`，下划线分隔 |
| 路径含中文，R 报错 | 用正斜杠 + UTF-8 编码保存脚本 |
| 字典 sheet 名乱码 | 用 `wb.worksheets[0]` 索引而非按名访问 |
