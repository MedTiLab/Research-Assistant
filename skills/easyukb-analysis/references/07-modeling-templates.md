# 建模代码模板

UKB 关联分析常用统计模型的可复用 R 模板。

## 1. Cox 比例风险模型（三层嵌套）

```r
library(survival)

# crude / M1 / M2
fit_crude <- coxph(Surv(time, event) ~ exposure_z, data = df)
fit_M1    <- coxph(Surv(time, event) ~ exposure_z + age + sex, data = df)
fit_M2    <- coxph(Surv(time, event) ~ exposure_z + age + sex + ethnicity +
                     Townsend + education + employment + income +
                     smoking + alcohol + PA + sleep + diet +
                     eGFR + family_history + SBP + DBP +
                     HbA1c + BP_med + lipid_med, data = df)

# 三分位 / 四分位 + p-trend
df$exposure_T <- factor(ntile(df$exposure, 3),
                        levels = 1:3, labels = c("T1","T2","T3"))
fit_M2_T <- coxph(Surv(time, event) ~ exposure_T + <covariates>, df)
# p-trend：用连续暴露代入 + ANOVA
fit_M2_trend <- coxph(Surv(time, event) ~ as.numeric(exposure_T) + <covariates>, df)
```

### 提取结果

```r
summary_cox <- function(fit, term) {
  s <- summary(fit)
  i <- which(rownames(s$coefficients) == term)
  data.frame(
    HR     = s$coefficients[i, "exp(coef)"],
    SE     = s$coefficients[i, "se(coef)"],
    P      = s$coefficients[i, "Pr(>|z|)"],
    HR_low = s$conf.int[i, "lower .95"],
    HR_high= s$conf.int[i, "upper .95"]
  )
}
```

### PH 假设检验

```r
cox.zph(fit_M2)
```

如违背 PH，加 `tt()` 或 `strata()`。

## 2. Logistic 回归（横断面/Case-control）

```r
fit_logit <- glm(outcome ~ exposure_z + <covariates>,
                 data = df, family = binomial(link = "logit"))
exp(coef(fit_logit))            # OR
exp(confint(fit_logit))         # 95% CI
```

## 3. 限制性立方样条 RCS（非线性）

```r
library(rms)
dd <- datadist(df); options(datadist = "dd")

fit_rcs <- cph(Surv(time, event) ~ rcs(exposure, 4) + <covariates>,
               data = df, x = TRUE, y = TRUE)

# 非线性 P
anova(fit_rcs)

# 可视化
pred <- Predict(fit_rcs, exposure, ref.zero = TRUE, fun = exp)
library(ggplot2)
ggplot(as.data.frame(pred), aes(exposure, yhat)) +
  geom_line() + geom_ribbon(aes(ymin=lower, ymax=upper), alpha=0.2) +
  geom_hline(yintercept = 1, linetype = "dashed") +
  labs(y = "HR (95% CI)")
```

**节点选择**：4 个节点（5%, 35%, 65%, 95% 分位）默认。样本量大且关系复杂时可用 5。

## 4. 多状态 Cox（mstate）

健康→单 CMD→共病（CMM）的 Path A/B。

```r
library(mstate)

# transition matrix
tmat <- transMat(x = list(c(2,3), c(4), c(4), c()),
                 names = c("Healthy","T2D","IHD","CMM"))

# long 格式
df_long <- msprep(
  time   = c(NA, "T2D_time", "IHD_time", "CMM_time"),
  status = c(NA, "T2D_event","IHD_event","CMM_event"),
  data   = df, trans = tmat,
  keep   = c("age","sex","exposure_z","<covariates>")
)

# stratified Cox
fit_ms <- coxph(Surv(Tstart, Tstop, status) ~ exposure_z + age + sex +
                  strata(trans), data = df_long)
```

## 5. 时间相关 ROC

```r
library(survivalROC)
roc_5yr <- survivalROC(
  Stime = df$time, status = df$event,
  marker = df$exposure, predict.time = 5, method = "KM"
)
roc_5yr$AUC

# Youden 截断点
library(OptimalCutpoints)
oc <- optimal.cutpoints(X = "exposure", status = "event",
                        tag.healthy = 0, methods = "Youden", data = df)
```

或用 easyUKB 内置：

```r
find_optimal_cutoff(df, predictor = "exposure", outcome = "event", method = "youden")
```

## 6. C-index / IDI / NRI

```r
library(survC1)
library(Hmisc)
rcorr.cens(-df$exposure, Surv(df$time, df$event))[["C Index"]]

# 比较模型
library(survIDINRI)
res <- IDI.INF(...)
```

或批量：

```r
batch_cindex_analysis(df, predictors = c("exposure"), time="time", status="event",
                      method = c("HZ","Uno"))
```

## 7. 中介分析（mediation）

```r
library(mediation)

run_med <- function(med_var, treat = "exposure_z", outcome = "event") {
  fml_m <- as.formula(paste0(med_var, " ~ ", treat, " + ", covars))
  fml_y <- as.formula(paste0(outcome, " ~ ", treat, " + ", med_var, " + ", covars))

  model.m <- lm(fml_m, data = df)
  model.y <- glm(fml_y, data = df, family = binomial)

  med <- mediate(model.m, model.y, treat = treat, mediator = med_var,
                 boot = TRUE, sims = 1000)
  list(
    ACME    = med$d.avg,
    ACME_CI = med$d.avg.ci,
    ADE     = med$z.avg,
    Total   = med$tau.coef,
    Prop    = med$n.avg,
    P_ACME  = med$d.avg.p
  )
}

mediators <- c("HbA1c","TG","HDL","LDL","ApoB","CRP","Albumin","GGT")
results <- lapply(mediators, run_med)
```

## 8. 亚组与交互

```r
# 单亚组（连续变量分层）
df$age_group <- cut(df$age, c(40, 60, 70), labels = c("<60", "≥60"))

for (lvl in levels(df$age_group)) {
  sub <- df[df$age_group == lvl, ]
  fit <- coxph(Surv(time, event) ~ exposure_z + <covariates>, sub)
  print(summary_cox(fit, "exposure_z"))
}

# 交互 P
fit_int <- coxph(Surv(time, event) ~ exposure_z * age_group + <covariates>, df)
anova(fit_M2, fit_int)  # 似然比检验
```

## 9. 多重插补（MICE）

```r
library(mice)
imp <- impute_mice(df, m = 5, maxit = 5, method = "pmm")

# 在每个插补集上跑模型并汇总
fits <- lapply(imp$all_imputations, function(d) {
  coxph(Surv(time, event) ~ exposure_z + <covariates>, data = d)
})
pooled <- mice::pool(fits)
summary(pooled, conf.int = TRUE, exponentiate = TRUE)
```

## 10. 批量分析

```r
# 批量 Cox
res <- batch_survival_analysis(df,
  exposures  = c("BMI","WC","SPISE","TyG"),
  time = "time", status = "event",
  covariates = covars
)
# 输出含 HR/95%CI/P/FDR 的 data.frame

# 批量 ROC
res_roc <- batch_roc_analysis(df,
  predictors = c("SPISE","TyG","HOMA"),
  outcome    = "T2D"
)

# 批量线性回归
res_lm <- perform_batch_linear_regression(df,
  pair_columns = c("Protein_A","Protein_B"),
  covariates   = covars,
  outcome      = "SPISE"
)
```

## 11. 敏感性分析

```r
# 排除基线 2 年内发病（avoid reverse causation）
df_sa1 <- df[df$time > 2, ]

# 排除基线癌症
df_sa2 <- df[df$baseline_cancer == 0, ]

# 补充协变量（药物）
fit_sa3 <- update(fit_M2, ~ . + OAD + insulin + statin)

# Winsorize 极端值
winsor <- function(x, p = 0.005) {
  q <- quantile(x, c(p, 1-p), na.rm = TRUE)
  pmin(pmax(x, q[1]), q[2])
}
df$exposure_w <- winsor(df$exposure)
```

## 12. 输出表格

```r
library(broom); library(dplyr)

# 整理 Cox 模型为发表表格
summary_table <- function(fit, term) {
  s <- summary(fit)
  i <- which(rownames(s$coefficients) == term)
  data.frame(
    Term = term,
    HR   = sprintf("%.2f (%.2f-%.2f)",
                   s$conf.int[i,"exp(coef)"],
                   s$conf.int[i,"lower .95"],
                   s$conf.int[i,"upper .95"]),
    P    = format.pval(s$coefficients[i,"Pr(>|z|)"], digits = 2)
  )
}

# 三层模型汇总
results_table <- bind_rows(
  summary_table(fit_crude, "exposure_z") |> mutate(Model = "Crude"),
  summary_table(fit_M1,    "exposure_z") |> mutate(Model = "M1"),
  summary_table(fit_M2,    "exposure_z") |> mutate(Model = "M2")
)

# 或用 easyUKB 内置
create_summary_table(results)
```

## 13. 绘图

```r
# 单生存曲线
plot_single_survival_curve(df, pair_column = "exposure", time = "time",
                           status = "event", cutoff = 0, time_unit = "years",
                           output_dir = "./04.figures/")

# top-N
plot_top_survival_curves(top_genes, survival_curves_data, time_unit = "years",
                         output_dir = "./04.figures/")

# 火山图
plot_volcano(results, output_dir = "./04.figures/")

# Forest（自定义）
library(forestplot)
# ...
```
