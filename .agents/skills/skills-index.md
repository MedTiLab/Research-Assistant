# Skills Index

> **Do NOT read all SKILL.md files at once.** Use this index to find the right skill, then read only that one.

## Core Pipeline Skills

| Skill | Path | Description |
|-------|------|-------------|
| clinical-preanalysis | `.agents/skills/clinical-preanalysis/SKILL.md` | Run a go/no-go pre-analysis for clinical and epidemiologic database studies before baseline tables or full modeling. ... |
| init-analysis | `.agents/skills/init-analysis/SKILL.md` | This skill should be used when the user asks to "run initial analysis", "analyze single-cell data", "QC my data", "ru... |
| medhelp-deep-research | `.agents/skills/medhelp-deep-research/SKILL.md` | Comprehensive research assistant that synthesizes information from multiple sources with citations. Use for biomedica... |
| medhelp-experiment-analysis | `.agents/skills/medhelp-experiment-analysis/SKILL.md` | Use for analyzing study or pipeline outputs, drafting Results sections, statistical analysis of health data, comparin... |
| medhelp-figure-gen | `.agents/skills/medhelp-figure-gen/SKILL.md` | Generate/edit images with Gemini image models (default: gemini-3.1-flash-image-preview). Use for image create/modify ... |
| medhelp-grant-proposal | `.agents/skills/medhelp-grant-proposal/SKILL.md` | Help professors and researchers write, revise, adapt, and polish grant proposals for US agencies (NSF, NIH, DOE, DARP... |
| medhelp-humanizer | `.agents/skills/medhelp-humanizer/SKILL.md` | Remove signs of AI-generated writing from text. Use when editing or reviewing text to make it sound more natural and ... |
| medhelp-idea-eval | `.agents/skills/medhelp-idea-eval/SKILL.md` | Multi-persona idea evaluation with quality gate. Evaluates ideas across 5 MedEval dimensions (Clarity, Novelty, Vali... |
| medhelp-idea-generation | `.agents/skills/medhelp-idea-generation/SKILL.md` | Facilitates structured brainstorming sessions, conducts comprehensive research, and generates creative solutions usin... |
| medhelp-paper-reviewer | `.agents/skills/medhelp-paper-reviewer/SKILL.md` | Structured manuscript/grant review with checklist-based evaluation. Use when writing formal peer reviews with specifi... |
| medhelp-paper-writing | `.agents/skills/medhelp-paper-writing/SKILL.md` | Creates formal academic research papers following IEEE/ACM formatting standards with proper structure, citations, and... |
| medhelp-pipeline-planner | `.agents/skills/medhelp-pipeline-planner/SKILL.md` | Guides the user through an interactive conversation to define their research project, then generates research_brief.j... |
| medhelp-prepare-resources | `.agents/skills/medhelp-prepare-resources/SKILL.md` | Loads the evaluation instance, searches GitHub for related repositories, builds a dataset description, queries the Pr... |
| medhelp-rclone-to-overleaf | `.agents/skills/medhelp-rclone-to-overleaf/SKILL.md` | Access Overleaf projects via CLI. Use for reading/writing LaTeX files, syncing local .tex files to Overleaf, download... |
| medhelp-reference-audit | `.agents/skills/medhelp-reference-audit/SKILL.md` | This skill provides reference guidance for citation verification in academic writing. Use when the user asks about "c... |

## Library Skills

| Skill | Path | Description |
|-------|------|-------------|
| Academic Figure Prompt | `.agents/skills/library/academic-figure-prompt/SKILL.md` | Use this skill whenever the user wants to generate detailed English prompts for AI image tools (NanoBanana / Gemini /... |
| academic-researcher | `.agents/skills/library/academic-researcher/SKILL.md` | Academic research assistant for literature reviews, paper analysis, and scholarly writing. Use when: reviewing academ... |
| baseline-table | `.agents/skills/library/baseline-table/SKILL.md` | Generate publication-ready baseline characteristic tables (三线表 / Table 1) for medical research. Supports single-datab... |
| biorxiv-database | `.agents/skills/library/biorxiv-database/SKILL.md` | Efficient database search tool for bioRxiv preprint server. Use this skill when searching for life sciences preprints... |
| citation-management | `.agents/skills/library/citation-management/SKILL.md` | Comprehensive citation management for academic research. Search Google Scholar and PubMed for papers, extract accurat... |
| data-stats-analysis | `.agents/skills/library/data-stats-analysis/SKILL.md` | Perform statistical tests, hypothesis testing, correlation analysis, and multiple testing corrections using scipy and... |
| data-transform | `.agents/skills/library/data-transform/SKILL.md` | Transform, clean, reshape, and preprocess data using pandas and numpy. Works with ANY LLM provider (GPT, Gemini, Clau... |
| data-visualization-biomedical | `.agents/skills/library/data-visualization-biomedical/SKILL.md` | Publication-quality visualizations for biomedical and genomics data. Use when creating volcano plots, heatmaps, UMAP ... |
| data-visualization-expert | `.agents/skills/library/data-visualization-expert/SKILL.md` | Generate insightful, publication-quality visualizations from complex datasets. |
| data-viz-plots | `.agents/skills/library/data-viz-plots/SKILL.md` | Create publication-quality plots and visualizations using matplotlib and seaborn. Works with ANY LLM provider (GPT, G... |
| datacommons-client | `.agents/skills/library/datacommons-client/SKILL.md` | Work with Data Commons, a platform providing programmatic access to public statistical data from global sources. Use ... |
| docx | `.agents/skills/library/docx/SKILL.md` | Document toolkit (.docx). Create/edit documents, tracked changes, comments, formatting preservation, text extraction,... |
| docx | `.agents/skills/library/docx/SKILL.md` | Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files). Triggers in... |
| docx-official | `.agents/skills/library/docx-official/SKILL.md` | A user may ask you to create, edit, or analyze the contents of a .docx file. A .docx file is essentially a ZIP archiv... |
| easyukb-analysis | `.agents/skills/library/easyukb-analysis/SKILL.md` | UK Biobank (UKB) data extraction + epidemiological association analysis using the `easyUKB` R package. Use when the u... |
| exploratory-data-analysis | `.agents/skills/library/exploratory-data-analysis/SKILL.md` | Perform comprehensive exploratory data analysis on scientific data files across 200+ file formats. This skill should ... |
| gco-database-analysis | `.agents/skills/library/gco-database-analysis/SKILL.md` | Use the local GCO/GLOBOCAN database for cancer epidemiology analysis. Trigger for tasks involving Global Cancer Obser... |
| geo-database | `.agents/skills/library/geo-database/SKILL.md` | Access NCBI GEO for gene expression/genomics data. Search/download microarray and RNA-seq datasets (GSE, GSM, GPL), r... |
| hypothesis-generation | `.agents/skills/library/hypothesis-generation/SKILL.md` | Structured hypothesis formulation from observations. Use when you have experimental observations or data and need to ... |
| medhelp-experiment-dev | `.agents/skills/library/medhelp-experiment-dev/SKILL.md` | Creates an analysis/implementation plan, builds reproducible code (stats, data pipelines, or ML when needed) with a j... |
| latex-posters | `.agents/skills/library/latex-posters/SKILL.md` | Create professional research posters in LaTeX using beamerposter, tikzposter, or baposter. Support for conference pre... |
| literature-review | `.agents/skills/library/literature-review/SKILL.md` | Conduct comprehensive, systematic literature reviews using multiple academic databases (PubMed, arXiv, bioRxiv, Seman... |
| making-academic-presentations | `.agents/skills/library/making-academic-presentations/SKILL.md` | Create academic presentation slide decks and optionally demo videos from research papers. Use when the user asks to "... |
| markitdown | `.agents/skills/library/markitdown/SKILL.md` | Convert files and office documents to Markdown. Supports PDF, DOCX, PPTX, XLSX, images (with OCR), audio (with transc... |
| matplotlib | `.agents/skills/library/matplotlib/SKILL.md` | Low-level plotting library for full customization. Use when you need fine-grained control over every plot element, cr... |
| mineru-pdf-parser | `.agents/skills/library/mineru-pdf-parser/SKILL.md` | Parse medical research PDFs in MedHelp Meta projects with MinerU into Markdown, tables, figures, page maps, and quali... |
| nature-citation | `.agents/skills/library/nature-citation/SKILL.md` | Add strict Nature/CNS citations to manuscript text by splitting long passages into citable segments, searching only a... |
| nature-data | `.agents/skills/library/nature-data/SKILL.md` | Prepare, audit, or revise Nature-ready Data Availability statements, data repository plans, dataset citations, and FA... |
| nature-figure | `.agents/skills/library/nature-figure/SKILL.md` | Submission-grade Nature/high-impact journal figure workflow for Python or R. Use whenever the user asks to create, re... |
| nature-paper2ppt | `.agents/skills/library/nature-paper2ppt/SKILL.md` | Build a complete but efficient Nature-style Chinese PPTX presentation from a scientific paper, preprint, PDF, article... |
| nature-polishing | `.agents/skills/library/nature-polishing/SKILL.md` | Polish, restructure, or translate academic prose into Nature-leaning English using the paper-architecture and writing... |
| nature-response | `.agents/skills/library/nature-response/SKILL.md` | Draft, audit, or revise point-by-point reviewer response letters for Nature-family manuscript revisions. Use when the... |
| nhanes-skill | `.agents/skills/library/nhanes-skill/SKILL.md` | Use when working with NHANES, National Health and Nutrition Examination Survey, US survey database source through sou... |
| openalex-database | `.agents/skills/library/openalex-database/SKILL.md` | Query and analyze scholarly literature using the OpenAlex database. This skill should be used when searching for acad... |
| paper-analyzer | `.agents/skills/library/paper-analyzer/SKILL.md` | Deep analysis of a single paper — generate structured notes with figures, evaluation, and knowledge graph updates |
| paper-finder | `.agents/skills/library/paper-finder/SKILL.md` | Search existing paper notes by title, author, keyword, or research domain |
| paper-image-extractor | `.agents/skills/library/paper-image-extractor/SKILL.md` | Extract figures from papers — prioritizes arXiv source package for high-quality images |
| pdf | `.agents/skills/library/pdf/SKILL.md` | PDF manipulation toolkit. Extract text/tables, create PDFs, merge/split, fill forms, for programmatic document proces... |
| peer-review | `.agents/skills/library/peer-review/SKILL.md` | Structured manuscript/grant review with checklist-based evaluation. Use when writing formal peer reviews with specifi... |
| plotly | `.agents/skills/library/plotly/SKILL.md` | Interactive visualization library. Use when you need hover info, zoom, pan, or web-embeddable charts. Best for dashbo... |
| pptx | `.agents/skills/library/pptx/SKILL.md` | Presentation toolkit (.pptx). Create/edit slides, layouts, content, speaker notes, comments, for programmatic present... |
| pptx-posters | `.agents/skills/library/pptx-posters/SKILL.md` | Create research posters using HTML/CSS that can be exported to PDF or PPTX. Use this skill ONLY when the user explici... |
| pubmed-database | `.agents/skills/library/pubmed-database/SKILL.md` | Direct REST API access to PubMed. Advanced Boolean/MeSH queries, E-utilities API, batch processing, citation manageme... |
| pymc-bayesian-modeling | `.agents/skills/library/pymc/SKILL.md` | Bayesian modeling with PyMC. Build hierarchical models, MCMC (NUTS), variational inference, LOO/WAIC comparison, post... |
| r-graph-selector | `.agents/skills/library/r-graph-selector/SKILL.md` | Use when the user wants MedHelp or Codex to shortlist R chart examples from the local r-graph-gallery based on figure... |
| Real Literature Trace | `.agents/skills/library/real-literature-trace/SKILL.md` | Use this skill whenever the user wants to search, verify, screen, compare, or organize real academic papers and retur... |
| research-grants | `.agents/skills/library/research-grants/SKILL.md` | Write competitive research proposals for NSF, NIH, DOE, DARPA, and Taiwan NSTC. Agency-specific formatting, review cr... |
| research-lookup | `.agents/skills/library/research-lookup/SKILL.md` | Look up current research information using Perplexity Sonar Pro Search or Sonar Reasoning Pro models through OpenRout... |
| research-news | `.agents/skills/library/research-news/SKILL.md` | Daily paper recommendation workflow — search arXiv and PubMed, score and recommend papers |
| scholar-evaluation | `.agents/skills/library/scholar-evaluation/SKILL.md` | Systematically evaluate scholarly work using the ScholarEval framework, providing structured assessment across resear... |
| scientific-brainstorming | `.agents/skills/library/scientific-brainstorming/SKILL.md` | Creative research ideation and exploration. Use for open-ended brainstorming sessions, exploring interdisciplinary co... |
| scientific-critical-thinking | `.agents/skills/library/scientific-critical-thinking/SKILL.md` | Evaluate scientific claims and evidence quality. Use for assessing experimental design validity, identifying biases a... |
| scientific-schematics | `.agents/skills/library/scientific-schematics/SKILL.md` | Create publication-quality scientific diagrams using Nano Banana Pro AI with smart iterative refinement. Uses Gemini ... |
| scientific-slides | `.agents/skills/library/scientific-slides/SKILL.md` | Build slide decks and presentations for research talks. Use this for making PowerPoint slides, conference presentatio... |
| scientific-visualization | `.agents/skills/library/scientific-visualization/SKILL.md` | Meta-skill for publication-ready figures. Use when creating journal submission figures requiring multi-panel layouts,... |
| scientific-writing | `.agents/skills/library/scientific-writing/SKILL.md` | Core skill for the deep research and writing tool. Write scientific manuscripts in full paragraphs (never bullet poin... |
| scikit-survival | `.agents/skills/library/scikit-survival/SKILL.md` | Comprehensive toolkit for survival analysis and time-to-event modeling in Python using scikit-survival. Use this skil... |
| seaborn | `.agents/skills/library/seaborn/SKILL.md` | Statistical visualization with pandas integration. Use for quick exploration of distributions, relationships, and cat... |
| statistical-analysis | `.agents/skills/library/statistical-analysis/SKILL.md` | Guided statistical analysis with test selection and reporting. Use when you need help choosing appropriate tests for ... |
| statsmodels | `.agents/skills/library/statsmodels/SKILL.md` | Statistical models library for Python. Use when you need specific model classes (OLS, GLM, mixed models, ARIMA) with ... |
| ukb-skill | `.agents/skills/library/ukb-skill/SKILL.md` | Use when working with UKB, UK Biobank, 英国生物银行 database source through source_id ukb in /Users/gaoyuzhen/database. Sea... |
| venue-templates | `.agents/skills/library/venue-templates/SKILL.md` | Access comprehensive LaTeX templates, formatting requirements, and submission guidelines for major scientific publica... |
| xlsx | `.agents/skills/library/xlsx/SKILL.md` | Spreadsheet toolkit (.xlsx/.csv). Create/edit with formulas/formatting, analyze data, visualization, recalculate form... |
