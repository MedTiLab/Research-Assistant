import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const ONLINE_ONLY_STATIC_PATHS = new Set([
  '/api-docs.html',
  '/clear-cache.html',
]);

// localStorage is scoped by the complete origin, including the port. The
// packaged offline desktop must therefore keep a stable loopback origin across
// launches or every renderer preference appears to reset after restarting.
export const DEFAULT_OFFLINE_UI_PORT = 43118;

export function normalizeOfflineUiPort(value = DEFAULT_OFFLINE_UI_PORT) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid offline frontend port: ${value}`);
  }
  return port;
}

function isOnlineOnlyStaticPath(pathname) {
  return ONLINE_ONLY_STATIC_PATHS.has(pathname)
    || pathname === '/download'
    || pathname.startsWith('/download/')
    || pathname.startsWith('/downloads/');
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function sanitizeProxyHeaders(headers, targetOrigin) {
  const output = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalizedName) || normalizedName === 'host') continue;
    if (normalizedName === 'origin') {
      output.origin = targetOrigin;
      continue;
    }
    if (normalizedName === 'referer') {
      output.referer = `${targetOrigin}/`;
      continue;
    }
    output[name] = value;
  }
  return output;
}

function proxyLocalRequest(request, response, localKernelUrl) {
  const target = new URL(request.url || '/', localKernelUrl);
  const transport = target.protocol === 'https:' ? https : http;
  const targetOrigin = new URL(localKernelUrl).origin;
  const upstream = transport.request(target, {
    method: request.method,
    headers: {
      ...sanitizeProxyHeaders(request.headers, targetOrigin),
      host: target.host,
    },
  }, (upstreamResponse) => {
    const responseHeaders = {};
    for (const [name, value] of Object.entries(upstreamResponse.headers)) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && value !== undefined) {
        responseHeaders[name] = value;
      }
    }
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(response);
  });

  upstream.setTimeout(30_000, () => {
    upstream.destroy(new Error('Cloud request timed out'));
  });
  upstream.on('error', (error) => {
    if (!response.headersSent) {
      sendJson(response, 502, {
        error: 'Local account service is unavailable',
        code: 'LOCAL_ACCOUNT_SERVICE_UNAVAILABLE',
      });
    } else {
      response.destroy(error);
    }
  });
  request.pipe(upstream);
}

function resolveStaticAsset(distRoot, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relativePath = decodedPath.replace(/^\/+/, '') || 'index.html';
  const candidate = path.resolve(distRoot, relativePath);
  const relative = path.relative(distRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function serveStaticAsset(request, response, distRoot) {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  let assetPath = resolveStaticAsset(distRoot, requestUrl.pathname);
  if (!assetPath && request.method === 'GET' && !path.extname(requestUrl.pathname)) {
    assetPath = path.join(distRoot, 'index.html');
  }
  if (!assetPath) {
    sendJson(response, 404, { error: 'Offline application asset not found' });
    return;
  }

  const extension = path.extname(assetPath).toLowerCase();
  const isEntryDocument = path.basename(assetPath) === 'index.html';
  response.writeHead(200, {
    'Cache-Control': isEntryDocument ? 'no-store' : 'public, max-age=31536000, immutable',
    'Content-Type': MIME_TYPES.get(extension) || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  fs.createReadStream(assetPath)
    .on('error', (error) => response.destroy(error))
    .pipe(response);
}

export async function startOfflineUiServer({
  distRoot,
  cloudAppUrl,
  getLocalKernelUrl = () => null,
  port = DEFAULT_OFFLINE_UI_PORT,
  log = () => {},
}) {
  const resolvedDistRoot = path.resolve(distRoot);
  const listenPort = normalizeOfflineUiPort(port);
  if (!fs.existsSync(path.join(resolvedDistRoot, 'index.html'))) {
    throw new Error(`Offline frontend is incomplete: ${resolvedDistRoot}`);
  }

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (isOnlineOnlyStaticPath(pathname)) {
      sendJson(response, 404, {
        error: 'This resource is available only from the MedHelp website',
        code: 'ONLINE_RESOURCE_NOT_BUNDLED',
        onlineUrl: new URL(pathname, cloudAppUrl).href,
      });
      return;
    }
    if (
      pathname.startsWith('/api/')
      || pathname === '/api'
      || pathname.startsWith('/user-avatars/')
    ) {
      const localKernelUrl = getLocalKernelUrl();
      if (!localKernelUrl) {
        sendJson(response, 503, {
          error: 'Local account service is starting',
          code: 'LOCAL_ACCOUNT_SERVICE_UNAVAILABLE',
        });
        return;
      }
      proxyLocalRequest(request, response, localKernelUrl);
      return;
    }
    serveStaticAsset(request, response, resolvedDistRoot);
  });
  server.on('clientError', (_error, socket) => socket.destroy());

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Offline frontend server did not bind to a loopback port');
  }
  const origin = `http://127.0.0.1:${address.port}`;
  log('Offline frontend server is ready', {
    origin,
    distRoot: resolvedDistRoot,
    persistentOrigin: listenPort !== 0,
  });

  return {
    origin,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
    }),
  };
}
