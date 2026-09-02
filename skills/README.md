# Skills

Skills are structured instruction files (SKILL.md) that tell an AI coding agent (Claude Code, Gemini CLI, etc.) what to do and how to do it. They are NOT standalone scripts — they are prompts/playbooks that an agent reads and follows:

`
Your instruction → Agent → reads SKILL.md → follows the instructions and use Skills
`
# MedHelp® research pipeline skills

Project-scoped skills for **database- and evidence-driven research**, with emphasis on **biomedical and health** workflows: discovery, structured ideation, reproducible analysis pipelines, and publication. Implementation steps still support ML when your question requires it, but defaults assume **cohorts, registries, trial or observational data**, and traceable citations—not generic model leaderboards. Canonical automation hooks remain in the Medical_ai_scientist_idea repo: `run_infer_idea_ours.py` (idea mode) and `run_infer.py` (plan mode).

## Project layout

When a project is **created in MedHelp**, the app creates **`instance.json`** at the project root (single config with **absolute paths**) and these preset directories:

- `Literature/references`, `Literature/reports`
- `Ideation/ideas`, `Ideation/references`
- `Experiment/code_references`, `Experiment/datasets`, `Experiment/core_code`, `Experiment/analysis`, `Experiment/figures`, `Experiment/tables`, `Experiment/attachments`
- `Publication/manuscript`, `Publication/figures`, `Publication/tables`, `Publication/supplementary`
- `Promotion/homepage`, `Promotion/slides`, `Promotion/audio`, `Promotion/video`

Skills read paths from `instance.json` and write logs under each area’s `logs/` as needed.

## Skill taxonomy

17 skills organized by pipeline stage. Depth follows natural structure — sub-groups only where real internal phases exist.

```
skills/
│
├─ Research & Discovery
│  ├─ medhelp-prepare-resources                Setup: load instance, GitHub search, arXiv download
│  ├─ dataset-discovery                     Find and evaluate datasets for a research task
│  ├─ medhelp-code-survey                      Repo acquisition (Phase A) + code survey (Phase B)
│  └─ medhelp-deep-research                    Comprehensive research assistant (multi-source synthesis with citations)
│
├─ Ideation
│  ├─ medhelp-idea-generation                  Structured brainstorming via creative frameworks (SCAMPER, SWOT)
│  └─ medhelp-idea-eval                        Medical research idea evaluation + evidence-gap quality gate
│
├─ Experiment
│  ├─ medhelp-experiment-dev                   Plan → implement (stats/ETL/ML as needed) → judge loop → final run
│  └─ medhelp-experiment-analysis              Clinical/health results: estimation, figures, Results drafting
│
├─ Publication
│  ├─ Authoring
│  │  ├─ medhelp-paper-writing                 Academic paper writing (IEEE/ACM format, citations, structure)
│  │  └─ medhelp-figure-gen                    Image generation via Nano Banana Pro (Gemini 3 Pro Image)
│  ├─ Review & Polish
│  │  ├─ medhelp-paper-reviewer                Structured peer review with checklist-based evaluation
│  │  ├─ medhelp-humanizer                     Rewrite to remove AI-writing markers
│  │  └─ medhelp-reference-audit               Citation verification and fake citation prevention
│  └─ medhelp-rclone-to-overleaf               Access & sync Overleaf projects via CLI
│
├─ Promotion
│  └─ making-academic-presentations         Slides, narration, TTS audio, and demo-video generation
│
└─ Domain-Specific
   ├─ bioinformatics-init-analysis          CyTOF / scRNA-seq / flow cytometry pipeline
   └─ ukb-cohort-analysis                   UK Biobank cohort construction, field mapping, clinical/statistical analysis
```

### Pipeline flow

```
Orchestration ──► Research & Discovery ──► Ideation ──► Experiment ──► Publication ──► Promotion
                  (can enter here if
                   plan already exists) ───────────────────────────────┘ skip if plan branch
```

### Depth rationale

| Group | Depth | Why |
|-------|-------|-----|
| Orchestration | 1 (standalone) | Single entry point, no peers |
| Research & Discovery | 2 | Literature Survey merged into single skill; other skills are independent |
| Ideation | 2 | Two tightly-coupled skills (generate → evaluate), flat is sufficient |
| Experiment | 2 | Two sequential skills (dev → analysis), flat is sufficient |
| Publication | 3 | Authoring vs Review & Polish are distinct concerns with different triggers |
| Promotion | 2 | Presentation and dissemination assets are a separate downstream stage |
| Domain-Specific | 2 | Extensible bucket for specialized research workflows such as single-cell analysis and UKB cohort studies |

> **Note:** Folder structure on disk is still flat (`skills/<skill-name>/`). This taxonomy is a logical grouping for documentation and navigation; `stage-skill-map.json` encodes the runtime mapping used by the Pipeline Board.

## Database Skill Routing

For a local database workspace, the skill layer is organized as **1 API access/router skill + 27 independent source skills**. The access layer is API-first through `medhelp-database-api-access`, with source-specific skills handling direct extraction workflows. The bundled client prefers `https://api.medtimehelp.com` and falls back to a healthy same-host `http://127.0.0.1:8787` only when the public endpoint is unavailable.

| Layer | Skills | Responsibility |
| --- | --- | --- |
| Remote API access | `medhelp-database-api-access` | Use the public `https://api.medtimehelp.com/api/v1` API from another machine with a Bearer `mdpat_*` token; query, build/export datasets, and download CSV outputs without same-host trusted-local assumptions. |
| Standalone extraction | 27 independent skills: `cfps-skill`, `cgss-skill`, `charls-skill`, `class-skill`, `chfs-skill`, `chip-skill`, `chns-skill`, `clds-skill`, `clhls-skill`, `css-skill`, `share-skill`, `hrs-skill`, `elsa-skill`, `klosa-skill`, `lasi-skill`, `mhas-skill`, `ukb-skill`, `nhanes-skill`, `mimiciii-skill`, `mimiciv-skill`, `mimiciv31-skill`, `nwicu-skill`, `eicu-skill`, `sicdb-skill`, `pic-skill`, `inspire-skill`, and `seer-skill` | Use the selected dataset's local indexes and guardrails to find real tables or columns and extract source-backed rows only. |

### Database families

- ICU / hospital EHR with within-stay longitudinal structure: `MIMIC-III`, `MIMIC-IV 1.0`, `MIMIC-IV 3.1`, `NWICU`, `eICU-CRD`, `PIC`
- Prospective biobank and multimodal cohort: `UK Biobank`
- Repeated cross-sectional health survey: `NHANES`
- Aging and longevity longitudinal cohorts: split sources `ELSA`, `HRS`, `KLoSA`, `LASI`, `MHAS`, `SHARE`, plus `CHARLS` and `CLHLS`
- Longitudinal family, labor, nutrition, and health panels: `CHNS`, `CFPS`, `CLDS`
- Repeated or default cross-sectional social, income, finance, and status surveys: `CGSS`, `CHIP`, `CSS`, `CHFS`

### Default handoff flow

- If the user starts from a research question, a concept, or mentions multiple databases, start with `medhelp-database-api-access`.
- If the request is clearly inside the China survey family but the exact dataset is still undecided, use the appropriate API access skill to choose among `CFPS`, `CGSS`, `CHARLS`, `CHFS`, `CHIP`, `CHNS`, `CLDS`, `CLHLS`, and `CSS`, then route directly to the dataset-specific skill before extraction.
- If the user already fixed the source dataset, go directly to the corresponding dataset skill instead of going through the family entry.
- `ELSA`, `HRS`, `KLoSA`, `LASI`, `MHAS`, and `SHARE` route to their own source IDs and skills: `elsa`, `hrs`, `klosa`, `lasi`, `mhas`, and `share`.
- The **`OLDMAN` bundle label** refers to unified six-cohort packaging when present locally; extraction routing still prefers the split cohort skills (`elsa`, `hrs`, `klosa`, `lasi`, `mhas`, `share`). `CHARLS` remains a separate skill and should not be routed through those cohorts.

### Shared extraction contract

- Extraction skills should start from the local `AI_Access` indexes and guardrails instead of searching raw trees first.
- API calls should include `Authorization: Bearer $DATABASE_API_TOKEN` when auth is enabled; if no token is available and the API returns `401`, use direct local fallback instead of stopping.
- Extraction should stay source-backed: only report variables, rows, counts, or values that were actually read from local files.
- Before pulling data, state the main structural warning that matters for interpretation, such as patient vs stay grain, within-stay timeline semantics, panel vs repeated cross-section, household vs individual tables, wave handling, or cycle overlap.
- Extract only the columns needed for the current task and report the exact dataset, file path, variables, and provenance used.

This keeps the per-dataset source skills explicit while making the first routing step easier for AI agents and aligning the top-level README with the database extraction workflow.

## Stage skill map (for Pipeline Board)

- File: `skills/stage-skill-map.json`
- Purpose: Runtime mapping from pipeline stage/task type to recommended skills used by TaskMaster task generation.
- Hot update behavior: Backend reloads this file by mtime, so editing it will update newly generated task recommendations without code changes.

## Skill tag mapping (for Skills panel)

- File: `skills/skill-tag-mapping.json`
- Purpose: Runtime mapping for skill tags shown in the **Skills Dashboard** (stage tags, domain tags, and platform source tag).

### Fields

- `stageOverrides`: Per-skill stage tag override, keyed by skill folder name.
- `domainOverrides`: Per-skill domain tag override, keyed by skill folder name.
- `platformNativeSkills`: Skills that should show the source tag (`来源: 平台自研` / `Source: MedHelp`).
- `domainCsAiExceptions`: Exception list for the global `cs.AI` domain policy.

### Current policy

- For skills in `platformNativeSkills`, domain is forced to `cs.AI`.
- Skills listed in `domainCsAiExceptions` keep their own domain mapping.

### Maintenance notes

- Keep keys exactly the same as skill directory names under `skills/`.
- Prefer updating this JSON instead of editing frontend code when tags change.

### Tag annotation conventions

- `domain`:
  - Prefer following the arXiv taxonomy (for example: `cs.AI`, `cs.CL`, `cs.CV`, `q-bio`).
  - Use the closest primary category for the skill's main capability; avoid overly broad custom names when a standard arXiv label exists.
- `source`:
  - Use two levels:
    - Internal: skills proposed/maintained by MedHelp (`来源: 平台自研` / `Source: MedHelp`).
    - External: skills introduced from outside MedHelp (third-party/community/imported repositories).
  - `platformNativeSkills` should include all internal skills.
- `stage`:
  - Keep stage tags aligned with the pipeline lifecycle. Recommended buckets:
    - Orchestration
    - Resource Prep
    - Idea Generation
    - Idea Evaluation
    - Literature
    - Experiment Dev
    - Analysis
    - Paper Writing
    - Paper Review
    - Publication Sync
    - Promotion Assets
  - Use `stageOverrides` for deterministic mapping when keyword inference is ambiguous.

## Script reuse (plan-scripts-reuse)

- **Call directly (same process / backend)**: All prompt builders (`build_*_query`, `build_*_query_for_plan`) and agents live in the research_agent Python codebase. When the MedHelp backend runs in an environment that can import `research_agent` (e.g. same repo or installed package), call the existing functions and agents directly; do not reimplement logic in SKILL.md.
- **Thin wrappers when needed**: If the backend cannot import the Medical_ai_scientist_idea project, add a thin API or CLI that invokes `run_infer_idea_ours.py` / `run_infer.py` (or a small runner that calls `load_instance`, `github_search`, etc.) and returns structured outputs. Skills then reference "call backend endpoint X" or "run script Y" instead of in-process calls.
- **Critical helpers**: Parsing `[REPO_ACQUIRED]` and scanning `.tex` in `workplace/papers_engineering` are small; either call the existing Python helpers or reimplement in a shared `scripts/` or `medhelp-utils/` folder and document the contract in the relevant SKILL.md (medhelp-code-survey, medhelp-idea-generation). The `github_search_clone.py` script in `medhelp-code-survey/scripts/` provides standalone GitHub repo search + clone.

## Progressive adoption

- **Phase 1**: Skills 1–3 (prepare, idea-generation, code-survey Phase A) for "idea-only" workflows.
- **Phase 2**: Add remaining skills for full pipeline (code survey Phase B → experiment-dev → experiment-analysis).
- **Phase 3**: Paper writing, review, and polish (`medhelp-paper-writing` + `medhelp-paper-reviewer` + `medhelp-humanizer`) for publication-ready deliverables.
- **Phase 4**: Promotion assets (`making-academic-presentations`) for homepage, slide deck, audio, and demo-video outputs.
