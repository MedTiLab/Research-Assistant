export type DiscoveryFrequency = 'daily' | 'weekly';

export type VariableCandidateMatchStatus =
  | 'new'
  | 'matched'
  | 'ambiguous'
  | 'manual_review'
  | 'ignored'
  | 'added_to_candidate_pool'
  | 'merged';

export type VariableCandidateReviewStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'merged'
  | 'ignored';

export type VariableType =
  | 'raw_field'
  | 'derived_index'
  | 'risk_score'
  | 'outcome'
  | 'covariate'
  | 'stratifier';

export type DiscoveryJobStatus = 'success' | 'failed' | 'partial' | 'running' | 'cancelled';

export type PubMedCandidateExtractionStage =
  | 'title_screen'
  | 'abstract_verified'
  | 'rule_based'
  | 'extraction_failed';

export type PubMedCandidateEvidenceLevel = 'title_only' | 'abstract_supported';

export interface PubMedCandidateEvidence {
  pmid: string;
  title: string;
  abstract?: string;
  journal?: string;
  publication_year?: number;
  publication_date?: string;
  evidence_sentence?: string;
  confidence_score: number;
  database_family_guess: string[];
  extraction_stage: PubMedCandidateExtractionStage;
  evidence_level: PubMedCandidateEvidenceLevel;
}

export interface PubMedExtractionArticle {
  pmid: string;
  title: string;
  abstract: string;
  journal: string;
  publicationDate?: string;
}

export interface PubMedExtractionSeedCandidate {
  pmid: string;
  raw_name: string;
  canonical_name_guess?: string;
  display_name_en_guess?: string;
  variable_type_guess?: VariableType;
  evidence_sentence?: string;
}

export interface PubMedExtractionBatchFailure {
  id: string;
  batch_index: number;
  pmids: string[];
  articles: PubMedExtractionArticle[];
  seed_candidates: PubMedExtractionSeedCandidate[];
  error_message: string;
  created_at: string;
  retry_status?: 'failed' | 'retrying';
}

export interface PubMedDiscoveryJob {
  id: string;
  job_type: DiscoveryFrequency;
  query_text: string;
  date_from: string;
  date_to: string;
  total_articles: number;
  candidate_count: number;
  matched_existing_count: number;
  pending_review_count: number;
  status: DiscoveryJobStatus;
  created_at: string;
  finished_at?: string;
  error_message?: string;
  extraction_source?: 'claude_json' | 'rule_based' | 'mock';
  extraction_note?: string;
  extraction_provider?: string;
  extraction_model?: string;
  extraction_invocation?: string;
  searched_article_count?: number;
  refinement_article_count?: number;
  successful_batch_count?: number;
  failed_batch_count?: number;
}

export interface PubMedVariableCandidate {
  id: string;
  job_id: string;
  pmid: string;
  title: string;
  abstract?: string;
  journal?: string;
  publication_year?: number;
  publication_date?: string;
  raw_name: string;
  canonical_name_guess: string;
  display_name_zh_guess: string;
  display_name_en_guess?: string;
  variable_type_guess: VariableType;
  database_family_guess: string[];
  clinical_domain_guess: string[];
  role_guess: string[];
  formula_text?: string;
  evidence_sentence?: string;
  evidence_sentence_zh?: string;
  confidence_score: number;
  match_status: VariableCandidateMatchStatus;
  matched_variable_id?: string;
  review_status: VariableCandidateReviewStatus;
  ambiguity_notes?: string;
  extraction_source: 'title' | 'abstract' | 'manual' | 'llm' | 'rule_based';
  extraction_stage?: PubMedCandidateExtractionStage;
  evidence_level?: PubMedCandidateEvidenceLevel;
  evidence_articles?: PubMedCandidateEvidence[];
  created_at: string;
  updated_at: string;
}

export interface VariableEvidenceArticle {
  id: string;
  variable_id: string;
  pmid: string;
  title: string;
  journal?: string;
  publication_year?: number;
  publication_date?: string;
  abstract?: string;
  database_used?: string[];
  population?: string;
  exposure_variable?: string;
  outcome_variable?: string;
  study_type?: string;
  evidence_role: 'definition' | 'formula' | 'application' | 'validation' | 'trend';
  relevance_score?: number;
  is_key_reference?: boolean;
  import_source: 'pubmed_auto_discovery' | 'manual' | 'project_report';
  created_at: string;
}

export interface VariableTrendPoint {
  date: string;
  candidate_count: number;
  evidence_count: number;
}

export interface VariablePubMedTrendPoint {
  month: string;
  count: number;
  dateFrom?: string;
  dateTo?: string;
}

export interface VariablePubMedTrendResult {
  variableName: string;
  query: string;
  source: 'pubmed_esearch';
  searchedAt: string;
  totalCount: number;
  points: VariablePubMedTrendPoint[];
}

export interface PubMedDiscoveryOptions {
  frequency: DiscoveryFrequency;
  dateFrom: string;
  dateTo: string;
  databaseFamilies?: string[];
  clinicalDomains?: string[];
  variableTypes?: VariableType[];
  variableKeyword?: string;
  queryMode?: 'broad' | 'focused';
}

export type PubMedDiscoveryProgressPhase =
  | 'prepare'
  | 'pubmed_search'
  | 'pubmed_results'
  | 'local_prescreen'
  | 'llm_extract'
  | 'llm_title_screen'
  | 'llm_abstract_refine'
  | 'llm_complete'
  | 'rule_fallback'
  | 'match_existing'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface PubMedDiscoveryProgressEvent {
  id: string;
  phase: PubMedDiscoveryProgressPhase;
  label: string;
  detail?: string;
  status: 'running' | 'success' | 'warning' | 'error' | 'cancelled';
  createdAt: string;
  startedAt?: string;
  durationMs?: number;
  timeoutMs?: number;
  progress?: number;
}

export interface PubMedDiscoveryResult {
  job: PubMedDiscoveryJob;
  candidates: PubMedVariableCandidate[];
  matchedEvidence: VariableEvidenceArticle[];
  trendPoints?: VariableTrendPoint[];
  failedBatches?: PubMedExtractionBatchFailure[];
}

export interface DiscoverySummaryStats {
  totalArticles: number;
  candidateCount: number;
  matchedExistingCount: number;
  pendingReviewCount: number;
}

export interface CandidateAuditLogEntry {
  id: string;
  candidateId: string;
  action: 'add_to_pool' | 'merge_existing' | 'mark_ambiguous' | 'ignore' | 'favorite';
  note?: string;
  createdAt: string;
}

export interface RuleSettings {
  frequency: DiscoveryFrequency | 'off';
  dailyRunTime: string;
  weeklyRunDay: string;
  weeklyRunTime: string;
  scopes: string[];
  databaseKeywords: string[];
  minimumConfidence: number;
  autoAddToCandidatePool: boolean;
  autoMergeMatchedEvidence: boolean;
}
