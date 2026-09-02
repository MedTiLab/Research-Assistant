export const PI_MODEL_CAPABILITY_SECTIONS = Object.freeze([
  { id: 'chat', task: 'chat', runtime: 'conversation' },
  { id: 'realtime_conversation', task: 'realtime_conversation', runtime: 'configured' },
  { id: 'speech_recognition', task: 'speech_recognition', runtime: 'agent' },
  { id: 'speech_synthesis', task: 'speech_synthesis', runtime: 'agent' },
  { id: 'vision', task: 'chat', trait: 'vision_input', runtime: 'conversation' },
  { id: 'image_generation', task: 'image_generation', runtime: 'agent' },
  { id: 'image_edit', task: 'image_edit', runtime: 'agent' },
  { id: 'video_generation', task: 'video_generation', runtime: 'configured' },
  { id: 'embedding', task: 'embedding', runtime: 'retrieval' },
  { id: 'rerank', task: 'rerank', runtime: 'retrieval' },
]);

export function getPiModelCapabilitySection(sectionId) {
  return PI_MODEL_CAPABILITY_SECTIONS.find((section) => section.id === sectionId)
    || PI_MODEL_CAPABILITY_SECTIONS[0];
}

export function modelSupportsPiCapabilitySection(model, section) {
  if (!model || !section) return false;
  const capability = model.capabilities?.find((entry) => (
    entry.task === section.task && entry.enabled !== false
  ));
  if (!capability) return false;
  return !section.trait || capability.traits?.includes(section.trait);
}

export function orderModelsForPiCapabilitySection(models, section) {
  return [...models].sort((left, right) => {
    const leftSupports = modelSupportsPiCapabilitySection(left, section);
    const rightSupports = modelSupportsPiCapabilitySection(right, section);
    if (leftSupports !== rightSupports) return leftSupports ? -1 : 1;
    return String(left.label || left.id).localeCompare(String(right.label || right.id));
  });
}
