---
name: conversation-memory
description: Review the current conversation, present durable project-memory candidates through an AskUserQuestion multi-select checkpoint, and merge only approved items into the current project root MEMORY.md. Use when the user asks to remember, summarize, capture, preserve, or update durable context from the current conversation, including preferences, corrections, decisions, constraints, workflows, and project state.
---

# Conversation Memory

Turn durable information from the current conversation into a concise project memory. Keep the entire review and confirmation flow inside the current conversation and store the result only in the current project root `MEMORY.md`.

## Workflow

1. Resolve the current project root. Read its `MEMORY.md` if one exists. Read other project files only when needed to verify a candidate.
2. Review the visible current conversation and extract only durable candidates:
   - Stable user preferences and collaboration rules
   - Confirmed project context, constraints, and decisions
   - Reusable workflows or conventions
   - Corrections, lessons, and cautions worth remembering
   - Confirmed progress or blockers that will matter in later conversations
3. Exclude:
   - One-off requests and ordinary short-lived tasks
   - Assistant guesses, unconfirmed interpretations, and general knowledge
   - Duplicates or facts already clear from the repository
   - Secrets, credentials, tokens, or sensitive personal information unless the user explicitly asks to preserve it
4. If no durable candidates remain, tell the user and stop. Do not create or modify `MEMORY.md`.
5. Before writing, call `AskUserQuestion` in the current conversation:
   - Ask one concise question with `multiSelect: true`.
   - Use the header `Memory`.
   - Offer the 2–4 highest-value candidates as distinct options.
   - Keep labels short. Make each description a self-contained statement of exactly what would be saved.
6. Do not write anything until the user answers. If the user skips the question or selects nothing, make no changes.
7. After confirmation, re-read `MEMORY.md` and merge only the selected candidates:
   - Preserve valid, non-conflicting existing content.
   - Preserve everything between `<!-- medhelp:auto-memory:start -->` and `<!-- medhelp:auto-memory:end -->` byte-for-byte; that section is maintained by automatic capture.
   - Let the newest explicit user instruction replace conflicting older memory.
   - Deduplicate and consolidate related points.
   - Write concise summary bullets in normal Markdown, never JSON.
8. Report the saved file path and the number of items merged.

## Memory File Format

Use this structure and omit empty sections:

```markdown
# Project Memory

## 用户偏好与协作方式 / Preferences and collaboration

## 项目背景与关键决定 / Context and decisions

## 可复用工作流 / Reusable workflows

## 经验与注意事项 / Lessons and cautions

## 已确认进展 / Confirmed progress
```

Store only `MEMORY.md` at the current project root. Do not create a hidden directory, database, JSON sidecar, import pipeline, new task, or new conversation.

For medical variables and indicators, store only verified definitions. Keep each variable and indicator separate, preserve source fields, coding, reference groups, units, formulas, numerator/denominator, time windows, thresholds, transformations, missing-value rules, and cohort/version when explicitly supported. Never complete an absent definition from model knowledge.

## Tool Fallback

If `AskUserQuestion` is unavailable, list the candidates as numbered options in the current conversation and ask the user to select them. Do not write `MEMORY.md` until the user explicitly confirms a selection.
