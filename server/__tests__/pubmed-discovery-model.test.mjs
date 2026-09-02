import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDirectClaudeModel } from '../routes/pubmed-discovery.js';

const KEYS = ['PUBMED_DISCOVERY_CLAUDE_MODEL', 'ANTHROPIC_MODEL'];
let saved = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  KEYS.forEach((key) => delete process.env[key]);
});

afterEach(() => {
  KEYS.forEach((key) => {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  });
});

describe('direct Anthropic model resolution', () => {
  it('expands a short alias to a pinned Messages API model id', () => {
    process.env.ANTHROPIC_MODEL = 'opus';
    expect(resolveDirectClaudeModel()).toMatch(/^claude-opus-/);
  });

  it('passes through an already qualified claude id', () => {
    process.env.ANTHROPIC_MODEL = 'claude-opus-5';
    expect(resolveDirectClaudeModel()).toBe('claude-opus-5');
  });

  it('refuses a third-party model id instead of posting it to the Anthropic API', () => {
    process.env.ANTHROPIC_MODEL = 'kimi-for-coding';
    expect(resolveDirectClaudeModel()).toBeNull();
  });

  it('refuses an alias the Messages API cannot accept', () => {
    process.env.ANTHROPIC_MODEL = 'sonnet[1m]';
    expect(resolveDirectClaudeModel()).toBeNull();
  });
});
