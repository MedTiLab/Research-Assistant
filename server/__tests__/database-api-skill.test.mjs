import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillRoot = path.join(repoRoot, 'skills', 'medhelp-database-api-access');
const execute = promisify(execFile);

async function readSkillFiles() {
  const paths = [
    'SKILL.md',
    'agents/openai.yaml',
    'references/api.md',
    'scripts/local_db_api.py',
  ];
  return Promise.all(paths.map(async relativePath => ({
    relativePath,
    contents: await fs.readFile(path.join(skillRoot, relativePath), 'utf8'),
  })));
}

describe('remote database API skill credential guidance', () => {
  it('treats missing managed credentials as injection failure without mining local secrets', async () => {
    const files = await readSkillFiles();
    const skill = files.find(file => file.relativePath === 'SKILL.md').contents;
    const combined = files.map(file => file.contents).join('\n');

    expect(skill).toContain('MEDHELP_MANAGED_AGENT_SESSION=1');
    expect(skill).toContain('MEDHELP_DATABASE_API_CONNECTION_STATUS=connected');
    expect(skill).toContain('backend Connector code; never let the AI reinterpret it');
    expect(skill).toMatch(/do not ask the user to paste the PAT into\s+chat/i);
    expect(skill).toContain('Do not search local `auth.db`');
    expect(combined).not.toContain('external-ai-download-token.txt');
    expect(combined).not.toContain('export MEDHELP_DATABASE_API_TOKEN="<paste-token-here>"');
    expect(combined).not.toContain('--token "$MEDHELP_DATABASE_API_TOKEN"');
  });
});

describe('database skill client selection transport', () => {
  // Invented data and a loopback HTTP stub: tests client serialization, not the
  // production resolver or cohort joins (covered in the database service repo).
  const columns = ['ID', 'HeArte', '中文 空格', 'score (0~21分,越大越好)',
    'quote"field', 'semi;colon', 'pipe|field', 'line\nbreak', 'dot.name'];
  const file = 'raw_data/original/fixture/wave1/w02_measure.parquet';
  const requests = [];
  let directory;
  let server;
  let base;

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-db-client-'));
    server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      requests.push({ method: req.method, path: req.url, body });
      const selected = body?.selected || body?.columns || [];
      res.setHeader('Content-Type', 'application/json');
      if (selected.length > 200) {
        res.writeHead(422);
        res.end(JSON.stringify({ code: 'TOO_MANY_VARIABLES' }));
      } else if (req.url === '/api/v1/sources') {
        res.end(JSON.stringify({ sources: [{ id: 'gshs' }, { id: 'gco' }] }));
      } else if (req.url === '/api/v1/export') {
        res.writeHead(202);
        res.end(JSON.stringify({ job: { id: 'invented-job', status: 'queued' } }));
      } else if (req.url === '/extract' && body.format === 'csv') {
        const quote = value => `"${String(value).replaceAll('"', '""')}"`;
        const records = [selected, selected.map((_, i) => i === 0 ? '0007' : 'a,"b\nc'),
          selected.map((_, i) => i === 0 ? '0008' : '')];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.end(records.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n');
      } else {
        res.end(JSON.stringify({ dataset: { columnNames: selected, rows: 2 } }));
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  async function run(command, args = []) {
    try {
      const result = await execute('python3', [path.join(skillRoot, 'scripts/local_db_api.py'),
        command, '--base-url', base, '--transport', 'urllib', ...args], {
        timeout: 10000,
        env: { ...process.env, MEDHELP_MANAGED_AGENT_SESSION: '1',
          MEDHELP_DATABASE_API_CONNECTION_STATUS: 'connected',
          MEDHELP_DATABASE_API_TOKEN: 'invented-test-token', DATABASE_API_TOKEN: '' },
      });
      return { code: 0, ...result };
    } catch (error) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  }

  it.each([
    { name: 'build', command: 'build' },
    { name: 'CSV export', command: 'export', format: 'csv' },
    { name: 'Parquet export', command: 'export', format: 'parquet' },
    { name: 'CSV extract', command: 'extract', format: 'csv' },
  ])('preserves exact columns, file and requested format through $name HTTP requests', async ({ command, format }) => {
    const args = ['--source', 'elsa', '--file', file,
      ...columns.flatMap(column => ['--column', column]),
      command === 'extract' ? '--limit' : '--row-cap', '2'];
    const output = path.join(directory, 'literal-columns.csv');
    if (format) args.push('--format', format);
    if (command === 'extract') args.push('--output', output);
    const result = await run(command, args);
    expect(result.code, result.stderr).toBe(0);
    const request = requests.at(-1);
    expect(request.method).toBe('POST');
    expect(request.path).toBe(command === 'extract' ? '/extract' : `/api/v1/${command === 'build' ? 'extract' : 'export'}`);
    expect(request.body.file).toBe(file);
    expect(request.body[command === 'extract' ? 'columns' : 'selected']).toEqual(columns);
    expect(request.body[command === 'extract' ? 'limit' : 'rowCap']).toBe(2);
    if (format) expect(request.body.format).toBe(format);
    if (command === 'extract') {
      const decoded = await execute('python3', ['-c',
        'import csv,json,sys; print(json.dumps(list(csv.reader(open(sys.argv[1],newline="",encoding="utf-8")))))', output]);
      const [header, first, second] = JSON.parse(decoded.stdout);
      expect(header).toEqual(columns);
      expect(first).toEqual(columns.map((_, i) => i === 0 ? '0007' : 'a,"b\nc'));
      expect(second).toEqual(columns.map((_, i) => i === 0 ? '0008' : ''));
    }
  });

  it.each(['build', 'export'])('retains ordered file selections and every explicit join key in %s', async command => {
    const selected = [{ file, column: 'HeArte' },
      { file: 'raw_data/original/fixture/wave2/module.parquet', column: 'score,中' }];
    const selectionFile = path.join(directory, `${command} 中文.json`);
    await fs.writeFile(selectionFile, JSON.stringify(selected));
    const args = ['--source', 'elsa', '--selection-file', selectionFile,
      '--join-on', 'person_id', '--join-on', 'wave'];
    if (command === 'export') args.push('--format', 'csv');
    const result = await run(command, args);
    expect(result.code, result.stderr).toBe(0);
    expect(requests.at(-1).body.selected).toEqual(selected);
    expect(requests.at(-1).body.join_on).toEqual(['person_id', 'wave']);
    if (command === 'export') expect(requests.at(-1).body).not.toHaveProperty('rowCap');
  });

  it.each(['build', 'export', 'extract'])('keeps legacy simple-code input compatible for %s', async command => {
    const result = await run(command, ['--source', 'elsa', '--file', file,
      command === 'extract' ? '--columns' : '--selected', 'ID, HeArte']);
    expect(result.code, result.stderr).toBe(0);
    expect(requests.at(-1).body[command === 'extract' ? 'columns' : 'selected']).toEqual(['ID', 'HeArte']);
  });

  it.each(['{', '{}', '[]', '[null]', '[""]', '[{"file":"x","column":""}]',
    '[{"file":"x","column":"y","typo":true}]'])('rejects invalid selection input before HTTP: %s', async value => {
    const selectionFile = path.join(directory, 'invalid.json');
    await fs.writeFile(selectionFile, value);
    const before = requests.length;
    const result = await run('build', ['--source', 'elsa', '--selection-file', selectionFile]);
    expect(result.code).not.toBe(0);
    expect(requests.length).toBe(before);
  });

  it('rejects mixed selection modes instead of silently choosing one', async () => {
    const before = requests.length;
    const result = await run('build', ['--source', 'elsa', '--selected', 'ID', '--column', 'HeArte']);
    expect(result.code).not.toBe(0);
    expect(requests.length).toBe(before);
  });

  it('preserves an oversized JSON selection and surfaces the server rejection without retry or truncation', async () => {
    const selected = Array.from({ length: 210 }, (_, i) => `measure_${i},中文`);
    const selectionFile = path.join(directory, 'all-columns.json');
    await fs.writeFile(selectionFile, JSON.stringify(selected));
    const before = requests.length;
    const result = await run('build', ['--source', 'elsa', '--file', file, '--selection-file', selectionFile, '--row-cap', '2']);
    expect(result.code).not.toBe(0);
    expect(requests).toHaveLength(before + 1);
    expect(requests.at(-1).body.selected).toEqual(selected);
    expect(result.stderr).toContain('422');
  });

  it('reports the new GSHS group only from the current allow-list and keeps GCO query-only', async () => {
    const result = await run('api-permissions');
    expect(result.code, result.stderr).toBe(0);
    const permission = JSON.parse(result.stdout);
    expect(permission.downloadAllowed).toContain('gshs');
    expect(permission.downloadAllowed).not.toContain('gco');
    expect(permission.permissionGroups.find(group => group.id === 'gshs').status).toBe('full');
    expect(permission.downloadDenied).toContain('class');
  });
});
