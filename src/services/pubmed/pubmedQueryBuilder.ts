import type { PubMedDiscoveryOptions } from '../../features/variableKnowledge/pubmedDiscovery/types';
import { getPublicDatabaseAliases } from '../../../shared/publicDatabaseCatalog';

const DEFAULT_VARIABLE_TERMS = [
  'index',
  'score',
  'ratio',
  'biomarker',
  '"derived indicator"',
  '"composite indicator"',
  '"risk score"',
  '"new indicator"',
  '"novel index"',
  '"burden score"',
  '"age gap"',
];
const DEFAULT_STUDY_TERMS = ['cohort', '"cross-sectional"', 'prospective', 'retrospective', 'epidemiology'];
export const PUBMED_SEARCH_RESULT_LIMIT = 100;

function quotePubMedTerm(term: string) {
  const cleaned = String(term || '').trim().replace(/^"+|"+$/g, '');
  if (!cleaned) return '';
  return /[\s-]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

function groupTerms(terms: string[]) {
  const cleaned = terms.map((term) => String(term || '').trim()).filter(Boolean);
  return cleaned.length > 0 ? `(${cleaned.join(' OR ')})` : '';
}

export function buildPubMedVariableDiscoveryQuery(options: PubMedDiscoveryOptions) {
  const databaseTerms = options.databaseFamilies?.length
    ? getPublicDatabaseAliases(options.databaseFamilies).map(quotePubMedTerm)
    : getPublicDatabaseAliases().map(quotePubMedTerm);

  const modeTerms = options.queryMode === 'focused'
    ? [...DEFAULT_VARIABLE_TERMS, '"risk score"', '"composite indicator"', '"novel biomarker"', '"prediction score"']
    : DEFAULT_VARIABLE_TERMS;

  const variableKeyword = options.variableKeyword?.trim();

  return [
    groupTerms(databaseTerms),
    variableKeyword ? quotePubMedTerm(variableKeyword) : groupTerms(modeTerms),
    groupTerms(DEFAULT_STUDY_TERMS),
    options.dateFrom && options.dateTo ? `("${options.dateFrom}"[Date - Publication] : "${options.dateTo}"[Date - Publication])` : '',
  ].filter(Boolean).join(' AND ');
}

export function buildPubMedVariableDiscoveryOptions(
  partial: Partial<PubMedDiscoveryOptions> = {},
): PubMedDiscoveryOptions {
  const today = new Date();
  const dateTo = partial.dateTo || today.toISOString().slice(0, 10);
  const daysBack = partial.frequency === 'daily' ? 1 : 7;
  const from = new Date(today);
  from.setDate(today.getDate() - daysBack);

  return {
    frequency: partial.frequency || 'weekly',
    dateFrom: partial.dateFrom || from.toISOString().slice(0, 10),
    dateTo,
    databaseFamilies: partial.databaseFamilies,
    clinicalDomains: partial.clinicalDomains,
    variableTypes: partial.variableTypes,
    variableKeyword: partial.variableKeyword,
    queryMode: partial.queryMode || 'broad',
  };
}

export function buildPubMedNewsSearchConfig(options: PubMedDiscoveryOptions) {
  const query = buildPubMedVariableDiscoveryQuery(options);
  const selectedDatabases = options.databaseFamilies?.length
    ? options.databaseFamilies
    : ['all-public-databases'];
  const variableKeyword = options.variableKeyword?.trim();

  return {
    research_domains: {
      'Resource Library Auto Discovery': {
        query,
        keywords: [
          ...(variableKeyword ? [variableKeyword] : []),
          ...selectedDatabases,
          ...(!variableKeyword ? [
            'index',
            'score',
            'ratio',
            'biomarker',
            'novel indicator',
            'composite indicator',
            'risk score',
          ] : []),
        ],
        arxiv_categories: [],
        priority: 5,
      },
    },
    top_n: PUBMED_SEARCH_RESULT_LIMIT,
    max_results: 160,
    date_range_days: options.frequency === 'daily' ? 30 : 90,
    discovery_query: query,
  };
}
