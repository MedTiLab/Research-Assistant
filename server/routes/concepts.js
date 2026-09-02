import express from 'express';
import { conceptsDb, projectDb, referencesDb } from '../database/db.js';

const router = express.Router();

const VALID_CONCEPT_TYPES = new Set([
  'indicator',
  'drug',
  'disease',
  'subtype',
  'stratifier',
  'risk_score',
  'outcome',
]);

const VALID_CONCEPT_STATUSES = new Set([
  'candidate',
  'reviewed',
  'stable',
  'rejected',
]);

const VALID_SOURCE_STRATEGIES = new Set([
  'manual',
  'zotero_note',
  'news_monitor',
  'llm_extraction',
]);

const VALID_EVIDENCE_TYPES = new Set([
  'abstract_claim',
  'fulltext_claim',
  'manual_note',
  'review_summary',
]);

const VALID_EVIDENCE_DIRECTIONS = new Set([
  'supporting',
  'contradicting',
  'neutral',
]);

const VALID_EVIDENCE_LEVELS = new Set([
  'low',
  'moderate',
  'high',
]);

const VALID_REVIEW_STATUSES = new Set([
  'pending',
  'accepted',
  'rejected',
]);

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function parseCsvParam(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function sanitizeAliases(value) {
  if (value == null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw badRequest('aliases must be an array of strings');
  }

  const aliases = value
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  return aliases;
}

function sanitizeMetadata(value) {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('metadata must be an object');
  }

  return value;
}

function sanitizeConceptPayload(body = {}, { partial = false } = {}) {
  const payload = {};

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'concept_type')) {
    const conceptType = String(body.concept_type || '').trim();
    if (!conceptType) {
      throw badRequest('concept_type is required');
    }
    if (!VALID_CONCEPT_TYPES.has(conceptType)) {
      throw badRequest(`Invalid concept_type: ${conceptType}`);
    }
    payload.concept_type = conceptType;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'canonical_name')) {
    const canonicalName = String(body.canonical_name || '').trim();
    if (!canonicalName) {
      throw badRequest('canonical_name is required');
    }
    payload.canonical_name = canonicalName;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'display_name')) {
    payload.display_name = String(body.display_name || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'aliases')) {
    payload.aliases = sanitizeAliases(body.aliases);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    payload.description = String(body.description || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'ontology_source')) {
    payload.ontology_source = String(body.ontology_source || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'ontology_id')) {
    payload.ontology_id = String(body.ontology_id || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = String(body.status || '').trim();
    if (!status) {
      throw badRequest('status cannot be empty');
    }
    if (!VALID_CONCEPT_STATUSES.has(status)) {
      throw badRequest(`Invalid status: ${status}`);
    }
    payload.status = status;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'source_strategy')) {
    const sourceStrategy = String(body.source_strategy || '').trim();
    if (!sourceStrategy) {
      throw badRequest('source_strategy cannot be empty');
    }
    if (!VALID_SOURCE_STRATEGIES.has(sourceStrategy)) {
      throw badRequest(`Invalid source_strategy: ${sourceStrategy}`);
    }
    payload.source_strategy = sourceStrategy;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'metadata')) {
    payload.metadata = sanitizeMetadata(body.metadata);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'first_seen_at')) {
    payload.first_seen_at = String(body.first_seen_at || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'last_seen_at')) {
    payload.last_seen_at = String(body.last_seen_at || '').trim();
  }

  return payload;
}

function sanitizeEvidencePayload(body = {}) {
  const evidenceType = String(body.evidence_type || '').trim();
  if (!evidenceType) {
    throw badRequest('evidence_type is required');
  }
  if (!VALID_EVIDENCE_TYPES.has(evidenceType)) {
    throw badRequest(`Invalid evidence_type: ${evidenceType}`);
  }

  const evidenceText = String(body.evidence_text || '').trim();
  if (!evidenceText) {
    throw badRequest('evidence_text is required');
  }

  const direction = String(body.direction || 'supporting').trim();
  if (!VALID_EVIDENCE_DIRECTIONS.has(direction)) {
    throw badRequest(`Invalid direction: ${direction}`);
  }

  const evidenceLevel = String(body.evidence_level || 'moderate').trim();
  if (!VALID_EVIDENCE_LEVELS.has(evidenceLevel)) {
    throw badRequest(`Invalid evidence_level: ${evidenceLevel}`);
  }

  const reviewStatus = String(body.review_status || 'accepted').trim();
  if (!VALID_REVIEW_STATUSES.has(reviewStatus)) {
    throw badRequest(`Invalid review_status: ${reviewStatus}`);
  }

  let extractionConfidence = null;
  if (body.extraction_confidence != null && body.extraction_confidence !== '') {
    extractionConfidence = Number(body.extraction_confidence);
    if (!Number.isFinite(extractionConfidence) || extractionConfidence < 0 || extractionConfidence > 1) {
      throw badRequest('extraction_confidence must be a number between 0 and 1');
    }
  }

  return {
    reference_id: String(body.reference_id || '').trim() || null,
    project_id: String(body.project_id || '').trim() || null,
    evidence_type: evidenceType,
    evidence_text: evidenceText,
    evidence_location: String(body.evidence_location || '').trim() || null,
    direction,
    evidence_level: evidenceLevel,
    extraction_confidence: extractionConfidence,
    review_status: reviewStatus,
    review_note: String(body.review_note || '').trim() || null,
    metadata: sanitizeMetadata(body.metadata),
  };
}

router.get('/', async (req, res) => {
  try {
    const conceptTypes = parseCsvParam(req.query.concept_types).filter((value) => VALID_CONCEPT_TYPES.has(value));
    const statuses = parseCsvParam(req.query.statuses).filter((value) => VALID_CONCEPT_STATUSES.has(value));
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const concepts = conceptsDb.listConcepts(req.user.id, {
      search: req.query.search ? String(req.query.search) : '',
      conceptTypes,
      statuses,
      limit,
      offset,
    });

    res.json({
      concepts,
      stats: conceptsDb.getOverviewStats(req.user.id),
    });
  } catch (error) {
    console.error('Error listing concepts:', error);
    res.status(500).json({ error: 'Failed to list concepts' });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = sanitizeConceptPayload(req.body || {});
    const duplicate = conceptsDb.findConceptByCanonical(req.user.id, payload.concept_type, payload.canonical_name);
    if (duplicate) {
      return res.status(409).json({
        error: 'Concept already exists',
        concept: duplicate,
      });
    }

    const concept = conceptsDb.createConcept(req.user.id, payload);
    res.status(201).json({ success: true, concept });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error creating concept:', error);
    res.status(500).json({ error: 'Failed to create concept' });
  }
});

router.get('/:id/evidence', async (req, res) => {
  try {
    const concept = conceptsDb.getConcept(req.user.id, req.params.id);
    if (!concept) {
      return res.status(404).json({ error: 'Concept not found' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const evidence = conceptsDb.getConceptEvidence(req.user.id, req.params.id, { limit, offset });

    res.json({ concept, evidence });
  } catch (error) {
    console.error('Error listing concept evidence:', error);
    res.status(500).json({ error: 'Failed to list concept evidence' });
  }
});

router.post('/:id/evidence', async (req, res) => {
  try {
    const concept = conceptsDb.getConcept(req.user.id, req.params.id);
    if (!concept) {
      return res.status(404).json({ error: 'Concept not found' });
    }

    const payload = sanitizeEvidencePayload(req.body || {});

    if (payload.reference_id) {
      const reference = referencesDb.getReference(payload.reference_id, req.user.id);
      if (!reference) {
        return res.status(400).json({ error: 'reference_id does not point to a known reference' });
      }
    }

    if (payload.project_id) {
      const project = projectDb.getProjectById(payload.project_id);
      if (!project || (project.user_id != null && project.user_id !== req.user.id)) {
        return res.status(400).json({ error: 'project_id does not point to a known project' });
      }
    }

    const evidence = conceptsDb.createConceptEvidence(req.user.id, req.params.id, payload);
    res.status(201).json({ success: true, evidence });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error creating concept evidence:', error);
    res.status(500).json({ error: 'Failed to create concept evidence' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const concept = conceptsDb.getConcept(req.user.id, req.params.id);
    if (!concept) {
      return res.status(404).json({ error: 'Concept not found' });
    }

    res.json({ concept });
  } catch (error) {
    console.error('Error fetching concept:', error);
    res.status(500).json({ error: 'Failed to fetch concept' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const current = conceptsDb.getConcept(req.user.id, req.params.id);
    if (!current) {
      return res.status(404).json({ error: 'Concept not found' });
    }

    const payload = sanitizeConceptPayload(req.body || {}, { partial: true });
    const nextType = payload.concept_type || current.concept_type;
    const nextCanonical = payload.canonical_name || current.canonical_name;
    const duplicate = conceptsDb.findConceptByCanonical(req.user.id, nextType, nextCanonical, { excludeId: req.params.id });
    if (duplicate) {
      return res.status(409).json({
        error: 'Another concept already uses this canonical name',
        concept: duplicate,
      });
    }

    const concept = conceptsDb.updateConcept(req.user.id, req.params.id, payload);
    res.json({ success: true, concept });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error updating concept:', error);
    res.status(500).json({ error: 'Failed to update concept' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const removed = conceptsDb.deleteConcept(req.user.id, req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Concept not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting concept:', error);
    res.status(500).json({ error: 'Failed to delete concept' });
  }
});

export default router;
