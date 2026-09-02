# Per-Persona Evaluation Query

## Parameters

| Parameter | Source | Description |
|-----------|--------|-------------|
| `persona_name` | `references/reviewer_personas.md` | Reviewer persona name |
| `persona_description` | `references/reviewer_personas.md` | Persona description and priorities |
| `selected_idea` | `Ideation/ideas/selected_idea.txt` | Medical research idea to evaluate |
| `evidence_block` | `prompts/build_evidence_assembly.md` | Persona-filtered evidence |
| `scoring_rubric` | `references/eval_agent_instructions.md` | 5-dimension MedEval scoring rubric |
| `grounded_note` | Pipeline state | Empty if grounded; disclaimer if standalone or unverified |

## Conversation Setup

Start a new conversation for each persona. Do not reuse the idea-generation
conversation and do not show one persona another persona's review.

System prompt: use `references/eval_agent_instructions.md`.

## Template

```text
You are acting as: {persona_name}

{persona_description}

## Medical Research Idea to Evaluate

{selected_idea}

## Available Evidence

{evidence_block}

{grounded_note}

## Evaluation Instructions

Evaluate the idea as a medical research study concept, not as a generic ML/CS
paper. For each dimension, provide:

1. A score from 0-10.
2. A detailed reason for the score in 2-4 sentences.
3. Specific references to the evidence block when available.
4. A confidence note when the evidence is incomplete.

{scoring_rubric}

### Evidence-Gap Use

If an Evidence Gap Report is present, use it as the primary basis for the
Evidence Gap score. Distinguish:

- Questions already answered by strong evidence.
- Crowded questions that still have a differentiable population, endpoint,
  design, or mechanism.
- Partially open questions with unresolved bias/design issues.
- Clear gaps with plausible clinical or biological importance.
- Unverified gaps where searches or artifacts were inadequate.

## Required Output Format

### Dimension Scores

**Question Clarity**: [score]/10
[Reason with evidence references]

**Evidence Gap**: [score]/10
[Reason with evidence references]

**Scientific Validity**: [score]/10
[Reason with evidence references]

**Study Design Feasibility**: [score]/10
[Reason with evidence references]

**Impact and Ethics**: [score]/10
[Reason with evidence references]

### Summary

**Strengths:**
- [strength 1]
- [strength 2]

**Weaknesses:**
- [weakness 1]
- [weakness 2]

**Suggestions for Improvement:**
- [suggestion 1]
- [suggestion 2]

**Overall Recommendation:** [Accept / Borderline Accept / Borderline Reject / Reject]
```

## Post-Processing

After receiving the Eval Agent response:

1. Parse scores from the "Dimension Scores" section.
2. Extract strengths, weaknesses, suggestions, and recommendation.
3. Preserve the complete review text.
4. Build the structured JSON for the persona cache file.
