import { describe, expect, it } from 'vitest';

import {
  buildPythonRuntimeCandidates,
  resolvePythonRuntime,
} from '../utils/newsRuntime.js';

describe('research news runtime resolution', () => {
  it('prefers configured Python before compatible system fallbacks', () => {
    expect(buildPythonRuntimeCandidates({
      MEDHELP_PYTHON_EXECUTABLE: '/opt/python/bin/python3',
    }, 'linux')).toEqual([
      { command: '/opt/python/bin/python3', args: [], source: 'environment' },
      { command: 'python3', args: [], source: 'system' },
      { command: 'python', args: [], source: 'system' },
    ]);
  });

  it('supports the Windows py launcher as a Python 3 fallback', () => {
    const candidates = buildPythonRuntimeCandidates({}, 'win32');
    expect(candidates).toContainEqual({ command: 'py', args: ['-3'], source: 'system' });
  });

  it('falls back when python3 is unavailable or is not Python 3', () => {
    const attempted = [];
    const runtime = resolvePythonRuntime({
      env: {},
      platform: 'linux',
      probe(candidate) {
        attempted.push(candidate.command);
        return candidate.command === 'python';
      },
    });

    expect(attempted).toEqual(['python3', 'python']);
    expect(runtime).toEqual({ command: 'python', args: [], source: 'system' });
  });

  it('reports a useful error when no Python 3 runtime is available', () => {
    expect(() => resolvePythonRuntime({
      env: {},
      platform: 'linux',
      probe: () => false,
    })).toThrow(/computer running MedHelp Local Engine/i);
  });
});
