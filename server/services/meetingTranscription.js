import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { OPENAI_MEDIA_MODELS } from '../../shared/modelConstants.js';
import { resolveAppDataRoot } from '../utils/storagePaths.js';

function safePart(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new Error(`A safe ${label} is required`);
  }
  return normalized.replace(/:/g, '_');
}

export function resolveMeetingRecordingDir(userId, meetingId, options = {}) {
  return path.join(
    options.dataRoot || resolveAppDataRoot(),
    'meetings',
    safePart(userId, 'user id'),
    safePart(meetingId, 'meeting id'),
    'recording',
  );
}

export function resolveMeetingChunkPath(userId, meetingId, segmentIndex, options = {}) {
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) throw new Error('A non-negative segment index is required');
  return path.join(resolveMeetingRecordingDir(userId, meetingId, options), `segment-${String(segmentIndex).padStart(6, '0')}.webm`);
}

function parseSummaryPayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Meeting summary model returned invalid JSON');
  }
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim().slice(0, 12_000) : '';
  const notes = Array.isArray(parsed?.notes) ? parsed.notes.slice(0, 100).flatMap((note) => {
    const content = typeof note?.content === 'string' ? note.content.trim().slice(0, 8_000) : '';
    const noteType = ['feedback', 'decision', 'question', 'idea'].includes(note?.noteType) ? note.noteType : 'idea';
    if (!content) return [];
    return [{
      content,
      noteType,
      ...(typeof note?.speaker === 'string' && note.speaker.trim() ? { speaker: note.speaker.trim().slice(0, 100) } : {}),
    }];
  }) : [];
  const candidateActions = Array.isArray(parsed?.candidateActions) ? parsed.candidateActions.slice(0, 100).flatMap((action) => {
    const content = typeof action?.content === 'string' ? action.content.trim().slice(0, 8_000) : '';
    if (!content) return [];
    const dueDate = typeof action?.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(action.dueDate)
      ? action.dueDate
      : undefined;
    return [{ content, ...(dueDate ? { dueDate } : {}) }];
  }) : [];
  return { summary, notes, candidateActions };
}

function comparableCharacters(text) {
  const characters = [];
  for (const [index, value] of Array.from(String(text || '')).entries()) {
    if (/^[\p{L}\p{N}]$/u.test(value)) {
      characters.push({ value: value.toLocaleLowerCase(), characterIndex: index });
    }
  }
  return characters;
}

export function dedupeTranscriptOverlap(previousText, currentText) {
  const current = String(currentText || '').trim();
  if (!current) return '';
  const previousCharacters = comparableCharacters(previousText);
  const currentCharacters = comparableCharacters(current);
  const maximum = Math.min(160, previousCharacters.length, currentCharacters.length);
  for (let size = maximum; size >= 6; size -= 1) {
    const previousStart = previousCharacters.length - size;
    let matches = true;
    for (let index = 0; index < size; index += 1) {
      if (previousCharacters[previousStart + index].value !== currentCharacters[index].value) {
        matches = false;
        break;
      }
    }
    if (matches) {
      const codePoints = Array.from(current);
      return codePoints
        .slice(currentCharacters[size - 1].characterIndex + 1)
        .join('')
        .replace(/^[\s,，。.!！？?;；:：、]+/u, '');
    }
  }
  return current;
}

export function createMeetingTranscriptionService({
  database,
  dataRoot,
  createClient = (apiKey) => new OpenAI({ apiKey }),
  apiKey = () => process.env.OPENAI_API_KEY,
  logger = console,
} = {}) {
  if (!database) throw new Error('database is required');
  let queue = Promise.resolve();

  async function ensureRecordingDir(userId, meetingId) {
    const directory = resolveMeetingRecordingDir(userId, meetingId, { dataRoot });
    await fsPromises.mkdir(directory, { recursive: true });
    return directory;
  }

  async function saveChunk({ userId, meetingId, segmentIndex, buffer }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Audio chunk is empty');
    await ensureRecordingDir(userId, meetingId);
    const filePath = resolveMeetingChunkPath(userId, meetingId, segmentIndex, { dataRoot });
    await fsPromises.writeFile(filePath, buffer, { flag: 'wx' });
    return { filePath, sizeBytes: buffer.length };
  }

  async function transcribeSegment(segmentId, language = 'zh') {
    const segment = database.prepare(`
      SELECT * FROM meeting_transcript_segments WHERE id = ?
    `).get(segmentId);
    if (!segment) return;
    const key = apiKey();
    if (!key) {
      database.prepare(`
        UPDATE meeting_transcript_segments
        SET status = 'failed', error = ?, updated_at = ?
        WHERE id = ?
      `).run('OpenAI API key is not configured', new Date().toISOString(), segmentId);
      return;
    }
    const filePath = resolveMeetingChunkPath(segment.user_id, segment.meeting_id, Number(segment.segment_index), { dataRoot });
    database.prepare(`
      UPDATE meeting_transcript_segments
      SET status = 'transcribing', error = NULL, updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), segmentId);
    try {
      const client = createClient(key);
      const result = await client.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: OPENAI_MEDIA_MODELS.TRANSCRIPTION,
        language,
        response_format: 'json',
      });
      const previousSegment = database.prepare(`
        SELECT text
        FROM meeting_transcript_segments
        WHERE meeting_id = ? AND user_id = ? AND segment_index < ? AND status = 'done'
        ORDER BY segment_index DESC
        LIMIT 1
      `).get(segment.meeting_id, segment.user_id, segment.segment_index);
      const transcriptText = dedupeTranscriptOverlap(previousSegment?.text, result?.text);
      database.prepare(`
        UPDATE meeting_transcript_segments
        SET text = ?, status = 'done', error = NULL, updated_at = ?
        WHERE id = ?
      `).run(transcriptText, new Date().toISOString(), segmentId);
    } catch (error) {
      logger.error('[ERROR] Meeting transcription segment failed:', error?.message || error);
      database.prepare(`
        UPDATE meeting_transcript_segments
        SET status = 'failed', error = ?, updated_at = ?
        WHERE id = ?
      `).run(String(error?.message || 'Transcription failed').slice(0, 2000), new Date().toISOString(), segmentId);
    }
  }

  function enqueue(segmentId, language = 'zh') {
    const task = () => transcribeSegment(segmentId, language);
    queue = queue.then(task, task);
    return queue;
  }

  async function summarizeMeeting({ title, transcriptSegments = [], notes = [] }) {
    const key = apiKey();
    if (!key) {
      const error = new Error('OpenAI API key is not configured');
      error.code = 'OPENAI_NOT_CONFIGURED';
      throw error;
    }
    const transcript = transcriptSegments
      .filter((segment) => segment.status === 'done' && String(segment.text || '').trim())
      .map((segment) => ({
        startMs: Number(segment.start_ms || 0),
        endMs: Number(segment.end_ms || 0),
        speaker: segment.speaker || null,
        text: String(segment.text).slice(0, 16_000),
      }));
    const manualNotes = notes.map((note) => ({ speaker: note.speaker || null, noteType: note.note_type, content: note.content }));
    if (transcript.length === 0 && manualNotes.length === 0) {
      const error = new Error('No transcript or meeting notes are available');
      error.code = 'MEETING_CONTENT_EMPTY';
      throw error;
    }
    const client = createClient(key);
    const completion = await client.chat.completions.create({
      model: OPENAI_MEDIA_MODELS.MEETING_SUMMARY,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: '你是医学科研组会纪要助手。只根据提供的转写和人工记录整理草稿，不补造事实。输出 JSON：summary 字符串；notes 数组，每项含 content、noteType(feedback/decision/question/idea)、可选 speaker；candidateActions 数组，每项含 content、可选 dueDate(YYYY-MM-DD)。行动项必须是明确可执行且确实被会议内容支持的事项。',
        },
        {
          role: 'user',
          content: JSON.stringify({ meetingTitle: title, transcript, manualNotes }),
        },
      ],
    });
    const content = completion?.choices?.[0]?.message?.content || '';
    return parseSummaryPayload(content);
  }

  return { ensureRecordingDir, saveChunk, enqueue, transcribeSegment, summarizeMeeting, waitForIdle: () => queue };
}
