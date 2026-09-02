import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { publicFetch } from './public-web.js';
import { listPiTaskModels, resolvePiTaskModel } from '../pi-runtime/provider-store.js';
import { resolvePiToolPath } from '../pi-runtime/tool-policy.js';
import {
  isPiAgentCapabilityCallable,
  PI_AGENT_TASK_PROTOCOLS,
  PI_MODEL_TASKS,
} from '../../shared/piModelCapabilities.js';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;

const MIME_EXTENSIONS = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'application/octet-stream': 'bin',
});

const INPUT_MIME_TYPES = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.opus': 'audio/opus', '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
});

function mediaError(code, message) {
  return Object.assign(new Error(message), { code });
}

function requireText(value, label, maxLength) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > maxLength) {
    throw mediaError('PI_MEDIA_INPUT_INVALID', `${label} is required and must be at most ${maxLength} characters.`);
  }
  return normalized;
}

function modelEndpoint(selection, fallbackPath) {
  if (selection.providerId === 'byok-anthropic-compatible') {
    throw mediaError('PI_MEDIA_PROTOCOL_UNSUPPORTED', 'Anthropic-compatible providers cannot run this media task.');
  }
  const base = new URL(`${selection.baseUrl.replace(/\/$/, '')}/`);
  const configured = selection.capability?.endpoint?.replaceAll(
    '{model}',
    encodeURIComponent(selection.model.id),
  );
  if (configured) {
    const resolved = new URL(configured, base);
    if (resolved.origin !== base.origin) {
      throw mediaError('PI_MEDIA_ENDPOINT_INVALID', 'A model capability endpoint must use its provider origin.');
    }
    return resolved.toString();
  }
  return new URL(fallbackPath.replace(/^\//, ''), base).toString();
}

function geminiImageBuffers(value) {
  const candidates = Array.isArray(value?.candidates) ? value.candidates : [];
  const images = [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const inline = part?.inlineData || part?.inline_data;
      const encoded = inline?.data;
      if (typeof encoded !== 'string' || !encoded) continue;
      const data = Buffer.from(encoded, 'base64');
      if (data.length === 0 || data.length > MAX_IMAGE_BYTES) {
        throw mediaError('PI_MEDIA_RESPONSE_INVALID', 'Gemini returned invalid or oversized image data.');
      }
      const declared = inline?.mimeType || inline?.mime_type || '';
      images.push({ data, mimeType: imageMime(data, declared) });
      if (images.length >= 4) return images;
    }
  }
  if (images.length === 0) {
    const reason = value?.promptFeedback?.blockReason;
    throw mediaError(
      reason ? 'PI_MEDIA_CONTENT_POLICY' : 'PI_MEDIA_RESPONSE_INVALID',
      reason ? `Gemini did not generate an image (${reason}).` : 'Gemini response did not contain an image.',
    );
  }
  return images;
}

async function imagesFromGeminiResponse(response) {
  if (!response.ok) await responseFailure(response);
  const raw = await boundedBuffer(response, MAX_IMAGE_BYTES * 2);
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    throw mediaError('PI_MEDIA_RESPONSE_INVALID', 'Gemini returned invalid image JSON.');
  }
  return geminiImageBuffers(payload);
}

function providerHeaders(selection, extra = {}) {
  return {
    Authorization: `Bearer ${selection.apiKey}`,
    ...extra,
  };
}

async function boundedBuffer(response, limit) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw mediaError('PI_MEDIA_RESPONSE_TOO_LARGE', 'The media response exceeds the allowed size.');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

async function responseFailure(response) {
  const body = (await boundedBuffer(response, MAX_ERROR_BYTES)).toString('utf8').trim();
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || parsed?.message || body;
  } catch {
    // Plain-text provider errors are still useful after bounding.
  }
  throw mediaError(
    'PI_MEDIA_PROVIDER_REJECTED',
    `The configured media provider rejected the request (HTTP ${response.status})${detail ? `: ${detail.slice(0, 1000)}` : '.'}`,
  );
}

function imageMime(buffer, declared = '') {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return /^image\/(?:png|jpeg|webp|gif)$/i.test(declared) ? declared.toLowerCase() : 'image/png';
}

async function audioFromResponse(response, fallbackMime, downloadFetch) {
  if (!response.ok) await responseFailure(response);
  const declared = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  const raw = await boundedBuffer(response, MAX_AUDIO_BYTES);
  if (declared === 'application/json' || raw.subarray(0, 1).toString() === '{') {
    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      throw mediaError('PI_MEDIA_RESPONSE_INVALID', 'The speech provider returned invalid JSON.');
    }
    const encoded = payload?.data?.audio || payload?.audio || payload?.data?.b64_json;
    if (typeof encoded === 'string' && encoded) {
      const data = Buffer.from(encoded, 'base64');
      if (data.length > 0) return { data, mimeType: fallbackMime };
    }
    const url = payload?.data?.url || payload?.url;
    if (typeof url === 'string' && url) {
      const downloaded = await downloadFetch(url, { headers: { accept: 'audio/*' } });
      if (!downloaded.ok) throw mediaError('PI_MEDIA_DOWNLOAD_FAILED', `Generated audio download failed (HTTP ${downloaded.status}).`);
      const data = await boundedBuffer(downloaded, MAX_AUDIO_BYTES);
      const mimeType = (downloaded.headers.get('content-type') || '').split(';')[0].toLowerCase();
      return { data, mimeType: MIME_EXTENSIONS[mimeType] ? mimeType : fallbackMime };
    }
    throw mediaError('PI_MEDIA_RESPONSE_INVALID', 'The speech provider response did not contain audio.');
  }
  return { data: raw, mimeType: MIME_EXTENSIONS[declared] ? declared : fallbackMime };
}

async function writeArtifact(projectRoot, buffer, mimeType, kind, title) {
  const directory = await resolvePiToolPath(projectRoot, 'artifacts/agent');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const extension = MIME_EXTENSIONS[mimeType] || (kind === 'image' ? 'png' : 'bin');
  const id = crypto.randomUUID();
  const file = await resolvePiToolPath(projectRoot, path.join(directory, `${id}.${extension}`));
  await fs.writeFile(file, buffer, { flag: 'wx', mode: 0o600 });
  return {
    id,
    path: path.relative(projectRoot, file),
    title,
    kind,
    mimeType,
    size: buffer.length,
  };
}

async function readProjectFile(projectRoot, relativePath, kind) {
  const file = await resolvePiToolPath(projectRoot, requireText(relativePath, `${kind} path`, 2000));
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw mediaError('PI_MEDIA_INPUT_INVALID', `${kind} must be an existing project file.`);
  const limit = kind === 'audio' ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;
  if (stat.size > limit) throw mediaError('PI_MEDIA_INPUT_INVALID', `${kind} exceeds the ${Math.round(limit / 1024 / 1024)} MB limit.`);
  return {
    file,
    name: path.basename(file),
    mimeType: INPUT_MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    data: await fs.readFile(file),
  };
}

async function imageBuffersFromResponse(response, downloadFetch) {
  if (!response.ok) await responseFailure(response);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.startsWith('image/')) {
    const data = await boundedBuffer(response, MAX_IMAGE_BYTES);
    return [{ data, mimeType: imageMime(data, contentType.split(';')[0]) }];
  }
  const raw = await boundedBuffer(response, MAX_IMAGE_BYTES * 2);
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    throw mediaError('PI_MEDIA_RESPONSE_INVALID', 'The image provider returned neither image data nor valid JSON.');
  }
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const images = [];
  for (const entry of entries.slice(0, 4)) {
    const encoded = entry?.b64_json || entry?.b64 || entry?.base64;
    if (typeof encoded === 'string' && encoded.length > 0) {
      const data = Buffer.from(encoded, 'base64');
      if (data.length > 0 && data.length <= MAX_IMAGE_BYTES) images.push({ data, mimeType: imageMime(data) });
      continue;
    }
    const url = entry?.url || entry?.image_url;
    if (typeof url === 'string' && url) {
      const downloaded = await downloadFetch(url, { headers: { accept: 'image/*' } });
      if (!downloaded.ok) throw mediaError('PI_MEDIA_DOWNLOAD_FAILED', `Generated image download failed (HTTP ${downloaded.status}).`);
      const data = await boundedBuffer(downloaded, MAX_IMAGE_BYTES);
      images.push({ data, mimeType: imageMime(data, downloaded.headers.get('content-type') || '') });
    }
  }
  if (images.length === 0) throw mediaError('PI_MEDIA_RESPONSE_INVALID', 'The image provider response did not contain an image.');
  return images;
}

export function createPiModelMedia({ fetchImpl = globalThis.fetch, downloadFetch = publicFetch } = {}) {
  async function listCapabilities(input, context) {
    const requestedTask = typeof input.task === 'string' ? input.task.trim().toLowerCase() : '';
    const allowedTasks = [...PI_MODEL_TASKS, 'vision'];
    if (requestedTask && !allowedTasks.includes(requestedTask)) {
      throw mediaError('PI_MEDIA_INPUT_INVALID', `Unsupported model capability: ${requestedTask}.`);
    }
    const tasks = requestedTask ? [requestedTask] : allowedTasks;
    return {
      capabilities: tasks.map((task) => {
        const catalogTask = task === 'vision' ? 'chat' : task;
        const models = listPiTaskModels(context.userId, catalogTask)
          .filter((model) => task !== 'vision' || model.capability?.traits?.includes('vision_input'))
          .slice(0, 64)
          .map((model) => {
            const protocol = model.capability?.protocol || null;
            return {
              id: model.id,
              label: model.label,
              provider: model.providerName,
              protocol,
              traits: Array.isArray(model.capability?.traits) ? [...model.capability.traits] : [],
              default: model.default === true,
              callable: task === 'vision' || task === 'chat'
                ? true
                : isPiAgentCapabilityCallable(model.capability),
            };
          });
        return {
          task,
          available: models.length > 0,
          callable: models.some((model) => model.callable),
          models,
        };
      }),
    };
  }

  async function selectionFor(context, task, input) {
    const selection = resolvePiTaskModel(context.userId, task, {
      modelRef: input.model_ref,
      protocols: PI_AGENT_TASK_PROTOCOLS[task],
    });
    if (!selection) {
      throw mediaError(
        'PI_MEDIA_MODEL_NOT_CONFIGURED',
        `No enabled ${task.replaceAll('_', ' ')} model is configured. Add one in Settings → medhelpOS → Models.`,
      );
    }
    return selection;
  }

  async function generateImage(input, context, edit = false) {
    const task = edit ? 'image_edit' : 'image_generation';
    const selection = await selectionFor(context, task, input);
    const prompt = requireText(input.prompt, 'Prompt', 32_000);
    const protocol = selection.capability?.protocol;
    let response;
    if (protocol === 'gemini.generate_content') {
      const parts = [{ text: prompt }];
      if (edit) {
        const image = await readProjectFile(context.projectRoot, input.image_path, 'image');
        parts.push({ inline_data: { mime_type: image.mimeType, data: image.data.toString('base64') } });
        if (input.mask_path) {
          const mask = await readProjectFile(context.projectRoot, input.mask_path, 'image');
          parts.push({ inline_data: { mime_type: mask.mimeType, data: mask.data.toString('base64') } });
        }
      }
      const count = Math.min(4, Math.max(1, Number(input.count) || 1));
      const generated = [];
      for (let index = 0; index < count; index += 1) {
        response = await fetchImpl(
          modelEndpoint(selection, `models/${encodeURIComponent(selection.model.id)}:generateContent`),
          {
            method: 'POST',
            headers: { 'x-goog-api-key': selection.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
            }),
            signal: context.signal,
          },
        );
        generated.push(...await imagesFromGeminiResponse(response));
      }
      response = null;
      const artifacts = [];
      for (const [index, image] of generated.slice(0, 4).entries()) {
        artifacts.push(await writeArtifact(
          context.projectRoot,
          image.data,
          image.mimeType,
          'image',
          `${edit ? 'Edited' : 'Generated'} image${generated.length > 1 ? ` ${index + 1}` : ''}`,
        ));
      }
      return {
        task,
        model: selection.selectionModelId,
        artifacts,
        text: `${artifacts.length} image artifact(s) saved in the project.`,
      };
    }
    if (edit) {
      const image = await readProjectFile(context.projectRoot, input.image_path, 'image');
      const form = new FormData();
      form.set('model', selection.model.id);
      form.set('prompt', prompt);
      form.set('image', new Blob([image.data], { type: image.mimeType }), image.name);
      if (input.mask_path) {
        const mask = await readProjectFile(context.projectRoot, input.mask_path, 'image');
        form.set('mask', new Blob([mask.data], { type: mask.mimeType }), mask.name);
      }
      if (input.size) form.set('size', String(input.size));
      response = await fetchImpl(modelEndpoint(selection, 'images/edits'), {
        method: 'POST', headers: providerHeaders(selection), body: form, signal: context.signal,
      });
    } else {
      const body = {
        model: selection.model.id,
        prompt,
        n: Math.min(4, Math.max(1, Number(input.count) || 1)),
        ...(input.size ? { size: String(input.size) } : {}),
        ...(input.quality ? { quality: String(input.quality) } : {}),
      };
      response = await fetchImpl(modelEndpoint(selection, 'images/generations'), {
        method: 'POST',
        headers: providerHeaders(selection, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        signal: context.signal,
      });
    }
    const images = await imageBuffersFromResponse(response, downloadFetch);
    const artifacts = [];
    for (const [index, image] of images.entries()) {
      artifacts.push(await writeArtifact(
        context.projectRoot,
        image.data,
        image.mimeType,
        'image',
        `${edit ? 'Edited' : 'Generated'} image${images.length > 1 ? ` ${index + 1}` : ''}`,
      ));
    }
    return {
      task,
      model: selection.selectionModelId,
      artifacts,
      text: `${artifacts.length} image artifact(s) saved in the project.`,
    };
  }

  async function synthesizeSpeech(input, context) {
    const selection = await selectionFor(context, 'speech_synthesis', input);
    const text = requireText(input.text, 'Text', 32_000);
    const format = String(input.format || 'mp3').toLowerCase();
    if (!['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'].includes(format)) {
      throw mediaError('PI_MEDIA_INPUT_INVALID', 'Unsupported audio format.');
    }
    const protocol = selection.capability?.protocol;
    const fallbackMime = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/opus', aac: 'audio/aac', flac: 'audio/flac', pcm: 'application/octet-stream' }[format];
    let audio;
    if (protocol === 'minimax.t2a') {
      const response = await fetchImpl(modelEndpoint(selection, 't2a_v2'), {
        method: 'POST',
        headers: providerHeaders(selection, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: selection.model.id,
          text,
          ...(input.voice ? { voice_setting: { voice_id: String(input.voice) } } : {}),
          audio_setting: { format },
        }),
        signal: context.signal,
      });
      if (!response.ok) await responseFailure(response);
      const raw = await boundedBuffer(response, MAX_AUDIO_BYTES * 2);
      let payload;
      try { payload = JSON.parse(raw.toString('utf8')); } catch { throw mediaError('PI_MEDIA_RESPONSE_INVALID', 'MiniMax returned invalid speech JSON.'); }
      const encoded = payload?.data?.audio;
      if (typeof encoded !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(encoded)) {
        throw mediaError('PI_MEDIA_RESPONSE_INVALID', payload?.base_resp?.status_msg || 'MiniMax speech response did not contain hexadecimal audio.');
      }
      audio = { data: Buffer.from(encoded, 'hex'), mimeType: fallbackMime };
    } else if (protocol === 'mimo.chat_tts') {
      const response = await fetchImpl(modelEndpoint(selection, 'chat/completions'), {
        method: 'POST',
        headers: providerHeaders(selection, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: selection.model.id,
          messages: [{ role: 'assistant', content: text }],
          audio: {
            format,
            ...(input.voice ? { voice: String(input.voice) } : {}),
          },
          stream: false,
        }),
        signal: context.signal,
      });
      if (!response.ok) await responseFailure(response);
      const raw = await boundedBuffer(response, MAX_AUDIO_BYTES * 2);
      let payload;
      try { payload = JSON.parse(raw.toString('utf8')); } catch { throw mediaError('PI_MEDIA_RESPONSE_INVALID', 'MiMo returned invalid speech JSON.'); }
      const encoded = payload?.choices?.[0]?.message?.audio?.data;
      if (typeof encoded !== 'string' || !encoded) throw mediaError('PI_MEDIA_RESPONSE_INVALID', 'MiMo speech response did not contain audio.');
      audio = { data: Buffer.from(encoded, 'base64'), mimeType: fallbackMime };
    } else {
      if (protocol === 'stepfun.audio_speech' && !String(input.voice || '').trim()) {
        throw mediaError('PI_MEDIA_INPUT_INVALID', 'StepFun speech synthesis requires a provider voice ID.');
      }
      const response = await fetchImpl(modelEndpoint(selection, 'audio/speech'), {
        method: 'POST',
        headers: providerHeaders(selection, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: selection.model.id,
          input: text,
          voice: String(input.voice || 'alloy'),
          response_format: format,
          ...(Number.isFinite(Number(input.speed)) ? { speed: Math.min(4, Math.max(0.25, Number(input.speed))) } : {}),
        }),
        signal: context.signal,
      });
      audio = await audioFromResponse(response, fallbackMime, downloadFetch);
    }
    const artifact = await writeArtifact(context.projectRoot, audio.data, audio.mimeType, 'audio', 'Synthesized speech');
    return { task: 'speech_synthesis', model: selection.selectionModelId, artifact, artifacts: [artifact], text: 'Speech audio saved in the project.' };
  }

  async function transcribeSpeech(input, context) {
    const selection = await selectionFor(context, 'speech_recognition', input);
    const audio = await readProjectFile(context.projectRoot, input.audio_path, 'audio');
    const protocol = selection.capability?.protocol;
    let response;
    if (protocol === 'stepfun.asr_sse') {
      const format = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'm4a' }[audio.mimeType];
      if (!format) throw mediaError('PI_MEDIA_INPUT_INVALID', 'StepFun speech recognition supports MP3, OGG, WAV, or M4A input.');
      response = await fetchImpl(modelEndpoint(selection, 'audio/asr/sse'), {
        method: 'POST',
        headers: providerHeaders(selection, { 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
        body: JSON.stringify({
          audio: {
            data: audio.data.toString('base64'),
            input: {
              transcription: {
                model: selection.model.id,
                ...(input.language ? { language: String(input.language) } : {}),
                ...(input.prompt ? { prompt: String(input.prompt).slice(0, 4000) } : {}),
              },
              format: { type: format },
            },
          },
        }),
        signal: context.signal,
      });
    } else if (protocol === 'mimo.chat_asr') {
      const format = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav' }[audio.mimeType];
      if (!format) throw mediaError('PI_MEDIA_INPUT_INVALID', 'MiMo speech recognition only supports MP3 or WAV input.');
      const encoded = audio.data.toString('base64');
      if (encoded.length > 10 * 1024 * 1024) throw mediaError('PI_MEDIA_INPUT_INVALID', 'MiMo Base64 audio exceeds its 10 MB limit.');
      response = await fetchImpl(modelEndpoint(selection, 'chat/completions'), {
        method: 'POST',
        headers: providerHeaders(selection, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: selection.model.id,
          messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: encoded, format } }] }],
          ...(input.language ? { asr_options: { language: String(input.language) } } : {}),
          stream: false,
        }),
        signal: context.signal,
      });
    } else {
      const form = new FormData();
      form.set('model', selection.model.id);
      form.set('file', new Blob([audio.data], { type: audio.mimeType }), audio.name);
      if (input.language) form.set('language', String(input.language));
      if (input.prompt) form.set('prompt', String(input.prompt).slice(0, 4000));
      response = await fetchImpl(modelEndpoint(selection, 'audio/transcriptions'), {
        method: 'POST', headers: providerHeaders(selection), body: form, signal: context.signal,
      });
    }
    if (!response.ok) await responseFailure(response);
    const raw = await boundedBuffer(response, 4 * 1024 * 1024);
    const body = raw.toString('utf8').trim();
    let transcript = body;
    if (protocol === 'stepfun.asr_sse') {
      const events = body.split(/\r?\n/).filter((line) => line.startsWith('data:')).flatMap((line) => {
        try { return [JSON.parse(line.slice(5).trim())]; } catch { return []; }
      });
      const done = [...events].reverse().find((event) => event.type === 'transcript.text.done');
      transcript = done?.text ?? events.filter((event) => event.type === 'transcript.text.delta').map((event) => event.delta || '').join('');
      if (transcript === undefined) throw mediaError('PI_MEDIA_RESPONSE_INVALID', 'StepFun ASR returned no recognizable transcript event.');
    } else try {
      const payload = JSON.parse(body);
      transcript = protocol === 'mimo.chat_asr'
        ? payload?.choices?.[0]?.message?.content
        : (payload?.text || payload?.transcript || body);
    } catch {
      // Some compatible providers return text/plain.
    }
    return { task: 'speech_recognition', model: selection.selectionModelId, text: String(transcript), untrusted: false };
  }

  return {
    async execute(name, input, context) {
      if (name === 'model_capabilities') return listCapabilities(input, context);
      if (name === 'image_generate') return generateImage(input, context, false);
      if (name === 'image_edit') return generateImage(input, context, true);
      if (name === 'speech_synthesize') return synthesizeSpeech(input, context);
      if (name === 'speech_transcribe') return transcribeSpeech(input, context);
      throw new Error(`Unsupported model media tool: ${name}`);
    },
  };
}
