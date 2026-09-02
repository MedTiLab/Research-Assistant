import { verifyLocalSessionToken } from '../routes/localKernel.js';
import { isAllowedLocalKernelOrigin } from './localKernelRuntime.js';

const OPEN_PREFIXES = [
  '/api/auth',
  '/api/local',
  '/api/local-kernel',
  '/api/user',
  '/api/conversations',
  '/api/settings',
  '/api/gateway',
  '/api/shares',
];

function getBearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function isOpenPath(requestPath) {
  return OPEN_PREFIXES.some((prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`));
}

export function createLocalApiGate() {
  return function localApiGate(req, res, next) {
    const requestPath = req.path || '';
    if (!requestPath.startsWith('/api/')) {
      return next();
    }

    if (isOpenPath(requestPath)) {
      return next();
    }

    const origin = req.headers.origin || null;
    if (!isAllowedLocalKernelOrigin(origin)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }

    const session = verifyLocalSessionToken(getBearer(req), origin);
    if (!session) {
      return res.status(401).json({ error: 'Local session token required' });
    }

    req.localKernelSession = session;
    req.user = {
      id: null,
      userId: null,
      cloudUserId: session.userId || null,
      username: 'local-kernel-user',
    };
    return next();
  };
}
