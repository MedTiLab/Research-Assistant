import { describe, expect, it } from 'vitest';

import {
  getPiModelCapabilitySection,
  modelSupportsPiCapabilitySection,
  orderModelsForPiCapabilitySection,
  PI_MODEL_CAPABILITY_SECTIONS,
} from './piModelCapabilitySections.js';

const models = [
  {
    id: 'chat-only',
    label: 'Chat only',
    enabled: true,
    capabilities: [{ task: 'chat', traits: [] }],
  },
  {
    id: 'vision-chat',
    label: 'Vision chat',
    enabled: true,
    capabilities: [{ task: 'chat', traits: ['vision_input'] }],
  },
  {
    id: 'image',
    label: 'Image',
    enabled: true,
    capabilities: [{ task: 'image_generation', traits: [] }],
  },
];

describe('Pi model capability sections', () => {
  it('keeps every model-management capability in a stable product order', () => {
    expect(PI_MODEL_CAPABILITY_SECTIONS.map((section) => section.id)).toEqual([
      'chat',
      'realtime_conversation',
      'speech_recognition',
      'speech_synthesis',
      'vision',
      'image_generation',
      'image_edit',
      'video_generation',
      'embedding',
      'rerank',
    ]);
  });

  it('treats vision as an independently selectable chat trait', () => {
    const vision = getPiModelCapabilitySection('vision');
    expect(modelSupportsPiCapabilitySection(models[0], vision)).toBe(false);
    expect(modelSupportsPiCapabilitySection(models[1], vision)).toBe(true);
  });

  it('keeps a disabled model assigned to its configured section', () => {
    const disabled = { ...models[2], enabled: false };
    expect(modelSupportsPiCapabilitySection(
      disabled,
      getPiModelCapabilitySection('image_generation'),
    )).toBe(true);
  });

  it('orders configured models before models that can be assigned later', () => {
    const image = getPiModelCapabilitySection('image_generation');
    expect(orderModelsForPiCapabilitySection(models, image).map((model) => model.id)).toEqual([
      'image',
      'chat-only',
      'vision-chat',
    ]);
  });
});
