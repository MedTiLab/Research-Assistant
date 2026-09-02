import { MEDICAL_LITERATURE_REVIEW_DEFAULT_SKILLS } from './medicalLiteratureReviewSkills';
import {
  LOCAL_DATABASE_ANALYSIS_SKILLS,
  LOCAL_DATABASE_EXTRACTION_SKILLS,
} from './localDatabaseExtractionSkills';

export interface GuidedPromptScenario {
  id: string;
  icon: string;
  titleKey: string;
  descriptionKey: string;
  skills: string[];
  autoRoutePromptKey?: string;
}

export interface ChatQuickActionGroup {
  id: 'evidence' | 'design' | 'visual' | 'writing' | 'daily' | 'news' | 'create';
  titleKey: string;
  scenarioIds: string[];
}

export const CHAT_QUICK_ACTION_GROUPS: ChatQuickActionGroup[] = [
  {
    id: 'daily',
    titleKey: 'guidedStarter.groups.daily',
    scenarioIds: ['today-tasks', 'reply-advisor'],
  },
  {
    id: 'news',
    titleKey: 'guidedStarter.groups.news',
    scenarioIds: ['watch-news'],
  },
  {
    id: 'evidence',
    titleKey: 'guidedStarter.groups.evidence',
    scenarioIds: [
      'research-ideation',
      'search-literature',
      'download-literature',
      'read-paper',
      'paper-card',
      'verify-references',
      'deep-research',
      'research-insights',
    ],
  },
  {
    id: 'design',
    titleKey: 'guidedStarter.groups.design',
    scenarioIds: ['research-design', 'database-extraction', 'data-analysis', 'experiment-log'],
  },
  {
    id: 'visual',
    titleKey: 'guidedStarter.groups.visual',
    scenarioIds: ['scientific-figure', 'mechanism-diagram', 'graphical-abstract-quick', 'mind-map'],
  },
  {
    id: 'writing',
    titleKey: 'guidedStarter.groups.writing',
    scenarioIds: [
      'writing-assistant',
      'make-presentation',
      'submit-manuscript',
      'review-manuscript',
      'statistics-audit',
      'reply-reviewers',
      'proposal-writing',
      'paper-to-patent',
    ],
  },
  {
    id: 'create',
    titleKey: 'guidedStarter.groups.create',
    scenarioIds: ['create-knowledge-base', 'create-skill', 'create-program', 'create-automation'],
  },
];

/**
 * Compact actions shown directly below an empty chat composer.
 * Keep these focused on frequent user intents; the larger research workflow
 * library remains available from the skill dropdown.
 */
export const CHAT_QUICK_ACTION_SCENARIOS: GuidedPromptScenario[] = [
  {
    id: 'today-tasks',
    icon: '✅',
    titleKey: 'guidedStarter.scenarios.todayTasks.title',
    descriptionKey: 'guidedStarter.scenarios.todayTasks.description',
    skills: ['medhelp-workbench-review'],
  },
  {
    id: 'reply-advisor',
    icon: '💬',
    titleKey: 'guidedStarter.scenarios.replyAdvisor.title',
    descriptionKey: 'guidedStarter.scenarios.replyAdvisor.description',
    skills: ['medhelp-humanizer'],
  },
  {
    id: 'research-ideation',
    icon: '💡',
    titleKey: 'guidedStarter.scenarios.researchIdeation.title',
    descriptionKey: 'guidedStarter.scenarios.researchIdeation.description',
    skills: ['medhelp-idea-generation', 'medhelp-idea-eval'],
  },
  {
    id: 'search-literature',
    icon: '🔎',
    titleKey: 'guidedStarter.scenarios.searchLiterature.title',
    descriptionKey: 'guidedStarter.scenarios.searchLiterature.description',
    skills: ['nature-academic-search', 'literature-review', 'paper-finder', 'pubmed-database', 'real-literature-trace'],
  },
  {
    id: 'download-literature',
    icon: '📥',
    titleKey: 'guidedStarter.scenarios.downloadLiterature.title',
    descriptionKey: 'guidedStarter.scenarios.downloadLiterature.description',
    skills: [
      'legal-pdf-acquisition',
      'public-literature-download',
      'research-paper-downloader',
      'paper-download',
      'meta-zotero-fulltext-handoff',
      'zotero-medautodata-library',
      'mineru-pdf-parser',
      'nature-downloader',
    ],
  },
  {
    id: 'read-paper',
    icon: '📖',
    titleKey: 'guidedStarter.scenarios.readPaper.title',
    descriptionKey: 'guidedStarter.scenarios.readPaper.description',
    skills: ['nature-reader', 'paper-analyzer', 'paper-image-extractor', 'pdf'],
  },
  {
    id: 'paper-card',
    icon: '🗒️',
    titleKey: 'guidedStarter.scenarios.paperCard.title',
    descriptionKey: 'guidedStarter.scenarios.paperCard.description',
    skills: ['nature-paper-card', 'paper-analyzer'],
  },
  {
    id: 'verify-references',
    icon: '🔗',
    titleKey: 'guidedStarter.scenarios.verifyReferences.title',
    descriptionKey: 'guidedStarter.scenarios.verifyReferences.description',
    skills: ['nature-ref-verifier', 'nature-citation', 'citation-management', 'medhelp-reference-audit'],
  },
  {
    id: 'deep-research',
    icon: '🌐',
    titleKey: 'guidedStarter.scenarios.deepResearch.title',
    descriptionKey: 'guidedStarter.scenarios.deepResearch.description',
    skills: ['medhelp-deep-research', 'academic-researcher', 'literature-review'],
  },
  {
    id: 'writing-assistant',
    icon: '✍️',
    titleKey: 'guidedStarter.scenarios.writingAssistant.title',
    descriptionKey: 'guidedStarter.scenarios.writingAssistant.description',
    skills: [
      'nature-polishing',
      'medhelp-humanizer',
      'citation-management',
      'nature-citation',
      'scientific-writing',
      'nature-writing',
      'medhelp-paper-writing',
    ],
  },
  {
    id: 'make-presentation',
    icon: '🖥️',
    titleKey: 'guidedStarter.scenarios.makePresentation.title',
    descriptionKey: 'guidedStarter.scenarios.makePresentation.description',
    skills: ['nature-paper2ppt', 'making-academic-presentations', 'scientific-slides', 'pptx'],
  },
  {
    id: 'data-analysis',
    icon: '📊',
    titleKey: 'guidedStarter.scenarios.dataAnalysis.title',
    descriptionKey: 'guidedStarter.scenarios.dataAnalysis.description',
    skills: [
      'nature-statistics',
      'exploratory-data-analysis',
      'baseline-table',
      'clinical-preanalysis',
      ...LOCAL_DATABASE_ANALYSIS_SKILLS,
      'data-stats-analysis',
      'statistical-analysis',
      'statsmodels',
    ],
  },
  {
    id: 'research-design',
    icon: '🧪',
    titleKey: 'guidedStarter.scenarios.researchDesign.title',
    descriptionKey: 'guidedStarter.scenarios.researchDesign.description',
    skills: ['clinical-preanalysis', 'statistical-analysis', 'medhelp-pipeline-planner'],
  },
  {
    id: 'database-extraction',
    icon: '🗂️',
    titleKey: 'guidedStarter.scenarios.databaseExtraction.title',
    descriptionKey: 'guidedStarter.scenarios.databaseExtraction.description',
    skills: ['medhelp-database-api-access', 'data-transform'],
  },
  {
    id: 'experiment-log',
    icon: '🧾',
    titleKey: 'guidedStarter.scenarios.experimentLog.title',
    descriptionKey: 'guidedStarter.scenarios.experimentLog.description',
    skills: ['nature-experiment-log'],
  },
  {
    id: 'submit-manuscript',
    icon: '📨',
    titleKey: 'guidedStarter.scenarios.submitManuscript.title',
    descriptionKey: 'guidedStarter.scenarios.submitManuscript.description',
    skills: ['nature-writing', 'nature-data', 'nature-citation', 'nature-ref-verifier', 'venue-templates', 'medhelp-paper-writing', 'citation-management', 'medhelp-reference-audit'],
  },
  {
    id: 'proposal-writing',
    icon: '📝',
    titleKey: 'guidedStarter.scenarios.proposalWriting.title',
    descriptionKey: 'guidedStarter.scenarios.proposalWriting.description',
    skills: ['nature-proposal-writer', 'medhelp-grant-proposal', 'research-grants'],
  },
  {
    id: 'paper-to-patent',
    icon: '💡',
    titleKey: 'guidedStarter.scenarios.paperToPatent.title',
    descriptionKey: 'guidedStarter.scenarios.paperToPatent.description',
    skills: ['nature-paper-to-patent'],
  },
  {
    id: 'review-manuscript',
    icon: '🧐',
    titleKey: 'guidedStarter.scenarios.reviewManuscript.title',
    descriptionKey: 'guidedStarter.scenarios.reviewManuscript.description',
    skills: ['nature-reviewer', 'medhelp-paper-reviewer', 'peer-review'],
  },
  {
    id: 'statistics-audit',
    icon: '📐',
    titleKey: 'guidedStarter.scenarios.statisticsAudit.title',
    descriptionKey: 'guidedStarter.scenarios.statisticsAudit.description',
    skills: ['nature-statistics', 'statistical-analysis', 'medhelp-paper-reviewer'],
  },
  {
    id: 'reply-reviewers',
    icon: '↩️',
    titleKey: 'guidedStarter.scenarios.replyReviewers.title',
    descriptionKey: 'guidedStarter.scenarios.replyReviewers.description',
    skills: ['nature-response', 'nature-polishing', 'nature-statistics', 'citation-management'],
  },
  {
    id: 'scientific-figure',
    icon: '📈',
    titleKey: 'guidedStarter.scenarios.scientificFigure.title',
    descriptionKey: 'guidedStarter.scenarios.scientificFigure.description',
    skills: ['nature-figure', 'data-visualization-biomedical', 'scientific-visualization', 'r-graph-selector'],
  },
  {
    id: 'mechanism-diagram',
    icon: '🧬',
    titleKey: 'guidedStarter.scenarios.mechanismDiagram.title',
    descriptionKey: 'guidedStarter.scenarios.mechanismDiagram.description',
    skills: ['nature-figure', 'scientific-schematics', 'academic-figure-prompt', 'medhelp-figure-gen'],
  },
  {
    id: 'graphical-abstract-quick',
    icon: '🖼️',
    titleKey: 'guidedStarter.scenarios.graphicalAbstractQuick.title',
    descriptionKey: 'guidedStarter.scenarios.graphicalAbstractQuick.description',
    skills: ['nature-figure', 'medhelp-figure-gen', 'scientific-schematics', 'scientific-visualization'],
  },
  {
    id: 'mind-map',
    icon: '🧠',
    titleKey: 'guidedStarter.scenarios.mindMap.title',
    descriptionKey: 'guidedStarter.scenarios.mindMap.description',
    skills: ['scientific-schematics'],
  },
  {
    id: 'create-knowledge-base',
    icon: '📚',
    titleKey: 'guidedStarter.scenarios.createKnowledgeBase.title',
    descriptionKey: 'guidedStarter.scenarios.createKnowledgeBase.description',
    skills: ['markitdown', 'chroma'],
  },
  {
    id: 'research-insights',
    icon: '📡',
    titleKey: 'guidedStarter.scenarios.researchInsights.title',
    descriptionKey: 'guidedStarter.scenarios.researchInsights.description',
    skills: ['nature-literature-pipeline', 'research-news', 'biorxiv-database', 'pubmed-database'],
  },
  {
    id: 'watch-news',
    icon: '📰',
    titleKey: 'guidedStarter.scenarios.watchNews.title',
    descriptionKey: 'guidedStarter.scenarios.watchNews.description',
    skills: [],
  },
  {
    id: 'create-skill',
    icon: '🧩',
    titleKey: 'guidedStarter.scenarios.createSkill.title',
    descriptionKey: 'guidedStarter.scenarios.createSkill.description',
    skills: ['skill-creator'],
  },
  {
    id: 'create-program',
    icon: '💻',
    titleKey: 'guidedStarter.scenarios.createProgram.title',
    descriptionKey: 'guidedStarter.scenarios.createProgram.description',
    skills: ['publish', 'taste-skill', 'popular-web-designs'],
  },
  {
    id: 'create-automation',
    icon: '⏱️',
    titleKey: 'guidedStarter.scenarios.createAutomation.title',
    descriptionKey: 'guidedStarter.scenarios.createAutomation.description',
    skills: [],
  },
];

export const GUIDED_PROMPT_SCENARIOS: GuidedPromptScenario[] = [
  {
    id: 'start-full-project',
    icon: '🚀',
    titleKey: 'guidedStarter.scenarios.startFullProject.title',
    descriptionKey: 'guidedStarter.scenarios.startFullProject.description',
    skills: ['medhelp-pipeline-planner', 'academic-researcher', 'medhelp-idea-generation'],
  },
  {
    id: 'paper-reproduction',
    icon: '📄',
    titleKey: 'guidedStarter.scenarios.paperReproduction.title',
    descriptionKey: 'guidedStarter.scenarios.paperReproduction.description',
    skills: ['medhelp-deep-research', 'academic-researcher', 'citation-management', 'medhelp-paper-reviewer'],
  },
  {
    id: 'literature-survey',
    icon: '🔎',
    titleKey: 'guidedStarter.scenarios.literatureSurvey.title',
    descriptionKey: 'guidedStarter.scenarios.literatureSurvey.description',
    skills: [...MEDICAL_LITERATURE_REVIEW_DEFAULT_SKILLS],
  },
  {
    id: 'database-access',
    icon: '🗂️',
    titleKey: 'guidedStarter.scenarios.databaseAccess.title',
    descriptionKey: 'guidedStarter.scenarios.databaseAccess.description',
    skills: [...LOCAL_DATABASE_EXTRACTION_SKILLS],
  },
  {
    id: 'research-idea',
    icon: '💡',
    titleKey: 'guidedStarter.scenarios.researchIdea.title',
    descriptionKey: 'guidedStarter.scenarios.researchIdea.description',
    skills: ['medhelp-idea-generation', 'medhelp-idea-eval', 'hypothesis-generation', 'scientific-brainstorming', 'academic-researcher'],
  },
  {
    id: 'pre-analysis',
    icon: '🩺',
    titleKey: 'guidedStarter.scenarios.preAnalysis.title',
    descriptionKey: 'guidedStarter.scenarios.preAnalysis.description',
    skills: [
      'clinical-preanalysis',
      'baseline-table',
      'data-transform',
      'exploratory-data-analysis',
      ...LOCAL_DATABASE_ANALYSIS_SKILLS,
      'statistical-analysis',
      'statsmodels',
      'scikit-survival',
    ],
  },
  {
    id: 'statistical-modeling',
    icon: '🧪',
    titleKey: 'guidedStarter.scenarios.statisticalModeling.title',
    descriptionKey: 'guidedStarter.scenarios.statisticalModeling.description',
    autoRoutePromptKey: 'guidedStarter.routePrompts.statisticalModeling',
    skills: [
      'medhelp-experiment-analysis',
      'data-stats-analysis',
      'statistical-analysis',
      'statsmodels',
      'scikit-survival',
      'ukb-cohort-analysis',
      'pymc',
    ],
  },
  {
    id: 'medical-visualization',
    icon: '📈',
    titleKey: 'guidedStarter.scenarios.medicalVisualization.title',
    descriptionKey: 'guidedStarter.scenarios.medicalVisualization.description',
    autoRoutePromptKey: 'guidedStarter.routePrompts.medicalVisualization',
    skills: [
      'data-visualization-biomedical',
      'r-graph-selector',
      'nature-figure',
      'scientific-visualization',
      'data-viz-plots',
      'matplotlib',
      'seaborn',
      'plotly',
    ],
  },
  {
    id: 'results-integration',
    icon: '📋',
    titleKey: 'guidedStarter.scenarios.resultsIntegration.title',
    descriptionKey: 'guidedStarter.scenarios.resultsIntegration.description',
    skills: [
      'medhelp-experiment-analysis',
      'scientific-writing',
      'medhelp-paper-writing',
    ],
  },
  {
    id: 'graphical-abstract',
    icon: '🖼️',
    titleKey: 'guidedStarter.scenarios.graphicalAbstract.title',
    descriptionKey: 'guidedStarter.scenarios.graphicalAbstract.description',
    skills: ['medhelp-figure-gen', 'scientific-schematics', 'scientific-visualization'],
  },
  {
    id: 'paper-writing',
    icon: '✍️',
    titleKey: 'guidedStarter.scenarios.paperWriting.title',
    descriptionKey: 'guidedStarter.scenarios.paperWriting.description',
    skills: [
      'medhelp-paper-writing',
      'scientific-writing',
      'nature-data',
      'literature-review',
      'pubmed-database',
      'real-literature-trace',
      'citation-management',
      'medhelp-humanizer',
    ],
  },
  {
    id: 'paper-polishing',
    icon: '✨',
    titleKey: 'guidedStarter.scenarios.paperPolishing.title',
    descriptionKey: 'guidedStarter.scenarios.paperPolishing.description',
    skills: [
      'nature-polishing',
      'medhelp-humanizer',
      'scientific-writing',
      'citation-management',
      'venue-templates',
    ],
  },
  {
    id: 'manuscript-review',
    icon: '🧾',
    titleKey: 'guidedStarter.scenarios.manuscriptReview.title',
    descriptionKey: 'guidedStarter.scenarios.manuscriptReview.description',
    skills: ['medhelp-paper-reviewer', 'peer-review', 'medhelp-reference-audit', 'citation-management', 'medhelp-humanizer'],
  },
  {
    id: 'rebuttal-response',
    icon: '💬',
    titleKey: 'guidedStarter.scenarios.rebuttalResponse.title',
    descriptionKey: 'guidedStarter.scenarios.rebuttalResponse.description',
    skills: ['medhelp-rebuttal', 'peer-review', 'citation-management'],
  },
  {
    id: 'presentation-promotion',
    icon: '🎬',
    titleKey: 'guidedStarter.scenarios.presentationPromotion.title',
    descriptionKey: 'guidedStarter.scenarios.presentationPromotion.description',
    skills: ['making-academic-presentations', 'paper-2-web', 'scientific-slides', 'pptx-posters'],
  },
  {
    id: 'grant-proposal',
    icon: '📝',
    titleKey: 'guidedStarter.scenarios.grantProposal.title',
    descriptionKey: 'guidedStarter.scenarios.grantProposal.description',
    skills: ['medhelp-grant-proposal', 'academic-researcher', 'citation-management'],
  },
];
