# Medical Evidence-Gap Verification - Configuration and Protocol

The filename remains `novelty_verification_config.md` for compatibility. The
protocol now verifies medical evidence gaps, not generic paper originality.

## Configuration Constants

| Constant | Default | Description |
|----------|---------|-------------|
| `NUM_QUERIES` | 5 | Number of search queries extracted from the idea |
| `MAX_RESULTS_PER_QUERY` | 10 | Maximum records returned per query per source |
| `DEFAULT_SOURCES` | `pubmed,clinicaltrials,guidelines,semantic_scholar,openalex` | Preferred evidence-gap sources |
| `YEAR_WINDOW` | 5 | Default recent-year window when a source supports date filtering |
| `DEFINITIVE_EVIDENCE_FAST_FAIL` | `true` | Present user checkpoint when the same question is already definitively answered |

## Source Priority

Use available tools in this order:

1. Local project references and downloaded papers.
2. PubMed or a local PubMed database, if available.
3. ClinicalTrials.gov for interventional/diagnostic/prognostic studies.
4. Guidelines, consensus statements, and major society recommendations when the
   topic is clinical or public-health practice.
5. Semantic Scholar and OpenAlex for broader biomedical and cross-disciplinary
   coverage.
6. General web search only when the user explicitly wants it or when no medical
   search tool is available.

Do not fabricate tool output. If a source cannot be queried, record it as a
coverage limitation.

## Search Invocation

There is no single required script for medical evidence-gap search. Prefer the
best available local or connected source. Acceptable implementations include:

- Existing literature artifacts already present in `Ideation/references`.
- PubMed database/search skills or APIs.
- OpenAlex/Semantic Scholar APIs.
- ClinicalTrials.gov API or web search.
- Guideline web search when needed.

For each query, collect title, abstract/summary if available, year, source,
identifier (DOI, PMID, PMCID, NCT ID), URL, and record type when identifiable.
Deduplicate across sources by DOI, PMID, NCT ID, normalized title, and first
author/year.

## Evidence-Gap Levels

| Level | Definition | Evidence Gap Score Guidance |
|-------|------------|-----------------------------|
| `already_answered` | Same PICO/PECO/design answered by strong evidence, guideline, definitive trial, or high-quality meta-analysis | 0-3 |
| `crowded` | Many similar studies; distinctiveness depends on sharper population, endpoint, mechanism, dataset, or design | 2-5 |
| `partial_gap` | Prior work exists but leaves a meaningful unresolved gap | 4-7 |
| `clear_gap` | Limited direct evidence and a plausible important question remains | 6-9 |
| `unverified` | Search failed or idea is too vague to judge | 3-6 with low confidence |

## Fast-Fail Protocol

When `DEFINITIVE_EVIDENCE_FAST_FAIL` is true and the analysis finds
`already_answered`:

1. Pause before persona reviews if possible.
2. Present the strongest overlapping evidence to the user:
   - Title, year, source, identifier/URL.
   - What overlaps: population, exposure/intervention/predictor, comparator,
     outcome, design.
   - Whether the evidence is definitive or only suggestive.
3. Offer choices:
   - **Proceed**: Continue with overlap noted.
   - **Refine**: Revise the idea to target a real remaining gap.
   - **Abandon**: Stop evaluating this idea.
4. Record the decision in the evidence-gap JSON log.

If the overlap is only crowded or partial, do not fast-fail. Continue with the
gap caveats visible to reviewers.

## Edge Case Handling

| Case | Protocol |
|------|----------|
| Search API failures | Log source/query errors; proceed with available results. If all searches fail, set gap level to `unverified`. |
| Zero relevant records | Set gap level to `clear_gap` only with a caveat about search coverage and idea specificity. |
| Vague idea | Mark missing PICO/PECO elements; avoid claiming a clear gap. |
| Trial exists but no results | Treat as crowded/active, not already answered, unless completed results are available. |
| Guideline already recommends the intervention/test | Usually `already_answered` unless the idea targets a different population, endpoint, implementation context, or mechanism. |
| Systematic review says evidence is insufficient | Usually `partial_gap` or `clear_gap`, depending on whether the proposed design can address the insufficiency. |
| Prediction/AI idea | Check leakage, calibration, external validation, clinical utility, and decision-curve/impact evidence. |
| Omics/biomarker idea | Check validation cohorts, assay feasibility, batch effects, multiple testing, and biological plausibility. |
| Refinement re-run | Re-run evidence-gap verification and save `evidence_gap_report_v{N}.txt` plus `idea_eval_agent_evidence_gap_v{N}.json`. |

## Report Versioning

Initial evaluation:

- `evidence_gap_report.txt`
- `logs/idea_eval_agent_evidence_gap.json`

Refinement iterations:

- `evidence_gap_report_v{N}.txt`
- `logs/idea_eval_agent_evidence_gap_v{N}.json`

Legacy compatibility aliases may also be written:

- `novelty_grounding_report.txt`
- `logs/idea_eval_agent_novelty.json`
