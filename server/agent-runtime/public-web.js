import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

export function isPublicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b)));
  }
  // Restrict IPv6 to globally routable unicast; reject mapped v4 and transition prefixes.
  return net.isIPv6(address) && /^[23]/i.test(address) && !/^2001:(?:0{1,4}:|0?db8:)/i.test(address) && !/^2002:/i.test(address);
}

export async function resolvePublicUrl(value, lookup = dns.lookup) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('Only public HTTP(S) URLs on standard ports without credentials are allowed');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('Private, loopback and reserved network addresses are blocked');
  return { url, address: addresses[0] };
}

// DNS is validated and pinned to the connection, including each redirect. Also usable by MCP OAuth discovery.
export async function publicFetch(value, init = {}, redirects = 0) {
  const { url, address } = await resolvePublicUrl(value instanceof Request ? value.url : String(value));
  const headers = Object.fromEntries(new Headers(init.headers || {}));
  headers['accept-encoding'] = 'identity';
  delete headers.host;
  const response = await new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: init.method || 'GET', headers, signal: init.signal,
      lookup: (_host, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
    }, (incoming) => {
      const body = ['HEAD'].includes(init.method) || [204, 205, 304].includes(incoming.statusCode) ? null : Readable.toWeb(incoming);
      resolve(new Response(body, { status: incoming.statusCode, headers: incoming.headers }));
    });
    request.setTimeout(30_000, () => request.destroy(new Error('Network request timed out')));
    request.on('error', reject);
    if (init.body) request.write(init.body instanceof URLSearchParams ? init.body.toString() : init.body);
    request.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location') && init.redirect !== 'manual') {
    await response.body?.cancel();
    if (redirects >= 3 || (init.method && init.method !== 'GET')) throw new Error('Redirect limit reached or unsafe method redirect');
    const target = new URL(response.headers.get('location'), url);
    // Never forward credentials to a different origin.
    if (target.origin !== url.origin) { delete headers.authorization; delete headers.cookie; }
    return publicFetch(target, { ...init, headers }, redirects + 1);
  }
  return response;
}

export async function boundedResponseText(response, limit = 2_000_000) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) throw new Error('Response exceeds size limit');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}

export const htmlText = (html) => String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
export async function executeWebTool(name, input, { signal } = {}) {
  const query = String(input.query || '').trim();
  if (name === 'web_search' && (!query || query.length > 1000)) throw new Error('A short search query is required');
  const url = name === 'web_search' ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : input.url;
  const response = await publicFetch(url, { signal, headers: { 'user-agent': 'MedHelp-Agent/1.0', accept: 'text/html,text/plain,application/json' } });
  if (!response.ok) throw new Error(`Web request failed (${response.status})`);
  const type = response.headers.get('content-type') || '';
  if (!/text\/|json|xml/i.test(type)) throw new Error('Use an integration download tool for non-text resources');
  const raw = await boundedResponseText(response);
  const links = [...raw.matchAll(/href=["'](https?:\/\/[^"']+|\/url\?q=[^"']+)["']/gi)].slice(0, 60).flatMap((match) => {
    try {
      const link = match[1].startsWith('/url?q=') ? new URL(match[1], url).searchParams.get('q') : match[1].replaceAll('&amp;', '&');
      return [{ url: link }];
    } catch { return []; }
  });
  return { url, text: (/html/i.test(type) ? htmlText(raw) : raw).slice(0, 32_000), links, untrusted: true };
}
