# Meta-Review Query

## Parameters

| Parameter | Source | Description |
|-----------|--------|-------------|
| `persona_1_review` | `Ideation/ideas/eval_persona_1_review.txt` | Medical Domain Reviewer review text |
| `persona_2_review` | `Ideation/ideas/eval_persona_2_review.txt` | Epidemiology and Biostatistics Reviewer review text |
| `persona_3_review` | `Ideation/ideas/eval_persona_3_review.txt` | Implementation and Ethics Reviewer review text |
| `persona_1_scores` | `logs/idea_eval_agent_persona_1.json` | Persona 1 structured scores |
| `persona_2_scores` | `logs/idea_eval_agent_persona_2.json` | Persona 2 structured scores |
| `persona_3_scores` | `logs/idea_eval_agent_persona_3.json` | Persona 3 structured scores |
| `selected_idea` | `Ideation/ideas/selected_idea.txt` | Original medical research idea |

## Conversation Setup

Start a new conversation. Do not reuse any persona review conversation.

System prompt: use `references/eval_agent_instructions.md` with the additional
instruction that this agent acts as a medical research area chair or study-section
chair.

## Template

```text
You are acting as the Area Chair for a medical research idea review process.
Three reviewers independently evaluated the following idea. Synthesize their
reviews, resolve disagreements, and produce a final recommendation.

## Original Medical Research Idea

{selected_idea}

## Reviewer 1: Medical Domain Reviewer
### Scores
{persona_1_scores}
### Full Review
{persona_1_review}

## Reviewer 2: Epidemiology and Biostatistics Reviewer
### Scores
{persona_2_scores}
### Full Review
{persona_2_review}

## Reviewer 3: Implementation and Ethics Reviewer
### Scores
{persona_3_scores}
### Full Review
{persona_3_review}

## Your Task

1. Aggregate scores for all 5 MedEval dimensions.
2. Resolve disagreements where reviewer scores differ by more than 3 points.
3. Identify whether the proposed medical study is worth pursuing now.
4. Separate fatal flaws from fixable issues.
5. Produce a concrete next action.

Decision thresholds:

- Average >= 7.0 -> `strong_accept`
- Average >= 6.0 -> `accept`
- Average >= 5.0 -> `borderline_accept`
- Average >= 4.0 -> `borderline_reject`
- Average < 4.0 -> `reject`

## Required Output Format

### Score Aggregation

| Dimension | Reviewer 1 | Reviewer 2 | Reviewer 3 | Average | Disagreement? |
|-----------|------------|------------|------------|---------|---------------|
| Question Clarity | | | | | |
| Evidence Gap | | | | | |
| Scientific Validity | | | | | |
| Study Design Feasibility | | | | | |
| Impact and Ethics | | | | | |

**Overall Average**: [X.X]

### Disagreement Resolution
[For each dimension with >3 point spread, explain whose assessment is more
justified and why.]

### Fatal Flaws vs Fixable Issues

**Potential Fatal Flaws:**
- [issue or "None identified"]

**Fixable Issues:**
- [issue]

### Synthesized Assessment

**Key Strengths:**
- [strength 1]

**Key Weaknesses:**
- [weakness 1]

**Actionable Suggestions:**
- [suggestion 1]

### Final Decision

**Decision**: [strong_accept / accept / borderline_accept / borderline_reject / reject]
**Rationale**: [2-3 sentences]
**Next Action**: [deep literature review / refine PICO / find dataset / draft protocol / proceed to analysis plan / abandon]
```

## Post-Processing

After receiving the Area Chair response:

1. Parse the score aggregation table.
2. Compute overall average across all dimensions.
3. Extract the final decision string.
4. Build `idea_evaluation_result` for `context_variables`.
5. Determine pipeline action based on the decision and next-action text.
