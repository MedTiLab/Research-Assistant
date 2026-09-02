import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
const originalLocalKernel = process.env.MEDHELP_LOCAL_KERNEL;
let tempRoot;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

describe('Pi model media tools', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pi-media-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
    process.env.MEDHELP_LOCAL_KERNEL = '1';
    vi.resetModules();
  });

  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (originalLocalKernel === undefined) delete process.env.MEDHELP_LOCAL_KERNEL;
    else process.env.MEDHELP_LOCAL_KERNEL = originalLocalKernel;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('routes image and speech tasks to their configured defaults and writes project artifacts', async () => {
    const database = await import('../database/db.js');
    await database.initializeDatabase();
    const store = await import('../pi-runtime/provider-store.js');
    const provider = store.upsertPiProvider(7001, {
      name: 'Local multimodal',
      providerType: 'local-openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
    });
    store.savePiProviderModels(7001, provider.id, {
      models: [
        { id: 'chat-model', capabilities: [{ task: 'chat', protocol: 'provider.chat' }] },
        { id: 'image-model', capabilities: [{ task: 'image_generation', protocol: 'openai.images' }, { task: 'image_edit', protocol: 'openai.images' }] },
        { id: 'tts-model', capabilities: [{ task: 'speech_synthesis', protocol: 'openai.audio_speech' }] },
        { id: 'tts-unadapted', capabilities: [{ task: 'speech_synthesis', protocol: 'zhipu.tts' }] },
        { id: 'asr-model', capabilities: [{ task: 'speech_recognition', protocol: 'openai.audio_transcriptions' }] },
        { id: 'tts-minimax', capabilities: [{ task: 'speech_synthesis', protocol: 'minimax.t2a' }] },
        { id: 'asr-mimo', capabilities: [{ task: 'speech_recognition', protocol: 'mimo.chat_asr' }] },
        { id: 'asr-stepfun', capabilities: [{ task: 'speech_recognition', protocol: 'stepfun.asr_sse' }] },
      ],
      activeModelIds: {
        chat: 'chat-model',
        image_generation: 'image-model',
        image_edit: 'image-model',
        speech_synthesis: 'tts-model',
        speech_recognition: 'asr-model',
      },
    });

    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/images/generations') || String(url).endsWith('/images/edits')) {
        return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url).endsWith('/audio/speech')) {
        return new Response(Buffer.from('ID3-test-audio'), { headers: { 'content-type': 'audio/mpeg' } });
      }
      if (String(url).endsWith('/audio/transcriptions')) {
        return new Response(JSON.stringify({ text: '测试转写文本' }), { headers: { 'content-type': 'application/json' } });
      }
      if (String(url).endsWith('/t2a_v2')) {
        return new Response(JSON.stringify({ data: { audio: Buffer.from('ID3-minimax').toString('hex') } }), { headers: { 'content-type': 'application/json' } });
      }
      if (String(url).endsWith('/chat/completions')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'MiMo 转写文本' } }] }), { headers: { 'content-type': 'application/json' } });
      }
      if (String(url).endsWith('/audio/asr/sse')) {
        return new Response('data: {"type":"transcript.text.delta","delta":"中间"}\n\ndata: {"type":"transcript.text.done","text":"StepFun 最终文本"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response('not found', { status: 404 });
    });
    const { createPiModelMedia } = await import('../agent-runtime/model-media.js');
    const media = createPiModelMedia({ fetchImpl });
    const context = { userId: 7001, projectRoot: tempRoot };

    const capabilities = await media.execute('model_capabilities', {}, context);
    expect(capabilities.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        task: 'image_generation',
        available: true,
        callable: true,
        models: [expect.objectContaining({
          id: `${provider.id}/image-model`,
          protocol: 'openai.images',
          default: true,
          callable: true,
        })],
      }),
      expect.objectContaining({
        task: 'speech_synthesis',
        available: true,
        callable: true,
        models: expect.arrayContaining([
          expect.objectContaining({ id: `${provider.id}/tts-model`, callable: true }),
          expect.objectContaining({ id: `${provider.id}/tts-unadapted`, callable: false }),
        ]),
      }),
      expect.objectContaining({ task: 'vision', available: false, callable: false, models: [] }),
    ]));
    expect(JSON.stringify(capabilities)).not.toContain('apiKey');
    expect(JSON.stringify(capabilities)).not.toContain('127.0.0.1');

    const generated = await media.execute('image_generate', { prompt: 'a medical diagram' }, context);
    expect(generated).toMatchObject({ model: `${provider.id}/image-model`, artifacts: [expect.objectContaining({ kind: 'image' })] });
    expect(await fs.readFile(path.join(tempRoot, generated.artifacts[0].path))).toEqual(PNG);

    await fs.writeFile(path.join(tempRoot, 'source.png'), PNG);
    const edited = await media.execute('image_edit', { prompt: 'add labels', image_path: 'source.png' }, context);
    expect(edited.model).toBe(`${provider.id}/image-model`);

    const speech = await media.execute('speech_synthesize', { text: '你好', voice: 'alloy' }, context);
    expect(speech).toMatchObject({ model: `${provider.id}/tts-model`, artifact: expect.objectContaining({ kind: 'audio', mimeType: 'audio/mpeg' }) });

    await fs.writeFile(path.join(tempRoot, 'speech.mp3'), Buffer.from('ID3-source'));
    const transcript = await media.execute('speech_transcribe', { audio_path: 'speech.mp3', language: 'zh' }, context);
    expect(transcript).toMatchObject({ model: `${provider.id}/asr-model`, text: '测试转写文本' });
    const minimax = await media.execute('speech_synthesize', { text: '你好', model_ref: `${provider.id}/tts-minimax`, format: 'mp3' }, context);
    expect(await fs.readFile(path.join(tempRoot, minimax.artifact.path))).toEqual(Buffer.from('ID3-minimax'));
    const mimo = await media.execute('speech_transcribe', { audio_path: 'speech.mp3', model_ref: `${provider.id}/asr-mimo` }, context);
    expect(mimo.text).toBe('MiMo 转写文本');
    const stepfun = await media.execute('speech_transcribe', { audio_path: 'speech.mp3', model_ref: `${provider.id}/asr-stepfun` }, context);
    expect(stepfun.text).toBe('StepFun 最终文本');
    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining([
      'http://127.0.0.1:11434/v1/images/generations',
      'http://127.0.0.1:11434/v1/images/edits',
      'http://127.0.0.1:11434/v1/audio/speech',
      'http://127.0.0.1:11434/v1/audio/transcriptions',
    ]));
  });

  it('generates and edits images through the native Gemini generateContent protocol', async () => {
    const database = await import('../database/db.js');
    await database.initializeDatabase();
    const store = await import('../pi-runtime/provider-store.js');
    const provider = store.upsertPiProvider(7001, {
      presetId: 'official-gemini',
      apiKey: 'gemini-image-secret',
    });
    store.savePiProviderModels(7001, provider.id, {
      models: [{
        id: 'gemini-3.1-flash-image',
        capabilities: [
          { task: 'image_generation', protocol: 'gemini.generate_content' },
          { task: 'image_edit', protocol: 'gemini.generate_content' },
        ],
      }],
      activeModelIds: {
        image_generation: 'gemini-3.1-flash-image',
        image_edit: 'gemini-3.1-flash-image',
      },
    });

    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] },
        }],
      }), { headers: { 'content-type': 'application/json' } });
    });
    const { createPiModelMedia } = await import('../agent-runtime/model-media.js');
    const media = createPiModelMedia({ fetchImpl });
    const context = { userId: 7001, projectRoot: tempRoot };

    const capabilities = await media.execute('model_capabilities', { task: 'image_generation' }, context);
    expect(capabilities.capabilities[0]).toMatchObject({
      task: 'image_generation',
      available: true,
      callable: true,
      models: expect.arrayContaining([
        expect.objectContaining({ protocol: 'gemini.generate_content', callable: true }),
      ]),
    });

    const generated = await media.execute('image_generate', { prompt: '医学示意图' }, context);
    await fs.writeFile(path.join(tempRoot, 'gemini-source.png'), PNG);
    const edited = await media.execute('image_edit', {
      prompt: '添加中文标注',
      image_path: 'gemini-source.png',
    }, context);

    expect(generated.model).toBe(`${provider.id}/gemini-3.1-flash-image`);
    expect(edited.model).toBe(`${provider.id}/gemini-3.1-flash-image`);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent');
      expect(call.init.headers).toMatchObject({
        'x-goog-api-key': 'gemini-image-secret',
        'Content-Type': 'application/json',
      });
      expect(call.body.generationConfig.responseModalities).toEqual(['TEXT', 'IMAGE']);
    }
    expect(calls[0].body.contents[0].parts).toEqual([{ text: '医学示意图' }]);
    expect(calls[1].body.contents[0].parts[1]).toMatchObject({
      inline_data: { mime_type: 'image/png', data: PNG.toString('base64') },
    });
  });
});
