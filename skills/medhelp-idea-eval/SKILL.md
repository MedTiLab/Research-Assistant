---
name: medhelp-idea-eval
description: >
  Multi-persona medical research idea evaluation with a quality gate. Evaluates
  biomedical, clinical, public-health, and translational research ideas across
  5 MedEval dimensions (Question Clarity, Evidence Gap, Scientific Validity,
  Study Design Feasibility, Impact and Ethics) using 3 reviewer personas and a
  meta-review. Sits after medhelp-idea-generation in the Ideation branch.
---

# MedHelp Idea Eval

## Scope

Use this skill to evaluate a proposed **medical research idea or study concept**.
This includes clinical, epidemiologic, biomedical, public-health, translational,
health-services, omics, imaging, EHR, registry, and database research ideas.

Do not evaluate the idea as a generic ML/CS contribution unless the user
explicitly says the target is an ML-methods paper. For medical research, the
central question is:

- Is the medical question important and answerable?
- Is the evidence gap real?
- Is the biology, clinical rationale, or public-health rationale plausible?
- Is the proposed study design valid for the causal, diagnostic, prognostic, or
  descriptive claim being made?
- Can the data, cohort, endpoints, measurements, ethics, and analysis plan
  realistically support the claim?

## Directory Structure

```
skills/medhelp-idea-eval/
|-- SKILL.md
|-- prompts/
|   |-- build_eval_query.md
|   |-- build_evidence_assembly.md
|   |-- build_meta_review_query.md
|   |-- build_novelty_queries.md
|   |-- build_novelty_analysis.md
|   `-- build_refinement_feedback_query.md
`-- references/
    |-- eval_agent_instructions.md
    |-- novelty_verification_config.md
    `-- reviewer_personas.md
```

The filenames keep the historical `novelty_*` names for compatibility, but the
content now treats Step 0.5 as **medical evidence-gap verification**, not generic
paper originality scoring.

## Inputs

Paths for `Ideation/ideas` and `Ideation/references` come from
`instance.json` (`instance.Ideation.ideas`, `instance.Ideation.references`).
They are absolute in MedHelp-created projects; use them as-is. If relative,
resolve with `path.join(project_path, value)`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `selected_idea` | Yes | The medical research idea to evaluate, usually from `Ideation/ideas/selected_idea.txt` |
| `references` | No* | Pre-formatted source list from resource preparation or literature work |
| `prepare_res` | No* | Prepare Agent output: selected papers, datasets, cohorts, repositories, or reasoning |
| `download_res` | No* | Download/import log for papers or supporting files |
| `data_module` | No* | Imported metaprompt module; use `TASK` if present to understand the medical task |
| `context_variables` | Yes | Shared context dictionary; should contain `final_selected_idea_data` when available |

*Standalone mode: only `selected_idea` is required. Evaluation proceeds with
explicitly marked evidence limitations.

## Outputs

| Output | Description |
|--------|-------------|
| `eval_report` | Full markdown meta-review report |
| `eval_scores` | Structured JSON: per-dimension, per-persona, aggregated |
| `eval_decision` | One of `strong_accept`, `accept`, `borderline_accept`, `borderline_reject`, `reject` |
| `eval_feedback` | Strengths, weaknesses, and actionable revision suggestions |
| `context_variables["idea_evaluation_result"]` | Complete structured result dict |

## Cache File Outputs

Each step produces two kinds of files:

1. `.txt` files in `Ideation/ideas/` containing the full markdown reports.
2. `.json` files in `Ideation/ideas/logs/` containing structured metadata whose
   text fields are copied verbatim from the corresponding `.txt` files.

```
Ideation/ideas/
|-- evidence_gap_report.txt
|-- eval_report.txt
|-- eval_persona_1_review.txt
|-- eval_persona_2_review.txt
|-- eval_persona_3_review.txt
`-- logs/
    |-- idea_eval_agent_evidence_gap.json
    |-- idea_eval_agent_persona_1.json
    |-- idea_eval_agent_persona_2.json
    |-- idea_eval_agent_persona_3.json
    `-- idea_eval_agent_meta_review.json
```

Compatibility: if older orchestration expects novelty filenames, also write
`novelty_grounding_report.txt` and `logs/idea_eval_agent_novelty.json` as aliases
of the evidence-gap report. New code and new reports should prefer
`evidence_gap_report.txt` and `idea_eval_agent_evidence_gap.json`.

### Write Order

For every step, always write the `.txt` file first, then build the `.json` file
by copying the `.txt` content into the appropriate field.

For Step 0.5:
1. Write `evidence_gap_report.txt` with the full evidence-gap analysis.
2. Copy the full text into `report_text`.
3. Write `logs/idea_eval_agent_evidence_gap.json`.
4. If compatibility is needed, duplicate the same content to the legacy novelty filenames.

For each persona review:
1. Write `eval_persona_{N}_review.txt` with the full review.
2. Read it back or keep it in memory.
3. Write `logs/idea_eval_agent_persona_{N}.json` with `review_text` copied
   verbatim from the `.txt` file.

For the meta-review:
1. Write `eval_report.txt` with the full meta-review.
2. Copy the full text into `report_text`.
3. Write `logs/idea_eval_agent_meta_review.json`.

## Structured JSON Formats

### Persona Review

```json
{
  "context_variables": {
    "ideas_path": "<instance.Ideation.ideas>",
    "references_path": "<instance.Ideation.references>",
    "persona": "medical_domain_reviewer | epidemiology_biostatistics_reviewer | implementation_ethics_reviewer",
    "scores": {
      "question_clarity": { "score": 0, "reason": "...", "references": [] },
      "evidence_gap": { "score": 0, "reason": "...", "references": [] },
      "scientific_validity": { "score": 0, "reason": "...", "references": [] },
      "study_design_feasibility": { "score": 0, "reason": "...", "references": [] },
      "impact_ethics": { "score": 0, "reason": "...", "references": [] }
    },
    "strengths": [],
    "weaknesses": [],
    "suggestions": [],
    "recommendation": "Accept|Reject|...",
    "review_text": "<FULL text from eval_persona_{N}_review.txt>"
  }
}
```

### Meta-Review

```json
{
  "context_variables": {
    "ideas_path": "<instance.Ideation.ideas>",
    "references_path": "<instance.Ideation.references>",
    "aggregated_scores": {
      "question_clarity": { "avg": 0, "scores": [0, 0, 0] },
      "evidence_gap": { "avg": 0, "scores": [0, 0, 0] },
      "scientific_validity": { "avg": 0, "scores": [0, 0, 0] },
      "study_design_feasibility": { "avg": 0, "scores": [0, 0, 0] },
      "impact_ethics": { "avg": 0, "scores": [0, 0, 0] }
    },
    "overall_avg": 0,
    "decision": "strong_accept|accept|borderline_accept|borderline_reject|reject",
    "report_text": "<FULL text from eval_report.txt>",
    "strengths": [],
    "weaknesses": [],
    "suggestions": [],
    "idea_evaluation_result": { "...complete structured result..." }
  }
}
```

### Evidence-Gap Verification

```json
{
  "context_variables": {
    "step": "medical_evidence_gap_verification",
    "search_config": {
      "num_queries": 5,
      "sources": ["pubmed", "clinicaltrials", "guidelines", "semantic_scholar", "openalex"],
      "max_results_per_query": 10,
      "year_from": "<current_year - 5>"
    },
    "queries": [
      { "type": "pico_core", "query": "...", "rationale": "..." },
      { "type": "outcome_endpoint", "query": "...", "rationale": "..." },
      { "type": "population_context", "query": "...", "rationale": "..." },
      { "type": "mechanism_or_exposure", "query": "...", "rationale": "..." },
      { "type": "trial_guideline_overlap", "query": "...", "rationale": "..." }
    ],
    "idea_summary": "...",
    "search_results": { "total_raw": 0, "total_unique": 0 },
    "triage": [
      { "title": "...", "year": 0, "relevance": "high|medium|low|irrelevant", "assessment": "..." }
    ],
    "detailed_analysis": [
      { "title": "...", "year": 0, "overlap": "...", "differences": "...", "gap_level": "..." }
    ],
    "evidence_gap_level": "already_answered|crowded|partial_gap|clear_gap|unverified",
    "actionable_research_gap": ["..."],
    "report_text": "<FULL text from evidence_gap_report.txt>",
    "fast_fail_triggered": false,
    "user_decision": null
  }
}
```

## Step-by-Step Instructions

### Step 0 - Assemble Medical Evidence

Template: `prompts/build_evidence_assembly.md`

Read existing pipeline artifacts and compose 3 evidence blocks, one for each
reviewer. Evidence can include:

- Literature from `Ideation/references/papers/` and `references`.
- Study task from `data_module.TASK`.
- Prepare Agent output (`prepare_res`).
- Dataset/cohort/resource descriptions from `Experiment/datasets`,
  `Experiment/code_references`, metadata manifests, or downloaded reports.
- Any stated target population, exposure/intervention, comparator, outcome,
  endpoint, time window, setting, and intended study type.

If artifacts are missing, proceed but say exactly what is missing and how that
limits confidence.

### Step 0.5 - Medical Evidence-Gap Verification

Templates:
- `prompts/build_novelty_queries.md`
- `prompts/build_novelty_analysis.md`
- `references/novelty_verification_config.md`

Proactively check whether the proposed medical question is already answered,
actively studied, guideline-settled, or still a legitimate gap. This step runs
before persona reviews so all reviewers can use the same prior-work grounding.

Sub-steps:

1. Extract 5 medical search queries from the idea:
   `pico_core`, `outcome_endpoint`, `population_context`,
   `mechanism_or_exposure`, and `trial_guideline_overlap`.
2. Search relevant sources when available: PubMed, ClinicalTrials.gov,
   guideline sources, Semantic Scholar, OpenAlex, or local literature indexes.
3. Deduplicate results by title/DOI/PMID/NCT ID.
4. Analyze whether the idea is already answered, crowded but differentiable,
   partially open, clearly open, or unverified.
5. Fast-fail only when the same question with the same population, exposure,
   comparator, outcome, and design is already answered by strong evidence or
   an ongoing/completed definitive trial.
6. Save the report and JSON as described above.

### Steps 1-3 - Three Persona Reviews

Templates and references:
- `prompts/build_eval_query.md`
- `references/eval_agent_instructions.md`
- `references/reviewer_personas.md`

For each persona:

1. Build an evaluation query with persona-specific evidence from Step 0 plus the
   Step 0.5 evidence-gap report.
2. Start a new conversation with the Eval Agent.
3. Evaluate all 5 MedEval dimensions:
   - Question Clarity
   - Evidence Gap
   - Scientific Validity
   - Study Design Feasibility
   - Impact and Ethics
4. Save the full review to `eval_persona_{N}_review.txt`, then write the JSON log.

### Step 4 - Meta-Review

Template: `prompts/build_meta_review_query.md`

Aggregate all 3 reviews. The meta-reviewer acts as a medical research area
chair / study-section chair:

- Compute average score per dimension.
- Resolve reviewer disagreements.
- Identify whether the idea should proceed, be refined, or be abandoned.
- Make the next action concrete: literature deepening, cohort refinement,
  protocol drafting, analysis planning, or stopping.

Decision thresholds:

| Average Score | Decision | Action |
|---------------|----------|--------|
| >= 7.0 | `strong_accept` | Proceed to downstream research planning |
| >= 6.0 | `accept` | Proceed, with listed caveats |
| >= 5.0 | `borderline_accept` | Present report; ask whether to refine or proceed |
| >= 4.0 | `borderline_reject` | Suggest focused refinement |
| < 4.0 | `reject` | Trigger refinement loop or abandon |

Save `eval_report.txt` first, then `logs/idea_eval_agent_meta_review.json`.

### Step 5 - Quality Gate

- `strong_accept` or `accept`: continue to the next appropriate skill. For
  medical research this may be `medhelp-deep-research`, `dataset-discovery`,
  `medhelp-experiment-dev`, `medhelp-experiment-analysis`, or protocol writing.
- `borderline_accept` or `borderline_reject`: present the evaluation report and
  ask the user whether to proceed, refine, or abandon.
- `reject`: build structured feedback via
  `prompts/build_refinement_feedback_query.md` and trigger the refinement loop.

### Step 6 - Refinement Loop

Template: `prompts/build_refinement_feedback_query.md`

1. Build structured feedback from the meta-review.
2. Ask the Idea Agent to revise the existing medical idea, not generate a new one.
3. Require the revision to address PICO/PECO, endpoint, design, bias/confounding,
   feasibility, ethics, and evidence-gap issues that were flagged.
4. Save revised ideas as `refined_idea_v{N}.txt`.
5. Re-run Steps 0.5 through 4.
6. Maximum 2 refinement iterations before requiring user decision.

If accepted after refinement, update:
- `Ideation/ideas/selected_idea.txt`
- `context_variables["final_selected_idea_data"]`

### Step 7 - Output

Set `context_variables["idea_evaluation_result"]` with complete structured data:

```json
{
  "decision": "strong_accept|accept|...",
  "overall_avg": 0.0,
  "aggregated_scores": { "..." },
  "persona_reviews": [ "..." ],
  "report": "<full report text>",
  "evidence_gap_verification": {
    "gap_level": "already_answered|crowded|partial_gap|clear_gap|unverified",
    "actionable_research_gap": ["..."],
    "search_coverage": { "total_raw": 0, "total_unique": 0, "sources": ["..."] },
    "fast_fail_triggered": false,
    "user_decision": null
  },
  "refinement_iterations": 0,
  "grounded": true
}
```

## Configuration

| Constant | Default | Description |
|----------|---------|-------------|
| `NUM_PERSONAS` | 3 | Number of reviewer personas |
| `ACCEPT_THRESHOLD` | 6.0 | Minimum average score for automatic accept |
| `STRONG_ACCEPT_THRESHOLD` | 7.0 | Minimum average score for strong accept |
| `BORDERLINE_THRESHOLD` | 5.0 | Minimum score before reject/refinement path |
| `REJECT_THRESHOLD` | 4.0 | Below this triggers refinement |
| `MAX_REFINEMENT_ITERATIONS` | 2 | Maximum refinement attempts before user decision |
| `NUM_QUERIES` | 5 | Evidence-gap queries extracted from the idea |
| `MAX_RESULTS_PER_QUERY` | 10 | Results per query per source |
| `DEFAULT_SOURCES` | `pubmed,clinicaltrials,guidelines,semantic_scholar,openalex` | Evidence-gap sources |
| `YEAR_WINDOW` | 5 | Years back for default search when a source supports date filtering |
| `DEFINITIVE_EVIDENCE_FAST_FAIL` | `true` | User checkpoint when the same question is already answered |

## Checklist

- [ ] Evidence assembled from medical literature, datasets/cohorts, task context, and available pipeline artifacts
- [ ] Evidence limitations stated explicitly
- [ ] Evidence-gap queries extracted (`pico_core`, `outcome_endpoint`, `population_context`, `mechanism_or_exposure`, `trial_guideline_overlap`)
- [ ] Literature/trial/guideline searches executed where tools are available
- [ ] Search results deduplicated by title/DOI/PMID/NCT ID
- [ ] Evidence Gap Report generated with gap level assessment
- [ ] Fast-fail check applied if definitive overlap is found
- [ ] Evidence Gap Report saved to `evidence_gap_report.txt`, then full text copied into `logs/idea_eval_agent_evidence_gap.json`
- [ ] Legacy novelty aliases written if required by orchestration
- [ ] Evidence-gap report injected into all persona evidence blocks
- [ ] Persona 1 review saved and logged
- [ ] Persona 2 review saved and logged
- [ ] Persona 3 review saved and logged
- [ ] Meta-review saved to `eval_report.txt`, then copied into `logs/idea_eval_agent_meta_review.json`
- [ ] Decision computed from aggregated MedEval scores
- [ ] Quality gate applied
- [ ] If refinement occurred: feedback built, idea revised, and evaluation re-run
- [ ] `context_variables["idea_evaluation_result"]` set with complete structured data
