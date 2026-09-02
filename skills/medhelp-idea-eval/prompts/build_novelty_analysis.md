# Medical Evidence-Gap Verification - Analysis

## Purpose

Analyze search results against the selected medical research idea to determine
whether the question is already answered, crowded, partially open, clearly open,
or unverified. The resulting Evidence Gap Report becomes primary evidence for
the Evidence Gap score in all persona reviews.

The filename remains `build_novelty_analysis.md` for compatibility.

## Parameters

| Parameter | Source | Description |
|-----------|--------|-------------|
| `selected_idea` | `Ideation/ideas/selected_idea.txt` | Medical research idea |
| `search_results` | Step 0.5 search output | Deduplicated results with title, abstract/summary, authors, year, source, DOI/PMID/NCT, URL |
| `source_papers` | `references` string or `Ideation/references/papers/` | Known source/background papers |
| `idea_summary` | Query extraction output | One-sentence summary |
| `study_skeleton` | Query extraction output | PICO/PECO, data source, study type |
| `key_terms` | Query extraction output | Distinctive medical terms |

## Conversation Setup

This is an LLM call, not a new agent conversation.

## Template

```text
You are a medical evidence-gap analyst. Your task is to compare the proposed
medical research idea against search results and determine whether the idea is
worth pursuing as a medical study.

## Medical Research Idea

{selected_idea}

**Idea Summary**: {idea_summary}
**Study Skeleton**: {study_skeleton}
**Key Terms**: {key_terms}

## Known Source Papers or Background Citations

These sources may have inspired the idea. They can still matter for evidence,
but do not treat the idea as redundant merely because it builds on them.

{source_papers}

## Search Results

{search_results}

## Analysis Protocol

### Phase 1: Triage

For each result, assign a relevance tier:

- **high**: Same or very similar population, exposure/intervention/predictor,
  comparator/reference, outcome, and study design.
- **medium**: Same question area but differs in population, endpoint, data
  source, mechanism, design, or clinical setting.
- **low**: Shares disease, mechanism, endpoint, or method, but does not directly
  address the question.
- **irrelevant**: No meaningful connection.

Tag result type when possible: original study, RCT, observational study,
systematic review/meta-analysis, guideline/consensus, trial record, protocol,
database/resource paper, methods paper, preclinical/mechanistic study.

### Phase 2: Deep Analysis

Deep-analyze the top 5-8 high/medium results. For each:

1. **Overlap**: Which PICO/PECO/design elements overlap with the idea?
2. **Differences**: What differentiates the idea?
3. **Evidence Strength**: Is the result definitive, suggestive, exploratory, or
   weak?
4. **Gap Level**: Does this result make the idea already answered, crowded,
   partially open, or still clearly open?
5. **Design Lessons**: Bias, confounding, endpoint, cohort, sample-size, or
   measurement issues the proposed study must handle.

### Phase 3: Synthesis

Assign one overall evidence-gap level:

- `already_answered`: The same question is answered by strong evidence,
  guidelines, a definitive trial, or a high-quality meta-analysis.
- `crowded`: Many similar studies exist, but the idea may survive with a sharper
  population, endpoint, mechanism, dataset, or design.
- `partial_gap`: Prior work exists but leaves a meaningful unresolved gap.
- `clear_gap`: Search found limited direct evidence and the question appears
  important and plausible.
- `unverified`: Searches failed or the idea is too underspecified to judge.

## Required Output Format

```markdown
# Medical Evidence Gap Report

## Search Coverage
- Queries executed: {number}
- Total raw results: {number}
- Unique records after deduplication: {number}
- Sources searched: {list}
- Year window: {range or "not restricted"}
- Evidence limitations: {limitations}

## Study Skeleton
- Population: ...
- Exposure/Intervention/Predictor: ...
- Comparator/Reference: ...
- Outcome/Endpoint: ...
- Setting/Data Source: ...
- Intended Study Type: ...

## Phase 1: Triage Summary
- High relevance: {count}
- Medium relevance: {count}
- Low relevance: {count}
- Irrelevant: {count}

### All Records by Relevance
{triage entries}

## Phase 2: Deep Analysis
### {record title} ({year})
- **Record Type**: ...
- **Overlap**: ...
- **Differences**: ...
- **Evidence Strength**: ...
- **Gap Level**: ...
- **Design Lessons**: ...

## Phase 3: Synthesis

### Overall Evidence Gap Level: {level}

### Actionable Research Gap
- {gap 1}
- {gap 2}

### Risks to Address Before Proceeding
- {risk 1}
- {risk 2}

### Reviewer Recommendation
{paragraph that explains how reviewers should score Evidence Gap and what
conditions would make the study worth pursuing}
```
```

## Post-Processing

1. Write the full report to `Ideation/ideas/evidence_gap_report.txt`.
2. Parse gap level, triage counts, analyzed records, actionable gaps, and risks.
3. Write `Ideation/ideas/logs/idea_eval_agent_evidence_gap.json` with
   `report_text` copied verbatim from the `.txt` file.
4. If compatibility is required, also write the same text and structured data to
   `novelty_grounding_report.txt` and `idea_eval_agent_novelty.json`.
5. If level is `already_answered` because of definitive evidence, trigger the
   fast-fail checkpoint.
