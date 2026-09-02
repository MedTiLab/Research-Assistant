# Data Extraction & Path Configuration

UKB 原始数据切片、按需读取、字段验证。

## 路径设置（全局环境）

```r
library(easyUKB)
set_data_path("K:/UKB文章/00.easyUKB_AI使用/UKB_rawdata")
get_data_path()  # 验证
```

实现细节：`data_config.R` 用 `.ukb_env`（子 environment）存路径；未设置时 `get_data_path()` 会 stop。

## 一次性切片（首次使用 UKB 数据时）

```r
ukb_data_prepare(
  raw_data_path = "K:/UKB原始/ukb_full_wide.rds",
  output_dir    = "K:/UKB文章/00.easyUKB_AI使用/UKB_rawdata/00.字段目录",
  chunk_size    = 80
)
```

产出：
- `00.字段目录/data1_*.rds`：每个 RDS 含 ≤80 个字段 + `eid`
- 父目录 `ID.xlsx`：字段名 → RDS 文件名索引

**为什么 chunk_size=80**：内存压力与读取次数的折衷。UKB 500K × 80 字段 ~ 200MB RDS，可正常读入 16GB 内存。

## 字段读取两种方式

### 方式 1：少量字段（推荐）

```r
df <- Common_data_extraction(
  id   = c("p31", "p21001_i0", "p189", "p21003_i0"),
  name = c("sex", "BMI", "Townsend", "age")
)
```

内部调用 `batch_merge_data_optimized()`，自动把字段映射到对应 RDS 文件。

### 方式 2：底层批量

```r
df <- batch_merge_data_optimized(
  data_path = get_data_path(),
  id_list   = c("p21001_i0", "p189", "p21003_i0", "p31")
)
```

返回的列名仍是 UKB 原始字段名（`p21001_i0` 等），无重命名。

## 内部实现（`batch_merge_data_optimized.R`）

1. `readxl::read_excel(file.path(path, "ID.xlsx"))` 读索引
2. 筛选出 `id_list` 所在的所有 RDS 文件名（去重）
3. 对每个 RDS：`readRDS()` → 只保留 `c("eid", 需要的字段)`
4. `purrr::reduce(full_join, by = "eid")` 合并所有切片

## 字段存在性验证（强烈推荐）

```r
id_idx <- readxl::read_excel(file.path(get_data_path(), "ID.xlsx"))
required_fields <- c("p21001_i0", "p30750_i0", "p21003_i0")
missing <- setdiff(required_fields, id_idx[["id"]])
if (length(missing) > 0) stop("Missing fields: ", paste(missing, collapse=","))
```

## 内存与性能小贴士

- **绝不**一次 `readRDS()` 整张原始大表（500K × 4000 字段 ~ 20GB）
- 提取后立即 `gc()`，回收内存
- 多次按需 join 比一次大 join 更内存友好
- 大批量字段（>500 个）拆 batch 跑

## 蛋白组 / NMR 特殊路径

```r
# Olink ~3000 蛋白
df_protein <- extract_protein_data(instance = 0)

# NMR 代谢组（需先做技术变异校正）
NMR_process(
  path        = get_data_path(),
  output_path = "K:/UKB文章/00.easyUKB_AI使用/UKB_rawdata/NMR_Data"
)
# 产出 NMR_Data/processed_*.csv
```

## 包加载时的激活

`zzz.R` 中 `.onLoad()` 调用 `easyUKBhelp:::online_activate("8.155.15.248", "8503", "/activate")`。**首次使用必须能联网**。如果在离线环境，需联系作者获取离线激活。

## 输出文件路径约定

- 中间结果：`./02.intermediate/` 或 `./03.数据处理结果/`
- Cox 结果：`./02.cox_univariate/`（与 `save_cox_results()` 默认路径一致）
- 图表：`./04.figures/` 或 `./05.plots/`

## 常见陷阱

| 陷阱 | 表现 | 修复 |
|------|------|------|
| 未 `set_data_path()` | `Error: please call set_data_path() first` | 脚本顶部设置 |
| 字段 instance 超出 | `Error: field 'p21001_i5' not found` | UKB 只有 i0/i1/i2/i3 |
| BMI 加 array 后缀 | `field 'p21001_a1' not found` | BMI 是单值，无 array；改 `p21001_i0` |
| 路径里中文转义 | Windows 双反斜杠或正斜杠 | 用 `"K:/UKB文章/..."` |
