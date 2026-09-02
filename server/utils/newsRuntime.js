import { spawnSync } from 'child_process';

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.command}\0${(candidate.args || []).join('\0')}`;
    if (!candidate.command || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildPythonRuntimeCandidates(
  env = process.env,
  platform = process.platform,
) {
  const configured = [
    env.MEDHELP_PYTHON_EXECUTABLE,
    env.MEDHELP_PYTHON,
    env.PYTHON,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((command) => ({ command, args: [], source: 'environment' }));

  const defaults = platform === 'win32'
    ? [
      { command: 'python3', args: [], source: 'system' },
      { command: 'python', args: [], source: 'system' },
      { command: 'py', args: ['-3'], source: 'system' },
    ]
    : [
      { command: 'python3', args: [], source: 'system' },
      { command: 'python', args: [], source: 'system' },
    ];

  return uniqueCandidates([...configured, ...defaults]);
}

function probePython3(candidate, env) {
  const result = spawnSync(
    candidate.command,
    [...candidate.args, '-c', 'import sys; print(sys.version_info[0])'],
    {
      env,
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    },
  );
  return result.status === 0 && String(result.stdout || '').trim() === '3';
}

export function resolvePythonRuntime({
  env = process.env,
  platform = process.platform,
  probe = probePython3,
} = {}) {
  const candidates = buildPythonRuntimeCandidates(env, platform);
  for (const candidate of candidates) {
    if (probe(candidate, env)) return candidate;
  }

  const error = new Error(
    'Python 3 was not found. Install Python 3 on the computer running MedHelp Local Engine, '
      + 'or set MEDHELP_PYTHON_EXECUTABLE to its full path.',
  );
  error.code = 'PYTHON3_NOT_FOUND';
  throw error;
}
