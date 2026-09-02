import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Store,
  UploadCloud,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LOCAL_DATABASE_EXTRACTION_SKILLS } from './chat/constants/localDatabaseExtractionSkills';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/api';
import { ScrollArea } from './ui/scroll-area';
import SkillUploadModal from './SkillUploadModal';
import SkillMarketModal from './SkillMarketModal';
import {
  collectSkillDirectories,
  countSkillNodeFiles,
  findDirectFilePathByName,
  type SkillNode,
} from '../utils/skillsTree';
import {
  DEFAULT_SKILL_WORKFLOW_CATEGORY_KEY,
  SKILL_WORKFLOW_CATEGORY_DEFINITIONS,
  notifySkillWorkflowCategoriesUpdated,
  parseSkillWorkflowCategoryConfig,
  resolveSkillWorkflowCategoryKey,
  type SkillWorkflowCategoryKey,
} from './chat/constants/skillWorkflowCategories';

type SkillTagType = 'workflow' | 'intent' | 'capability' | 'domain' | 'source' | 'stage' | 'meta';

type SkillTag = {
  label: string;
  type: SkillTagType;
};

type LocaleKey = 'zh' | 'en';

type LocalizedLabel = {
  zh: string;
  en: string;
};

type SkillTagMappingFile = {
  stageOverrides?: Record<string, LocalizedLabel>;
  categoryOverrides?: Record<string, LocalizedLabel>;
  domainOverrides?: Record<string, LocalizedLabel>;
  customTags?: Record<string, string[]>;
  platformNativeSkills?: string[];
};

type SkillTagMapping = {
  stageOverrides: Record<string, LocalizedLabel>;
  categoryOverrides: Record<string, LocalizedLabel>;
  domainOverrides: Record<string, LocalizedLabel>;
  customTags: Record<string, string[]>;
  platformNativeSkills: Set<string>;
};

type SkillSummary = {
  name: string;
  dirPath: string;
  summary: string;
  fullDescription: string;
  tags: SkillTag[];
  hasSkillMd: boolean;
  taxonomy: SkillTaxonomyRecord | null;
};

type SkillRelation = {
  dirPath: string;
  name: string;
  reason: string;
  score: number;
};

type SkillExplorerSeed = SkillSummary & {
  primaryIntentKey: string;
  primaryIntentLabel: string;
  intentLabels: string[];
  capabilityKeys: string[];
  capabilityLabels: string[];
  domainKeys: string[];
  domainLabels: string[];
  keywordLabels: string[];
  primaryDomainKey: string;
  primaryDomainLabel: string;
  sourceKey: string;
  sourceLabel: string;
  owner?: string;
  legacyCollectionLabel: string;
  legacyGroupLabel: string;
  searchText: string;
  relatedSkillNames: string[];
  workflowCategoryKey: SkillWorkflowCategoryKey;
  workflowCategoryLabel: string;
  workflowCategoryIcon: string;
};

type SkillExplorerItem = SkillExplorerSeed & {
  relatedSkills: SkillRelation[];
};

type SkillCatalogV2Record = {
  name: string;
  primaryIntent: string;
  intents: string[];
  capabilities: string[];
  domains: string[];
  keywords?: string[];
  source: string;
  status: string;
  summary: string;
  relatedSkills?: string[];
  owner?: string;
  legacy?: {
    dirPath?: string;
    skillFile?: string;
    topLevelGroup?: string;
    collection?: string;
    domain?: string;
  };
};

type SkillCatalogV2File = {
  skills?: SkillCatalogV2Record[];
};

type SkillTaxonomyFacet = {
  key: string;
  label: string;
};

type SkillTaxonomyRecord = {
  primaryIntent: SkillTaxonomyFacet;
  intents: SkillTaxonomyFacet[];
  capabilities: SkillTaxonomyFacet[];
  domains: SkillTaxonomyFacet[];
  keywords: string[];
  source: SkillTaxonomyFacet;
  relatedSkillNames: string[];
  owner?: string;
  legacyCollectionLabel?: string;
  legacyGroupLabel?: string;
};

const STAGE_RULES: Array<{ test: RegExp; tag: LocalizedLabel }> = [
  { test: /(orchestrator|route|planning|planner)/i, tag: { zh: '阶段: 编排', en: 'Stage: Orchestration' } },
  { test: /(prepare|resource|bootstrap|setup|collect)/i, tag: { zh: '阶段: 资源准备', en: 'Stage: Resource Prep' } },
  { test: /(idea|brainstorm|hypothesis)/i, tag: { zh: '阶段: Idea生成', en: 'Stage: Idea Generation' } },
  { test: /(idea eval|evaluation|quality gate|meta-review)/i, tag: { zh: '阶段: Idea评估', en: 'Stage: Idea Evaluation' } },
  { test: /(survey|reference|literature|search)/i, tag: { zh: '阶段: 文献', en: 'Stage: Literature' } },
  { test: /(experiment|develop|training|implementation|run)/i, tag: { zh: '阶段: 实验开发', en: 'Stage: Experiment Dev' } },
  { test: /(analysis|evaluate|benchmark|metric)/i, tag: { zh: '阶段: 实验分析', en: 'Stage: Analysis' } },
  { test: /(paper|write|publication|report)/i, tag: { zh: '阶段: 论文撰写', en: 'Stage: Paper Writing' } },
  { test: /(reviewer|peer review|manuscript review)/i, tag: { zh: '阶段: 论文评审', en: 'Stage: Paper Review' } },
  { test: /(overleaf|rclone|sync)/i, tag: { zh: '阶段: 发布同步', en: 'Stage: Publication Sync' } },
];

const DOMAIN_RULES: Array<{ test: RegExp; tag: LocalizedLabel }> = [
  { test: /(medical|med|clinical|health|biomed)/i, tag: { zh: '领域: 医疗', en: 'Domain: Medical' } },
  { test: /(vision|image|cv|segmentation|detection)/i, tag: { zh: '领域: 视觉', en: 'Domain: Vision' } },
  { test: /(dataset|benchmark|corpus|data discovery)/i, tag: { zh: '领域: 数据', en: 'Domain: Data' } },
  { test: /(mcp|orchestrator|workflow|tool[- ]?use|automation|multi-agent)/i, tag: { zh: '领域: Agent', en: 'Domain: Agent' } },
];

const EMPTY_TAG_MAPPING: SkillTagMapping = {
  stageOverrides: {},
  categoryOverrides: {},
  domainOverrides: {},
  customTags: {},
  platformNativeSkills: new Set<string>(),
};

const INTENT_LABELS: Record<string, LocalizedLabel> = {
  research: { zh: '调研', en: 'Research' },
  ideation: { zh: '想法生成', en: 'Ideation' },
  data: { zh: '数据处理', en: 'Data' },
  experiment: { zh: '实验开发', en: 'Experiment' },
  training: { zh: '模型训练', en: 'Training' },
  evaluation: { zh: '评测分析', en: 'Evaluation' },
  writing: { zh: '论文与汇报', en: 'Writing' },
  deployment: { zh: '部署集成', en: 'Deployment' },
};

const CAPABILITY_LABELS: Record<string, LocalizedLabel> = {
  'search-retrieval': { zh: '检索搜索', en: 'Search & Retrieval' },
  'research-planning': { zh: '研究规划', en: 'Research Planning' },
  'agent-workflow': { zh: 'Agent 工作流', en: 'Agent Workflow' },
  'data-processing': { zh: '数据处理', en: 'Data Processing' },
  'training-tuning': { zh: '训练与调优', en: 'Training & Tuning' },
  'inference-serving': { zh: '推理与服务', en: 'Inference & Serving' },
  'evaluation-benchmarking': { zh: '评测与基准', en: 'Evaluation & Benchmarking' },
  'prompt-structured-output': { zh: '提示与结构化输出', en: 'Prompt & Structured Output' },
  multimodal: { zh: '多模态', en: 'Multimodal' },
  interpretability: { zh: '可解释性', en: 'Interpretability' },
  'safety-alignment': { zh: '安全与对齐', en: 'Safety & Alignment' },
  'infrastructure-ops': { zh: '基础设施与运维', en: 'Infrastructure & Ops' },
  'visualization-reporting': { zh: '可视化与汇报', en: 'Visualization & Reporting' },
};

const TAXONOMY_DOMAIN_LABELS: Record<string, LocalizedLabel> = {
  general: { zh: '通用', en: 'General' },
  bioinformatics: { zh: '生物信息学', en: 'Bioinformatics' },
  medical: { zh: '医疗', en: 'Medical' },
  vision: { zh: '视觉', en: 'Vision' },
  'data-engineering': { zh: '数据工程', en: 'Data Engineering' },
};

const PATH_GROUP_LABELS: Record<string, string> = {
  agents: 'Agent Frameworks',
  'data-processing': 'Data Processing',
  'distributed-training': 'Distributed Training',
  'emerging-techniques': 'Emerging Techniques',
  evaluation: 'Evaluation',
  'fine-tuning': 'Fine-Tuning',
  'inference-serving': 'Inference Serving',
  infrastructure: 'Infrastructure',
  'mechanistic-interpretability': 'Mechanistic Interpretability',
  mlops: 'MLOps',
  'model-architecture': 'Model Architecture',
  multimodal: 'Multimodal',
  observability: 'Observability',
  optimization: 'Optimization',
  'post-training': 'Post-Training',
  'prompt-engineering': 'Prompt Engineering',
  rag: 'RAG',
  'research-ideation': 'Research Ideation',
  'safety-alignment': 'Safety & Alignment',
  tokenization: 'Tokenization',
};

const SLUG_WORD_LABELS: Record<string, string> = {
  ai: 'AI',
  cv: 'CV',
  fsdp: 'FSDP',
  llm: 'LLM',
  mlops: 'MLOps',
  rag: 'RAG',
  rl: 'RL',
};

const FACET_PREFIX_PATTERN = /^(Domain|Stage|Category|Source|领域|阶段|类别|来源):\s*/i;
const SOURCE_PLATFORM_PATTERN =
  /^(来源: 平台自研|Source: MedHelp|Source: Dr\. Claw|医学自动研究)$/i;

function normalizeSourceKey(value: string) {
  if (value === 'vibelab' || value === 'medhelp') return 'dr-claw';
  return value;
}

function resolveCatalogSourceLabel(record: SkillCatalogV2Record, text: Record<string, string>): string {
  if (record.source === 'medhelp') {
    return text.sourceMedHelp;
  }
  if (record.source === 'vibelab' || record.source === 'dr-claw') {
    return text.sourcePlatformShort;
  }
  return text.sourceImportedShort;
}

const UI_TEXT: Record<LocaleKey, Record<string, string>> = {
  zh: {
    loading: '加载技能中...',
    eyebrow: '共享技能目录',
    title: '技能列表',
    subtitle: '按主意图、技术能力和领域浏览 100+ 技能，而不是把工作流阶段和技术类别混在一起。',
    refresh: '刷新',
    uploadSkill: '上传技能',
    skillMarket: '技能市场',
    noRoots: '当前项目中未找到技能目录。',
    notFoundRoots: '当前工作区未检测到可用技能。',
    noSkills: '暂未检测到技能。创建或关联技能后点击刷新。',
    searchPlaceholder: '搜索技能名、意图、能力、领域或标签...',
    clearSearch: '清除搜索',
    allTags: '全部标签',
    noFilterResult: '当前筛选条件下没有技能，尝试清空搜索词或切换筛选。',
    clickForMore: '点击查看完整描述',
    detailTitle: '技能详情',
    fallbackDesc: 'Skill available, but description could not be extracted from SKILL.md.',
    fallbackNoSkillMd: 'No SKILL.md detected at the root. Contains {{count}} files (likely script- or workflow-based skill).',
    defaultDomain: '领域: 通用',
    sourcePlatform: '来源: 平台自研',
    sourcePlatformShort: '医学自动研究',
    sourceMedHelp: '医学自动研究',
    sourceImportedShort: '导入',
    headerCount: '{{shown}}/{{total}} skills',
    summaryIntents: '{{count}} 个主意图',
    summaryCapabilities: '{{count}} 个技术能力',
    summaryDomains: '{{count}} 个领域',
    quickViews: '快速视图',
    workflowCategories: '工作流分类',
    allWorkflowCategories: '全部工作流分类',
    workflowCategoryField: '工作流分类',
    otherWorkflowCategory: '其他',
    expandSection: '展开',
    collapseSection: '收起',
    allSkills: '全部技能',
    nativeSkills: '医学自动研究',
    communitySkills: '外部导入',
    intents: '主意图',
    capabilities: '技术能力',
    domains: '领域',
    allIntents: '全部主意图',
    allCapabilities: '全部技术能力',
    allDomains: '全部领域',
    clearFilters: '清空筛选',
    results: '结果',
    resultsSummary: '当前显示 {{shown}} 个技能',
    overview: '概览',
    relatedSkills: '相关技能',
    emptySelection: '选择一个技能以查看详情、标签和相关技能。',
    pathField: '路径',
    primaryIntentField: '主意图',
    intentsField: '意图',
    capabilitiesField: '能力',
    domainField: '领域',
    sourceField: '来源',
    ownerField: '维护者',
    legacyField: '旧分类',
    keywordsField: '关键词',
    rawTagsField: '原始标签',
    standaloneGroup: '独立技能',
    noSkillFile: '根目录未检测到 SKILL.md',
    importLocal: '导入本地技能',
    importModalTitle: '从本地目录导入技能',
    scan: '扫描',
    scanning: '扫描中...',
    importSelected: '导入选中',
    importing: '导入中...',
    importSuccess: '成功导入 {{count}} 个技能',
    importSkipped: '已跳过 {{count}} 个已存在的技能',
    noSkillsFound: '未在该目录中发现技能。',
    alreadyImported: '已导入',
    pathLabel: '技能目录路径',
    useInChat: '发送到聊天',
  },
  en: {
    loading: 'Loading skills...',
    eyebrow: 'Shared Skill Catalog',
    title: 'Skills list',
    subtitle: 'Browse 100+ skills by primary intent, capability, and domain instead of mixing workflow stage with technical type.',
    refresh: 'Refresh',
    uploadSkill: 'Upload Skill',
    skillMarket: 'Skill Market',
    noRoots: 'No skill directories found in this project.',
    notFoundRoots: 'No skills are currently available in this workspace.',
    noSkills: 'No skills detected yet. Click Refresh after creating or linking skills.',
    searchPlaceholder: 'Search skills, intents, capabilities, domains, or tags...',
    clearSearch: 'Clear search',
    allTags: 'All Tags',
    noFilterResult: 'No skills match the current filters. Try clearing search or switching filters.',
    clickForMore: 'Click to view full description',
    detailTitle: 'Skill details',
    fallbackDesc: 'Skill available, but description could not be extracted from SKILL.md.',
    fallbackNoSkillMd: 'No SKILL.md detected at the root. Contains {{count}} files (likely script- or workflow-based skill).',
    defaultDomain: 'Domain: General',
    sourcePlatform: 'Source: MedHelp',
    sourcePlatformShort: 'MedHelp',
    sourceMedHelp: 'MedHelp',
    sourceImportedShort: 'Imported',
    headerCount: '{{shown}}/{{total}} skills',
    summaryIntents: '{{count}} primary intents',
    summaryCapabilities: '{{count}} capabilities',
    summaryDomains: '{{count}} domains',
    quickViews: 'Quick Views',
    workflowCategories: 'Workflow Categories',
    allWorkflowCategories: 'All Workflow Categories',
    workflowCategoryField: 'Workflow Category',
    otherWorkflowCategory: 'Other',
    expandSection: 'Expand',
    collapseSection: 'Collapse',
    allSkills: 'All Skills',
    nativeSkills: 'MedHelp',
    communitySkills: 'Imported',
    intents: 'Primary Intent',
    capabilities: 'Capabilities',
    domains: 'Domains',
    allIntents: 'All Intents',
    allCapabilities: 'All Capabilities',
    allDomains: 'All Domains',
    clearFilters: 'Clear Filters',
    results: 'Results',
    resultsSummary: '{{shown}} skills shown',
    overview: 'Overview',
    relatedSkills: 'Related Skills',
    emptySelection: 'Select a skill to inspect its details, tags, and nearby skills.',
    pathField: 'Path',
    primaryIntentField: 'Primary Intent',
    intentsField: 'Intents',
    capabilitiesField: 'Capabilities',
    domainField: 'Domain',
    sourceField: 'Source',
    ownerField: 'Owner',
    legacyField: 'Legacy',
    keywordsField: 'Keywords',
    rawTagsField: 'Raw Tags',
    standaloneGroup: 'Standalone',
    noSkillFile: 'No root SKILL.md found',
    importLocal: 'Import Local Skills',
    importModalTitle: 'Import skills from local directory',
    scan: 'Scan',
    scanning: 'Scanning...',
    importSelected: 'Import Selected',
    importing: 'Importing...',
    importSuccess: 'Successfully imported {{count}} skills',
    importSkipped: 'Skipped {{count}} already-imported skills',
    noSkillsFound: 'No skills found in this directory.',
    alreadyImported: 'Already imported',
    pathLabel: 'Skills directory path',
    useInChat: 'Use in Chat',
  },
};

function resolveLocaleKey(language: string): LocaleKey {
  const normalized = language.toLowerCase();
  if (normalized.startsWith('zh')) return 'zh';
  return 'en';
}

function localize(label: LocalizedLabel, localeKey: LocaleKey): string {
  return label[localeKey] ?? label.en;
}

function getWorkflowCategoryLabel(
  key: SkillWorkflowCategoryKey,
  localeKey: LocaleKey,
  i18n: { t: (key: string, options?: Record<string, unknown>) => string }
): string {
  if (key === 'other') {
    return UI_TEXT[localeKey].otherWorkflowCategory;
  }
  const translationKey = `skillShortcuts.categories.${key}`;
  const translated = i18n.t(translationKey, { ns: 'chat' });
  return translated === translationKey ? key : translated;
}

function getWorkflowCategoryIcon(key: SkillWorkflowCategoryKey): string {
  return SKILL_WORKFLOW_CATEGORY_DEFINITIONS.find((category) => category.key === key)?.icon ?? '📦';
}

function getPrefix(type: 'domain' | 'stage', localeKey: LocaleKey): string {
  if (type === 'domain') {
    if (localeKey === 'zh') return '领域:';
    return 'Domain:';
  }

  if (localeKey === 'zh') return '阶段:';
  return 'Stage:';
}

function compactText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function normalizeSkillKey(input: string): string {
  return compactText(input).toLowerCase();
}

function parseTagMappingFile(payload: unknown): SkillTagMapping {
  if (!payload || typeof payload !== 'object') {
    return EMPTY_TAG_MAPPING;
  }

  const parsed = payload as SkillTagMappingFile;
  const stageOverrides = Object.fromEntries(
    Object.entries(parsed.stageOverrides ?? {}).map(([key, value]) => [normalizeSkillKey(key), value])
  );
  const categoryOverrides = Object.fromEntries(
    Object.entries(parsed.categoryOverrides ?? {}).map(([key, value]) => [normalizeSkillKey(key), value])
  );
  const domainOverrides = Object.fromEntries(
    Object.entries(parsed.domainOverrides ?? {}).map(([key, value]) => [normalizeSkillKey(key), value])
  );
  const customTags = Object.fromEntries(
    Object.entries(parsed.customTags ?? {}).map(([key, value]) => [
      normalizeSkillKey(key),
      Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [],
    ])
  );
  const platformNativeSkills = new Set((parsed.platformNativeSkills ?? []).map((name) => normalizeSkillKey(name)));

  return {
    stageOverrides,
    categoryOverrides,
    domainOverrides,
    customTags,
    platformNativeSkills,
  };
}

function localizeTaxonomyValue(
  type: 'intent' | 'capability' | 'domain',
  key: string,
  localeKey: LocaleKey
): string {
  const source =
    type === 'intent'
      ? INTENT_LABELS
      : type === 'capability'
        ? CAPABILITY_LABELS
        : TAXONOMY_DOMAIN_LABELS;

  const label = source[key];
  if (label) {
    return localize(label, localeKey);
  }

  return humanizeSlug(key);
}

function buildTaxonomyTags(taxonomy: SkillTaxonomyRecord, metaTags: string[]): SkillTag[] {
  const tags: SkillTag[] = [];
  const pushTag = (label: string, type: SkillTagType) => {
    if (!tags.some((tag) => tag.label === label && tag.type === type)) {
      tags.push({ label, type });
    }
  };

  pushTag(taxonomy.primaryIntent.label, 'intent');
  taxonomy.capabilities.forEach((facet) => pushTag(facet.label, 'capability'));
  taxonomy.domains.forEach((facet) => pushTag(facet.label, 'domain'));
  pushTag(taxonomy.source.label, 'source');
  [...taxonomy.keywords, ...metaTags].slice(0, 4).forEach((label) => pushTag(label, 'meta'));

  return tags;
}

const LOCAL_DATABASE_EXTRACTION_SKILL_IDS = new Set<string>([...LOCAL_DATABASE_EXTRACTION_SKILLS]);

function isLocalDatabaseExtractionSkillId(skillName: string, dirPath: string): boolean {
  const dir = compactText(dirPath);
  if (LOCAL_DATABASE_EXTRACTION_SKILL_IDS.has(skillName)) {
    return true;
  }
  if (dir && LOCAL_DATABASE_EXTRACTION_SKILL_IDS.has(dir)) {
    return true;
  }
  return false;
}

function isLocalDatabaseExtractionCatalogRecord(record: SkillCatalogV2Record): boolean {
  return isLocalDatabaseExtractionSkillId(record.name, record.legacy?.dirPath ?? '');
}

function parseSkillCatalogV2(payload: unknown, localeKey: LocaleKey, text: Record<string, string>): Map<string, SkillTaxonomyRecord> {
  const catalog = payload as SkillCatalogV2File;
  const records = Array.isArray(catalog?.skills) ? catalog.skills : [];
  const result = new Map<string, SkillTaxonomyRecord>();

  for (const record of records) {
    const treatAsMedAutoResearch = isLocalDatabaseExtractionCatalogRecord(record);
    const taxonomy: SkillTaxonomyRecord = {
      primaryIntent: {
        key: record.primaryIntent,
        label: localizeTaxonomyValue('intent', record.primaryIntent, localeKey),
      },
      intents: (record.intents?.length ? record.intents : [record.primaryIntent]).map((value) => ({
        key: value,
        label: localizeTaxonomyValue('intent', value, localeKey),
      })),
      capabilities: (record.capabilities ?? []).map((value) => ({
        key: value,
        label: localizeTaxonomyValue('capability', value, localeKey),
      })),
      domains: (record.domains ?? []).map((value) => ({
        key: value,
        label: localizeTaxonomyValue('domain', value, localeKey),
      })),
      keywords: Array.isArray(record.keywords) ? record.keywords.map((value) => compactText(String(value))).filter(Boolean) : [],
      source: {
        key: treatAsMedAutoResearch ? 'dr-claw' : normalizeSourceKey(record.source),
        label: treatAsMedAutoResearch ? text.sourceMedHelp : resolveCatalogSourceLabel(record, text),
      },
      relatedSkillNames: Array.isArray(record.relatedSkills) ? record.relatedSkills : [],
      owner: record.owner,
      legacyCollectionLabel: record.legacy?.collection,
      legacyGroupLabel: record.legacy?.topLevelGroup,
    };

    const legacyDirPath = compactText(record.legacy?.dirPath ?? '');
    if (legacyDirPath) {
      result.set(legacyDirPath, taxonomy);
    }

    result.set(record.name, taxonomy);
  }

  return result;
}

function clampText(input: string, maxLength = 240): string {
  const text = compactText(input);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function parseYamlInlineArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return [];
  }

  return trimmed
    .slice(1, -1)
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function parseFrontmatterTags(lines: string[], localeKey: LocaleKey): SkillTag[] {
  const tags: SkillTag[] = [];
  const pushTag = (label: string, type: SkillTagType = 'meta') => {
    const normalized = compactText(label);
    if (normalized) {
      tags.push({ label: normalized, type });
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const keyMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!keyMatch) continue;

    const key = keyMatch[1].toLowerCase();
    const rawValue = keyMatch[2].trim();

    if (key === 'tags') {
      if (!rawValue) {
        for (let j = i + 1; j < lines.length; j += 1) {
          const listMatch = lines[j].match(/^\s*[-*]\s*(.+)$/);
          if (!listMatch) break;
          pushTag(listMatch[1], 'meta');
          i = j;
        }
      } else {
        const inlineArray = parseYamlInlineArray(rawValue);
        if (inlineArray.length > 0) {
          inlineArray.forEach((tag) => pushTag(tag, 'meta'));
        } else {
          rawValue.split(',').forEach((tag) => pushTag(tag, 'meta'));
        }
      }
    }

    if (key === 'domain') {
      rawValue.split(',').forEach((tag) => {
        const trimmed = tag.trim();
        const lowered = trimmed.toLowerCase();
        if (lowered === 'nlp' || lowered === 'cs / ai' || lowered === 'cs-ai') return;
        pushTag(`${getPrefix('domain', localeKey)} ${trimmed}`, 'domain');
      });
    }

    if (key === 'stage') {
      rawValue.split(',').forEach((tag) => pushTag(`${getPrefix('stage', localeKey)} ${tag.trim()}`, 'stage'));
    }
  }

  return tags;
}

function parseDescriptionFromFrontmatter(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const keyMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!keyMatch) continue;

    const key = keyMatch[1];
    const rawValue = keyMatch[2].trim();
    if (key !== 'description') continue;

    if (/^(>|>-|\||\|-)$/.test(rawValue)) {
      const blockLines: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const candidate = lines[j];
        if (/^[A-Za-z0-9_-]+\s*:/.test(candidate)) {
          break;
        }
        const cleaned = candidate.replace(/^\s+/, '');
        if (cleaned) blockLines.push(cleaned);
      }
      const blockSummary = compactText(blockLines.join(' '));
      if (blockSummary) {
        return blockSummary;
      }
    } else if (rawValue) {
      const inlineSummary = compactText(rawValue.replace(/^['"]|['"]$/g, ''));
      if (inlineSummary) {
        return inlineSummary;
      }
    }

    break;
  }

  return null;
}

function extractBodyDescription(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !line.startsWith('#'));

  return lines.join('\n').replace(/^[\-*+]\s+/gm, '').trim();
}

function inferTags(
  skillName: string,
  summary: string,
  explicitTags: SkillTag[],
  localeKey: LocaleKey,
  mapping: SkillTagMapping
): SkillTag[] {
  const inferred: SkillTag[] = [...explicitTags];
  const push = (label: string, type: SkillTagType) => {
    if (!inferred.some((tag) => tag.label === label)) {
      inferred.push({ label, type });
    }
  };

  const signal = `${skillName} ${summary}`;
  const normalizedSkillName = normalizeSkillKey(skillName);
  const hasStage = inferred.some((tag) => tag.type === 'stage');
  const hasDomain = inferred.some((tag) => tag.type === 'domain');
  const nativeSkillSet = mapping.platformNativeSkills;

  if (!hasStage) {
    const stageOverride = mapping.stageOverrides[normalizedSkillName];
    if (stageOverride) {
      push(localize(stageOverride, localeKey), 'stage');
    } else if (nativeSkillSet.has(normalizedSkillName)) {
      for (const rule of STAGE_RULES) {
        if (rule.test.test(signal)) {
          push(localize(rule.tag, localeKey), 'stage');
          break;
        }
      }
    }
  }

  const categoryOverride = mapping.categoryOverrides[normalizedSkillName];
  if (categoryOverride) {
    push(localize(categoryOverride, localeKey), 'stage');
  }

  if (!hasDomain) {
    const domainOverride = mapping.domainOverrides[normalizedSkillName];
    if (domainOverride) {
      push(localize(domainOverride, localeKey), 'domain');
    } else {
      for (const rule of DOMAIN_RULES) {
        if (rule.test.test(signal)) {
          push(localize(rule.tag, localeKey), 'domain');
        }
      }
    }
  }

  if (!inferred.some((tag) => tag.type === 'domain')) {
    push(UI_TEXT[localeKey].defaultDomain, 'domain');
  }

  if (nativeSkillSet.has(normalizedSkillName)) {
    push(UI_TEXT[localeKey].sourcePlatform, 'meta');
  }

  for (const customTag of mapping.customTags[normalizedSkillName] || []) {
    push(customTag, 'meta');
  }

  return inferred;
}

function extractSkillMetadata(
  content: string,
  localeKey: LocaleKey
): { summary: string | null; fullDescription: string | null; tags: SkillTag[] } {
  const normalized = content.replace(/\r\n/g, '\n');
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  const frontmatterLines = frontmatterMatch ? frontmatterMatch[1].split('\n') : [];

  const fmDescription = parseDescriptionFromFrontmatter(frontmatterLines);
  const bodyDescription = extractBodyDescription(normalized);
  const fullDescription = fmDescription || bodyDescription || null;
  const summary = fullDescription ? clampText(fullDescription) : null;
  const tags = parseFrontmatterTags(frontmatterLines, localeKey);

  return { summary, fullDescription, tags };
}

function isSourcePlatformTag(label: string): boolean {
  return SOURCE_PLATFORM_PATTERN.test(label);
}

function stripFacetPrefix(label: string): string {
  return label.replace(FACET_PREFIX_PATTERN, '').trim();
}

function humanizeSlug(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => SLUG_WORD_LABELS[part.toLowerCase()] ?? `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function getTopLevelGroup(dirPath: string, standaloneLabel: string): { key: string; label: string } {
  const segments = dirPath.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return { key: 'standalone', label: standaloneLabel };
  }

  const key = segments[0];
  return {
    key,
    label: PATH_GROUP_LABELS[key] ?? humanizeSlug(key),
  };
}

function tagStyleClass(type: SkillTagType, label?: string): string {
  if (type === 'workflow') {
    return 'border-sky-300/70 bg-sky-50 text-sky-800 shadow-sm dark:border-sky-500/60 dark:bg-sky-950/35 dark:text-sky-200';
  }
  if (type === 'source' || (label && isSourcePlatformTag(label))) {
    return 'border-emerald-300/80 bg-emerald-50 text-emerald-800 shadow-sm dark:border-emerald-500/60 dark:bg-emerald-900/30 dark:text-emerald-200';
  }
  if (type === 'intent') {
    return 'border-emerald-300/60 bg-emerald-50 text-emerald-700 dark:border-emerald-600/60 dark:bg-emerald-950/40 dark:text-emerald-200';
  }
  if (type === 'capability') {
    return 'border-green-300/60 bg-green-50 text-green-700 dark:border-green-600/60 dark:bg-green-950/40 dark:text-green-200';
  }
  if (type === 'stage') {
    if (label && /^(Category:|类别:)/.test(label)) {
      return 'border-green-300/60 bg-green-50 text-green-700 dark:border-green-600/60 dark:bg-green-950/40 dark:text-green-200';
    }
    return 'border-teal-300/60 bg-teal-50 text-teal-700 dark:border-teal-600/60 dark:bg-teal-950/40 dark:text-teal-200';
  }
  if (type === 'domain') {
    return 'border-emerald-300/60 bg-emerald-50 text-emerald-700 dark:border-emerald-600/60 dark:bg-emerald-950/40 dark:text-emerald-200';
  }
  return 'border-slate-300/60 bg-slate-50 text-slate-700 dark:border-slate-600/60 dark:bg-slate-900/60 dark:text-slate-200';
}

function getTagPriority(tag: SkillTag): number {
  if (tag.type === 'workflow') return 0;
  if (isSourcePlatformTag(tag.label)) return 0;
  if (tag.type === 'intent') return 1;
  if (tag.type === 'capability') return 2;
  if (tag.type === 'domain') return 3;
  if (tag.type === 'source') return 4;
  if (tag.type === 'stage') return 5;
  return 6;
}

function sortSkillTags(tags: SkillTag[]): SkillTag[] {
  return [...tags].sort((a, b) => {
    const priorityDiff = getTagPriority(a) - getTagPriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return a.label.localeCompare(b.label);
  });
}

function scoreSkillMatch(skill: SkillExplorerItem, query: string): number {
  const terms = compactText(query).toLowerCase().split(' ').filter(Boolean);
  if (terms.length === 0) {
    return 0;
  }

  let score = 0;
  const name = skill.name.toLowerCase();
  const path = skill.dirPath.toLowerCase();
  const primaryIntent = skill.primaryIntentLabel.toLowerCase();
  const capabilities = skill.capabilityLabels.join(' ').toLowerCase();
  const domain = skill.primaryDomainLabel.toLowerCase();
  const summary = skill.summary.toLowerCase();

  for (const term of terms) {
    if (name === term) score += 140;
    if (name.startsWith(term)) score += 80;
    if (name.includes(term)) score += 55;
    if (path.includes(term)) score += 35;
    if (primaryIntent.includes(term)) score += 28;
    if (capabilities.includes(term)) score += 24;
    if (domain.includes(term)) score += 18;
    if (summary.includes(term)) score += 12;
    if (skill.tags.some((tag) => tag.label.toLowerCase().includes(term))) score += 10;
  }

  if (terms.every((term) => skill.searchText.includes(term))) {
    score += 25;
  }

  return score;
}

function sortSkillsForBrowse(items: SkillExplorerItem[]): SkillExplorerItem[] {
  return [...items].sort((a, b) =>
    a.primaryIntentLabel.localeCompare(b.primaryIntentLabel)
    || a.name.localeCompare(b.name)
  );
}

function buildExplorerSkills(
  skills: SkillSummary[],
  options: {
    standaloneLabel: string;
    defaultDomainLabel: string;
    sourcePlatformShort: string;
    sourceImportedShort: string;
    workflowAssignments: Map<string, SkillWorkflowCategoryKey>;
    workflowCategoryLabels: Record<SkillWorkflowCategoryKey, string>;
  }
): SkillExplorerItem[] {
  const seeds: SkillExplorerSeed[] = skills.map((skill) => {
    const fallbackTags = sortSkillTags(skill.tags);
    const topLevelGroup = getTopLevelGroup(skill.dirPath, options.standaloneLabel);
    const primaryStageTag = fallbackTags.find((tag) => tag.type === 'stage');
    const primaryDomainTag = fallbackTags.find((tag) => tag.type === 'domain');
    const collectionLabel = stripFacetPrefix(primaryStageTag?.label ?? topLevelGroup.label);
    const primaryDomainLabel = stripFacetPrefix(primaryDomainTag?.label ?? options.defaultDomainLabel);
    const taxonomy = skill.taxonomy;
    const isLocalDbExtraction = isLocalDatabaseExtractionSkillId(skill.name, skill.dirPath);
    const fallbackSourceKey =
      isLocalDbExtraction || fallbackTags.some((tag) => isSourcePlatformTag(tag.label)) ? 'dr-claw' : 'imported';
    const fallbackDomainKey = primaryDomainTag ? `domain:${normalizeSkillKey(primaryDomainLabel)}` : 'domain:general';
    const fallbackCapabilities = topLevelGroup.key === 'standalone'
      ? []
      : [{ key: `legacy:${topLevelGroup.key}`, label: topLevelGroup.label }];
    const intentLabel = taxonomy?.primaryIntent.label ?? collectionLabel;
    const sourceLabel = taxonomy?.source.label ?? (fallbackSourceKey === 'dr-claw' ? options.sourcePlatformShort : options.sourceImportedShort);
    const domains = taxonomy?.domains ?? [{ key: fallbackDomainKey, label: primaryDomainLabel }];
    const capabilities = taxonomy?.capabilities ?? fallbackCapabilities;
    const tags = taxonomy
      ? sortSkillTags(buildTaxonomyTags(taxonomy, fallbackTags.filter((tag) => tag.type === 'meta').map((tag) => tag.label)))
      : fallbackTags;
    const workflowCategoryKey = resolveSkillWorkflowCategoryKey({
      name: skill.name,
      dirPath: skill.dirPath,
      summary: skill.summary,
      tags: [
        ...fallbackTags.map((tag) => tag.label),
        ...(taxonomy?.capabilities ?? []).map((facet) => facet.key),
        ...(taxonomy?.domains ?? []).map((facet) => facet.key),
        taxonomy?.primaryIntent.key ?? '',
      ],
      assignments: options.workflowAssignments,
    });
    const workflowCategoryLabel = options.workflowCategoryLabels[workflowCategoryKey] ?? options.workflowCategoryLabels.other;
    const workflowCategoryIcon = getWorkflowCategoryIcon(workflowCategoryKey);

    return {
      ...skill,
      tags,
      primaryIntentKey: taxonomy?.primaryIntent.key ?? `legacy:${normalizeSkillKey(collectionLabel)}`,
      primaryIntentLabel: intentLabel,
      intentLabels: (taxonomy?.intents ?? [{ key: `legacy:${normalizeSkillKey(collectionLabel)}`, label: collectionLabel }]).map((facet) => facet.label),
      capabilityKeys: capabilities.map((facet) => facet.key),
      capabilityLabels: capabilities.map((facet) => facet.label),
      domainKeys: domains.map((facet) => facet.key),
      domainLabels: domains.map((facet) => facet.label),
      keywordLabels: taxonomy?.keywords ?? fallbackTags.filter((tag) => tag.type === 'meta').map((tag) => tag.label),
      primaryDomainKey: domains[0]?.key ?? fallbackDomainKey,
      primaryDomainLabel: domains[0]?.label ?? primaryDomainLabel,
      sourceKey: taxonomy?.source.key ?? fallbackSourceKey,
      sourceLabel,
      owner: taxonomy?.owner,
      legacyCollectionLabel: taxonomy?.legacyCollectionLabel ?? collectionLabel,
      legacyGroupLabel: taxonomy?.legacyGroupLabel ?? topLevelGroup.label,
      relatedSkillNames: taxonomy?.relatedSkillNames ?? [],
      workflowCategoryKey,
      workflowCategoryLabel,
      workflowCategoryIcon,
      searchText: compactText([
        skill.name,
        skill.dirPath,
        skill.summary,
        workflowCategoryLabel,
        intentLabel,
        capabilities.map((facet) => facet.label).join(' '),
        domains.map((facet) => facet.label).join(' '),
        sourceLabel,
        ...tags.map((tag) => tag.label),
      ].join(' ')).toLowerCase(),
    };
  });

  const seedByName = new Map(seeds.map((skill) => [skill.name, skill]));

  return seeds.map((skill) => {
    const inferReason = (other: SkillExplorerSeed): string => {
      const sharedCapability = skill.capabilityLabels.find((label) => other.capabilityLabels.includes(label));
      if (sharedCapability) return sharedCapability;
      const sharedDomain = skill.domainLabels.find((label) => other.domainLabels.includes(label));
      if (sharedDomain) return sharedDomain;
      const sharedIntent = skill.intentLabels.find((label) => other.intentLabels.includes(label));
      if (sharedIntent) return sharedIntent;
      if (skill.sourceKey === other.sourceKey) return skill.sourceLabel;
      return other.primaryIntentLabel;
    };

    const explicitRelated = skill.relatedSkillNames
      .map((name, index) => {
        const other = seedByName.get(name);
        if (!other || other.dirPath === skill.dirPath) {
          return null;
        }

        return {
          dirPath: other.dirPath,
          name: other.name,
          reason: inferReason(other),
          score: 100 - index,
        };
      })
      .filter((relation): relation is SkillRelation => relation !== null);

    const heuristicRelated = seeds
      .filter((other) => other.dirPath !== skill.dirPath)
      .map((other) => {
        let score = 0;
        let reason = '';

        if (skill.primaryIntentKey === other.primaryIntentKey) {
          score += 6;
          reason = skill.primaryIntentLabel;
        }

        const sharedCapabilities = skill.capabilityLabels.filter((label) => other.capabilityLabels.includes(label));
        if (sharedCapabilities.length > 0) {
          score += 4;
          if (!reason) {
            reason = sharedCapabilities[0];
          }
        }

        const sharedDomains = skill.domainLabels.filter((label) => other.domainLabels.includes(label));
        if (sharedDomains.length > 0) {
          score += 3;
          if (!reason) {
            reason = sharedDomains[0];
          }
        }

        const sharedMetaTags = skill.tags.filter(
          (tag) => tag.type === 'meta' && other.tags.some((otherTag) => otherTag.label === tag.label)
        );
        if (sharedMetaTags.length > 0) {
          score += Math.min(sharedMetaTags.length, 2);
          if (!reason) {
            reason = sharedMetaTags[0].label;
          }
        }

        if (score === 0 && skill.sourceKey === other.sourceKey) {
          score = 1;
          reason = skill.sourceLabel;
        }

        if (score === 0) {
          return null;
        }

        return {
          dirPath: other.dirPath,
          name: other.name,
          reason,
          score,
        };
      })
      .filter((relation): relation is SkillRelation => relation !== null)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 6);

    const relatedSkills = explicitRelated.length > 0
      ? explicitRelated
      : heuristicRelated;

    return {
      ...skill,
      relatedSkills,
    };
  });
}

function facetButtonClass(active: boolean): string {
  return `flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
    active
      ? 'border-border bg-muted text-foreground shadow-sm dark:bg-muted/50'
      : 'border-border/70 bg-background text-foreground hover:bg-muted/60'
  }`;
}

function buildSkillCardTagSummary(skill: SkillExplorerItem): { tags: Array<{ label: string; type: SkillTagType }>; hiddenCount: number } {
  const tags: Array<{ label: string; type: SkillTagType }> = [
    { label: `${skill.workflowCategoryIcon} ${skill.workflowCategoryLabel}`, type: 'workflow' },
    { label: skill.primaryIntentLabel, type: 'intent' },
    ...skill.capabilityLabels.slice(0, 1).map((label) => ({ label, type: 'capability' as SkillTagType })),
    ...skill.domainLabels.slice(0, 1).map((label) => ({ label, type: 'domain' as SkillTagType })),
  ];

  const hiddenCount = Math.max(skill.intentLabels.length - 1, 0)
    + Math.max(skill.capabilityLabels.length - 1, 0)
    + Math.max(skill.domainLabels.length - 1, 0);

  return { tags, hiddenCount };
}

function FilterCollapsible({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: typeof Sparkles;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2.5 select-none [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{title}</span>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="pb-3">{children}</div>
    </details>
  );
}

type SkillsDashboardProps = {
  projectName?: string | null;
  onSendToChat?: (command: string) => void;
  onSkillsCountChange?: (count: number) => void;
  embedded?: boolean;
};

type SkillsCacheEntry = {
  skills: SkillSummary[];
  hasSkillRoots: boolean;
  workflowAssignments: Map<string, SkillWorkflowCategoryKey>;
};

const skillsCache = new Map<LocaleKey, SkillsCacheEntry>();

function readSkillsCache(localeKey: LocaleKey): SkillsCacheEntry | null {
  return skillsCache.get(localeKey) ?? null;
}

function writeSkillsCache(localeKey: LocaleKey, entry: SkillsCacheEntry) {
  skillsCache.set(localeKey, entry);
}

function clearSkillsCache() {
  skillsCache.clear();
}

export default function SkillsDashboard({ projectName, onSendToChat, onSkillsCountChange, embedded = false }: SkillsDashboardProps = {}) {
  const { i18n } = useTranslation();
  const { token } = useAuth() as { token: string | null };
  const localeKey = useMemo(() => resolveLocaleKey(i18n.language || 'en'), [i18n.language]);
  const text = UI_TEXT[localeKey];
  const cachedSkills = readSkillsCache(localeKey);
  const previousTokenRef = useRef(token);
  const emptyRootRetryRef = useRef(false);

  const [loading, setLoading] = useState(!cachedSkills);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillSummary[]>(cachedSkills?.skills ?? []);
  const [hasSkillRoots, setHasSkillRoots] = useState(cachedSkills?.hasSkillRoots ?? true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeWorkflowCategory, setActiveWorkflowCategory] = useState<SkillWorkflowCategoryKey | 'all'>('all');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPath, setImportPath] = useState('~/.claude/skills');
  const [scanLoading, setScanLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [scannedSkills, setScannedSkills] = useState<Array<{ name: string; hasSkillMd: boolean; alreadyImported: boolean }>>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showMarketModal, setShowMarketModal] = useState(false);
  const [workflowAssignments, setWorkflowAssignments] = useState<Map<string, SkillWorkflowCategoryKey>>(new Map());

  const loadSkills = useCallback(async (forceRefresh = false) => {
    const cached = readSkillsCache(localeKey);
    if (cached && !forceRefresh) {
      setSkills(cached.skills);
      setHasSkillRoots(cached.hasSkillRoots);
      setWorkflowAssignments(cached.workflowAssignments ?? new Map());
      setError(null);
      setLoading(false);
      onSkillsCountChange?.(cached.skills.length);
      return;
    }

    setLoading(skills.length === 0);
    setRefreshing(skills.length > 0);
    setError(null);

    try {
      let tagMapping = EMPTY_TAG_MAPPING;
      try {
        const mappingResponse = await api.readGlobalSkillFile('skill-tag-mapping.json');
        if (mappingResponse.ok) {
          const mappingPayload = await mappingResponse.json();
          const mappingContent = mappingPayload?.content ?? '';
          tagMapping = parseTagMappingFile(JSON.parse(mappingContent));
        }
      } catch {
        tagMapping = EMPTY_TAG_MAPPING;
      }

      let nextWorkflowAssignments = new Map<string, SkillWorkflowCategoryKey>();
      try {
        const workflowResponse = await api.readGlobalSkillFile('skill-workflow-categories.json');
        if (workflowResponse.ok) {
          const workflowPayload = await workflowResponse.json();
          const workflowContent = workflowPayload?.content ?? '';
          nextWorkflowAssignments = parseSkillWorkflowCategoryConfig(JSON.parse(workflowContent || '{}')).assignments;
        }
      } catch {
        nextWorkflowAssignments = new Map<string, SkillWorkflowCategoryKey>();
      }
      setWorkflowAssignments(nextWorkflowAssignments);

      let taxonomyMap = new Map<string, SkillTaxonomyRecord>();
      let catalogRecordMap = new Map<string, SkillCatalogV2Record>();
      try {
        const catalogResponse = await api.readGlobalSkillFile('skills-catalog-v2.json');
        if (catalogResponse.ok) {
          const catalogPayload = await catalogResponse.json();
          const catalogContent = catalogPayload?.content ?? '';
          const catalog = JSON.parse(catalogContent || '{}') as SkillCatalogV2File;
          taxonomyMap = parseSkillCatalogV2(catalog, localeKey, text);
          for (const record of catalog.skills ?? []) {
            if (record.legacy?.dirPath) {
              catalogRecordMap.set(record.legacy.dirPath, record);
            }
            catalogRecordMap.set(record.name, record);
          }
        }
      } catch {
        taxonomyMap = new Map<string, SkillTaxonomyRecord>();
        catalogRecordMap = new Map<string, SkillCatalogV2Record>();
      }

      const treeResponse = await api.getGlobalSkills();
      if (!treeResponse.ok) {
        if (treeResponse.status === 404) {
          writeSkillsCache(localeKey, { skills: [], hasSkillRoots: false, workflowAssignments: nextWorkflowAssignments });
          setHasSkillRoots(false);
          setSkills([]);
          onSkillsCountChange?.(0);
          return;
        }
        throw new Error(`Failed to load global skills (${treeResponse.status})`);
      }

      const responseContentType = treeResponse.headers.get('content-type') || '';
      if (!responseContentType.includes('application/json')) {
        throw new Error('Skills API returned non-JSON response. Please restart the backend and try again.');
      }

      const treeNodes = (await treeResponse.json()) as SkillNode[];
      const skillDirs = collectSkillDirectories(treeNodes);
      const skillsRoot = treeNodes.length > 0 && treeNodes[0].path
        ? treeNodes[0].path.replace(/[/\\][^/\\]+$/, '')
        : '';
      const normalizedSkillsRoot = skillsRoot.replace(/\\/g, '/');

      const extractedSkills = await Promise.all(
        skillDirs.map(async (node) => {
          const hasSkillMd = Boolean(findDirectFilePathByName(node, 'SKILL.md'));
          const skillName = node.name;
          const normalizedNodePath = node.path.replace(/\\/g, '/');

          let dirPath = skillName;
          if (normalizedSkillsRoot && normalizedNodePath.startsWith(`${normalizedSkillsRoot}/`)) {
            dirPath = normalizedNodePath.slice(normalizedSkillsRoot.length + 1);
          }

          let summary = '';
          let fullDescription = '';
          let tags: SkillTag[] = [];
          let taxonomy: SkillTaxonomyRecord | null = null;

          taxonomy = taxonomyMap.get(dirPath) ?? taxonomyMap.get(skillName) ?? null;

          if (hasSkillMd) {
            try {
              const fileResponse = await api.readGlobalSkillFile(`${dirPath}/SKILL.md`);
              if (fileResponse.ok) {
                const payload = await fileResponse.json();
                const parsed = extractSkillMetadata(payload.content || '', localeKey);
                summary = parsed.summary || '';
                fullDescription = parsed.fullDescription || '';
                tags = parsed.tags;
              }
            } catch {
              // Fallback summary below.
            }
          }

          if (!summary) {
            const catalogRecord = catalogRecordMap.get(dirPath) ?? catalogRecordMap.get(skillName);
            if (catalogRecord?.summary) {
              summary = catalogRecord.summary;
              fullDescription = catalogRecord.summary;
            }
          }

          if (!summary) {
            const fileCount = countSkillNodeFiles(node);
            summary = hasSkillMd
              ? text.fallbackDesc
              : text.fallbackNoSkillMd.replace('{{count}}', String(fileCount));
          }

          if (!fullDescription) {
            fullDescription = summary;
          }

          if (taxonomy) {
            tags = buildTaxonomyTags(taxonomy, tags.filter((tag) => tag.type === 'meta').map((tag) => tag.label));
          } else {
            tags = inferTags(skillName, summary, tags, localeKey, tagMapping);
          }

          return {
            name: skillName,
            dirPath,
            summary,
            fullDescription,
            tags,
            hasSkillMd,
            taxonomy,
          };
        })
      );

      const nextSkills = extractedSkills.sort((a, b) => a.name.localeCompare(b.name));
      const nextHasSkillRoots = skillDirs.length > 0;
      writeSkillsCache(localeKey, {
        skills: nextSkills,
        hasSkillRoots: nextHasSkillRoots,
        workflowAssignments: nextWorkflowAssignments,
      });
      setHasSkillRoots(nextHasSkillRoots);
      setSkills(nextSkills);
      onSkillsCountChange?.(nextSkills.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load skills';
      setError(message);
      if (skills.length === 0) {
        setHasSkillRoots(false);
        setSkills([]);
        onSkillsCountChange?.(0);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [localeKey, onSkillsCountChange, skills.length, text, text.fallbackDesc, text.fallbackNoSkillMd]);

  const handleScanLocal = useCallback(async () => {
    setScanLoading(true);
    setImportMessage(null);
    setScannedSkills([]);
    setSelectedSkills(new Set());
    setHasScanned(false);

    try {
      const response = await api.scanLocalSkills(importPath);
      if (!response.ok) {
        const err = await response.json();
        setImportMessage({ type: 'error', text: err.error || 'Scan failed' });
        return;
      }

      const data = await response.json();
      setScannedSkills(data.skills || []);
      setHasScanned(true);

      const nextSelected = new Set<string>();
      for (const skill of data.skills || []) {
        if (!skill.alreadyImported) {
          nextSelected.add(skill.name);
        }
      }
      setSelectedSkills(nextSelected);
    } catch (err) {
      setImportMessage({ type: 'error', text: err instanceof Error ? err.message : 'Scan failed' });
    } finally {
      setScanLoading(false);
    }
  }, [importPath]);

  const handleImportSelected = useCallback(async () => {
    if (selectedSkills.size === 0) return;

    setImportLoading(true);
    setImportMessage(null);

    try {
      const response = await api.importLocalSkills(importPath, Array.from(selectedSkills), projectName);
      if (!response.ok) {
        const err = await response.json();
        setImportMessage({ type: 'error', text: err.error || 'Import failed' });
        return;
      }

      const data = await response.json();
      const messages: string[] = [];
      if (data.imported?.length > 0) {
        messages.push(text.importSuccess.replace('{{count}}', String(data.imported.length)));
      }
      if (data.skipped?.length > 0) {
        messages.push(text.importSkipped.replace('{{count}}', String(data.skipped.length)));
      }
      if (data.errors?.length > 0) {
        messages.push(`Errors: ${data.errors.join(', ')}`);
      }

      setImportMessage({
        type: data.errors?.length ? 'error' : 'success',
        text: messages.join('. '),
      });

      if (data.imported?.length > 0) {
        const rescan = await api.scanLocalSkills(importPath);
        if (rescan.ok) {
          const rescanData = await rescan.json();
          setScannedSkills(rescanData.skills || []);
          setSelectedSkills(new Set());
        }
        clearSkillsCache();
        notifySkillWorkflowCategoriesUpdated();
        await loadSkills(true);
      }
    } catch (err) {
      setImportMessage({ type: 'error', text: err instanceof Error ? err.message : 'Import failed' });
    } finally {
      setImportLoading(false);
    }
  }, [importPath, loadSkills, selectedSkills, text.importSkipped, text.importSuccess]);

  const openImportModal = useCallback(() => {
    setShowImportModal(true);
    setScannedSkills([]);
    setSelectedSkills(new Set());
    setImportMessage(null);
    setHasScanned(false);
  }, []);

  const handleUploadComplete = useCallback(async () => {
    clearSkillsCache();
    notifySkillWorkflowCategoriesUpdated();
    await loadSkills(true);
  }, [loadSkills]);

  const handleSendSkillToChat = useCallback((skill: SkillExplorerItem) => {
    onSendToChat?.(`/${skill.name}`);
  }, [onSendToChat]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    const previousToken = previousTokenRef.current;
    previousTokenRef.current = token;

    if (token && token !== previousToken) {
      clearSkillsCache();
      emptyRootRetryRef.current = false;
      loadSkills(true).catch(() => {});
    }
  }, [loadSkills, token]);

  useEffect(() => {
    const handleTokenRefreshed = () => {
      clearSkillsCache();
      emptyRootRetryRef.current = false;
      loadSkills(true).catch(() => {});
    };

    window.addEventListener('medhelp-auth-token-refreshed', handleTokenRefreshed);
    return () => {
      window.removeEventListener('medhelp-auth-token-refreshed', handleTokenRefreshed);
    };
  }, [loadSkills]);

  useEffect(() => {
    if (!loading && !error && !hasSkillRoots && !emptyRootRetryRef.current) {
      emptyRootRetryRef.current = true;
      loadSkills(true).catch(() => {});
    }
  }, [error, hasSkillRoots, loadSkills, loading]);

  useEffect(() => {
    setActiveWorkflowCategory('all');
  }, [localeKey]);

  const workflowCategoryLabels = useMemo(
    () => Object.fromEntries(
      SKILL_WORKFLOW_CATEGORY_DEFINITIONS.map((category) => [
        category.key,
        getWorkflowCategoryLabel(category.key, localeKey, i18n),
      ]),
    ) as Record<SkillWorkflowCategoryKey, string>,
    [i18n, localeKey],
  );

  const explorerSkills = useMemo(
    () => buildExplorerSkills(skills, {
      standaloneLabel: text.standaloneGroup,
      defaultDomainLabel: text.defaultDomain,
      sourcePlatformShort: text.sourcePlatformShort,
      sourceImportedShort: text.sourceImportedShort,
      workflowAssignments,
      workflowCategoryLabels,
    }),
    [
      skills,
      text.defaultDomain,
      text.sourceImportedShort,
      text.sourcePlatformShort,
      text.standaloneGroup,
      workflowAssignments,
      workflowCategoryLabels,
    ]
  );

  const workflowCategoryLookup = useMemo(
    () => new Map(SKILL_WORKFLOW_CATEGORY_DEFINITIONS.map((category) => [
      category.key,
      `${category.icon} ${workflowCategoryLabels[category.key]}`,
    ])),
    [workflowCategoryLabels]
  );
  const searchFilteredSkills = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) {
      return sortSkillsForBrowse(explorerSkills);
    }

    return explorerSkills
      .map((skill) => ({ skill, score: scoreSkillMatch(skill, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
      .map((entry) => entry.skill);
  }, [explorerSkills, searchQuery]);

  const workflowCategoryOptions = useMemo(
    () => {
      const counts = new Map<SkillWorkflowCategoryKey, number>();
      const hasOtherSkills = explorerSkills.some(
        (skill) => skill.workflowCategoryKey === DEFAULT_SKILL_WORKFLOW_CATEGORY_KEY,
      );
      for (const skill of searchFilteredSkills) {
        counts.set(skill.workflowCategoryKey, (counts.get(skill.workflowCategoryKey) ?? 0) + 1);
      }

      return SKILL_WORKFLOW_CATEGORY_DEFINITIONS
        .map((category) => ({
          key: category.key,
          label: `${category.icon} ${workflowCategoryLabels[category.key]}`,
          count: counts.get(category.key) ?? 0,
        }))
        .filter((option) => option.key !== DEFAULT_SKILL_WORKFLOW_CATEGORY_KEY || hasOtherSkills);
    },
    [explorerSkills, searchFilteredSkills, workflowCategoryLabels]
  );
  const filteredSkills = useMemo(() => {
    return searchFilteredSkills.filter((skill) => {
      if (activeWorkflowCategory !== 'all' && skill.workflowCategoryKey !== activeWorkflowCategory) return false;
      return true;
    });
  }, [activeWorkflowCategory, searchFilteredSkills]);

  const hasActiveFilters = Boolean(searchQuery.trim())
    || activeWorkflowCategory !== 'all';

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];

    if (activeWorkflowCategory !== 'all') {
      labels.push(`${text.workflowCategoryField}: ${workflowCategoryLookup.get(activeWorkflowCategory) ?? activeWorkflowCategory}`);
    }
    return labels;
  }, [
    activeWorkflowCategory,
    workflowCategoryLookup,
    text.workflowCategoryField,
  ]);

  const headerSummary = useMemo(() => {
    if (!hasSkillRoots) return text.noRoots;
    return text.headerCount
      .replace('{{shown}}', String(filteredSkills.length))
      .replace('{{total}}', String(skills.length));
  }, [filteredSkills.length, hasSkillRoots, skills.length, text.headerCount, text.noRoots]);

  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setActiveWorkflowCategory('all');
  }, []);

  if (loading && skills.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {text.loading}
      </div>
    );
  }

  return (
    <div className={embedded ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'flex h-full min-h-0 flex-col overflow-hidden bg-background'}>
      <div className={embedded
        ? 'flex h-full min-h-0 w-full flex-col overflow-hidden'
        : 'mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col overflow-hidden p-4 sm:p-6'}>
        {error && (
          <div className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
            {error}
          </div>
        )}

        {!hasSkillRoots && !error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            <span>{text.notFoundRoots}</span>
            <button
              type="button"
              onClick={() => loadSkills(true)}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
              {text.refresh}
            </button>
          </div>
        )}

        {hasSkillRoots && skills.length === 0 && !error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            <span>{text.noSkills}</span>
            <button
              type="button"
              onClick={() => loadSkills(true)}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
              {text.refresh}
            </button>
          </div>
        )}

        {skills.length > 0 && (
          <div className={embedded
            ? 'grid h-full min-h-0 overflow-hidden rounded-2xl border border-border/70 bg-card/95 lg:grid-cols-[280px_minmax(0,1fr)] lg:divide-x lg:divide-border/70'
            : 'grid min-h-[620px] overflow-hidden rounded-2xl border border-border/70 bg-card/95 lg:h-[min(calc(100vh-14rem),900px)] lg:grid-cols-[280px_minmax(0,1fr)] lg:divide-x lg:divide-border/70'}>
            <aside className="flex min-h-0 flex-col overflow-hidden">
              <div className="shrink-0 space-y-3 border-b border-border/70 px-4 py-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    {text.eyebrow}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">{text.title}</h3>
                    <span className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                      {headerSummary}
                    </span>
                  </div>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={text.searchPlaceholder}
                    className="h-8 w-full rounded-lg border border-border/60 bg-background pl-8 pr-8 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted"
                      aria-label={text.clearSearch}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {text.clearFilters}
                  </button>
                )}
              </div>

              <ScrollArea className="panel-scroll-area sidebar-scroll-area min-h-0 flex-1">
              <div className="space-y-1 p-3">
              <FilterCollapsible title={text.workflowCategories} icon={Sparkles} defaultOpen>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setActiveWorkflowCategory('all')}
                    className={facetButtonClass(activeWorkflowCategory === 'all')}
                  >
                    <span>{text.allWorkflowCategories}</span>
                    <span className="text-xs text-muted-foreground">{searchFilteredSkills.length}</span>
                  </button>
                  {workflowCategoryOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setActiveWorkflowCategory(option.key as SkillWorkflowCategoryKey)}
                      className={facetButtonClass(activeWorkflowCategory === option.key)}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.count}</span>
                    </button>
                  ))}
                </div>
              </FilterCollapsible>

              </div>
              </ScrollArea>
            </aside>

            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
              <div className="shrink-0 border-b border-border/70 p-5">
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">{text.results}</p>
                <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <h3 className="break-words text-xl font-semibold leading-tight text-foreground">{headerSummary}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {text.resultsSummary.replace('{{shown}}', String(filteredSkills.length))}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 lg:items-end">
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <button
                        type="button"
                        onClick={() => setShowMarketModal(true)}
                        className="inline-flex items-center gap-2 rounded-xl border border-sky-400/70 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800 shadow-sm transition-colors hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:bg-sky-900/50"
                      >
                        <Store className="h-3.5 w-3.5" />
                        {text.skillMarket}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowUploadModal(true)}
                        className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
                      >
                        <UploadCloud className="h-3.5 w-3.5" />
                        {text.uploadSkill}
                      </button>
                      <button
                        type="button"
                        onClick={openImportModal}
                        className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {text.importLocal}
                      </button>
                      <button
                        type="button"
                        onClick={() => loadSkills(true)}
                        disabled={refreshing}
                        className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                        {text.refresh}
                      </button>
                    </div>
                    {activeFilterLabels.length > 0 && (
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {activeFilterLabels.map((label) => (
                          <span
                            key={label}
                            className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {filteredSkills.length === 0 && (
                <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
                  {text.noFilterResult}
                </div>
              )}

              {filteredSkills.length > 0 && (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="panel-scroll-area min-h-0 flex-1 overflow-y-auto divide-y divide-border/60">
                    {filteredSkills.map((skill) => {
                      const { tags: cardTags, hiddenCount } = buildSkillCardTagSummary(skill);
                      return (
                        <div
                          key={skill.dirPath}
                          className="flex w-full items-start justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/40"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="break-all text-sm font-semibold text-foreground">{skill.name}</h4>
                              {cardTags.map((tag) => (
                                <span
                                  key={`${skill.dirPath}-${tag.type}-${tag.label}`}
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tagStyleClass(tag.type, tag.label)}`}
                                >
                                  {tag.label}
                                </span>
                              ))}
                              {hiddenCount > 0 && (
                                <span className="inline-flex items-center rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                  +{hiddenCount}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{`skills/${skill.dirPath}`}</p>
                            <p
                              className="mt-3 text-sm leading-6 text-muted-foreground"
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {skill.summary}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSendSkillToChat(skill)}
                            disabled={!onSendToChat}
                            className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                            {text.useInChat}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setShowImportModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{text.importModalTitle}</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">{text.pathLabel}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={importPath}
                  onChange={(e) => setImportPath(e.target.value)}
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-border"
                  placeholder="~/.claude/skills"
                />
                <button
                  onClick={handleScanLocal}
                  disabled={scanLoading || !importPath.trim()}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {scanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {scanLoading ? text.scanning : text.scan}
                </button>
              </div>
            </div>

            {importMessage && (
              <div className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                {importMessage.text}
              </div>
            )}

            {hasScanned && scannedSkills.length === 0 && (
              <div className="mb-4 rounded-md border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                {text.noSkillsFound}
              </div>
            )}

            {scannedSkills.length > 0 && (
              <div className="mb-4 max-h-[40vh] overflow-auto rounded-lg border border-border/70">
                {scannedSkills.map((skill) => (
                  <label
                    key={skill.name}
                    className={`flex items-center gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0 transition-colors ${skill.alreadyImported ? 'opacity-60' : 'cursor-pointer hover:bg-muted/50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSkills.has(skill.name)}
                      disabled={skill.alreadyImported}
                      onChange={(e) => {
                        const next = new Set(selectedSkills);
                        if (e.target.checked) {
                          next.add(skill.name);
                        } else {
                          next.delete(skill.name);
                        }
                        setSelectedSkills(next);
                      }}
                      className="rounded border-border"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-foreground">{skill.name}</span>
                      <div className="mt-0.5 flex items-center gap-2">
                        {skill.hasSkillMd && (
                          <span className="text-[11px] text-muted-foreground">SKILL.md</span>
                        )}
                        {skill.alreadyImported && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Check className="h-3 w-3" />
                            {text.alreadyImported}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {scannedSkills.length > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={handleImportSelected}
                  disabled={importLoading || selectedSkills.size === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {importLoading ? text.importing : `${text.importSelected} (${selectedSkills.size})`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showUploadModal && (
        <SkillUploadModal
          projectName={projectName}
          existingTags={[]}
          onClose={() => setShowUploadModal(false)}
          onUploadComplete={handleUploadComplete}
        />
      )}

      {showMarketModal && (
        <SkillMarketModal
          projectName={projectName}
          onClose={() => setShowMarketModal(false)}
          onSkillsChanged={handleUploadComplete}
        />
      )}
    </div>
  );
}
