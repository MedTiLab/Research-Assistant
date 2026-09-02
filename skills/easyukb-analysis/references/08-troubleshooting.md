# 错误排查与调试

UKB + easyUKB 分析中最常见的坑与修复手段。

## 1. 路径/字段错误

| 症状 | 根因 | 修复 |
|------|------|------|
| `Error: please call set_data_path() first` | 全局路径未设 | 脚本顶部 `set_data_path("...")` |
| `Error: field 'p21001_i5' not found` | instance 超出（UKB 只有 i0/i1/i2/i3） | 改 instance |
| `Error: field 'p21001_a1' not found` | BMI 是单值，无 array | 改成 `p21001_i0` |
| `Error: field 'p<id>_i0' not found` | 字段确实不在 UKB | 查 `dataset.data_dictionary.xlsx` |
| `ID.xlsx` not found | 未先 `ukb_data_prepare()` 切片 | 先跑一次切片 |

### 字段验证脚本

```r
id_idx <- readxl::read_excel(file.path(get_data_path(), "ID.xlsx"))
required <- c("p21001_i0","p30750_i0","p21003_i0")
missing  <- setdiff(required, id_idx[["id"]])
if (length(missing)) {
  message("Missing fields:")
  print(missing)
  stop("Fix above fields first")
}
```

## 2. ICD10 / 编码相关

| 症状 | 根因 | 修复 |
|------|------|------|
| `_diagnosis` 列全 NA | ICD10 没去点号或字段没清洗 | 确认 `convert_p41270_ultimate()` 已调用 |
| `_diagnosis` 全 0 | icd_list 写法错（带点号） | `"I21"` 而非 `"I21.0"` |
| `_diagnosis` 全 NA 但非空集 | melt 后无匹配 | 检查 disease_list/icd_list 名字对应 |
| 自报疾病诊断少 | 没用 `convert_p20002_to_coding` | 先把 meaning 转 coding 数字 |

### ICD 匹配调试

```r
df_icd <- convert_p41270_ultimate(df_raw)

# 看清洗后 3 位 ICD10 分布
top_icd3 <- sort(table(stringr::str_sub(df_icd$icd10_clean, 1, 3)),
                 decreasing = TRUE)[1:20]
print(top_icd3)

# 验证目标病种是否覆盖
"I21" %in% stringr::str_sub(df_icd$icd10_clean, 1, 3)
```

## 3. 时间骨架相关

| 症状 | 根因 | 修复 |
|------|------|------|
| 部分人 `outcome_time` 缺失 | 既无死亡日也无失访日 | 用 `death_default` 兜底（已默认） |
| `outcome_age` 小于 `baseline_age` | 日期算错 | 检查 `time_Extract` 是否覆盖最新数据 |
| `followup_years` 异常大/负 | 字段单位混乱 | 用 `process_date_dataframe()` 标准化 |

```r
df_time <- time_Extract()
summary(df_time[, c("baseline_age","outcome_age","outcome_time")])
# 应该：baseline_age 40-70 之间，outcome_age >= baseline_age
```

## 4. 内存/性能

| 症状 | 根因 | 修复 |
|------|------|------|
| 内存溢出 (`cannot allocate vector...`) | 一次 `readRDS()` 整表 | 改用 `Common_data_extraction(id=c(...))` |
| 读取超慢 | `id_list` 太大、跨多 RDS | 拆 batch 跑 |
| join 后内存翻倍 | full_join 产生 NA 行 | 用 `inner_join` 或先 filter |
| `data.frame` → `data.table` 转换慢 | 在循环里反复转 | 先转一次，全程用 data.table |

```r
# 推荐：少而精
df <- Common_data_extraction(id = vars_needed_now, name = nice_names)
gc()
```

## 5. 协变量缺失爆炸

| 症状 | 根因 | 修复 |
|------|------|------|
| 调整 21 项后 N 砍半 | 多协变量 OR 缺失叠加 | 先看缺失模式：`calculate_missing_rate()` |
| 某变量缺失 >50% | 字段质量本身差 | 替换或丢弃 |
| 完整病例 < 3 万 | 协变量集太宽 | 多重插补 `impute_mice()` |

```r
mr <- calculate_missing_rate(df, exclude_cols = "eid")
mr$col_missing |> sort(decreasing = TRUE) |> head(10)

# 列缺失 >30% 的变量
hi_missing <- names(mr$col_missing[mr$col_missing > 0.3])
```

## 6. 模型异常

| 症状 | 根因 | 修复 |
|------|------|------|
| HR < 0 或 > 100 | 暴露未标准化/未 winsorize | `scale()` 或 `winsor()` |
| 标准误极大 / Cox 警告 | 多重共线性 | `car::vif()` 查 |
| PH 假设违背 | 时间相关效应 | `cox.zph()` + `tt()` 或 `strata()` |
| `mstate` 长格式错 | trans matrix 与 status 列不对应 | 仔细按 `transMat()` 写 |
| ROC 截断点不稳定 | 样本不平衡 / 时间点选不当 | 用 5/10 年 + bootstrap CI |
| 中介 ACME 不显著 | 中介物效应小 | 报告完整 mediated proportion + boot CI |

```r
# 标准化暴露
df$exposure_z <- scale(df$exposure)[, 1]

# Winsorize 极端值
df$exposure_w <- pmin(pmax(df$exposure,
                          quantile(df$exposure, 0.005, na.rm=TRUE)),
                          quantile(df$exposure, 0.995, na.rm=TRUE))

# VIF 多重共线性
library(car)
vif(fit_M2)
```

## 7. 包加载失败

| 症状 | 根因 | 修复 |
|------|------|------|
| `online_activate` 失败 | 离线或激活服务器不通 | 联系作者要离线 token |
| `Error in library(easyUKBhelp)` | 依赖包未装 | 装 easyUKBhelp |
| `package 'preventr' not available` | calculate_Prevent_CVD_Risk 缺依赖 | `install.packages("preventr")` |
| `package 'ukbnmr' not available` | NMR_process 缺依赖 | 装 ukbnmr |

## 8. PowerShell 中文路径乱码

Windows PowerShell 默认 GBK，UKB 路径含中文（如 `K:\UKB文章\`）会乱码。

- `exec` 用 Python 脚本而非直接 ps1 命令
- `read` 工具显示正常（VS Code 渲染 UTF-8）
- 关键脚本放 `_tmp_scripts/` 用 ASCII 名（s01.R, s02.R...）

## 9. 调试代码片段

```r
# 看时间骨架
df_time <- time_Extract()
summary(df_time)

# 看入排
table(!is.na(df$SPISE),
      df$baseline_age >= 40 & df$baseline_age <= 70,
      df$Diabetes_baseline == 0)

# 看结局
sapply(c("T2D","IHD","Stroke","CMM"), function(d) {
  list(N = sum(df[[paste0(d,"_diagnosis")]] == 1, na.rm = TRUE),
       N_miss = sum(is.na(df[[paste0(d,"_diagnosis")]])))
})

# 看协变量分布
df |> select(age, BMI, HDL, TG, HbA1c) |> summary()

# 看 Cox 结果
broom::tidy(fit_M2, exponentiate = TRUE, conf.int = TRUE) |>
  filter(term == "exposure_z")
```

## 10. 报告诚实度

- 区分"读源码 line-by-line"vs"按使用上下文推断"vs"仅知函数名"，不要假装全懂。
- 字段不确定时，先 `id_idx[id_idx$id == "p...", ]` 查证。
- 公式不确定时，先翻原 R 函数源码再写注释。
- 用户给的暴露/结局映射不熟时，请用户提供 UKB FieldID。
