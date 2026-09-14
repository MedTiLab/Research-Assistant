# 本地优先与 UKB 官网核对

## 核对顺序

1. **先查本地**：用 `ukb.py search` 搜概念及同义词，再用 `field`、`coding` 确定候选字段、编码、单位、时间点与列展开。即使用户给出 Field ID，也先查本地定义。
2. **再查官网**：对最终使用的 Field ID 和 Coding ID 去重后，用可用的网页工具打开下列 UKB Showcase 页面。涉及时间点时，打开字段页所链接的 instancing 体系；`instance.cgi?id=` 参数是字段的 `instance_id`，不是物理列的 `_i0` 或 `_i1`。
3. **比较并记录**：核对标题和定义、单位、Value Type、Coding ID、将使用的编码值及特殊值含义、instance 含义、array 结构和字段版本。网页显示“可达”但未读到相应定义，不算核验成功；大型编码表只核验相关条目时，明确核验范围，不声称整表一致。
4. **无法核对则回退本地**：超时、DNS/TLS 错误、403/429、服务故障、登录或验证页、页面缺少必要内容、当前无网页工具，都使用已有本地元数据继续任务。对临时网络错误可重试一次；已确认访问受限时直接回退。未失败的字段保留其核验结果，不将整个任务一概标为已核验或未核验。

## 官方入口

- [UKB Showcase](https://biobank.ndph.ox.ac.uk/showcase/)：官网检索入口。
- 字段：`https://biobank.ndph.ox.ac.uk/showcase/field.cgi?id=<FIELD_ID>`，例如 [BMI / 21001](https://biobank.ndph.ox.ac.uk/showcase/field.cgi?id=21001)。
- 编码：`https://biobank.ndph.ox.ac.uk/showcase/coding.cgi?id=<CODING_ID>`，例如 [Sex / Coding 9](https://biobank.ndph.ox.ac.uk/showcase/coding.cgi?id=9)。
- 时间点体系：`https://biobank.ndph.ox.ac.uk/showcase/instance.cgi?id=<INSTANCE_ID>`，例如 [Assessment Centre Visit / Instancing 2](https://biobank.ndph.ox.ac.uk/showcase/instance.cgi?id=2)。
- [Value Type 说明](https://biobank.ndph.ox.ac.uk/showcase/help.cgi?cd=value_type)。

只向官网查询字段与编码元数据，不发送 eid、参与者值或用户数据文件。第三方文章、搜索摘要和镜像可作线索，不能作为“已核对官网”的证据。

## 不一致或缺少字段

官网提供当前公开定义，本地快照和用户发布版本可能更旧。列出差异及各自版本，不静默覆盖 codebook、重编码或修改物理列名；先判断是定义变化还是数据布局不同。官网的 array 数量不能证明用户文件拥有相同列，也不能将打包字符串自动拆成诊断/日期配对。

本地未命中时，在完成本地检索后可使用官网发现候选字段；在用户实际 schema 或补充字典确认物理列之前，只报告候选，不制造可执行提取映射。两处都没有可核实定义时，保留未知状态。存在影响变量含义的未解决冲突时，可原样提取，但涉及该含义的派生变量和统计建议应列为待确认。

## 交付证据

只查询时，在回复中给出官网链接、核验日期、核验范围及差异；生成方案或提取时，AI 在对应输出目录另写 `official_verification.md`。记录本地 codebook 版本、Field/Coding/Instancing ID、URL、访问日期、实际读到的定义或错误原因、结论和差异。可用状态：`verified`（所述范围内一致）、`different`、`unavailable`、`partial`、`not_checked`。不要把文件中已有的历史核验日期当成本次访问。

回退说明示例：“使用本地 codebook（2026-09-06 快照）；本次 UKB 官网访问超时，未完成在线核验。变量提取按本地字典与实际文件列进行。”这是可继续工作的回退状态，不表示本地结果已获官网确认。
