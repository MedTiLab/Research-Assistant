# Refinement Feedback Query

## Purpose

When a medical research idea receives `borderline_reject` or `reject`, build
structured feedback that asks the Idea Agent to revise the same idea rather than
generate a new one.

## Parameters

| Parameter | Source | Description |
|-----------|--------|-------------|
| `eval_report` | `Ideation/ideas/eval_report.txt` | Full meta-review report |
| `weaknesses` | Meta-review JSON | Consolidated weaknesses |
| `suggestions` | Meta-review JSON | Consolidated actionable suggestions |
| `selected_idea` | `Ideation/ideas/selected_idea.txt` | Current medical research idea |
| `iteration` | Pipeline state | Current refinement iteration |
| `max_iterations` | Configuration | Maximum refinement iterations, default 2 |

## Conversation Setup

Append this prompt to the original idea-generation conversation. Do not start a
new idea-generation conversation.

## Template

```text
Your previously selected medical research idea was evaluated by a panel of
reviewers. Revise the existing idea to address the feedback below.

IMPORTANT: You are revising the same idea, not generating a new topic. Preserve
the core medical question when possible, but make it more answerable, evidence
grounded, and methodologically valid.

## Current Idea

{selected_idea}

## Evaluation Summary

{eval_report}

## Key Weaknesses to Address

{weaknesses}

## Suggested Improvements

{suggestions}

## Revision Guidelines

1. Specify PICO/PECO elements: population, exposure/intervention/predictor,
   comparator/reference, outcome/endpoint, and time window.
2. Clarify the intended study type and target claim: association, causation,
   prediction, diagnosis, prognosis, mechanism, intervention effect, or
   descriptive burden.
3. Sharpen the evidence gap: explain what prior work has not answered.
4. Improve scientific validity: add biological/clinical rationale and address
   obvious alternative explanations.
5. Improve study design: define data source, inclusion/exclusion criteria,
   covariates, missing-data handling, bias/confounding control, and sensitivity
   analyses where appropriate.
6. Improve feasibility and ethics: note data access, consent/privacy, risks,
   equity, and practical constraints.
7. Keep the revised idea self-contained.

This is refinement iteration {iteration} of {max_iterations}. If a concern
cannot be fixed without changing the topic, state that explicitly.

Output the complete revised idea in the same general format as the original.
```

## Post-Processing

1. Save as `Ideation/ideas/refined_idea_v{iteration}.txt`.
2. Update `selected_idea.txt` with the refined version.
3. Update `context_variables["final_selected_idea_data"]["selected_idea_text"]`
   when present.
4. Re-run evidence-gap verification and evaluation.
5. If still below threshold and iteration is less than `max_iterations`, repeat.
6. If max iterations are reached, present the final report to the user.
