import { describe, expect, it } from 'vitest';

import { shouldBlockProjectsFetch } from './projectLoading';

describe('shouldBlockProjectsFetch', () => {
  it('blocks while the initial project list is unknown', () => {
    expect(shouldBlockProjectsFetch(false)).toBe(true);
  });

  it('keeps the workspace mounted during later project refreshes', () => {
    expect(shouldBlockProjectsFetch(true)).toBe(false);
  });
});
