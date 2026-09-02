import { describe, expect, it } from 'vitest';

import {
  extractSessionModeFromMetadata,
  extractSessionModeFromText,
  normalizeSessionMode,
} from './sessionMode.js';

describe('consultation session mode', () => {
  it('preserves the explicit consultation mode', () => {
    expect(normalizeSessionMode('consultation')).toBe('consultation');
    expect(extractSessionModeFromMetadata({ sessionMode: 'consultation' })).toBe('consultation');
  });

  it('detects consultation mode inside a guarded prompt', () => {
    expect(extractSessionModeFromText([
      '[System constraint: consultation mode]',
      'Explanation-only side conversation.',
      '[Context: session-mode=consultation]',
    ].join('\n'))).toBe('consultation');
  });
});
