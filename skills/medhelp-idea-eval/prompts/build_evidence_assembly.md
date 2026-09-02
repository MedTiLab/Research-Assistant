# Evidence Assembly

## Purpose

Compose persona-specific evidence blocks from existing medical research pipeline
artifacts. Do not invent evidence. If evidence is missing, state the limitation
plainly and continue with lower confidence.

## Artifact Sources

| Artifact | Location or parameter | Content |
|----------|-----------------------|---------|
| Source literature | `Ideation/references/papers/`, `references` | Papers, abstracts, citations, guidelines, reports |
| Study task | `data_module.TASK` | Medical research question or task description |
| Prepare output | `prepare_res` | Selected papers, datasets, cohorts, repositories, and reasoning |
| Download/import log | `download_res` | Paper/source download status and limitations |
| Dataset/cohort files | `Experiment/datasets/` | Data dictionaries, manifests, cohort descriptions, sample metadata |
| Code/protocol references | `Experiment/code_references/` | Analysis code, protocol examples, statistical workflows |
| Evidence-gap report | `evidence_gap_report.txt` | Step 0.5 prior-work and gap verification |

## Extract a Study Skeleton First

Before building persona blocks, extract what is explicitly known:

- Study type: observational, trial, diagnostic, prognostic, mechanistic,
  biomarker, omics, imaging, health-services, public-health, systematic review,
  or unclear.
- Population: disease/condition, age range, setting, geography, inclusion and
  exclusion criteria.
- Exposure/intervention/index test/predictor.
- Comparator/control/reference standard.
- Outcome/endpoints and follow-up window.
- Data source or specimen type.
- Claimed contribution.
- Main risk: bias, confounding, missingness, measurement error, reverse
  causation, selection bias, leakage, small sample size, or limited external
  validity.

If an element is not specified, write `Not specified`.

## Evidence Levels

### Level: `domain` - Medical Domain Reviewer

Include:
- Paper titles, abstracts, guideline snippets, and disease/context background.
- Evidence-gap report.
- Study skeleton.
- Any clinical, biological, or public-health rationale in `selected_idea`,
  `references`, `prepare_res`, or `data_module.TASK`.

Format:

```text
### Study Skeleton
{study_skeleton}

### Evidence Gap Report
{full content of evidence_gap_report.txt if available}

### Medical Background and Source Literature
{titles, abstracts, guideline snippets, and key claims}

### Task Context
{data_module.TASK or "Not provided"}
```

### Level: `methods` - Epidemiology and Biostatistics Reviewer

Include:
- Study skeleton with emphasis on PICO/PECO, endpoint, comparator, time window,
  data source, and target estimand.
- Evidence-gap report.
- Methods details from papers, code references, protocols, or prepare output.
- Dataset/cohort manifests, data dictionaries, sample size hints, missingness
  notes, and available covariates.

Format:

```text
### Study Skeleton and Target Claim
{study_skeleton}

### Evidence Gap Report
{full content of evidence_gap_report.txt if available}

### Study Design and Analysis Evidence
{methods, cohort, endpoint, covariate, and analysis details}

### Data Availability and Quality Notes
{dataset/cohort descriptions and limitations}
```

### Level: `implementation` - Implementation and Ethics Reviewer

Include:
- Study skeleton.
- Evidence-gap report.
- Dataset/cohort availability, access constraints, IRB/consent/privacy clues,
  code/protocol references, and timeline or resource assumptions.
- Practical risks: data linkage, endpoint adjudication, missing data,
  harmonization, reproducibility, and deployment/translation issues.

Format:

```text
### Study Skeleton
{study_skeleton}

### Evidence Gap Report
{full content of evidence_gap_report.txt if available}

### Feasibility Evidence
{datasets, code/protocols, access constraints, timeline, reproducibility notes}

### Ethics and Translation Notes
{consent, privacy, risk/benefit, equity, clinical workflow, stakeholder issues}
```

## Standalone Mode

When only `selected_idea` is available:

```text
### Evidence Status: Standalone Medical Research Evaluation
No pipeline artifacts are available. The review is based on the idea text and
any evidence-gap search that could be performed. Scores for Evidence Gap,
Scientific Validity, and Study Design Feasibility should be interpreted with
caution.

### Study Skeleton
{study_skeleton}

### Evidence Gap Report
{full content of evidence_gap_report.txt if available; otherwise "Not available"}
```

If evidence-gap search also failed:

```text
### Evidence Status: Ungrounded Medical Research Evaluation
No pipeline artifacts are available and evidence-gap verification failed. The
review is based only on the idea text and reviewer expertise. Do not claim that
the question is novel or unanswered; mark the gap as unverified.

### Study Skeleton
{study_skeleton}
```

## Assembly Function

For each persona:

1. Check file and directory existence.
2. Extract the study skeleton from the idea and available artifacts.
3. Select the persona-specific evidence level.
4. Include the full evidence-gap report when available.
5. State missing artifacts and confidence limits.
6. Return the formatted evidence block string.
