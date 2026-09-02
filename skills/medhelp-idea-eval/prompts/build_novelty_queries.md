# Medical Evidence-Gap Verification - Query Extraction

## Purpose

Extract targeted medical search queries from the selected research idea. The
queries should test whether the question has already been answered, is actively
being studied, or remains a valid evidence gap.

The filename remains `build_novelty_queries.md` for compatibility, but this is
not generic novelty checking.

## Parameters

| Parameter | Source | Description |
|-----------|--------|-------------|
| `selected_idea` | `Ideation/ideas/selected_idea.txt` | Medical research idea to verify |
| `source_papers` | `references` string or `Ideation/references/papers/` | Known source papers or background citations |

## Conversation Setup

This is an LLM call, not a new agent conversation. The orchestrating agent
extracts queries.

## Template

```text
You are a medical literature search specialist. Extract exactly 5 search
queries from the medical research idea below. These queries will be used to
search sources such as PubMed, ClinicalTrials.gov, guideline repositories,
Semantic Scholar, OpenAlex, and local literature indexes.

## Medical Research Idea

{selected_idea}

## Known Source Papers or Background Citations

{source_papers}

## Query Extraction Rules

Extract exactly 5 queries:

1. **pico_core** - Main PICO/PECO question: population + exposure/intervention
   or predictor + outcome. This should find studies asking essentially the same
   question.

2. **outcome_endpoint** - Outcome, endpoint, or measurement definition. This
   checks whether the endpoint is standard, validated, clinically meaningful, or
   already studied.

3. **population_context** - Disease, setting, subgroup, geography, or cohort.
   This checks whether the target population is sufficiently distinct.

4. **mechanism_or_exposure** - Biological mechanism, risk factor, intervention,
   index test, biomarker, or exposure. This checks plausibility and prior use.

5. **trial_guideline_overlap** - Trial, guideline, consensus, or systematic
   review overlap. This catches definitive evidence or active studies that may
   make the idea redundant.

## Guidelines

- Keep each query concise: 4-12 meaningful terms.
- Prefer MeSH-like medical terms when obvious, but keep natural-language terms
  if the idea uses newer terminology.
- Include disease, population, exposure/intervention/predictor, and outcome
  terms when known.
- Do not include author names unless the idea is explicitly about a named cohort
  or trial.
- Do not include year constraints in the query text.
- If the idea is underspecified, use the most specific terms available and mark
  missing PICO/PECO elements in the rationale.

## Required Output Format

Return JSON:

```json
{
  "queries": [
    {
      "type": "pico_core",
      "query": "...",
      "rationale": "..."
    },
    {
      "type": "outcome_endpoint",
      "query": "...",
      "rationale": "..."
    },
    {
      "type": "population_context",
      "query": "...",
      "rationale": "..."
    },
    {
      "type": "mechanism_or_exposure",
      "query": "...",
      "rationale": "..."
    },
    {
      "type": "trial_guideline_overlap",
      "query": "...",
      "rationale": "..."
    }
  ],
  "idea_summary": "One-sentence summary of the medical research question",
  "study_skeleton": {
    "population": "...",
    "exposure_intervention_predictor": "...",
    "comparator": "...",
    "outcome_endpoint": "...",
    "setting_data_source": "...",
    "study_type": "..."
  },
  "key_terms": ["term1", "term2", "term3"]
}
```
```

## Post-Processing

1. Parse the JSON output.
2. Validate that exactly 5 queries are present with the expected types.
3. Store queries, idea summary, study skeleton, and key terms for search and
   evidence assembly.
4. If parsing fails, extract fallback queries from disease, exposure/predictor,
   outcome, and study-design sentences in the idea.
