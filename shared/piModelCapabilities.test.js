import { describe, expect, it } from 'vitest';

import {
  inferPiModelCapabilities,
  isPiAgentCapabilityCallable,
  modelSupportsPiTask,
  normalizePiModelCapabilities,
} from './piModelCapabilities.js';

describe('Pi task-scoped model capabilities', () => {
  it('classifies chat, image, speech and specialist models by task', () => {
    expect(inferPiModelCapabilities({ presetId: 'official-openai' }, 'gpt-image-1').map((item) => item.task))
      .toEqual(['image_generation', 'image_edit']);
    expect(inferPiModelCapabilities({ presetId: 'official-gemini' }, 'gemini-3.1-flash-image'))
      .toEqual([
        expect.objectContaining({ task: 'image_generation', protocol: 'gemini.generate_content' }),
        expect.objectContaining({ task: 'image_edit', protocol: 'gemini.generate_content' }),
      ]);
    expect(inferPiModelCapabilities({ presetId: 'official-openai' }, 'whisper-1').map((item) => item.task))
      .toEqual(['speech_recognition']);
    expect(inferPiModelCapabilities({ presetId: 'stepfun' }, 'stepaudio-2.5-tts'))
      .toEqual([expect.objectContaining({ task: 'speech_synthesis', protocol: 'stepfun.audio_speech' })]);
    expect(inferPiModelCapabilities({ presetId: 'minimax-global' }, 'speech-2.8-hd'))
      .toEqual([expect.objectContaining({ task: 'speech_synthesis', protocol: 'minimax.t2a' })]);
    expect(inferPiModelCapabilities({ presetId: 'xiaomi-mimo' }, 'mimo-v2.5-asr'))
      .toEqual([expect.objectContaining({ task: 'speech_recognition', protocol: 'mimo.chat_asr' })]);
    expect(inferPiModelCapabilities({ presetId: 'official-openai' }, 'gpt-5.6-sol')[0]).toMatchObject({
      task: 'chat',
      traits: expect.arrayContaining(['vision_input', 'function_calling', 'streaming']),
    });
  });

  it('treats persisted capability rows as authoritative', () => {
    const capabilities = normalizePiModelCapabilities([
      { task: 'speech_synthesis', protocol: 'custom.speech', endpoint: '/voice/render' },
      { task: 'unknown' },
      { task: 'speech_synthesis' },
    ], { id: 'custom' }, 'looks-like-chat');
    expect(capabilities).toEqual([expect.objectContaining({
      task: 'speech_synthesis',
      protocol: 'custom.speech',
      endpoint: '/voice/render',
    })]);
    expect(modelSupportsPiTask({ enabled: true, capabilities }, 'speech_synthesis')).toBe(true);
    expect(modelSupportsPiTask({ enabled: false, capabilities }, 'speech_synthesis')).toBe(false);
  });

  it('distinguishes configured capabilities from protocols callable by native Pi tools', () => {
    expect(isPiAgentCapabilityCallable({
      task: 'speech_synthesis',
      protocol: 'minimax.t2a',
    })).toBe(true);
    expect(isPiAgentCapabilityCallable({
      task: 'image_generation',
      protocol: 'gemini.generate_content',
    })).toBe(true);
    expect(isPiAgentCapabilityCallable({
      task: 'speech_recognition',
      protocol: 'mimo.chat_asr',
    })).toBe(true);
    expect(isPiAgentCapabilityCallable({
      task: 'speech_synthesis',
      protocol: 'zhipu.tts',
    })).toBe(false);
    expect(isPiAgentCapabilityCallable({
      task: 'video_generation',
      protocol: 'provider.video',
    })).toBe(false);
  });
});
