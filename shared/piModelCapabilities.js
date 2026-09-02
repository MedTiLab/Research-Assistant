/**
 * Task-scoped model capabilities shared by the Pi settings UI and runtime.
 *
 * A model can serve several independent tasks, while traits refine
 * chat/realtime models.
 * Persisted capability rows are authoritative; name inference is only used to
 * seed newly discovered or manually entered models.
 */

export const PI_MODEL_TASKS = Object.freeze([
  'chat',
  'realtime_conversation',
  'image_generation',
  'image_edit',
  'video_generation',
  'speech_synthesis',
  'speech_recognition',
  'embedding',
  'rerank',
]);

export const PI_MODEL_TRAITS = Object.freeze([
  'vision_input',
  'function_calling',
  'reasoning',
  'web_search',
  'audio_input',
  'audio_output',
  'video_input',
  'realtime',
  'streaming',
]);

export const PI_EXECUTABLE_MEDIA_TASKS = Object.freeze([
  'image_generation',
  'image_edit',
  'speech_synthesis',
  'speech_recognition',
]);

/** Protocols backed by a native medhelpOS Agent tool in this build. */
export const PI_AGENT_TASK_PROTOCOLS = Object.freeze({
  image_generation: Object.freeze([
    'openai.images',
    'gemini.generate_content',
    'stepfun.images',
    'ark.images',
  ]),
  image_edit: Object.freeze([
    'openai.images',
    'gemini.generate_content',
    'stepfun.images',
    'ark.images',
  ]),
  speech_synthesis: Object.freeze([
    'openai.audio_speech',
    'stepfun.audio_speech',
    'minimax.t2a',
    'mimo.chat_tts',
  ]),
  speech_recognition: Object.freeze([
    'openai.audio_transcriptions',
    'stepfun.asr_sse',
    'mimo.chat_asr',
  ]),
});

const TASK_SET = new Set(PI_MODEL_TASKS);
const TRAIT_SET = new Set(PI_MODEL_TRAITS);

const DEFAULT_PROTOCOLS = Object.freeze({
  chat: 'provider.chat',
  realtime_conversation: 'provider.realtime',
  image_generation: 'openai.images',
  image_edit: 'openai.images',
  video_generation: 'provider.video',
  speech_synthesis: 'openai.audio_speech',
  speech_recognition: 'openai.audio_transcriptions',
  embedding: 'openai.embeddings',
  rerank: 'provider.rerank',
});

function protocolFor(platform, task) {
  if (platform === 'gemini' && ['image_generation', 'image_edit'].includes(task)) {
    return 'gemini.generate_content';
  }
  if (platform === 'minimax' && task === 'speech_synthesis') return 'minimax.t2a';
  if (platform === 'minimax' && ['image_generation', 'image_edit'].includes(task)) return 'minimax.images';
  if (platform === 'mimo' && task === 'speech_synthesis') return 'mimo.chat_tts';
  if (platform === 'mimo' && task === 'speech_recognition') return 'mimo.chat_asr';
  if ((platform === 'stepfun' || platform === 'stepfun-plan') && task === 'speech_synthesis') return 'stepfun.audio_speech';
  if ((platform === 'stepfun' || platform === 'stepfun-plan') && task === 'speech_recognition') return 'stepfun.asr_sse';
  if ((platform === 'stepfun' || platform === 'stepfun-plan') && ['image_generation', 'image_edit'].includes(task)) return 'stepfun.images';
  if (platform === 'volcengine' && ['image_generation', 'image_edit'].includes(task)) return 'ark.images';
  if (platform === 'zhipu' && ['image_generation', 'image_edit'].includes(task)) return 'zhipu.images';
  if (platform === 'zhipu' && task === 'speech_synthesis') return 'zhipu.tts';
  if (platform === 'zhipu' && task === 'speech_recognition') return 'zhipu.asr';
  return DEFAULT_PROTOCOLS[task];
}

const PROVIDER_PLATFORM_MAP = Object.freeze({
  'official-openai': 'openai',
  'official-anthropic': 'anthropic',
  'official-gemini': 'gemini',
  bailian: 'dashscope',
  'bailian-global': 'dashscope',
  'bailian-plan': 'dashscope-coding',
  zhipu: 'zhipu',
  'zhipu-global': 'zhipu',
  'glm-coding-plan': 'glm-coding-plan',
  'glm-coding-plan-global': 'glm-coding-plan',
  kimi: 'moonshot-cn',
  'kimi-coding': 'moonshot-cn',
  minimax: 'minimax',
  'minimax-global': 'minimax',
  stepfun: 'stepfun',
  'stepfun-global': 'stepfun',
  'step-plan': 'stepfun-plan',
  'xiaomi-mimo': 'mimo',
  volcengine: 'volcengine',
});

function unique(values) {
  return [...new Set(values)];
}

function leafModelName(modelId) {
  return String(modelId || '').trim().toLowerCase().split('/').pop().replace(/:\w+$/, '');
}

export function resolvePiProviderPlatform(provider = {}) {
  return PROVIDER_PLATFORM_MAP[provider.presetId]
    || String(provider.platform || provider.presetId || provider.id || 'custom').trim().toLowerCase();
}

function verifiedProfile(platform, model) {
  if (platform === 'gemini') {
    if (/^(?:gemini-3\.1-flash(?:-lite)?-image|gemini-3-pro-image|gemini-2\.5-flash-image)$/.test(model)) {
      return { tasks: ['image_generation', 'image_edit'], traits: [] };
    }
  }
  if (platform === 'openai') {
    if (/^(?:gpt-image(?:-|$)|chatgpt-image-latest$)/.test(model)) {
      return { tasks: ['image_generation', 'image_edit'], traits: [] };
    }
    if (/^dall-e-2$/.test(model)) return { tasks: ['image_generation', 'image_edit'], traits: [] };
    if (/^dall-e-3$/.test(model)) return { tasks: ['image_generation'], traits: [] };
  }
  if (platform === 'minimax') {
    if (/^(?:image-01|image-01-live)$/.test(model)) return { tasks: ['image_generation'], traits: [] };
    if (/^speech-2(?:\.|-)/.test(model)) return { tasks: ['speech_synthesis'], traits: [] };
    if (/^(?:minimax-h3|minimax-hailuo)/.test(model)) return { tasks: ['video_generation'], traits: [] };
  }
  if (platform === 'mimo') {
    if (/asr/.test(model)) return { tasks: ['speech_recognition'], traits: [] };
    if (/tts|voiceclone|voicedesign/.test(model)) return { tasks: ['speech_synthesis'], traits: [] };
  }
  if (platform === 'stepfun' || platform === 'stepfun-plan') {
    if (/realtime/.test(model)) {
      return {
        tasks: ['realtime_conversation'],
        traits: ['audio_input', 'audio_output', 'realtime', 'streaming'],
      };
    }
    if (/asr/.test(model)) return { tasks: ['speech_recognition'], traits: [] };
    if (/tts/.test(model)) return { tasks: ['speech_synthesis'], traits: [] };
    if (/image-edit/.test(model)) return { tasks: ['image_generation', 'image_edit'], traits: [] };
  }
  if (platform === 'zhipu' || platform === 'glm-coding-plan') {
    if (/^(?:glm-image|cogview)/.test(model)) return { tasks: ['image_generation'], traits: [] };
    if (/^cogvideo/.test(model)) return { tasks: ['video_generation'], traits: [] };
    if (/asr/.test(model)) return { tasks: ['speech_recognition'], traits: [] };
    if (/tts/.test(model)) return { tasks: ['speech_synthesis'], traits: [] };
    if (/^embedding/.test(model)) return { tasks: ['embedding'], traits: [] };
    if (/rerank/.test(model)) return { tasks: ['rerank'], traits: [] };
  }
  if (platform === 'volcengine' && /seedream/.test(model)) {
    return {
      tasks: ['image_generation', ...(/(?:4[.-][045]|5[.-]0)/.test(model) ? ['image_edit'] : [])],
      traits: [],
    };
  }
  if (platform === 'moonshot-cn' && /^(?:kimi-k3|kimi-k2\.[567])/.test(model)) {
    return { tasks: ['chat'], traits: ['vision_input', 'streaming'] };
  }
  return null;
}

/** Seed task capabilities for a newly added model. */
export function inferPiModelCapabilities(provider, modelId, hints = {}) {
  const platform = resolvePiProviderPlatform(provider);
  const model = leafModelName(modelId);
  const verified = verifiedProfile(platform, model);
  let tasks = verified?.tasks || [];
  let traits = verified?.traits || [];

  if (tasks.length === 0) {
    if (/(?:rerank)/.test(model)) tasks.push('rerank');
    else if (/(?:embed|text-embedding|bge-|gte-|(?:^|-)e5-)/.test(model)) tasks.push('embedding');
    else if (/(?:whisper|(?:^|[-_.])asr(?:[-_.]|$)|transcrib|speech-to-text|sensevoice|paraformer|nova-[23])/.test(model)) tasks.push('speech_recognition');
    else if (/(?:tts|text-to-speech|cosyvoice|(?:^|-)voice(?:-|$)|speech-[0-9]|sovits)/.test(model)) tasks.push('speech_synthesis');
    else if (/(?:video|sora|hailuo|veo)/.test(model)) tasks.push('video_generation');
    else if (/(?:gpt-image|dall-e|seedream|cogview|(?:^|[-_.])image(?:[-_.]|$))/.test(model)) tasks.push('image_generation');
    else if (/realtime/.test(model)) tasks.push('realtime_conversation');
    else tasks.push('chat');
  }

  if (tasks.includes('image_generation') && /(?:edit|inpaint)/.test(model)) tasks.push('image_edit');
  if (tasks.includes('chat')) {
    if (hints.vision === true || /(?:vision|vl|gpt-4o|gpt-5|gemini|glm-4v|glm-5v)/.test(model)) traits.push('vision_input');
    if (hints.reasoning === true || /(?:reason|thinking|deepseek-r1|o[134](?:-|$))/.test(model)) traits.push('reasoning');
    traits.push('function_calling', 'streaming');
  }
  if (tasks.includes('realtime_conversation')) {
    traits.push('audio_input', 'audio_output', 'realtime', 'streaming');
  }

  return unique(tasks).map((task) => ({
    task,
    traits: unique(traits.filter((trait) => TRAIT_SET.has(trait))),
    protocol: protocolFor(platform, task),
    enabled: true,
  }));
}

export function normalizePiModelCapabilities(input, provider, modelId, hints = {}) {
  const raw = Array.isArray(input) ? input : [];
  const normalized = [];
  const seen = new Set();
  for (const entry of raw) {
    const value = typeof entry === 'string' ? { task: entry } : entry;
    const task = String(value?.task || '').trim().toLowerCase();
    if (!TASK_SET.has(task) || seen.has(task)) continue;
    const traits = Array.isArray(value.traits)
      ? unique(value.traits.map((trait) => String(trait).trim().toLowerCase()).filter((trait) => TRAIT_SET.has(trait)))
      : [];
    const protocol = typeof value.protocol === 'string' && value.protocol.trim().length <= 120
      ? value.protocol.trim()
      : DEFAULT_PROTOCOLS[task];
    const endpoint = typeof value.endpoint === 'string' && value.endpoint.trim().length <= 500
      ? value.endpoint.trim()
      : null;
    normalized.push({
      task,
      traits,
      protocol,
      ...(endpoint ? { endpoint } : {}),
      enabled: value.enabled !== false,
    });
    seen.add(task);
  }
  return normalized.length > 0 ? normalized : inferPiModelCapabilities(provider, modelId, hints);
}

export function modelSupportsPiTask(model, task) {
  return model?.enabled !== false && Array.isArray(model?.capabilities)
    && model.capabilities.some((capability) => capability.task === task && capability.enabled !== false);
}

export function getPiCapability(model, task) {
  return model?.capabilities?.find((capability) => capability.task === task && capability.enabled !== false) || null;
}

export function isPiAgentCapabilityCallable(capability) {
  const protocols = PI_AGENT_TASK_PROTOCOLS[capability?.task];
  return Array.isArray(protocols) && protocols.includes(capability?.protocol);
}
