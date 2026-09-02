import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../types/types';
import {
  buildSelectionConsultationContext,
  buildSelectionConsultationPrompt,
} from './selectionConsultation';

const message = (type: string, content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  type,
  content,
  timestamp: '2026-08-09T00:00:00.000Z',
  ...extra,
});

describe('selection consultation context', () => {
  it('keeps recent conversational messages and excludes tools and thinking', () => {
    const context = buildSelectionConsultationContext([
      message('user', 'What does this result mean?'),
      message('assistant', 'Private chain of thought', { isThinking: true }),
      message('assistant', '', { isToolUse: true, toolName: 'Bash' }),
      message('assistant', 'It is an adjusted estimate.'),
    ]);

    expect(context).toContain('User: What does this result mean?');
    expect(context).toContain('Assistant: It is an adjusted estimate.');
    expect(context).not.toContain('Private chain of thought');
    expect(context).not.toContain('Bash');
  });

  it('builds an explanation-only prompt with the selection and snapshot', () => {
    const prompt = buildSelectionConsultationPrompt(
      'adjusted hazard ratio',
      'User: Explain Table 2',
      'Why is this important?',
    );

    expect(prompt).toContain('session-mode=consultation');
    expect(prompt).toContain('Do not edit or create files');
    expect(prompt).toContain('adjusted hazard ratio');
    expect(prompt).toContain('User: Explain Table 2');
    expect(prompt).toContain('Why is this important?');
  });
});
