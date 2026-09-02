import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_OFFLINE_UI_PORT,
  normalizeOfflineUiPort,
  startOfflineUiServer,
} from './offlineUiServer.mjs';

let tempRoot = null;
let cloudServer = null;
let offlineServer = null;

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

describe('offline desktop frontend server', () => {
  afterEach(async () => {
    await offlineServer?.close();
    offlineServer = null;
    if (cloudServer) {
      await new Promise((resolve) => cloudServer.close(resolve));
      cloudServer = null;
    }
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('serves bundled assets and keeps SPA navigation inside the offline build', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-offline-ui-'));
    await fs.mkdir(path.join(tempRoot, 'assets'));
    await fs.writeFile(path.join(tempRoot, 'index.html'), '<main>offline-medhelp</main>');
    await fs.writeFile(path.join(tempRoot, 'assets', 'app.js'), 'globalThis.offline = true;');
    cloudServer = http.createServer((_request, response) => response.end('cloud'));
    const cloudOrigin = await listen(cloudServer);
    offlineServer = await startOfflineUiServer({ distRoot: tempRoot, cloudAppUrl: cloudOrigin, port: 0 });

    await expect(fetch(`${offlineServer.origin}/`).then((response) => response.text()))
      .resolves.toContain('offline-medhelp');
    await expect(fetch(`${offlineServer.origin}/projects/example`).then((response) => response.text()))
      .resolves.toContain('offline-medhelp');
    await expect(fetch(`${offlineServer.origin}/assets/app.js`).then((response) => response.text()))
      .resolves.toContain('offline = true');
  });

  it('proxies account requests to the local Kernel without contacting the cloud', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-offline-ui-'));
    await fs.writeFile(path.join(tempRoot, 'index.html'), '<main>offline-medhelp</main>');
    cloudServer = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          authorization: request.headers.authorization,
          body: JSON.parse(body),
          origin: request.headers.origin,
          path: request.url,
        }));
      });
    });
    const cloudOrigin = await listen(cloudServer);
    offlineServer = await startOfflineUiServer({
      distRoot: tempRoot,
      cloudAppUrl: 'https://cloud.invalid',
      getLocalKernelUrl: () => cloudOrigin,
      port: 0,
    });

    const response = await fetch(`${offlineServer.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer online-proof',
        'Content-Type': 'application/json',
        Origin: offlineServer.origin,
      },
      body: JSON.stringify({ username: 'researcher' }),
    });

    await expect(response.json()).resolves.toEqual({
      authorization: 'Bearer online-proof',
      body: { username: 'researcher' },
      origin: cloudOrigin,
      path: '/api/auth/login',
    });
  });

  it('never falls back to the cloud when the local account service is unavailable', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-offline-ui-'));
    await fs.writeFile(path.join(tempRoot, 'index.html'), '<main>offline-medhelp</main>');
    let cloudRequests = 0;
    cloudServer = http.createServer((_request, response) => {
      cloudRequests += 1;
      response.end('unexpected-cloud-request');
    });
    const cloudOrigin = await listen(cloudServer);
    offlineServer = await startOfflineUiServer({
      distRoot: tempRoot,
      cloudAppUrl: cloudOrigin,
      port: 0,
    });

    const response = await fetch(`${offlineServer.origin}/api/auth/status`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'LOCAL_ACCOUNT_SERVICE_UNAVAILABLE',
    });
    expect(cloudRequests).toBe(0);
  });

  it('serves the bundled help page without contacting the cloud', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-offline-ui-'));
    await fs.writeFile(path.join(tempRoot, 'index.html'), '<main>offline-medhelp</main>');
    await fs.writeFile(path.join(tempRoot, 'help.html'), '<main>local-help</main>');
    let cloudRequests = 0;
    cloudServer = http.createServer((_request, response) => {
      cloudRequests += 1;
      response.end('cloud-help');
    });
    const cloudOrigin = await listen(cloudServer);
    offlineServer = await startOfflineUiServer({ distRoot: tempRoot, cloudAppUrl: cloudOrigin, port: 0 });

    const response = await fetch(`${offlineServer.origin}/help.html`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('local-help');
    expect(cloudRequests).toBe(0);
  });

  it('refuses to serve website-only documentation from the offline bundle', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-offline-ui-'));
    await fs.writeFile(path.join(tempRoot, 'index.html'), '<main>offline-medhelp</main>');
    await fs.writeFile(path.join(tempRoot, 'api-docs.html'), '<main>bundled-api-docs-must-not-load</main>');
    cloudServer = http.createServer((_request, response) => response.end('cloud-api-docs'));
    const cloudOrigin = await listen(cloudServer);
    offlineServer = await startOfflineUiServer({ distRoot: tempRoot, cloudAppUrl: cloudOrigin, port: 0 });

    const response = await fetch(`${offlineServer.origin}/api-docs.html`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'ONLINE_RESOURCE_NOT_BUNDLED',
      onlineUrl: `${cloudOrigin}/api-docs.html`,
    });
  });

  it('uses one stable packaged origin so local preferences survive restarts', () => {
    expect(DEFAULT_OFFLINE_UI_PORT).toBe(43118);
    expect(normalizeOfflineUiPort()).toBe(43118);
    expect(normalizeOfflineUiPort(0)).toBe(0);
    expect(() => normalizeOfflineUiPort(70_000)).toThrow('Invalid offline frontend port');
  });
});
