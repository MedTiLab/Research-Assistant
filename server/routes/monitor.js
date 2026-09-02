import express from 'express';
import { conceptsDb, monitorDb, projectDb, referencesDb } from '../database/db.js';
import { AUTOMATED_SOURCE_KEYS, monitorSchedulerService } from '../services/monitor-scheduler.js';
import { extractCandidatesForLiteratureRecord, normalizeExtractionConfig } from '../utils/literature-concept-extractor.js';

const router = express.Router();

const VALID_CANDIDATE_TYPES = new Set([
  'indicator',
  'drug',
  'disease',
  'subtype',
  'stratifier',
  'risk_score',
  'outcome',
]);

const VALID_CANDIDATE_STATUSES = new Set([
  'pending',
  'accepted',
  'merged',
  'rejected',
]);

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function serviceUnavailable(message) {
  const error = new Error(message);
  error.statusCode = 503;
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

function normalizeCandidateName(value) {
  return String(value || '').trim();
}

function sanitizeSchedulerPatch(body = {}) {
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
    patch.enabled = Boolean(body.enabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'poll_interval_minutes')) {
    patch.poll_interval_minutes = body.poll_interval_minutes;
  }

  if (body.sources && typeof body.sources === 'object' && !Array.isArray(body.sources)) {
    patch.sources = {};
    for (const sourceKey of AUTOMATED_SOURCE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(body.sources, sourceKey)) {
        continue;
      }

      const sourcePatch = body.sources[sourceKey];
      if (!sourcePatch || typeof sourcePatch !== 'object' || Array.isArray(sourcePatch)) {
        throw badRequest(`Invalid scheduler source patch for ${sourceKey}`);
      }

      patch.sources[sourceKey] = {};
      if (Object.prototype.hasOwnProperty.call(sourcePatch, 'enabled')) {
        patch.sources[sourceKey].enabled = Boolean(sourcePatch.enabled);
      }
      if (Object.prototype.hasOwnProperty.call(sourcePatch, 'frequency_hours')) {
        patch.sources[sourceKey].frequency_hours = sourcePatch.frequency_hours;
      }
      if (Object.prototype.hasOwnProperty.call(sourcePatch, 'ingest_limit')) {
        patch.sources[sourceKey].ingest_limit = sourcePatch.ingest_limit;
      }
    }
  }

  if (body.extraction && typeof body.extraction === 'object' && !Array.isArray(body.extraction)) {
    patch.extraction = normalizeExtractionConfig(body.extraction);
  }

  return patch;
}

router.get('/scheduler', async (req, res) => {
  try {
    const scheduler = await monitorSchedulerService.getState();
    res.json({ scheduler });
  } catch (error) {
    console.error('Error reading monitor scheduler:', error);
    res.status(500).json({ error: 'Failed to read monitor scheduler' });
  }
});

router.put('/scheduler', async (req, res) => {
  try {
    const patch = sanitizeSchedulerPatch(req.body || {});
    const result = await monitorSchedulerService.updateConfig(patch);
    res.json({
      success: true,
      scheduler: result.scheduler,
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error updating monitor scheduler:', error);
    res.status(500).json({ error: 'Failed to update monitor scheduler' });
  }
});

router.post('/scheduler/run', async (req, res) => {
  try {
    const sourceKey = normalizeCandidateName(req.body?.source_key);
    if (!sourceKey) {
      throw badRequest('source_key is required');
    }
    if (!AUTOMATED_SOURCE_KEYS.includes(sourceKey)) {
      throw badRequest(`Unsupported source_key: ${sourceKey}`);
    }

    const result = await monitorSchedulerService.runSourceNow(sourceKey, { reason: 'manual' });
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error running monitor scheduler:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to run monitor scheduler' });
  }
});

router.get('/candidates', async (req, res) => {
  try {
    const statuses = parseCsvParam(req.query.statuses).filter((value) => VALID_CANDIDATE_STATUSES.has(value));
    const candidateTypes = parseCsvParam(req.query.candidate_types).filter((value) => VALID_CANDIDATE_TYPES.has(value));
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const candidates = monitorDb.listCandidates(req.user.id, {
      statuses,
      candidateTypes,
      limit,
      offset,
    });

    res.json({
      candidates,
      stats: monitorDb.getOverviewStats(req.user.id),
    });
  } catch (error) {
    console.error('Error listing monitor candidates:', error);
    res.status(500).json({ error: 'Failed to list monitor candidates' });
  }
});

router.post('/extract-references', async (req, res) => {
  try {
    const extractionConfig = normalizeExtractionConfig(req.body?.extraction || {});
    const strictLlm = req.body?.strict_llm !== false;
    const referenceIds = Array.isArray(req.body?.reference_ids)
      ? req.body.reference_ids.map((value) => normalizeCandidateName(value)).filter(Boolean)
      : [];

    if (referenceIds.length === 0) {
      throw badRequest('reference_ids is required');
    }

    const limitedReferenceIds = Array.from(new Set(referenceIds)).slice(0, 50);
    const references = referencesDb.getReferencesByIds(req.user.id, limitedReferenceIds);
    if (references.length === 0) {
      return res.status(404).json({ error: 'References not found' });
    }

    const processedReferences = [];
    const createdCandidates = [];
    const preparedResults = [];

    for (const reference of references) {
      const sourceKey = normalizeCandidateName(reference.source) || 'reference_import';
      const extractionResult = await extractCandidatesForLiteratureRecord({
        userId: req.user.id,
        reference: {
          title: reference.title,
          abstract: reference.abstract,
        },
        sourceKey,
        extractionConfig,
        allowFallback: !strictLlm,
      });

      if (strictLlm && extractionResult.strategy !== 'llm_json') {
        throw serviceUnavailable(
          `所选模型没有返回可用的结构化概念结果：${reference.title || reference.id}。${extractionResult.error || '请检查模型登录状态、模型选择或 JSON 提取配置后重试。'}`,
        );
      }

      preparedResults.push({
        reference,
        sourceKey,
        extractionResult,
      });
    }

    monitorDb.deletePendingCandidatesByReferenceIds(req.user.id, preparedResults.map((entry) => entry.reference.id));

    for (const entry of preparedResults) {
      const { reference, sourceKey, extractionResult } = entry;
      const run = monitorDb.createRun(req.user.id, {
        source_key: sourceKey,
        trigger_type: 'reference_import',
        item_title: reference.title,
        reference_id: reference.id,
        status: 'completed',
        metadata: {
          imported_via: 'manual_library_intake',
          extraction_provider: extractionConfig.provider,
          extraction_model: extractionConfig.model,
          strict_llm: strictLlm,
        },
      });

      const extracted = extractionResult.candidates.map((candidate) => ({
        ...candidate,
        reference_id: reference.id,
        source_key: sourceKey,
        metadata: {
          ...(candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {}),
          extraction_strategy: extractionResult.strategy,
          extraction_provider: extractionResult.extractionConfig.provider,
          extraction_model: extractionResult.extractionConfig.model,
        },
      }));

      const inserted = monitorDb.createCandidates(req.user.id, run?.id, extracted);
      createdCandidates.push(...inserted);
      processedReferences.push({
        reference_id: reference.id,
        title: reference.title,
        source: sourceKey,
        candidate_count: inserted.length,
        extraction_strategy: extractionResult.strategy,
      });
    }

    res.json({
      success: true,
      processed_references: processedReferences.length,
      extracted_candidates: createdCandidates.length,
      extraction: extractionConfig,
      strict_llm: strictLlm,
      references: processedReferences,
      candidates: createdCandidates,
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error extracting monitor candidates from references:', error);
    res.status(500).json({ error: 'Failed to extract monitor candidates from references' });
  }
});

router.post('/candidates/:id/accept', async (req, res) => {
  try {
    const candidate = monitorDb.getCandidate(req.user.id, req.params.id);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    if (candidate.status !== 'pending') {
      return res.status(409).json({ error: 'Only pending candidates can be accepted' });
    }

    const mode = String(req.body?.mode || 'auto').trim();
    const reviewNote = normalizeCandidateName(req.body?.review_note);
    const evidenceText = normalizeCandidateName(req.body?.evidence_text)
      || [candidate.summary, candidate.rationale].filter(Boolean).join(' ');

    let concept = null;
    let usedExistingConcept = false;
    if (mode === 'merge') {
      const conceptId = normalizeCandidateName(req.body?.concept_id);
      if (!conceptId) {
        throw badRequest('concept_id is required when mode=merge');
      }

      concept = conceptsDb.getConcept(req.user.id, conceptId);
      if (!concept) {
        return res.status(404).json({ error: 'Target concept not found' });
      }
      usedExistingConcept = true;
    } else if (mode === 'new' || mode === 'auto') {
      const conceptType = normalizeCandidateName(req.body?.concept_type || candidate.candidate_type);
      const canonicalName = normalizeCandidateName(req.body?.canonical_name || candidate.display_name || candidate.normalized_name);
      if (!conceptType) {
        throw badRequest('concept_type is required');
      }
      if (!canonicalName) {
        throw badRequest('canonical_name is required');
      }

      const duplicate = conceptsDb.findConceptByCanonical(req.user.id, conceptType, canonicalName);
      if (duplicate) {
        concept = duplicate;
        usedExistingConcept = true;
      } else {
        concept = conceptsDb.createConcept(req.user.id, {
          concept_type: conceptType,
          canonical_name: canonicalName,
          display_name: normalizeCandidateName(req.body?.display_name || candidate.display_name || candidate.normalized_name),
          aliases: Array.isArray(req.body?.aliases) ? req.body.aliases : [],
          description: normalizeCandidateName(req.body?.description || candidate.summary || ''),
          status: normalizeCandidateName(req.body?.status || 'reviewed'),
          source_strategy: normalizeCandidateName(req.body?.source_strategy || 'news_monitor'),
          metadata: {
            candidate_id: candidate.id,
            source_key: candidate.source_key,
            accepted_via: 'monitor_review',
          },
        });
      }
    } else {
      throw badRequest(`Unsupported accept mode: ${mode}`);
    }

    let evidence = null;
    if (concept && evidenceText) {
      if (candidate.project_id) {
        const project = projectDb.getProjectById(candidate.project_id);
        if (!project || (project.user_id != null && project.user_id !== req.user.id)) {
          return res.status(400).json({ error: 'Candidate project context is no longer available' });
        }
      }

      if (candidate.reference_id) {
        const reference = referencesDb.getReference(candidate.reference_id, req.user.id);
        if (!reference) {
          return res.status(400).json({ error: 'Candidate reference context is no longer available' });
        }
      }

      evidence = conceptsDb.createConceptEvidence(req.user.id, concept.id, {
        reference_id: candidate.reference_id || null,
        project_id: candidate.project_id || null,
        evidence_type: 'review_summary',
        evidence_text: evidenceText,
        evidence_location: 'monitor_candidate_review',
        direction: 'supporting',
        evidence_level: 'moderate',
        review_status: 'accepted',
        review_note: reviewNote || null,
        metadata: {
          candidate_id: candidate.id,
          source_key: candidate.source_key,
          confidence: candidate.confidence,
        },
      });
    }

    const nextStatus = usedExistingConcept ? 'merged' : 'accepted';
    const updatedCandidate = monitorDb.updateCandidateStatus(req.user.id, candidate.id, {
      status: nextStatus,
      merged_concept_id: concept?.id || null,
      review_note: reviewNote || null,
      metadata: {
        ...(candidate.metadata || {}),
        accepted_mode: mode,
      },
    });

    res.json({
      success: true,
      candidate: updatedCandidate,
      concept,
      evidence,
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error accepting monitor candidate:', error);
    res.status(500).json({ error: 'Failed to accept monitor candidate' });
  }
});

router.post('/candidates/:id/reject', async (req, res) => {
  try {
    const candidate = monitorDb.getCandidate(req.user.id, req.params.id);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    if (candidate.status !== 'pending') {
      return res.status(409).json({ error: 'Only pending candidates can be rejected' });
    }

    const reviewNote = normalizeCandidateName(req.body?.review_note);
    const updatedCandidate = monitorDb.updateCandidateStatus(req.user.id, candidate.id, {
      status: 'rejected',
      review_note: reviewNote || null,
      metadata: {
        ...(candidate.metadata || {}),
        rejected_via: 'monitor_review',
      },
    });

    res.json({
      success: true,
      candidate: updatedCandidate,
    });
  } catch (error) {
    console.error('Error rejecting monitor candidate:', error);
    res.status(500).json({ error: 'Failed to reject monitor candidate' });
  }
});

export default router;
