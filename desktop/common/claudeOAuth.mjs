const TRUSTED_CLAUDE_AUTH_HOSTS = Object.freeze([
  'claude.com',
  'claude.ai',
  'anthropic.com',
]);

function isTrustedClaudeAuthHost(hostname) {
  return TRUSTED_CLAUDE_AUTH_HOSTS.some((domain) => (
    hostname === domain || hostname.endsWith(`.${domain}`)
  ));
}

export function findTrustedClaudeAuthUrl(value) {
  const candidates = String(value || '').match(/https:\/\/[^\s\x1b]+/g) || [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.replace(/[),.;]+$/, ''));
      if (isTrustedClaudeAuthHost(url.hostname)) return url.href;
    } catch {
      // Continue scanning CLI output for a valid first-party OAuth URL.
    }
  }
  return null;
}
