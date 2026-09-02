/**
 * Resolve the account identity used for user-owned files.
 *
 * Cloud requests expose the database user on req.user.id. Local Kernel
 * requests deliberately keep that field empty and carry the authenticated
 * cloud account id in cloudUserId / localKernelSession.userId instead.
 */
export function resolveRequestUserId(req) {
  return req?.user?.id
    ?? req?.user?.userId
    ?? req?.user?.cloudUserId
    ?? req?.localKernelSession?.userId
    ?? null;
}

/**
 * Pick the same account identity for agent runtimes as for HTTP-owned files.
 */
export function resolveAgentUserId(user, localKernelSession = null) {
  return user?.id
    ?? user?.userId
    ?? user?.cloudUserId
    ?? localKernelSession?.userId
    ?? null;
}
