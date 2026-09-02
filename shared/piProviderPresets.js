/**
 * Curated Pi provider presets for Chinese model vendors.
 *
 * Keep this catalog shared by the settings UI and the server-side credential
 * store so a preset always seeds the same endpoint and model metadata that the
 * runtime will use. The catalog mirrors the provider registry maintained in
 * qm_research; region-specific and subscription endpoints remain separate so
 * users never have to guess which base URL belongs to their API key.
 */

const model = (id, contextWindow, label = id) => Object.freeze({ id, label, contextWindow });
const reasoningModel = (id, contextWindow, maxTokens, label = id) => Object.freeze({
  id,
  label,
  contextWindow,
  maxTokens,
  reasoning: true,
});

const freezePreset = (preset) => Object.freeze({
  discoverModels: preset.discoverModels !== false,
  ...preset,
  models: Object.freeze(preset.models),
});

/**
 * Official API defaults also act as a compatibility migration for providers
 * saved before model auto-seeding existed. The settings catalogue exposes
 * these alongside the regional provider presets.
 */
export const PI_OFFICIAL_PROVIDER_PRESETS = Object.freeze([
  freezePreset({
    id: 'official-gemini',
    name: 'Gemini / Google AI',
    providerType: 'byok-openai-compatible',
    modelApi: 'openai-completions',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    models: [
      model('gemini-3.1-flash-image', 65_536, 'Gemini 3.1 Flash Image'),
      model('gemini-3.1-flash-lite-image', 65_536, 'Gemini 3.1 Flash Lite Image'),
      model('gemini-3-pro-image', 65_536, 'Gemini 3 Pro Image'),
      model('gemini-2.5-flash-image', 32_768, 'Gemini 2.5 Flash Image'),
    ],
  }),
  freezePreset({
    id: 'official-anthropic',
    name: 'Claude',
    providerType: 'byok-anthropic-compatible',
    modelApi: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      reasoningModel('claude-sonnet-4-6', 1_000_000, 128_000, 'Claude Sonnet 4.6'),
      reasoningModel('claude-opus-5', 1_000_000, 128_000, 'Claude Opus 5'),
      reasoningModel('claude-sonnet-5', 1_000_000, 128_000, 'Claude Sonnet 5'),
      reasoningModel('claude-fable-5', 1_000_000, 128_000, 'Claude Fable 5'),
      reasoningModel('claude-opus-4-8', 1_000_000, 128_000, 'Claude Opus 4.8'),
      reasoningModel('claude-opus-4-7', 1_000_000, 128_000, 'Claude Opus 4.7'),
      reasoningModel('claude-opus-4-6', 1_000_000, 128_000, 'Claude Opus 4.6'),
      reasoningModel('claude-sonnet-4-5', 1_000_000, 64_000, 'Claude Sonnet 4.5'),
      reasoningModel('claude-haiku-4-5', 200_000, 64_000, 'Claude Haiku 4.5'),
    ],
  }),
  freezePreset({
    id: 'official-openai',
    name: 'OpenAI',
    providerType: 'byok-openai-compatible',
    modelApi: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    models: [
      reasoningModel('gpt-5.6-sol', 272_000, 128_000, 'GPT-5.6 Sol'),
      reasoningModel('gpt-5.6-terra', 272_000, 128_000, 'GPT-5.6 Terra'),
      reasoningModel('gpt-5.6-luna', 272_000, 128_000, 'GPT-5.6 Luna'),
      reasoningModel('gpt-5.5', 272_000, 128_000, 'GPT-5.5'),
      reasoningModel('gpt-5.4', 272_000, 128_000, 'GPT-5.4'),
      reasoningModel('gpt-5.4-mini', 400_000, 128_000, 'GPT-5.4 Mini'),
      reasoningModel('gpt-5.3-codex', 400_000, 128_000, 'GPT-5.3 Codex'),
      reasoningModel('gpt-5.2', 400_000, 128_000, 'GPT-5.2'),
      model('gpt-image-2', 32_000, 'GPT Image 2'),
      model('gpt-image-1.5', 32_000, 'GPT Image 1.5'),
      model('gpt-4o-mini-tts', 32_000, 'GPT-4o mini TTS'),
      model('whisper-1', 32_000, 'Whisper 1'),
    ],
  }),
]);

export const PI_DOMESTIC_PROVIDER_PRESETS = Object.freeze([
  {
    id: 'deepseek',
    name: 'DeepSeek',
    region: 'china',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      model('deepseek-v4-pro', 1_000_000, 'DeepSeek V4 Pro'),
      model('deepseek-v4-pro[1m]', 1_000_000, 'DeepSeek V4 Pro (1M)'),
      model('deepseek-v4-flash', 1_000_000, 'DeepSeek V4 Flash'),
    ],
  },
  {
    id: 'bailian',
    name: '阿里云百炼',
    region: 'china',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyUrl: 'https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key',
    models: [
      model('qwen3.8-max', 983_616, 'Qwen 3.8 Max'),
      model('qwen3.7-plus', 1_000_000, 'Qwen 3.7 Plus'),
      model('qwen3.7-max', 1_000_000, 'Qwen 3.7 Max'),
      model('qwen3.7-flash', 1_000_000, 'Qwen 3.7 Flash'),
      model('qwen3.6-plus', 1_000_000, 'Qwen 3.6 Plus'),
      model('qwen3.6-flash', 1_000_000, 'Qwen 3.6 Flash'),
      model('deepseek-v4-flash-0731', 1_000_000, 'DeepSeek V4 Flash 0731'),
      model('deepseek-v4-pro', 1_000_000, 'DeepSeek V4 Pro'),
      model('deepseek-v4-flash', 1_000_000, 'DeepSeek V4 Flash'),
    ],
  },
  {
    id: 'bailian-global',
    name: 'Alibaba Cloud Model Studio',
    region: 'global',
    baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
    apiKeyUrl: 'https://modelstudio.console.alibabacloud.com/us-east-1?tab=model#/api-key',
    models: [
      model('qwen3.8-max', 983_616, 'Qwen 3.8 Max'),
      model('qwen3.7-plus', 1_000_000, 'Qwen 3.7 Plus'),
      model('qwen3.7-max', 1_000_000, 'Qwen 3.7 Max'),
      model('qwen3.7-flash', 1_000_000, 'Qwen 3.7 Flash'),
      model('qwen3.6-plus', 1_000_000, 'Qwen 3.6 Plus'),
      model('qwen3.6-flash', 1_000_000, 'Qwen 3.6 Flash'),
    ],
  },
  {
    id: 'bailian-plan',
    name: '阿里云百炼 Coding Plan',
    region: 'chinaSubscription',
    baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    apiKeyUrl: 'https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/overview',
    discoverModels: false,
    models: [
      model('qwen3.8-max', 983_616, 'Qwen 3.8 Max'),
      model('qwen3.8-max-preview', 983_616, 'Qwen 3.8 Max Preview'),
      model('qwen3.7-max', 1_000_000, 'Qwen 3.7 Max'),
      model('qwen3.7-plus', 1_000_000, 'Qwen 3.7 Plus'),
      model('qwen3.6-flash', 1_000_000, 'Qwen 3.6 Flash'),
      model('glm-5.2', 1_000_000, 'GLM 5.2'),
      model('deepseek-v4-pro', 1_000_000, 'DeepSeek V4 Pro'),
      model('deepseek-v4-flash-0731', 1_000_000, 'DeepSeek V4 Flash 0731'),
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 AI (GLM)',
    region: 'china',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    models: [
      model('glm-5.2', 1_000_000, 'GLM 5.2'),
      model('glm-5.1', 200_000, 'GLM 5.1'),
      model('glm-5', 200_000, 'GLM 5'),
      model('glm-5v-turbo', 200_000, 'GLM 5V Turbo'),
      model('glm-5-turbo', 200_000, 'GLM 5 Turbo'),
      model('glm-image', 32_000, 'GLM Image'),
      model('glm-asr-2512', 32_000, 'GLM ASR'),
      model('glm-tts', 32_000, 'GLM TTS'),
      model('cogvideox-3', 32_000, 'CogVideoX 3'),
      model('embedding-3', 32_000, 'Embedding 3'),
      model('rerank', 32_000, 'Rerank'),
    ],
  },
  {
    id: 'zhipu-global',
    name: 'Z.AI (GLM)',
    region: 'global',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    apiKeyUrl: 'https://z.ai',
    models: [
      model('glm-5.2', 1_000_000, 'GLM 5.2'),
      model('glm-5.1', 200_000, 'GLM 5.1'),
      model('glm-5', 200_000, 'GLM 5'),
      model('glm-5v-turbo', 200_000, 'GLM 5V Turbo'),
      model('glm-5-turbo', 200_000, 'GLM 5 Turbo'),
      model('glm-image', 32_000, 'GLM Image'),
      model('glm-asr-2512', 32_000, 'GLM ASR'),
      model('glm-tts', 32_000, 'GLM TTS'),
      model('cogvideox-3', 32_000, 'CogVideoX 3'),
      model('embedding-3', 32_000, 'Embedding 3'),
      model('rerank', 32_000, 'Rerank'),
    ],
  },
  {
    id: 'glm-coding-plan',
    name: 'GLM Coding Plan',
    region: 'chinaSubscription',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    apiKeyUrl: 'https://bigmodel.cn/glm-coding',
    discoverModels: false,
    models: [
      model('glm-5.2', 1_000_000, 'GLM 5.2'),
      model('glm-5.1', 200_000, 'GLM 5.1'),
      model('glm-5', 200_000, 'GLM 5'),
      model('glm-5-turbo', 200_000, 'GLM 5 Turbo'),
    ],
  },
  {
    id: 'glm-coding-plan-global',
    name: 'GLM Coding Plan',
    region: 'globalSubscription',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    apiKeyUrl: 'https://z.ai/subscribe',
    discoverModels: false,
    models: [
      model('glm-5.2', 1_000_000, 'GLM 5.2'),
      model('glm-5.1', 200_000, 'GLM 5.1'),
      model('glm-5', 200_000, 'GLM 5'),
      model('glm-5-turbo', 200_000, 'GLM 5 Turbo'),
    ],
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    region: 'china',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyUrl: 'https://platform.kimi.com/console',
    models: [
      model('kimi-k3', 1_000_000, 'Kimi K3'),
      model('kimi-k2.7-code', 256_000, 'Kimi K2.7 Code'),
      model('kimi-k2.6', 256_000, 'Kimi K2.6'),
      model('kimi-k2.5', 256_000, 'Kimi K2.5'),
    ],
  },
  {
    id: 'kimi-coding',
    name: 'Kimi For Coding',
    region: 'chinaSubscription',
    baseUrl: 'https://api.kimi.com/coding/v1',
    apiKeyUrl: 'https://www.kimi.com/code/docs',
    discoverModels: false,
    models: [
      model('kimi-k3', 1_000_000, 'Kimi K3'),
      model('kimi-for-coding', 256_000, 'Kimi For Coding'),
      model('kimi-for-coding-highspeed', 256_000, 'Kimi For Coding High-speed'),
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    region: 'china',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    models: [
      model('MiniMax-M3', 1_000_000, 'MiniMax M3'),
      model('MiniMax-M3[1m]', 1_000_000, 'MiniMax M3 (1M)'),
      model('MiniMax-M2.7', 204_800, 'MiniMax M2.7'),
      model('MiniMax-M2.5', 204_800, 'MiniMax M2.5'),
      model('image-01', 32_000, 'Image 01'),
      model('image-01-live', 32_000, 'Image 01 Live'),
      model('speech-2.8-hd', 32_000, 'Speech 2.8 HD'),
      model('speech-2.8-turbo', 32_000, 'Speech 2.8 Turbo'),
      model('MiniMax-H3', 32_000, 'MiniMax H3 Video'),
    ],
  },
  {
    id: 'minimax-global',
    name: 'MiniMax',
    region: 'global',
    baseUrl: 'https://api.minimax.io/v1',
    apiKeyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    models: [
      model('MiniMax-M3', 1_000_000, 'MiniMax M3'),
      model('MiniMax-M3[1m]', 1_000_000, 'MiniMax M3 (1M)'),
      model('MiniMax-M2.7', 204_800, 'MiniMax M2.7'),
      model('MiniMax-M2.5', 204_800, 'MiniMax M2.5'),
      model('image-01', 32_000, 'Image 01'),
      model('image-01-live', 32_000, 'Image 01 Live'),
      model('speech-2.8-hd', 32_000, 'Speech 2.8 HD'),
      model('speech-2.8-turbo', 32_000, 'Speech 2.8 Turbo'),
      model('MiniMax-H3', 32_000, 'MiniMax H3 Video'),
    ],
  },
  {
    id: 'stepfun',
    name: '阶跃星辰 StepFun',
    region: 'china',
    baseUrl: 'https://api.stepfun.com/v1',
    apiKeyUrl: 'https://platform.stepfun.com/interface-key',
    models: [
      model('step-3.7-flash', 262_144, 'Step 3.7 Flash'),
      model('step-3.5-flash', 262_144, 'Step 3.5 Flash'),
      model('step-image-edit-2', 32_000, 'Step Image Edit 2'),
      model('stepaudio-2.5-tts', 32_000, 'StepAudio 2.5 TTS'),
      model('stepaudio-2.5-asr', 32_000, 'StepAudio 2.5 ASR'),
      model('stepaudio-2.5-realtime', 32_000, 'StepAudio 2.5 Realtime'),
    ],
  },
  {
    id: 'stepfun-global',
    name: 'StepFun',
    region: 'global',
    baseUrl: 'https://api.stepfun.ai/v1',
    apiKeyUrl: 'https://platform.stepfun.ai/interface-key',
    models: [
      model('step-3.7-flash', 262_144, 'Step 3.7 Flash'),
      model('step-3.5-flash', 262_144, 'Step 3.5 Flash'),
      model('step-image-edit-2', 32_000, 'Step Image Edit 2'),
      model('stepaudio-2.5-tts', 32_000, 'StepAudio 2.5 TTS'),
      model('stepaudio-2.5-asr', 32_000, 'StepAudio 2.5 ASR'),
      model('stepaudio-2.5-realtime', 32_000, 'StepAudio 2.5 Realtime'),
    ],
  },
  {
    id: 'step-plan',
    name: 'Step Plan',
    region: 'chinaSubscription',
    baseUrl: 'https://api.stepfun.com/step_plan/v1',
    apiKeyUrl: 'https://platform.stepfun.com/plan-subscribe',
    discoverModels: false,
    models: [
      model('step-3.7-flash', 262_144, 'Step 3.7 Flash'),
      model('step-3.5-flash', 262_144, 'Step 3.5 Flash'),
      model('step-3.5-flash-2603', 262_144, 'Step 3.5 Flash 2603'),
      model('step-router-v1', 262_144, 'Step Router V1'),
      model('step-image-edit-2', 32_000, 'Step Image Edit 2'),
      model('stepaudio-2.5-tts', 32_000, 'StepAudio 2.5 TTS'),
      model('stepaudio-2.5-asr', 32_000, 'StepAudio 2.5 ASR'),
      model('stepaudio-2.5-realtime', 32_000, 'StepAudio 2.5 Realtime'),
    ],
  },
  {
    id: 'xiaomi-mimo',
    name: '小米 MiMo',
    region: 'china',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    apiKeyUrl: 'https://platform.xiaomimimo.com/console/api-keys',
    models: [
      model('mimo-v2.5-pro', 1_000_000, 'MiMo V2.5 Pro'),
      model('mimo-v2.5', 1_000_000, 'MiMo V2.5'),
      model('mimo-v2.5-asr', 32_000, 'MiMo V2.5 ASR'),
      model('mimo-v2.5-tts', 32_000, 'MiMo V2.5 TTS'),
      model('mimo-v2.5-tts-voicedesign', 32_000, 'MiMo V2.5 TTS Voice Design'),
      model('mimo-v2.5-tts-voiceclone', 32_000, 'MiMo V2.5 TTS Voice Clone'),
    ],
  },
  {
    id: 'sensenova',
    name: '商汤日日新 SenseNova',
    region: 'chinaSubscription',
    baseUrl: 'https://token.sensenova.cn/v1',
    apiKeyUrl: 'https://platform.sensenova.cn/token-plan',
    models: [
      model('sensenova-6.7-flash-lite', 256_000, 'SenseNova 6.7 Flash Lite'),
      model('deepseek-v4-flash', 1_000_000, 'DeepSeek V4 Flash'),
    ],
  },
  {
    id: 'volcengine',
    name: '火山引擎方舟',
    region: 'china',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
    models: [
      model('doubao-seed-2-1-pro-260628', 256_000, 'Doubao Seed 2.1 Pro'),
      model('doubao-seed-2-1-turbo-260628', 256_000, 'Doubao Seed 2.1 Turbo'),
      model('doubao-seed-2-0-pro-260215', 256_000, 'Doubao Seed 2.0 Pro'),
      model('doubao-seed-2-0-lite-260215', 256_000, 'Doubao Seed 2.0 Lite'),
      model('doubao-seed-2-0-mini-260215', 256_000, 'Doubao Seed 2.0 Mini'),
      model('doubao-seed-2-0-code-preview-260215', 256_000, 'Doubao Seed 2.0 Code Preview'),
      model('doubao-seedream-5-0-260128', 32_000, 'Doubao Seedream 5.0'),
      model('doubao-seedream-4-5-251128', 32_000, 'Doubao Seedream 4.5'),
    ],
  },
].map((preset) => freezePreset({
  providerType: 'byok-openai-compatible',
  modelApi: 'openai-completions',
  ...preset,
})));

export const PI_PROVIDER_PRESETS = Object.freeze([
  ...PI_OFFICIAL_PROVIDER_PRESETS,
  ...PI_DOMESTIC_PROVIDER_PRESETS,
]);

export function getPiProviderPreset(presetId) {
  const normalized = typeof presetId === 'string' ? presetId.trim().toLowerCase() : '';
  return PI_PROVIDER_PRESETS.find((preset) => preset.id === normalized) || null;
}

export function getPiDomesticProviderPreset(presetId) {
  const normalized = typeof presetId === 'string' ? presetId.trim().toLowerCase() : '';
  return PI_DOMESTIC_PROVIDER_PRESETS.find((preset) => preset.id === normalized) || null;
}

export function inferPiProviderPreset(provider = {}) {
  if (Array.isArray(provider.models) && provider.models.length > 0) return null;
  const providerType = typeof provider.providerType === 'string' ? provider.providerType.trim() : '';
  let normalizedBaseUrl = '';
  try {
    normalizedBaseUrl = new URL(provider.baseUrl).toString().replace(/\/$/, '');
  } catch {
    return null;
  }
  return PI_OFFICIAL_PROVIDER_PRESETS.find((preset) => (
    preset.providerType === providerType
    && new URL(preset.baseUrl).toString().replace(/\/$/, '') === normalizedBaseUrl
  )) || null;
}

export function mergePiProviderPresetModels(presetId, savedModels = []) {
  const preset = getPiProviderPreset(presetId);
  if (!preset) return Array.isArray(savedModels) ? [...savedModels] : [];
  const normalizedSaved = Array.isArray(savedModels) ? savedModels : [];
  const savedById = new Map(normalizedSaved.map((entry) => [entry?.id, entry]));
  const presetIds = new Set(preset.models.map((entry) => entry.id));
  return [
    ...preset.models.map((entry) => ({ ...entry, ...savedById.get(entry.id) })),
    ...normalizedSaved.filter((entry) => entry?.id && !presetIds.has(entry.id)),
  ];
}

export function mergePiDomesticPresetModels(presetId, savedModels = []) {
  return getPiDomesticProviderPreset(presetId)
    ? mergePiProviderPresetModels(presetId, savedModels)
    : (Array.isArray(savedModels) ? [...savedModels] : []);
}
