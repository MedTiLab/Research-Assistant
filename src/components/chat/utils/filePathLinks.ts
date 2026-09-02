const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/;
const EXTENSIONLESS_FILES_RE = /(?:^|[/\\])(?:Dockerfile|Makefile|Procfile|Gemfile|Rakefile|Vagrantfile|Brewfile|Guardfile|Justfile|Taskfile)$/i;
const COMMON_FILE_EXTENSION_RE = /\.(?:md|mdx|markdown|txt|json|jsonl|csv|tsv|tab|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|r|rmd|qmd|ipynb|sql|sh|bash|zsh|fish|ps1|yaml|yml|toml|ini|env|xml|svg|png|jpe?g|gif|webp|bmp|ico|pdf|docx?|pptx?|xlsx?|zip|gz|tar|tgz|7z|rar|parquet|feather|arrow|pkl|pickle|npy|npz|pt|pth|onnx)(?:$|[?#])/i;
const GENERIC_PATH_EXTENSION_RE = /(?:^|[/\\])[^/\\]+\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}(?:$|[?#])/;
const EXTERNAL_HREF_RE = /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i;
const BARE_FILE_PATH_RE = /(^|[\s([{"'`])((?:\.{1,2}[\\/]|~[\\/]|\/(?!\/)|[A-Za-z]:[\\/])(?:[^\s<>"'`()\[\]{}]+[\\/])*[^\s<>"'`()\[\]{},;]+?\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}(?::\d+(?::\d+)?)?(?:#[A-Za-z0-9_-]+)?|(?:[A-Za-z0-9_.@-]+[\\/])+(?:[A-Za-z0-9_.@-]+?\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}|Dockerfile|Makefile|Procfile|Gemfile|Rakefile|Vagrantfile|Brewfile|Guardfile|Justfile|Taskfile)(?::\d+(?::\d+)?)?(?:#[A-Za-z0-9_-]+)?)/g;

export type ChatFilePathTextSegment =
  | { type: 'text'; value: string }
  | { type: 'file'; value: string; href: string };

function trimLinkWrapper(value: string): string {
  return value.trim().replace(/^<(.+)>$/, '$1').trim();
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function stripHashQueryAndLine(value: string): string {
  const withoutHashOrQuery = value.replace(/[?#].*$/, '');
  const lineMatch = withoutHashOrQuery.match(/^(.*\.[A-Za-z0-9][A-Za-z0-9_-]{0,15})(?::\d+(?::\d+)?)$/);
  return (lineMatch?.[1] || withoutHashOrQuery).trim();
}

export function isExternalHref(href?: string | null): boolean {
  const value = String(href || '').trim();
  return !value || value.startsWith('#') || EXTERNAL_HREF_RE.test(value);
}

export function normalizeChatFilePath(value?: string | null): string {
  const trimmed = trimLinkWrapper(String(value || ''));
  if (!trimmed) {
    return '';
  }

  if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const decodedPath = decodeURIComponent(url.pathname);
      const normalizedPath = WINDOWS_ABSOLUTE_PATH_RE.test(decodedPath.slice(1))
        ? decodedPath.slice(1)
        : decodedPath;
      return stripHashQueryAndLine(normalizedPath);
    } catch {
      return stripHashQueryAndLine(trimmed.replace(/^file:\/\//i, ''));
    }
  }

  return stripHashQueryAndLine(safeDecodeUri(trimmed));
}

export function isLikelyChatFilePath(value?: string | null): boolean {
  const trimmed = trimLinkWrapper(String(value || ''));
  if (!trimmed || isExternalHref(trimmed)) {
    return false;
  }

  const normalized = normalizeChatFilePath(trimmed);
  if (!normalized) {
    return false;
  }

  if (EXTENSIONLESS_FILES_RE.test(normalized)) {
    return true;
  }

  if (COMMON_FILE_EXTENSION_RE.test(trimmed) || COMMON_FILE_EXTENSION_RE.test(normalized)) {
    return true;
  }

  if ((normalized.includes('/') || normalized.includes('\\')) && GENERIC_PATH_EXTENSION_RE.test(normalized)) {
    return true;
  }

  return normalized.startsWith('./') || normalized.startsWith('../') || normalized.startsWith('/') || WINDOWS_ABSOLUTE_PATH_RE.test(normalized);
}

export function splitChatFilePathText(value?: string | null): ChatFilePathTextSegment[] {
  const text = String(value || '');
  if (!text) {
    return [];
  }

  const segments: ChatFilePathTextSegment[] = [];
  let lastIndex = 0;
  BARE_FILE_PATH_RE.lastIndex = 0;

  for (const match of text.matchAll(BARE_FILE_PATH_RE)) {
    const prefix = match[1] || '';
    const candidate = match[2] || '';
    if (!candidate) {
      continue;
    }

    const candidateStart = (match.index || 0) + prefix.length;
    const candidateEnd = candidateStart + candidate.length;

    if (candidateStart > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, candidateStart) });
    }

    if (isLikelyChatFilePath(candidate)) {
      segments.push({
        type: 'file',
        value: candidate,
        href: normalizeChatFilePath(candidate),
      });
    } else {
      segments.push({ type: 'text', value: candidate });
    }

    lastIndex = candidateEnd;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: text }];
}
