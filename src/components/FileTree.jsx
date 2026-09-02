import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Folder, FolderOpen, FolderPlus, File, FileText, FileCode, Eye, Search, X,
  ChevronRight, ChevronDown, UploadCloud, Loader2, Trash2, Copy, Check, RefreshCw, Clock,
  FileJson, FileType, FileSpreadsheet, FileArchive,
  Hash, Braces, Terminal, Database, Globe, Palette, Music2, Video, Archive,
  Lock, Shield, Settings, Image, BookOpen, Cpu, Box, Gem, Coffee,
  Flame, Hexagon, FileCode2, Code2, Cog, Binary, SquareFunction,
  Scroll, FlaskConical, NotebookPen, FileCheck, Workflow, Blocks, MessageSquarePlus,
  ExternalLink, FilePlus2, Pencil, ClipboardPaste, FolderInput
} from 'lucide-react';
import { cn } from '../lib/utils';
import ImageViewer from './ImageViewer';
import ProjectDownloadButton from './ProjectDownloadDialog';
import { api } from '../utils/api';
import { copyTextToClipboard } from '../utils/clipboard';
import {
  PROJECT_FILE_DELETED_EVENT,
  PROJECT_FILE_MOVED_EVENT,
  dispatchProjectFileMoved,
} from '../utils/projectFileEvents';
import { isInternalProjectPath, normalizeProjectRelativePath } from '../../shared/internalProjectFiles';
import { CAPABILITIES, useEntitlements } from '../hooks/useEntitlements';

// ─── File Icon Registry ──────────────────────────────────────────────
// Maps file extensions (and special filenames) to { icon, colorClass } pairs.
// Uses lucide-react icons mapped semantically to file types.

const ICON_SIZE = 'w-4 h-4 flex-shrink-0';
const IMAGE_FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tif', 'tiff']);
const MARKDOWN_FILE_EXTENSIONS = new Set(['md', 'mdx']);
const AUTO_REFRESH_STORAGE_KEY = 'file-tree-auto-refresh-interval-ms';
const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 15000;
const DEFAULT_FILE_TREE_VIEW_MODE = 'compact';
const AUTO_REFRESH_INTERVAL_OPTIONS = [0, 5000, 15000, 30000, 60000];
const FILE_TREE_INITIAL_MAX_DEPTH = 2;
const FILE_TREE_CHILD_MAX_DEPTH = 1;
const FILE_TREE_DRAG_MIME = 'application/x-medhelp-file-tree-item';
const TOP_LEVEL_DIRECTORY_ORDER = [
  'Literature',
  'literature',
  'Ideation',
  'Experiment',
  'Publication',
  'Promotion',
  'Survey',
  'Research',
  'reports',
  'drafts',
];
const TOP_LEVEL_DIRECTORY_RANK = new Map(
  TOP_LEVEL_DIRECTORY_ORDER.map((name, index) => [name, index]),
);
const PUBLICATION_DIRECTORY_ORDER = [
  'manuscript',
  'figures',
  'tables',
  'supplementary',
];
const PUBLICATION_DIRECTORY_RANK = new Map(
  PUBLICATION_DIRECTORY_ORDER.map((name, index) => [name, index]),
);
const FILE_TREE_NAME_COLLATOR = new Intl.Collator(['zh-CN', 'en-US'], {
  numeric: true,
  sensitivity: 'base',
});

const UPLOAD_RELATIVE_PATH_PROPERTY = '__medHelpUploadRelativePath';

function normalizeBrowserRelativePath(pathValue) {
  return String(pathValue || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function attachUploadRelativePath(file, relativePath) {
  const normalizedPath = normalizeBrowserRelativePath(relativePath);
  if (!normalizedPath || normalizedPath === file.name) {
    return file;
  }

  try {
    Object.defineProperty(file, UPLOAD_RELATIVE_PATH_PROPERTY, {
      value: normalizedPath,
      configurable: true,
    });
  } catch {
    try {
      file[UPLOAD_RELATIVE_PATH_PROPERTY] = normalizedPath;
    } catch {
      // Some browser File objects are not extensible; fall back to the flat file name.
    }
  }

  return file;
}

function getUploadRelativePath(file) {
  return normalizeBrowserRelativePath(
    file?.[UPLOAD_RELATIVE_PATH_PROPERTY] || file?.webkitRelativePath || file?.name
  );
}

function isVisibleUploadRelativePath(relativePath) {
  const normalizedPath = normalizeBrowserRelativePath(relativePath);
  return Boolean(normalizedPath && !isInternalProjectPath(normalizedPath));
}

function getUploadDirectoriesFromFiles(files) {
  const directories = new Set();

  files.forEach((file) => {
    const relativePath = getUploadRelativePath(file);
    const segments = relativePath.split('/').filter(Boolean);

    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  });

  return Array.from(directories);
}

function mergeUploadItems(items) {
  const files = [];
  const directories = new Set();

  items.forEach((item) => {
    (item.files || []).forEach((file) => {
      if (isVisibleUploadRelativePath(getUploadRelativePath(file))) {
        files.push(file);
      }
    });
    (item.directories || []).forEach((directoryPath) => {
      const normalizedPath = normalizeBrowserRelativePath(directoryPath);
      if (isVisibleUploadRelativePath(normalizedPath)) {
        directories.add(normalizedPath);
      }
    });
  });

  getUploadDirectoriesFromFiles(files).forEach((directoryPath) => directories.add(directoryPath));

  return {
    files,
    directories: Array.from(directories),
  };
}

function readFileSystemFileEntry(entry, relativePath) {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => resolve(attachUploadRelativePath(file, relativePath)),
      reject
    );
  });
}

function readAllDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const entries = [];

    const readNextBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(entries);
            return;
          }

          entries.push(...batch);
          readNextBatch();
        },
        reject
      );
    };

    readNextBatch();
  });
}

async function readFileSystemEntryUploadItems(entry, parentPath = '') {
  const relativePath = normalizeBrowserRelativePath(parentPath ? `${parentPath}/${entry.name}` : entry.name);

  if (entry.isFile) {
    return {
      files: [await readFileSystemFileEntry(entry, relativePath)],
      directories: [],
    };
  }

  if (entry.isDirectory) {
    const children = await readAllDirectoryEntries(entry.createReader());
    const nestedItems = await Promise.all(
      children.map((child) => readFileSystemEntryUploadItems(child, relativePath))
    );
    const mergedItems = mergeUploadItems(nestedItems);

    return {
      files: mergedItems.files,
      directories: [relativePath, ...mergedItems.directories],
    };
  }

  return {
    files: [],
    directories: [],
  };
}

async function readFileSystemHandleUploadItems(handle, parentPath = '') {
  const relativePath = normalizeBrowserRelativePath(parentPath ? `${parentPath}/${handle.name}` : handle.name);

  if (handle.kind === 'file') {
    const file = await handle.getFile();
    return {
      files: [attachUploadRelativePath(file, relativePath)],
      directories: [],
    };
  }

  if (handle.kind === 'directory') {
    const nestedItems = [];

    for await (const childHandle of handle.values()) {
      nestedItems.push(await readFileSystemHandleUploadItems(childHandle, relativePath));
    }

    const mergedItems = mergeUploadItems(nestedItems);
    return {
      files: mergedItems.files,
      directories: [relativePath, ...mergedItems.directories],
    };
  }

  return {
    files: [],
    directories: [],
  };
}

async function getUploadItemsFromDataTransfer(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);

  const handles = (await Promise.all(
    items.map(async (item) => (
      typeof item.getAsFileSystemHandle === 'function'
        ? item.getAsFileSystemHandle().catch(() => null)
        : null
    ))
  )).filter(Boolean);

  if (handles.length > 0) {
    const uploadItemsByHandle = await Promise.all(handles.map((handle) => readFileSystemHandleUploadItems(handle)));
    return mergeUploadItems(uploadItemsByHandle);
  }

  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (entries.length > 0) {
    const uploadItemsByEntry = await Promise.all(entries.map((entry) => readFileSystemEntryUploadItems(entry)));
    return mergeUploadItems(uploadItemsByEntry);
  }

  const files = Array.from(dataTransfer?.files || []).map((file) => (
    attachUploadRelativePath(file, file.webkitRelativePath || file.name)
  ));

  return {
    files,
    directories: getUploadDirectoriesFromFiles(files),
  };
}

const FILE_ICON_MAP = {
  // ── JavaScript / TypeScript ──
  js:   { icon: FileCode,   color: 'text-yellow-500' },
  jsx:  { icon: FileCode,   color: 'text-yellow-500' },
  mjs:  { icon: FileCode,   color: 'text-yellow-500' },
  cjs:  { icon: FileCode,   color: 'text-yellow-500' },
  ts:   { icon: FileCode2,  color: 'text-blue-500' },
  tsx:  { icon: FileCode2,  color: 'text-blue-500' },
  mts:  { icon: FileCode2,  color: 'text-blue-500' },

  // ── Python ──
  py:   { icon: Code2,      color: 'text-emerald-500' },
  pyw:  { icon: Code2,      color: 'text-emerald-500' },
  pyi:  { icon: Code2,      color: 'text-emerald-400' },
  ipynb:{ icon: NotebookPen, color: 'text-orange-500' },

  // ── Rust ──
  rs:   { icon: Cog,        color: 'text-orange-600' },
  toml: { icon: Settings,   color: 'text-gray-500' },

  // ── Go ──
  go:   { icon: Hexagon,    color: 'text-cyan-500' },

  // ── Ruby ──
  rb:   { icon: Gem,        color: 'text-red-500' },
  erb:  { icon: Gem,        color: 'text-red-400' },

  // ── PHP ──
  php:  { icon: Blocks,     color: 'text-violet-500' },

  // ── Java / Kotlin ──
  java: { icon: Coffee,     color: 'text-red-600' },
  jar:  { icon: Coffee,     color: 'text-red-500' },
  kt:   { icon: Hexagon,    color: 'text-violet-500' },
  kts:  { icon: Hexagon,    color: 'text-violet-400' },

  // ── C / C++ ──
  c:    { icon: Cpu,        color: 'text-blue-600' },
  h:    { icon: Cpu,        color: 'text-blue-400' },
  cpp:  { icon: Cpu,        color: 'text-blue-700' },
  hpp:  { icon: Cpu,        color: 'text-blue-500' },
  cc:   { icon: Cpu,        color: 'text-blue-700' },

  // ── C# ──
  cs:   { icon: Hexagon,    color: 'text-purple-600' },

  // ── Swift ──
  swift:{ icon: Flame,      color: 'text-orange-500' },

  // ── Lua ──
  lua:  { icon: SquareFunction, color: 'text-blue-500' },

  // ── R ──
  r:    { icon: FlaskConical, color: 'text-blue-600' },

  // ── Web ──
  html: { icon: Globe,      color: 'text-orange-600' },
  htm:  { icon: Globe,      color: 'text-orange-600' },
  css:  { icon: Hash,       color: 'text-blue-500' },
  scss: { icon: Hash,       color: 'text-pink-500' },
  sass: { icon: Hash,       color: 'text-pink-400' },
  less: { icon: Hash,       color: 'text-indigo-500' },
  vue:  { icon: FileCode2,  color: 'text-emerald-500' },
  svelte:{ icon: FileCode2, color: 'text-orange-500' },

  // ── Data / Config ──
  json: { icon: Braces,     color: 'text-yellow-600' },
  jsonc:{ icon: Braces,     color: 'text-yellow-500' },
  json5:{ icon: Braces,     color: 'text-yellow-500' },
  yaml: { icon: Settings,   color: 'text-purple-400' },
  yml:  { icon: Settings,   color: 'text-purple-400' },
  xml:  { icon: FileCode,   color: 'text-orange-500' },
  csv:  { icon: FileSpreadsheet, color: 'text-green-600' },
  tsv:  { icon: FileSpreadsheet, color: 'text-green-500' },
  sql:  { icon: Database,   color: 'text-blue-500' },
  graphql:{ icon: Workflow,  color: 'text-pink-500' },
  gql:  { icon: Workflow,   color: 'text-pink-500' },
  proto:{ icon: Box,        color: 'text-green-500' },
  env:  { icon: Shield,     color: 'text-yellow-600' },

  // ── Documents ──
  md:   { icon: BookOpen,   color: 'text-blue-500' },
  mdx:  { icon: BookOpen,   color: 'text-blue-400' },
  txt:  { icon: FileText,   color: 'text-gray-500' },
  doc:  { icon: FileText,   color: 'text-blue-600' },
  docx: { icon: FileText,   color: 'text-blue-600' },
  pdf:  { icon: FileCheck,  color: 'text-red-600' },
  rtf:  { icon: FileText,   color: 'text-gray-500' },
  tex:  { icon: Scroll,     color: 'text-teal-600' },
  rst:  { icon: FileText,   color: 'text-gray-400' },

  // ── Shell / Scripts ──
  sh:   { icon: Terminal,   color: 'text-green-500' },
  bash: { icon: Terminal,   color: 'text-green-500' },
  zsh:  { icon: Terminal,   color: 'text-green-400' },
  fish: { icon: Terminal,   color: 'text-green-400' },
  ps1:  { icon: Terminal,   color: 'text-blue-400' },
  bat:  { icon: Terminal,   color: 'text-gray-500' },
  cmd:  { icon: Terminal,   color: 'text-gray-500' },

  // ── Images ──
  png:  { icon: Image,      color: 'text-purple-500' },
  jpg:  { icon: Image,      color: 'text-purple-500' },
  jpeg: { icon: Image,      color: 'text-purple-500' },
  gif:  { icon: Image,      color: 'text-purple-400' },
  webp: { icon: Image,      color: 'text-purple-400' },
  ico:  { icon: Image,      color: 'text-purple-400' },
  bmp:  { icon: Image,      color: 'text-purple-400' },
  tiff: { icon: Image,      color: 'text-purple-400' },
  svg:  { icon: Palette,    color: 'text-amber-500' },

  // ── Audio ──
  mp3:  { icon: Music2,     color: 'text-pink-500' },
  wav:  { icon: Music2,     color: 'text-pink-500' },
  ogg:  { icon: Music2,     color: 'text-pink-400' },
  flac: { icon: Music2,     color: 'text-pink-400' },
  aac:  { icon: Music2,     color: 'text-pink-400' },
  m4a:  { icon: Music2,     color: 'text-pink-400' },

  // ── Video ──
  mp4:  { icon: Video,      color: 'text-rose-500' },
  mov:  { icon: Video,      color: 'text-rose-500' },
  avi:  { icon: Video,      color: 'text-rose-500' },
  webm: { icon: Video,      color: 'text-rose-400' },
  mkv:  { icon: Video,      color: 'text-rose-400' },

  // ── Fonts ──
  ttf:  { icon: FileType,   color: 'text-red-500' },
  otf:  { icon: FileType,   color: 'text-red-500' },
  woff: { icon: FileType,   color: 'text-red-400' },
  woff2:{ icon: FileType,   color: 'text-red-400' },
  eot:  { icon: FileType,   color: 'text-red-400' },

  // ── Archives ──
  zip:  { icon: Archive,    color: 'text-amber-600' },
  tar:  { icon: Archive,    color: 'text-amber-600' },
  gz:   { icon: Archive,    color: 'text-amber-600' },
  bz2:  { icon: Archive,    color: 'text-amber-600' },
  rar:  { icon: Archive,    color: 'text-amber-500' },
  '7z': { icon: Archive,    color: 'text-amber-500' },

  // ── Lock files ──
  lock: { icon: Lock,       color: 'text-gray-500' },

  // ── Binary / Executable ──
  exe:  { icon: Binary,     color: 'text-gray-500' },
  bin:  { icon: Binary,     color: 'text-gray-500' },
  dll:  { icon: Binary,     color: 'text-gray-400' },
  so:   { icon: Binary,     color: 'text-gray-400' },
  dylib:{ icon: Binary,     color: 'text-gray-400' },
  wasm: { icon: Binary,     color: 'text-purple-500' },

  // ── Misc config ──
  ini:  { icon: Settings,   color: 'text-gray-500' },
  cfg:  { icon: Settings,   color: 'text-gray-500' },
  conf: { icon: Settings,   color: 'text-gray-500' },
  log:  { icon: Scroll,     color: 'text-gray-400' },
  map:  { icon: File,       color: 'text-gray-400' },
};

// Special full-filename matches (highest priority)
const FILENAME_ICON_MAP = {
  'Dockerfile':       { icon: Box,       color: 'text-blue-500' },
  'docker-compose.yml': { icon: Box,     color: 'text-blue-500' },
  'docker-compose.yaml': { icon: Box,    color: 'text-blue-500' },
  '.dockerignore':    { icon: Box,       color: 'text-gray-500' },
  '.gitignore':       { icon: Settings,  color: 'text-gray-500' },
  '.gitmodules':      { icon: Settings,  color: 'text-gray-500' },
  '.gitattributes':   { icon: Settings,  color: 'text-gray-500' },
  '.editorconfig':    { icon: Settings,  color: 'text-gray-500' },
  '.prettierrc':      { icon: Settings,  color: 'text-pink-400' },
  '.prettierignore':  { icon: Settings,  color: 'text-gray-500' },
  '.eslintrc':        { icon: Settings,  color: 'text-violet-500' },
  '.eslintrc.js':     { icon: Settings,  color: 'text-violet-500' },
  '.eslintrc.json':   { icon: Settings,  color: 'text-violet-500' },
  '.eslintrc.cjs':    { icon: Settings,  color: 'text-violet-500' },
  'eslint.config.js': { icon: Settings,  color: 'text-violet-500' },
  'eslint.config.mjs':{ icon: Settings,  color: 'text-violet-500' },
  '.env':             { icon: Shield,    color: 'text-yellow-600' },
  '.env.local':       { icon: Shield,    color: 'text-yellow-600' },
  '.env.development': { icon: Shield,    color: 'text-yellow-500' },
  '.env.production':  { icon: Shield,    color: 'text-yellow-600' },
  '.env.example':     { icon: Shield,    color: 'text-yellow-400' },
  'package.json':     { icon: Braces,    color: 'text-green-500' },
  'package-lock.json':{ icon: Lock,      color: 'text-gray-500' },
  'yarn.lock':        { icon: Lock,      color: 'text-blue-400' },
  'pnpm-lock.yaml':   { icon: Lock,      color: 'text-orange-400' },
  'bun.lockb':        { icon: Lock,      color: 'text-gray-400' },
  'Cargo.toml':       { icon: Cog,       color: 'text-orange-600' },
  'Cargo.lock':       { icon: Lock,      color: 'text-orange-400' },
  'Gemfile':          { icon: Gem,       color: 'text-red-500' },
  'Gemfile.lock':     { icon: Lock,      color: 'text-red-400' },
  'Makefile':         { icon: Terminal,   color: 'text-gray-500' },
  'CMakeLists.txt':   { icon: Cog,       color: 'text-blue-500' },
  'tsconfig.json':    { icon: Braces,    color: 'text-blue-500' },
  'jsconfig.json':    { icon: Braces,    color: 'text-yellow-500' },
  'vite.config.ts':   { icon: Flame,     color: 'text-purple-500' },
  'vite.config.js':   { icon: Flame,     color: 'text-purple-500' },
  'webpack.config.js':{ icon: Cog,       color: 'text-blue-500' },
  'tailwind.config.js':{ icon: Hash,     color: 'text-cyan-500' },
  'tailwind.config.ts':{ icon: Hash,     color: 'text-cyan-500' },
  'postcss.config.js':{ icon: Cog,       color: 'text-red-400' },
  'babel.config.js':  { icon: Settings,  color: 'text-yellow-500' },
  '.babelrc':         { icon: Settings,  color: 'text-yellow-500' },
  'README.md':        { icon: BookOpen,  color: 'text-blue-500' },
  'LICENSE':          { icon: FileCheck,  color: 'text-gray-500' },
  'LICENSE.md':       { icon: FileCheck,  color: 'text-gray-500' },
  'CHANGELOG.md':     { icon: Scroll,    color: 'text-blue-400' },
  'requirements.txt': { icon: FileText,  color: 'text-emerald-400' },
  'go.mod':           { icon: Hexagon,   color: 'text-cyan-500' },
  'go.sum':           { icon: Lock,      color: 'text-cyan-400' },
};

function getFileIconData(filename) {
  // 1. Exact filename match
  if (FILENAME_ICON_MAP[filename]) {
    return FILENAME_ICON_MAP[filename];
  }

  // 2. Check for .env prefix pattern
  if (filename.startsWith('.env')) {
    return { icon: Shield, color: 'text-yellow-600' };
  }

  // 3. Extension-based lookup
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && FILE_ICON_MAP[ext]) {
    return FILE_ICON_MAP[ext];
  }

  // 4. Fallback
  return { icon: File, color: 'text-muted-foreground' };
}

function isImageFilename(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  return IMAGE_FILE_EXTENSIONS.has(ext);
}

function isMarkdownFilename(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  return MARKDOWN_FILE_EXTENSIONS.has(ext);
}

function hideInternalFileTreeItems(items, parentRelativePath = '') {
  return items
    .filter((item) => {
      const relativePath = normalizeProjectRelativePath(
        parentRelativePath ? `${parentRelativePath}/${item.name}` : item.name
      );
      return !isInternalProjectPath(relativePath);
    })
    .map((item) => {
      if (item.type !== 'directory' || !Array.isArray(item.children)) {
        return item;
      }

      const relativePath = normalizeProjectRelativePath(
        parentRelativePath ? `${parentRelativePath}/${item.name}` : item.name
      );

      return {
        ...item,
        children: hideInternalFileTreeItems(item.children, relativePath),
      };
    });
}

function compareFileTreeItems(a, b, level = 0, parentName = '') {
  if (a.type !== b.type) {
    return a.type === 'directory' ? -1 : 1;
  }

  if (parentName === 'Publication' && a.type === 'directory') {
    const rankA = PUBLICATION_DIRECTORY_RANK.has(a.name)
      ? PUBLICATION_DIRECTORY_RANK.get(a.name)
      : Number.POSITIVE_INFINITY;
    const rankB = PUBLICATION_DIRECTORY_RANK.has(b.name)
      ? PUBLICATION_DIRECTORY_RANK.get(b.name)
      : Number.POSITIVE_INFINITY;

    if (rankA !== rankB) {
      return rankA - rankB;
    }
  }

  if (level === 0 && a.type === 'directory') {
    const rankA = TOP_LEVEL_DIRECTORY_RANK.has(a.name)
      ? TOP_LEVEL_DIRECTORY_RANK.get(a.name)
      : Number.POSITIVE_INFINITY;
    const rankB = TOP_LEVEL_DIRECTORY_RANK.has(b.name)
      ? TOP_LEVEL_DIRECTORY_RANK.get(b.name)
      : Number.POSITIVE_INFINITY;

    if (rankA !== rankB) {
      return rankA - rankB;
    }
  }

  return FILE_TREE_NAME_COLLATOR.compare(a.name, b.name);
}

function sortDisplayFileTree(items, level = 0, parentName = '') {
  return [...items]
    .map((item) => {
      if (item.type !== 'directory' || !Array.isArray(item.children)) {
        return item;
      }

      return {
        ...item,
        children: sortDisplayFileTree(item.children, level + 1, item.name),
      };
    })
    .sort((a, b) => compareFileTreeItems(a, b, level, parentName));
}

function collectDirectoryPaths(items) {
  const paths = [];

  const walk = (nodes) => {
    nodes.forEach((item) => {
      if (item.type !== 'directory') {
        return;
      }

      paths.push(item.path);
      if (Array.isArray(item.children) && item.children.length > 0) {
        walk(item.children);
      }
    });
  };

  walk(items);
  return paths;
}

function collectTopLevelDirectoryPaths(items) {
  return items
    .filter((item) => item.type === 'directory')
    .map((item) => item.path);
}

function collectUnloadedTopLevelDirectoryPaths(items) {
  return items
    .filter((item) => item.type === 'directory' && !Array.isArray(item.children))
    .map((item) => item.path);
}

function updateDirectoryChildren(items, targetPath, children) {
  let changed = false;
  const nextItems = items.map((item) => {
    if (item.type === 'directory' && item.path === targetPath) {
      changed = true;
      return {
        ...item,
        children,
      };
    }

    if (item.type === 'directory' && Array.isArray(item.children)) {
      const nextChildren = updateDirectoryChildren(item.children, targetPath, children);
      if (nextChildren !== item.children) {
        changed = true;
        return {
          ...item,
          children: nextChildren,
        };
      }
    }

    return item;
  });

  return changed ? nextItems : items;
}

function getRelativeParentDirectoryPath(relativePath) {
  const normalizedPath = normalizeBrowserRelativePath(relativePath);
  const lastSeparatorIndex = normalizedPath.lastIndexOf('/');
  return lastSeparatorIndex > 0 ? normalizedPath.slice(0, lastSeparatorIndex) : '';
}

function collectUploadResponseDirectoryPaths(uploadResponse) {
  const directories = new Set();

  (uploadResponse?.directories || []).forEach((directory) => {
    const relativePath = normalizeBrowserRelativePath(directory?.relativePath);
    if (relativePath && relativePath !== '.') {
      directories.add(relativePath);
    }
  });

  (uploadResponse?.files || []).forEach((file) => {
    let directoryPath = getRelativeParentDirectoryPath(file?.relativePath);
    while (directoryPath) {
      directories.add(directoryPath);
      directoryPath = getRelativeParentDirectoryPath(directoryPath);
    }
  });

  return Array.from(directories);
}

function getRelativePathDepth(relativePath) {
  return normalizeBrowserRelativePath(relativePath).split('/').filter(Boolean).length;
}

function getUploadRefreshDepth(uploadResponse) {
  const directoryPaths = collectUploadResponseDirectoryPaths(uploadResponse);
  const maxDirectoryDepth = directoryPaths.reduce(
    (maxDepth, directoryPath) => Math.max(maxDepth, getRelativePathDepth(directoryPath)),
    FILE_TREE_INITIAL_MAX_DEPTH
  );

  return Math.min(10, Math.max(FILE_TREE_INITIAL_MAX_DEPTH, maxDirectoryDepth));
}

function buildProjectAbsolutePath(projectRoot, relativePath) {
  const normalizedRoot = String(projectRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedRelativePath = normalizeBrowserRelativePath(relativePath);

  if (!normalizedRoot || !normalizedRelativePath || normalizedRelativePath === '.') {
    return normalizedRoot;
  }

  return `${normalizedRoot}/${normalizedRelativePath}`;
}

function getParentDirectoryPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return '';
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  const lastSeparatorIndex = normalizedPath.lastIndexOf('/');
  return lastSeparatorIndex > 0 ? normalizedPath.slice(0, lastSeparatorIndex) : '';
}

function getItemOperationDirectory(item) {
  return item?.type === 'directory' ? item.path : getParentDirectoryPath(item?.path || '');
}

function normalizeTreeMovePath(pathValue) {
  return String(pathValue || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
}

function isSameOrNestedPath(parentPath, candidatePath) {
  const parent = normalizeTreeMovePath(parentPath);
  const candidate = normalizeTreeMovePath(candidatePath);

  return Boolean(parent && candidate && (candidate === parent || candidate.startsWith(`${parent}/`)));
}

function isFileTreeItemRowEvent(event) {
  return typeof Element !== 'undefined'
    && event?.target instanceof Element
    && Boolean(event.target.closest('[data-file-tree-item-row="true"]'));
}

function isDragStillInsideCurrentTarget(event) {
  const currentTarget = event?.currentTarget;
  if (typeof Node === 'undefined' || !(currentTarget instanceof Node)) {
    return false;
  }

  const relatedTarget = event.relatedTarget;
  if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
    return true;
  }

  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
    return false;
  }

  const nextTarget = document.elementFromPoint(event.clientX, event.clientY);
  return nextTarget instanceof Node && currentTarget.contains(nextTarget);
}

function toProjectRelativePath(filePath, projectRoot) {
  if (!filePath || typeof filePath !== 'string') {
    return '';
  }

  if (!projectRoot || typeof projectRoot !== 'string') {
    return filePath.replace(/\\/g, '/');
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedRoot = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const rootPrefix = `${normalizedRoot}/`;

  if (normalizedPath === normalizedRoot) {
    return '.';
  }

  return normalizedPath.startsWith(rootPrefix)
    ? normalizedPath.slice(rootPrefix.length)
    : normalizedPath;
}


// ─── Component ───────────────────────────────────────────────────────

function FileTree({ selectedProject, onFileOpen, onStartWorkspaceQa, enableAutoRefresh = true }) {
  const { t } = useTranslation();
  const { can } = useEntitlements();
  const canRevealFiles = can(CAPABILITIES.fileReveal);
  const canExpandFileTree = can(CAPABILITIES.fileExpand);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [selectedImage, setSelectedImage] = useState(null);
  const [viewMode, setViewMode] = useState(() => {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_FILE_TREE_VIEW_MODE;
    }
    const storedMode = localStorage.getItem('file-tree-view-mode');
    return storedMode === 'compact' || storedMode === 'simple' || storedMode === 'detailed'
      ? storedMode
      : DEFAULT_FILE_TREE_VIEW_MODE;
  });
  const [autoRefreshMenuOpen, setAutoRefreshMenuOpen] = useState(false);
  const [autoRefreshIntervalMs, setAutoRefreshIntervalMs] = useState(() => {
    if (!enableAutoRefresh) {
      return 0;
    }
    if (typeof localStorage === 'undefined') {
      return DEFAULT_AUTO_REFRESH_INTERVAL_MS;
    }

    const storedInterval = Number(localStorage.getItem(AUTO_REFRESH_STORAGE_KEY));
    return AUTO_REFRESH_INTERVAL_OPTIONS.includes(storedInterval)
      ? storedInterval
      : DEFAULT_AUTO_REFRESH_INTERVAL_MS;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredFiles, setFilteredFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingDeleteItem, setPendingDeleteItem] = useState(null);
  const [dragOverDir, setDragOverDir] = useState(null);
  const [draggedItem, setDraggedItem] = useState(null);
  const [loadingDirs, setLoadingDirs] = useState(new Set());
  const [movingPath, setMovingPath] = useState(null);
  const [newFolderParentPath, setNewFolderParentPath] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [itemContextMenu, setItemContextMenu] = useState(null);
  const [fileClipboardItem, setFileClipboardItem] = useState(null);
  const [nameOperation, setNameOperation] = useState(null);
  const [nameOperationValue, setNameOperationValue] = useState('');
  const [fileOperationPending, setFileOperationPending] = useState(false);
  const [moveOperationItem, setMoveOperationItem] = useState(null);
  const [moveTargetDir, setMoveTargetDir] = useState(null);
  const [moveDirectoryOptions, setMoveDirectoryOptions] = useState([]);
  const [moveDirectoriesLoading, setMoveDirectoriesLoading] = useState(false);
  const [openingFileManagerPath, setOpeningFileManagerPath] = useState(null);
  const uploadTargetDirRef = useRef('');
  const fileInputRef = useRef(null);
  const fetchRequestSeqRef = useRef(0);
  const loadingDirsRef = useRef(new Set());
  const autoRefreshMenuRef = useRef(null);
  const itemContextMenuRef = useRef(null);
  const fileTreeMaxDepthRef = useRef(FILE_TREE_INITIAL_MAX_DEPTH);
  const autoExpandedProjectRef = useRef(null);

  const fetchFiles = useCallback(async ({ silent = false, maxDepth } = {}) => {
    const requestSeq = fetchRequestSeqRef.current + 1;
    fetchRequestSeqRef.current = requestSeq;

    if (!selectedProject?.name || selectedProject.isDefaultWorkspace) {
      setFiles([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const requestedMaxDepth = Number.isFinite(Number(maxDepth))
        ? Math.min(10, Math.max(FILE_TREE_INITIAL_MAX_DEPTH, Number(maxDepth)))
        : fileTreeMaxDepthRef.current;
      fileTreeMaxDepthRef.current = Math.max(fileTreeMaxDepthRef.current, requestedMaxDepth);

      const response = await api.getFiles(selectedProject.name, {
        maxDepth: requestedMaxDepth,
        showHidden: false,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ File fetch failed:', response.status, errorText);
        if (fetchRequestSeqRef.current === requestSeq && !silent) {
          setFiles([]);
        }
        return;
      }

      const data = await response.json();
      if (fetchRequestSeqRef.current !== requestSeq) {
        return;
      }
      setFiles(data);
      if (autoExpandedProjectRef.current !== selectedProject.name) {
        const visibleFiles = hideInternalFileTreeItems(data);
        setExpandedDirs(new Set(collectTopLevelDirectoryPaths(visibleFiles)));
        autoExpandedProjectRef.current = selectedProject.name;
      }
      loadingDirsRef.current = new Set();
      setLoadingDirs(new Set());
    } catch (error) {
      console.error('❌ Error fetching files:', error);
      if (fetchRequestSeqRef.current === requestSeq && !silent) {
        setFiles([]);
      }
    } finally {
      if (fetchRequestSeqRef.current === requestSeq) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [selectedProject?.isDefaultWorkspace, selectedProject?.name]);

  const loadDirectoryChildren = useCallback(async (
    dirPath,
    { maxDepth = FILE_TREE_CHILD_MAX_DEPTH, expandDescendants = false } = {}
  ) => {
    if (!selectedProject?.name || !dirPath || loadingDirsRef.current.has(dirPath)) {
      return;
    }

    loadingDirsRef.current.add(dirPath);
    setLoadingDirs(new Set(loadingDirsRef.current));

    try {
      const response = await api.getFiles(selectedProject.name, {
        path: dirPath,
        maxDepth,
        showHidden: false,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Directory fetch failed:', response.status, errorText);
        return;
      }

      const children = await response.json();
      setFiles((previousFiles) => updateDirectoryChildren(previousFiles, dirPath, children));
      if (expandDescendants) {
        const descendantDirectoryPaths = collectDirectoryPaths(children);
        setExpandedDirs((previousExpanded) => {
          const nextExpanded = new Set(previousExpanded);
          nextExpanded.add(dirPath);
          descendantDirectoryPaths.forEach((path) => nextExpanded.add(path));
          return nextExpanded;
        });
      }
    } catch (error) {
      console.error('❌ Error fetching directory:', error);
    } finally {
      loadingDirsRef.current.delete(dirPath);
      setLoadingDirs(new Set(loadingDirsRef.current));
    }
  }, [selectedProject?.name]);

  const handleUpload = useCallback(async (uploadItems, targetDir = '') => {
    const rawFilesToUpload = Array.isArray(uploadItems) ? uploadItems : (uploadItems?.files || []);
    const rawDirectoriesToCreate = Array.isArray(uploadItems)
      ? getUploadDirectoriesFromFiles(uploadItems)
      : (uploadItems?.directories || []);
    const filesToUpload = rawFilesToUpload.filter((file) => (
      isVisibleUploadRelativePath(getUploadRelativePath(file))
    ));
    const directoriesToCreate = rawDirectoriesToCreate.filter((directoryPath) => (
      isVisibleUploadRelativePath(directoryPath)
    ));

    if ((!filesToUpload.length && !directoriesToCreate.length) || !selectedProject) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const formData = new FormData();
      formData.append('targetDir', targetDir);
      directoriesToCreate.forEach((directoryPath) => {
        const normalizedPath = normalizeBrowserRelativePath(directoryPath);
        if (normalizedPath) {
          formData.append('directories', normalizedPath);
        }
      });
      filesToUpload.forEach((file) => {
        const relativePath = getUploadRelativePath(file) || file.name;
        formData.append('relativePaths', relativePath);
        formData.append('files', file, file.name);
      });
      const res = await api.uploadFiles(selectedProject.name, formData);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      const uploadedCount = (data.files?.length || 0) + (data.directories?.length || 0);
      const uploadDirectoryPaths = collectUploadResponseDirectoryPaths(data);
      const projectRoot = selectedProject.path || selectedProject.fullPath;

      if (uploadDirectoryPaths.length > 0 && projectRoot) {
        setExpandedDirs((previousDirs) => {
          const nextDirs = new Set(previousDirs);
          uploadDirectoryPaths.forEach((directoryPath) => {
            const absolutePath = buildProjectAbsolutePath(projectRoot, directoryPath);
            if (absolutePath) {
              nextDirs.add(absolutePath);
            }
          });
          return nextDirs;
        });
      }

      setUploadSuccess(t('fileTree.uploadSuccess', { count: uploadedCount }));
      setTimeout(() => setUploadSuccess(null), 3000);
      await fetchFiles({ silent: true, maxDepth: getUploadRefreshDepth(data) });
    } catch (err) {
      setUploadError(err.message);
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setUploading(false);
    }
  }, [fetchFiles, selectedProject, t]);

  const handleFileInputChange = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) {
      handleUpload({
        files,
        directories: getUploadDirectoriesFromFiles(files),
      }, uploadTargetDirRef.current);
    }
    e.target.value = '';
  }, [handleUpload]);

  const handleFileDrop = useCallback(async (e, targetDir) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDir(null);
    const dataTransfer = e.dataTransfer;

    try {
      const uploadItems = await getUploadItemsFromDataTransfer(dataTransfer);
      if (uploadItems.files.length || uploadItems.directories.length) {
        handleUpload(uploadItems, targetDir);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('fileTree.folderReadError'));
      setTimeout(() => setUploadError(null), 5000);
    }
  }, [handleUpload, t]);

  const getDraggedItemFromEvent = useCallback((e) => {
    const transferData = e.dataTransfer?.getData(FILE_TREE_DRAG_MIME);

    if (transferData) {
      try {
        const parsed = JSON.parse(transferData);
        if ((parsed?.type === 'file' || parsed?.type === 'directory') && parsed.path) {
          return parsed;
        }
      } catch {
        // Fall back to component state when the browser blocks custom drag data.
      }
    }

    return draggedItem;
  }, [draggedItem]);

  const canMoveItemToDirectory = useCallback((item, targetDir) => {
    if (
      !item?.path ||
      (item.type !== 'file' && item.type !== 'directory')
    ) {
      return false;
    }

    const projectRoot = selectedProject?.path || selectedProject?.fullPath || '';
    const resolvedTargetDir = targetDir || projectRoot;
    const normalizedTargetDir = normalizeTreeMovePath(resolvedTargetDir);
    const normalizedSourcePath = normalizeTreeMovePath(item.path);

    if (!normalizedTargetDir || !normalizedSourcePath) {
      return false;
    }

    if (normalizeTreeMovePath(getParentDirectoryPath(item.path)) === normalizedTargetDir) {
      return false;
    }

    if (item.type === 'directory' && isSameOrNestedPath(normalizedSourcePath, normalizedTargetDir)) {
      return false;
    }

    return true;
  }, [selectedProject?.fullPath, selectedProject?.path]);

  const handleItemDragStart = useCallback((e, item) => {
    if (item.type !== 'file' && item.type !== 'directory') {
      e.preventDefault();
      return;
    }

    const dragPayload = {
      name: item.name,
      path: item.path,
      type: item.type,
    };

    setDraggedItem(dragPayload);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(FILE_TREE_DRAG_MIME, JSON.stringify(dragPayload));
    e.dataTransfer.setData('text/plain', item.path);
  }, []);

  const handleItemDragEnd = useCallback(() => {
    setDraggedItem(null);
    setDragOverDir(null);
  }, []);

  const handleDirectoryDragOver = useCallback((e, targetDir) => {
    const dataTypes = Array.from(e.dataTransfer?.types || []);
    const isInternalItemMove = dataTypes.includes(FILE_TREE_DRAG_MIME);
    const isExternalFileUpload = dataTypes.includes('Files');

    if (!isInternalItemMove && !isExternalFileUpload) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (isInternalItemMove) {
      const item = getDraggedItemFromEvent(e);
      if (canMoveItemToDirectory(item, targetDir) && !movingPath) {
        e.dataTransfer.dropEffect = 'move';
        setDragOverDir(targetDir);
      } else {
        e.dataTransfer.dropEffect = 'none';
      }
      return;
    }

    e.dataTransfer.dropEffect = 'copy';
    setDragOverDir(targetDir);
  }, [canMoveItemToDirectory, getDraggedItemFromEvent, movingPath]);

  const handleDirectoryDragLeave = useCallback((e, targetDir) => {
    e.stopPropagation();
    if (isDragStillInsideCurrentTarget(e)) {
      return;
    }

    if (dragOverDir === targetDir) {
      setDragOverDir(null);
    }
  }, [dragOverDir]);

  const handleMoveItemDrop = useCallback(async (e, targetDir) => {
    const item = getDraggedItemFromEvent(e);
    setDragOverDir(null);

    if (!selectedProject?.name || !canMoveItemToDirectory(item, targetDir)) {
      setDraggedItem(null);
      return;
    }

    setMovingPath(item.path);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const response = await api.moveFile(selectedProject.name, item.path, targetDir);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || t('fileTree.moveError'));
      }

      const payload = await response.json();
      const projectRoot = selectedProject.path || selectedProject.fullPath;
      const oldRelativePath = toProjectRelativePath(item.path, projectRoot);
      const nextRelativePath = payload?.relativePath || item.path;
      const nextAbsolutePath = payload?.absolutePath || null;
      const destinationLabel = payload?.destinationDir || targetDir;
      const movedName = payload?.name || item.name;

      dispatchProjectFileMoved({
        projectName: selectedProject.name,
        oldRelativePath,
        newRelativePath: nextRelativePath,
        oldAbsolutePath: item.path,
        newAbsolutePath: nextAbsolutePath,
        name: movedName,
      });

      setUploadSuccess(t('fileTree.moveSuccess', { name: movedName, folder: destinationLabel }));
      setTimeout(() => setUploadSuccess(null), 3000);
      fetchFiles();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('fileTree.moveError'));
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setDraggedItem(null);
      setMovingPath(null);
    }
  }, [
    canMoveItemToDirectory,
    fetchFiles,
    getDraggedItemFromEvent,
    selectedProject?.fullPath,
    selectedProject?.name,
    selectedProject?.path,
    t,
  ]);

  const handleDirectoryDrop = useCallback((e, targetDir) => {
    e.preventDefault();
    e.stopPropagation();

    const dataTypes = Array.from(e.dataTransfer?.types || []);
    if (dataTypes.includes(FILE_TREE_DRAG_MIME)) {
      void handleMoveItemDrop(e, targetDir);
      return;
    }

    handleFileDrop(e, targetDir);
  }, [handleFileDrop, handleMoveItemDrop]);

  const handleRootDragOver = useCallback((e) => {
    const dataTypes = Array.from(e.dataTransfer?.types || []);
    const isInternalItemMove = dataTypes.includes(FILE_TREE_DRAG_MIME);
    const isExternalFileUpload = dataTypes.includes('Files');

    if (isInternalItemMove && isFileTreeItemRowEvent(e)) {
      return;
    }

    if (!isInternalItemMove && !isExternalFileUpload) {
      return;
    }

    e.preventDefault();

    if (isInternalItemMove) {
      const item = getDraggedItemFromEvent(e);
      e.dataTransfer.dropEffect = canMoveItemToDirectory(item, '') && !movingPath ? 'move' : 'none';
      return;
    }

    e.dataTransfer.dropEffect = 'copy';
  }, [canMoveItemToDirectory, getDraggedItemFromEvent, movingPath]);

  const handleRootDrop = useCallback((e) => {
    const dataTypes = Array.from(e.dataTransfer?.types || []);

    if (dataTypes.includes(FILE_TREE_DRAG_MIME)) {
      if (isFileTreeItemRowEvent(e)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      void handleMoveItemDrop(e, '');
      return;
    }

    handleFileDrop(e, '');
  }, [handleFileDrop, handleMoveItemDrop]);

  const startCreateFolder = useCallback((e, parentPath = '') => {
    e?.stopPropagation?.();
    const normalizedParentPath = parentPath || '';

    setNewFolderParentPath(normalizedParentPath);
    setNewFolderName('');
    setUploadError(null);
    setUploadSuccess(null);

    if (normalizedParentPath) {
      setExpandedDirs(prev => {
        const next = new Set(prev);
        next.add(normalizedParentPath);
        return next;
      });
    }
  }, []);

  const cancelCreateFolder = useCallback((e) => {
    e?.stopPropagation?.();
    setNewFolderParentPath(null);
    setNewFolderName('');
  }, []);

  const validateFolderName = useCallback((name) => {
    const trimmedName = name.trim();
    if (
      !trimmedName ||
      trimmedName === '.' ||
      trimmedName === '..' ||
      trimmedName.startsWith('.') ||
      trimmedName.length > 255 ||
      trimmedName.endsWith('.') ||
      /[<>:"/\\|?*\u0000-\u001f]/.test(trimmedName) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(trimmedName)
    ) {
      return null;
    }
    return trimmedName;
  }, []);

  const handleCreateFolder = useCallback(async (e) => {
    e?.stopPropagation?.();

    if (!selectedProject?.name || newFolderParentPath === null) {
      return;
    }

    const folderName = validateFolderName(newFolderName);
    if (!folderName) {
      setUploadError(t('fileTree.invalidFolderName'));
      setTimeout(() => setUploadError(null), 5000);
      return;
    }

    setCreatingFolder(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const response = await api.createProjectFolder(selectedProject.name, newFolderParentPath, folderName);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || t('fileTree.createFolderError'));
      }

      const payload = await response.json();
      const createdName = payload?.name || folderName;
      const parentLabel = payload?.parentDir || '.';

      if (newFolderParentPath) {
        setExpandedDirs(prev => {
          const next = new Set(prev);
          next.add(newFolderParentPath);
          return next;
        });
      }

      setNewFolderParentPath(null);
      setNewFolderName('');
      setUploadSuccess(t('fileTree.createFolderSuccess', { name: createdName, folder: parentLabel }));
      setTimeout(() => setUploadSuccess(null), 3000);
      fetchFiles();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('fileTree.createFolderError'));
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setCreatingFolder(false);
    }
  }, [fetchFiles, newFolderName, newFolderParentPath, selectedProject?.name, t, validateFolderName]);

  const handleManualRefresh = useCallback(() => {
    void fetchFiles({ silent: true });
  }, [fetchFiles]);

  const handleOpenInFileManager = useCallback(async (e, targetPath = '') => {
    e?.stopPropagation?.();

    if (!canRevealFiles || !selectedProject?.name || openingFileManagerPath !== null) {
      return;
    }

    const pathToOpen = typeof targetPath === 'string' ? targetPath : '';
    const pendingPath = pathToOpen || '.';
    setOpeningFileManagerPath(pendingPath);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const response = await api.openInFileManager(selectedProject.name, pathToOpen);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t('fileTree.openInFileManagerError'));
      }

      setUploadSuccess(t('fileTree.openInFileManagerSuccess'));
      setTimeout(() => setUploadSuccess(null), 3000);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('fileTree.openInFileManagerError'));
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setOpeningFileManagerPath(null);
    }
  }, [canRevealFiles, openingFileManagerPath, selectedProject?.name, t]);

  const beginUploadForItem = useCallback((item) => {
    uploadTargetDirRef.current = getItemOperationDirectory(item);
    fileInputRef.current?.click();
  }, []);

  const beginNameOperation = useCallback((type, item) => {
    setNameOperation(type === 'rename'
      ? { type, item }
      : { type, parentPath: getItemOperationDirectory(item) });
    setNameOperationValue(type === 'rename' ? item.name : '');
    setUploadError(null);
    setUploadSuccess(null);
  }, []);

  const closeNameOperation = useCallback(() => {
    if (!fileOperationPending) {
      setNameOperation(null);
      setNameOperationValue('');
    }
  }, [fileOperationPending]);

  const handleNameOperationSubmit = useCallback(async () => {
    if (!selectedProject?.name || !nameOperation || fileOperationPending) {
      return;
    }

    const nextName = validateFolderName(nameOperationValue);
    if (!nextName) {
      setUploadError(t('fileTree.invalidItemName'));
      setTimeout(() => setUploadError(null), 5000);
      return;
    }

    setFileOperationPending(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const response = nameOperation.type === 'rename'
        ? await api.renameFile(selectedProject.name, nameOperation.item.path, nextName)
        : await api.createProjectFile(selectedProject.name, nameOperation.parentPath, nextName);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || (
          nameOperation.type === 'rename'
            ? t('fileTree.renameError')
            : t('fileTree.createFileError')
        ));
      }

      if (nameOperation.type === 'rename') {
        const projectRoot = selectedProject.path || selectedProject.fullPath;
        dispatchProjectFileMoved({
          projectName: selectedProject.name,
          oldRelativePath: toProjectRelativePath(nameOperation.item.path, projectRoot),
          newRelativePath: payload?.relativePath || nextName,
          oldAbsolutePath: nameOperation.item.path,
          newAbsolutePath: payload?.absolutePath || null,
          name: payload?.name || nextName,
        });
        setUploadSuccess(t('fileTree.renameSuccess', { name: payload?.name || nextName }));
      } else {
        setUploadSuccess(t('fileTree.createFileSuccess', { name: payload?.name || nextName }));
        void fetchFiles({ silent: true });
      }

      setNameOperation(null);
      setNameOperationValue('');
      setTimeout(() => setUploadSuccess(null), 3000);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t('fileTree.fileOperationError'));
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setFileOperationPending(false);
    }
  }, [
    fetchFiles,
    fileOperationPending,
    nameOperation,
    nameOperationValue,
    selectedProject,
    t,
    validateFolderName,
  ]);

  const copyItemToFileClipboard = useCallback((item) => {
    setFileClipboardItem({ name: item.name, path: item.path, type: item.type });
    setUploadSuccess(t('fileTree.copyItemReady', { name: item.name }));
    setTimeout(() => setUploadSuccess(null), 3000);
  }, [t]);

  const pasteFileClipboardItem = useCallback(async (targetItem) => {
    if (!selectedProject?.name || !fileClipboardItem || fileOperationPending) {
      return;
    }

    setFileOperationPending(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const response = await api.copyFile(
        selectedProject.name,
        fileClipboardItem.path,
        getItemOperationDirectory(targetItem),
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t('fileTree.copyItemError'));
      }

      setUploadSuccess(t('fileTree.copyItemSuccess', { name: payload?.name || fileClipboardItem.name }));
      setTimeout(() => setUploadSuccess(null), 3000);
      void fetchFiles({ silent: true });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t('fileTree.copyItemError'));
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setFileOperationPending(false);
    }
  }, [fetchFiles, fileClipboardItem, fileOperationPending, selectedProject?.name, t]);

  const beginMoveOperation = useCallback(async (item) => {
    if (!selectedProject?.name) {
      return;
    }

    setMoveOperationItem(item);
    setMoveTargetDir(null);
    setMoveDirectoryOptions([]);
    setMoveDirectoriesLoading(true);
    setUploadError(null);
    try {
      const response = await api.getFiles(selectedProject.name, { maxDepth: 10, showHidden: false });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || t('fileTree.loadFoldersError'));
      }
      const items = hideInternalFileTreeItems(await response.json());
      const currentParent = getParentDirectoryPath(item.path);
      const directories = collectDirectoryPaths(items)
        .filter((directoryPath) => directoryPath !== currentParent)
        .filter((directoryPath) => item.type !== 'directory' || !isSameOrNestedPath(item.path, directoryPath));
      setMoveDirectoryOptions(directories);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t('fileTree.loadFoldersError'));
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setMoveDirectoriesLoading(false);
    }
  }, [selectedProject?.name, t]);

  const closeMoveOperation = useCallback(() => {
    if (!fileOperationPending) {
      setMoveOperationItem(null);
      setMoveTargetDir(null);
      setMoveDirectoryOptions([]);
    }
  }, [fileOperationPending]);

  const handleMoveOperationSubmit = useCallback(async () => {
    if (!selectedProject?.name || !moveOperationItem || moveTargetDir === null || fileOperationPending) {
      return;
    }

    setFileOperationPending(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const response = await api.moveFile(selectedProject.name, moveOperationItem.path, moveTargetDir);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t('fileTree.moveError'));
      }

      const projectRoot = selectedProject.path || selectedProject.fullPath;
      dispatchProjectFileMoved({
        projectName: selectedProject.name,
        oldRelativePath: toProjectRelativePath(moveOperationItem.path, projectRoot),
        newRelativePath: payload?.relativePath || moveOperationItem.path,
        oldAbsolutePath: moveOperationItem.path,
        newAbsolutePath: payload?.absolutePath || null,
        name: payload?.name || moveOperationItem.name,
      });
      setUploadSuccess(t('fileTree.moveSuccess', {
        name: payload?.name || moveOperationItem.name,
        folder: payload?.destinationDir || t('fileTree.projectRoot'),
      }));
      setMoveOperationItem(null);
      setMoveTargetDir(null);
      setMoveDirectoryOptions([]);
      setTimeout(() => setUploadSuccess(null), 3000);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t('fileTree.moveError'));
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setFileOperationPending(false);
    }
  }, [fileOperationPending, moveOperationItem, moveTargetDir, selectedProject, t]);

  const changeAutoRefreshInterval = useCallback((intervalMs) => {
    if (!enableAutoRefresh) {
      return;
    }
    const nextInterval = Number(intervalMs);
    const safeInterval = AUTO_REFRESH_INTERVAL_OPTIONS.includes(nextInterval)
      ? nextInterval
      : DEFAULT_AUTO_REFRESH_INTERVAL_MS;

    setAutoRefreshIntervalMs(safeInterval);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(safeInterval));
    }
  }, [enableAutoRefresh]);

  const handleCopyPath = async (e, item) => {
    e?.stopPropagation?.();
    const projectRoot = selectedProject?.path || selectedProject?.fullPath || '';
    const pathToCopy = toProjectRelativePath(item.path, projectRoot);
    const copied = await copyTextToClipboard(pathToCopy);
    if (!copied) {
      console.warn('Unable to copy file path to clipboard:', pathToCopy);
    }
  };

  const buildProjectFileContextItem = useCallback((item) => ({
    name: item.name,
    path: item.path,
    absolutePath: item.path,
    kind: item.type === 'directory' ? 'directory' : 'file',
  }), []);

  const handleAddItemToNewChat = useCallback((e, item) => {
    e?.stopPropagation?.();
    if (!selectedProject || !onStartWorkspaceQa) {
      return;
    }

    onStartWorkspaceQa(selectedProject, '', {
      projectFiles: [buildProjectFileContextItem(item)],
    });
  }, [buildProjectFileContextItem, onStartWorkspaceQa, selectedProject]);

  const handleDelete = useCallback((item) => {
    if (!selectedProject) return;
    setPendingDeleteItem(item);
    setUploadError(null);
    setUploadSuccess(null);
  }, [selectedProject]);

  const openItemContextMenu = useCallback((event, item) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 224;
    const menuHeight = 520;
    const viewportPadding = 8;
    const maxX = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding);
    const maxY = Math.max(viewportPadding, window.innerHeight - menuHeight - viewportPadding);

    setItemContextMenu({
      item,
      x: Math.min(Math.max(event.clientX, viewportPadding), maxX),
      y: Math.min(Math.max(event.clientY, viewportPadding), maxY),
    });
  }, []);

  const closeItemContextMenu = useCallback(() => {
    setItemContextMenu(null);
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    if (!deleting) {
      setPendingDeleteItem(null);
    }
  }, [deleting]);

  const handleConfirmDelete = useCallback(async () => {
    if (!selectedProject || !pendingDeleteItem || deleting) return;

    setDeleting(true);
    try {
      const res = await api.deleteFile(selectedProject.name, pendingDeleteItem.path);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Delete failed (${res.status})`);
      }
      setPendingDeleteItem(null);
      setUploadSuccess(t('fileTree.deleteSuccess'));
      setTimeout(() => setUploadSuccess(null), 3000);
      // Keep the scroll viewport mounted while the deleted item is refreshed
      // out of the tree. A full loading refresh unmounts ScrollArea and resets
      // its scrollTop, which jumps long file lists back to the beginning.
      void fetchFiles({ silent: true });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setDeleting(false);
    }
  }, [deleting, fetchFiles, pendingDeleteItem, selectedProject, t]);

  useEffect(() => {
    fileTreeMaxDepthRef.current = FILE_TREE_INITIAL_MAX_DEPTH;
    void fetchFiles({ maxDepth: FILE_TREE_INITIAL_MAX_DEPTH });
  }, [fetchFiles]);

  useEffect(() => {
    if (!enableAutoRefresh || !autoRefreshMenuOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (autoRefreshMenuRef.current && !autoRefreshMenuRef.current.contains(event.target)) {
        setAutoRefreshMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setAutoRefreshMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [autoRefreshMenuOpen, enableAutoRefresh]);

  useEffect(() => {
    if (!itemContextMenu || typeof document === 'undefined' || typeof window === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (itemContextMenuRef.current && !itemContextMenuRef.current.contains(event.target)) {
        closeItemContextMenu();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeItemContextMenu();
      }
    };
    const handleViewportChange = () => closeItemContextMenu();
    const focusFrame = window.requestAnimationFrame(() => {
      itemContextMenuRef.current?.querySelector('button:not(:disabled)')?.focus();
    });

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [closeItemContextMenu, itemContextMenu]);

  useEffect(() => {
    if ((!nameOperation && !moveOperationItem) || typeof document === 'undefined') {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || fileOperationPending) {
        return;
      }
      if (nameOperation) {
        closeNameOperation();
      } else {
        closeMoveOperation();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeMoveOperation, closeNameOperation, fileOperationPending, moveOperationItem, nameOperation]);

  useEffect(() => {
    if (!enableAutoRefresh || typeof window === 'undefined' || !selectedProject?.name || autoRefreshIntervalMs <= 0) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void fetchFiles({ silent: true });
    }, autoRefreshIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [autoRefreshIntervalMs, enableAutoRefresh, fetchFiles, selectedProject?.name]);

  useEffect(() => {
    if (typeof window === 'undefined' || !selectedProject?.name) {
      return undefined;
    }

    const handleProjectFileChanged = (event) => {
      const detail = event.detail || {};
      if (detail.projectName !== selectedProject.name) {
        return;
      }

      void fetchFiles();
    };

    window.addEventListener(PROJECT_FILE_MOVED_EVENT, handleProjectFileChanged);
    window.addEventListener(PROJECT_FILE_DELETED_EVENT, handleProjectFileChanged);
    return () => {
      window.removeEventListener(PROJECT_FILE_MOVED_EVENT, handleProjectFileChanged);
      window.removeEventListener(PROJECT_FILE_DELETED_EVENT, handleProjectFileChanged);
    };
  }, [fetchFiles, selectedProject?.name]);

  useEffect(() => {
    setSelectedImage(null);
    setNewFolderParentPath(null);
    setItemContextMenu(null);
    setFileClipboardItem(null);
    setNameOperation(null);
    setMoveOperationItem(null);
  }, [selectedProject?.name]);

  useEffect(() => {
    const visibleFiles = sortDisplayFileTree(hideInternalFileTreeItems(files));

    if (!searchQuery.trim()) {
      setFilteredFiles(visibleFiles);
    } else {
      const filtered = filterFiles(visibleFiles, searchQuery.toLowerCase());
      setFilteredFiles(filtered);
      const pathsToExpand = [];

      const expandMatches = (items) => {
        items.forEach(item => {
          if (item.type === 'directory' && item.children && item.children.length > 0) {
            pathsToExpand.push(item.path);
            expandMatches(item.children);
          }
        });
      };
      expandMatches(filtered);
      if (pathsToExpand.length > 0) {
        setExpandedDirs(prev => {
          const next = new Set(prev);
          pathsToExpand.forEach((path) => next.add(path));
          return next;
        });
      }
    }
  }, [files, searchQuery]);

  const filterFiles = (items, query) => {
    return items.reduce((filtered, item) => {
      const matchesName = item.name.toLowerCase().includes(query);
      let filteredChildren = [];

      if (item.type === 'directory' && item.children) {
        filteredChildren = filterFiles(item.children, query);
      }

      if (matchesName || filteredChildren.length > 0) {
        filtered.push({
          ...item,
          children: filteredChildren
        });
      }

      return filtered;
    }, []);
  };

  const isSearching = searchQuery.trim().length > 0;
  const displayFiles = filteredFiles;

  const changeViewMode = (mode) => {
    setViewMode(mode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('file-tree-view-mode', mode);
    }
  };

  const autoRefreshLabel = t(`fileTree.autoRefreshOptions.${autoRefreshIntervalMs}`);
  const topLevelDirectoryPaths = useMemo(
    () => collectTopLevelDirectoryPaths(displayFiles),
    [displayFiles]
  );
  const unloadedTopLevelDirectoryPaths = useMemo(
    () => collectUnloadedTopLevelDirectoryPaths(displayFiles),
    [displayFiles]
  );
  const expandedVisibleDirectoryCount = useMemo(
    () => topLevelDirectoryPaths.filter((path) => expandedDirs.has(path)).length,
    [expandedDirs, topLevelDirectoryPaths]
  );
  const canToggleAllDirectories = topLevelDirectoryPaths.length > 0;
  const shouldCollapseAllDirectories = canToggleAllDirectories
    && expandedVisibleDirectoryCount === topLevelDirectoryPaths.length;
  const toggleAllDirectoriesLabel = t(
    shouldCollapseAllDirectories ? 'fileTree.collapseAll' : 'fileTree.expandAll'
  );

  const handleToggleAllDirectories = useCallback(() => {
    if (topLevelDirectoryPaths.length === 0) {
      return;
    }

    if (shouldCollapseAllDirectories) {
      setExpandedDirs(new Set());
      return;
    }

    setExpandedDirs(new Set(topLevelDirectoryPaths));
    unloadedTopLevelDirectoryPaths.forEach((path) => {
      void loadDirectoryChildren(path);
    });
  }, [loadDirectoryChildren, shouldCollapseAllDirectories, topLevelDirectoryPaths, unloadedTopLevelDirectoryPaths]);

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatRelativeTime = (date) => {
    if (!date) return '-';
    const now = new Date();
    const past = new Date(date);
    const diffInSeconds = Math.floor((now - past) / 1000);

    if (diffInSeconds < 60) return t('fileTree.justNow');
    if (diffInSeconds < 3600) return t('fileTree.minAgo', { count: Math.floor(diffInSeconds / 60) });
    if (diffInSeconds < 86400) return t('fileTree.hoursAgo', { count: Math.floor(diffInSeconds / 3600) });
    if (diffInSeconds < 2592000) return t('fileTree.daysAgo', { count: Math.floor(diffInSeconds / 86400) });
    return past.toLocaleDateString();
  };

  const formatExactTime = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleString();
  };

  const getFileIcon = (filename) => {
    const { icon: Icon, color } = getFileIconData(filename);
    return <Icon className={cn(ICON_SIZE, color)} />;
  };

  const visibleImageFiles = useMemo(() => {
    const items = [];

    const walk = (nodes) => {
      nodes.forEach((item) => {
        if (item.type === 'file' && isImageFilename(item.name)) {
          items.push({
            name: item.name,
            path: item.path,
            projectName: selectedProject?.name,
          });
        }

        if (item.type === 'directory' && Array.isArray(item.children) && item.children.length > 0) {
          walk(item.children);
        }
      });
    };

    walk(displayFiles);
    return items;
  }, [displayFiles, selectedProject?.name]);
  const visibleMarkdownFiles = useMemo(() => {
    const items = [];

    const walk = (nodes) => {
      nodes.forEach((item) => {
        if (item.type === 'file' && isMarkdownFilename(item.name)) {
          items.push({
            name: item.name,
            path: item.path,
            projectName: selectedProject?.name,
          });
        }

        if (item.type === 'directory' && Array.isArray(item.children) && item.children.length > 0) {
          walk(item.children);
        }
      });
    };

    walk(displayFiles);
    return items;
  }, [displayFiles, selectedProject?.name]);

  const selectedImageIndex = useMemo(() => {
    if (!selectedImage) {
      return -1;
    }
    return visibleImageFiles.findIndex((item) => item.path === selectedImage.path);
  }, [selectedImage, visibleImageFiles]);

  const handleSelectAdjacentImage = useCallback((direction) => {
    if (selectedImageIndex < 0) {
      return;
    }

    const nextImage = visibleImageFiles[selectedImageIndex + direction];
    if (nextImage) {
      setSelectedImage(nextImage);
    }
  }, [selectedImageIndex, visibleImageFiles]);

  const toggleDirectory = useCallback((item) => {
    if (!item?.path) {
      return;
    }

    const willExpand = !expandedDirs.has(item.path);
    setExpandedDirs((previousExpanded) => {
      const nextExpanded = new Set(previousExpanded);
      if (willExpand) {
        nextExpanded.add(item.path);
      } else {
        nextExpanded.delete(item.path);
      }
      return nextExpanded;
    });

    if (willExpand && item.type === 'directory' && !Array.isArray(item.children)) {
      void loadDirectoryChildren(item.path);
    }
  }, [expandedDirs, loadDirectoryChildren]);

  // ── Click handler shared across all view modes ──
  const handleItemClick = (item) => {
    if (item.type === 'directory') {
      toggleDirectory(item);
    } else if (isImageFilename(item.name)) {
      if (onFileOpen) {
        onFileOpen(item.path, {
          __chatPreviewNavigation: {
            kind: 'image-gallery',
            paths: visibleImageFiles.map((image) => image.path),
          },
        });
        return;
      }
      const nextImage = visibleImageFiles.find((image) => image.path === item.path) || {
        name: item.name,
        path: item.path,
        projectName: selectedProject.name,
      };
      setSelectedImage(nextImage);
    } else if (isMarkdownFilename(item.name) && onFileOpen) {
      const itemDirectory = getParentDirectoryPath(item.path);
      const siblingMarkdownPaths = visibleMarkdownFiles
        .filter((file) => getParentDirectoryPath(file.path) === itemDirectory)
        .map((file) => file.path);

      onFileOpen(item.path, {
        __chatPreviewNavigation: {
          kind: 'markdown-gallery',
          paths: siblingMarkdownPaths,
        },
      });
    } else if (onFileOpen) {
      onFileOpen(item.path);
    }
  };

  const getItemDragProps = (item) => {
    if (item.type === 'directory') {
      return {
        draggable: !movingPath,
        onDragStart: (e) => handleItemDragStart(e, item),
        onDragEnd: handleItemDragEnd,
        onDragOver: (e) => handleDirectoryDragOver(e, item.path),
        onDragLeave: (e) => handleDirectoryDragLeave(e, item.path),
        onDrop: (e) => handleDirectoryDrop(e, item.path),
      };
    }

    return {
      draggable: !movingPath,
      onDragStart: (e) => handleItemDragStart(e, item),
      onDragEnd: handleItemDragEnd,
    };
  };

  const getItemDragClass = (item) => cn(
    (item.type === 'file' || item.type === 'directory') && !movingPath && 'cursor-grab active:cursor-grabbing',
    movingPath === item.path && 'opacity-50'
  );

  const renderNewFolderInput = (parentPath, level = 0) => {
    if (newFolderParentPath !== parentPath) {
      return null;
    }

    return (
      <div
        className="flex items-center gap-1.5 rounded-sm border-l-2 border-primary/30 bg-accent/40 py-1 pr-2"
        style={{ paddingLeft: `${level * 16 + 4}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex items-center flex-shrink-0 ml-[18px]">
          <FolderPlus className="w-4 h-4 text-blue-500" />
        </span>
        <Input
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void handleCreateFolder(e);
            } else if (e.key === 'Escape') {
              cancelCreateFolder(e);
            }
          }}
          placeholder={t('fileTree.newFolderPlaceholder')}
          className="h-7 min-w-0 flex-1 text-xs"
          autoFocus
          disabled={creatingFolder}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleCreateFolder}
          disabled={creatingFolder || !newFolderName.trim()}
          title={t('fileTree.createFolder')}
        >
          {creatingFolder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={cancelCreateFolder}
          disabled={creatingFolder}
          title={t('fileTree.cancelFolder')}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  };

  const renderDirectoryLoadingRow = (level) => (
    <div
      className="flex items-center gap-1.5 py-1 pr-2 text-xs text-muted-foreground"
      style={{ paddingLeft: `${level * 16 + 26}px` }}
    >
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      <span>{t('fileTree.loading')}</span>
    </div>
  );

  // ── Indent guide + folder/file icon rendering ──
  const renderIndentGuides = (level) => {
    if (level === 0) return null;
    return (
      <span className="flex items-center flex-shrink-0" aria-hidden="true">
        {Array.from({ length: level }).map((_, i) => (
          <span
            key={i}
            className="inline-block w-4 h-full border-l border-border/50"
          />
        ))}
      </span>
    );
  };

  const renderItemIcons = (item, { allowNested = true } = {}) => {
    const isDir = item.type === 'directory';
    const isOpen = allowNested && expandedDirs.has(item.path);
    const isLoadingDir = isDir && loadingDirs.has(item.path);

    if (isDir) {
      return (
        <span className="flex items-center gap-0.5 flex-shrink-0">
          {isLoadingDir ? (
            <Loader2 className="w-3.5 h-3.5 text-muted-foreground/70 animate-spin" />
          ) : (
            <ChevronRight
              className={cn(
                'w-3.5 h-3.5 text-muted-foreground/70 transition-transform duration-150',
                isOpen && 'rotate-90'
              )}
            />
          )}
          {isOpen ? (
            <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
        </span>
      );
    }

    return (
      <span className="flex items-center flex-shrink-0 ml-[18px]">
        {getFileIcon(item.name)}
      </span>
    );
  };

  // ─── Simple (Tree) View ────────────────────────────────────────────
  const renderFileTree = (items, level = 0, { allowNested = true } = {}) => {
    return items.map((item) => {
      const isDir = item.type === 'directory';
      const isOpen = allowNested && isDir && expandedDirs.has(item.path);
      return (
        <div key={item.path} className="select-none">
          <div
            data-file-tree-item-row="true"
            className={cn(
              'group flex items-center gap-1.5 py-[3px] pr-2 cursor-pointer rounded-sm',
              'hover:bg-accent/60 transition-colors duration-100',
              isDir && isOpen && 'border-l-2 border-primary/30',
              isDir && !isOpen && 'border-l-2 border-transparent',
              !isDir && 'border-l-2 border-transparent',
              isDir && dragOverDir === item.path && 'bg-primary/10 ring-1 ring-primary/40',
              getItemDragClass(item),
            )}
            style={{ paddingLeft: `${level * 16 + 4}px` }}
            onClick={() => handleItemClick(item)}
            onContextMenu={(event) => openItemContextMenu(event, item)}
            {...getItemDragProps(item)}
          >
            {renderItemIcons(item, { allowNested })}
            <span className={cn(
              'text-[13px] leading-tight truncate flex-1',
              isDir ? 'font-medium text-foreground' : 'text-foreground/90'
            )}>
              {item.name}
            </span>
          </div>

          {isDir && renderNewFolderInput(item.path, level + 1)}

          {isDir && isOpen && loadingDirs.has(item.path) && !Array.isArray(item.children) && (
            renderDirectoryLoadingRow(level + 1)
          )}

          {isDir && isOpen && item.children && item.children.length > 0 && (
            <div className="relative">
              <span
                className="absolute top-0 bottom-0 border-l border-border/40"
                style={{ left: `${level * 16 + 14}px` }}
                aria-hidden="true"
              />
              {renderFileTree(item.children, level + 1, { allowNested })}
            </div>
          )}
        </div>
      );
    });
  };

  // ─── Detailed View ────────────────────────────────────────────────
  const renderDetailedView = (items, level = 0, { allowNested = true } = {}) => {
    return items.map((item) => {
      const isDir = item.type === 'directory';
      const isOpen = allowNested && isDir && expandedDirs.has(item.path);
      return (
        <div key={item.path} className="select-none">
          <div
            data-file-tree-item-row="true"
            className={cn(
              'group grid grid-cols-12 gap-2 py-[3px] pr-2 hover:bg-accent/60 cursor-pointer items-center rounded-sm transition-colors duration-100',
              isDir && isOpen && 'border-l-2 border-primary/30',
              isDir && !isOpen && 'border-l-2 border-transparent',
              !isDir && 'border-l-2 border-transparent',
              isDir && dragOverDir === item.path && 'bg-primary/10 ring-1 ring-primary/40',
              getItemDragClass(item),
            )}
            style={{ paddingLeft: `${level * 16 + 4}px` }}
            onClick={() => handleItemClick(item)}
            onContextMenu={(event) => openItemContextMenu(event, item)}
            {...getItemDragProps(item)}
          >
            <div className="col-span-7 flex items-center gap-1.5 min-w-0">
              {renderItemIcons(item, { allowNested })}
              <span className={cn(
                'text-[13px] leading-tight truncate flex-1',
                isDir ? 'font-medium text-foreground' : 'text-foreground/90'
              )}>
                {item.name}
              </span>
            </div>
            <div className="col-span-2 text-xs text-muted-foreground tabular-nums">
              {item.type === 'file' ? formatFileSize(item.size) : ''}
            </div>
            <div className="col-span-3 text-xs text-muted-foreground">
              {formatRelativeTime(item.modified)}
            </div>
          </div>

          {isDir && renderNewFolderInput(item.path, level + 1)}

          {isDir && isOpen && loadingDirs.has(item.path) && !Array.isArray(item.children) && (
            renderDirectoryLoadingRow(level + 1)
          )}

          {isDir && isOpen && item.children && (
            <div className="relative">
              <span
                className="absolute top-0 bottom-0 border-l border-border/40"
                style={{ left: `${level * 16 + 14}px` }}
                aria-hidden="true"
              />
              {renderDetailedView(item.children, level + 1, { allowNested })}
            </div>
          )}
        </div>
      );
    });
  };

  // ─── Compact View ──────────────────────────────────────────────────
  const renderCompactView = (items, level = 0, { allowNested = true } = {}) => {
    return items.map((item) => {
      const isDir = item.type === 'directory';
      const isOpen = allowNested && isDir && expandedDirs.has(item.path);
      return (
        <div key={item.path} className="select-none">
          <div
            data-file-tree-item-row="true"
            className={cn(
              'group flex items-center justify-between py-[3px] pr-2 hover:bg-accent/60 cursor-pointer rounded-sm transition-colors duration-100',
              isDir && isOpen && 'border-l-2 border-primary/30',
              isDir && !isOpen && 'border-l-2 border-transparent',
              !isDir && 'border-l-2 border-transparent',
              isDir && dragOverDir === item.path && 'bg-primary/10 ring-1 ring-primary/40',
              getItemDragClass(item),
            )}
            style={{ paddingLeft: `${level * 16 + 4}px` }}
            onClick={() => handleItemClick(item)}
            onContextMenu={(event) => openItemContextMenu(event, item)}
            {...getItemDragProps(item)}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {renderItemIcons(item, { allowNested })}
              <span className={cn(
                'text-[13px] leading-tight truncate',
                isDir ? 'font-medium text-foreground' : 'text-foreground/90'
              )}>
                {item.name}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0 ml-2">
              {item.type === 'file' && (
                <span className="tabular-nums" title={formatExactTime(item.modified)}>{formatFileSize(item.size)}</span>
              )}
            </div>
          </div>

          {isDir && renderNewFolderInput(item.path, level + 1)}

          {isDir && isOpen && loadingDirs.has(item.path) && !Array.isArray(item.children) && (
            renderDirectoryLoadingRow(level + 1)
          )}

          {isDir && isOpen && item.children && (
            <div className="relative">
              <span
                className="absolute top-0 bottom-0 border-l border-border/40"
                style={{ left: `${level * 16 + 14}px` }}
                aria-hidden="true"
              />
              {renderCompactView(item.children, level + 1, { allowNested })}
            </div>
          )}
        </div>
      );
    });
  };

  // The protected default workspace is only a routing placeholder. Showing
  // its root would mix every date/conversation folder into one file tree.
  if (selectedProject?.isDefaultWorkspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground">
        <Folder className="h-8 w-8 opacity-45" />
        <p className="mt-2 text-sm font-medium text-foreground">
          {t('fileTree.noFolderConnected')}
        </p>
        <p className="mt-1 max-w-64 text-xs">
          {t('fileTree.noFolderConnectedHint')}
        </p>
      </div>
    );
  }

  // ─── Loading state ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground text-sm">
          {t('fileTree.loading')}
        </div>
      </div>
    );
  }

  // ─── Main render ───────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('fileTree.files')}
          </h3>
          <div className="flex items-center gap-0.5">
            {enableAutoRefresh && (
              <div className="relative" ref={autoRefreshMenuRef}>
                <Button
                  variant={autoRefreshIntervalMs > 0 ? 'secondary' : 'ghost'}
                  size="sm"
                  type="button"
                  className={cn(
                    'h-7 min-w-[58px] px-1.5 gap-1 text-[11px] tabular-nums',
                    autoRefreshMenuOpen && 'bg-accent text-accent-foreground'
                  )}
                  onClick={() => setAutoRefreshMenuOpen((open) => !open)}
                  title={t('fileTree.autoRefresh')}
                  aria-label={t('fileTree.autoRefresh')}
                  aria-haspopup="menu"
                  aria-expanded={autoRefreshMenuOpen}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span className="leading-none">{autoRefreshLabel}</span>
                  <ChevronDown className={cn('w-3 h-3 transition-transform', autoRefreshMenuOpen && 'rotate-180')} />
                </Button>

                {autoRefreshMenuOpen && (
                  <div
                    className="absolute right-0 top-full z-50 mt-1 w-28 overflow-hidden rounded-md border border-border bg-background py-1 shadow-lg"
                    role="menu"
                    aria-label={t('fileTree.autoRefresh')}
                  >
                    {AUTO_REFRESH_INTERVAL_OPTIONS.map((intervalMs) => {
                      const isSelected = intervalMs === autoRefreshIntervalMs;

                      return (
                        <button
                          key={intervalMs}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          className={cn(
                            'flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                            isSelected && 'bg-accent text-accent-foreground'
                          )}
                          onClick={() => {
                            changeAutoRefreshInterval(intervalMs);
                            setAutoRefreshMenuOpen(false);
                          }}
                        >
                          <span>{t(`fileTree.autoRefreshOptions.${intervalMs}`)}</span>
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="h-7 w-7 p-0"
              onClick={canExpandFileTree ? handleToggleAllDirectories : undefined}
              title={canExpandFileTree ? toggleAllDirectoriesLabel : t('entitlements.lockedAction')}
              aria-label={canExpandFileTree ? toggleAllDirectoriesLabel : t('entitlements.lockedAction')}
              disabled={!canExpandFileTree || !canToggleAllDirectories}
            >
              {!canExpandFileTree
                ? <Lock className="w-3.5 h-3.5" />
                : shouldCollapseAllDirectories
                  ? <Folder className="w-3.5 h-3.5" />
                  : <FolderOpen className="w-3.5 h-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="h-7 w-7 p-0"
              onClick={(e) => handleOpenInFileManager(e, '')}
              title={canRevealFiles ? t('fileTree.openInFileManager') : t('entitlements.lockedAction')}
              aria-label={canRevealFiles ? t('fileTree.openInFileManager') : t('entitlements.lockedAction')}
              disabled={!canRevealFiles || !selectedProject?.name || openingFileManagerPath !== null}
            >
              {!canRevealFiles
                ? <Lock className="w-3.5 h-3.5" />
                : openingFileManagerPath === '.'
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <ExternalLink className="w-3.5 h-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={(e) => startCreateFolder(e, '')}
              title={t('fileTree.newFolder')}
              disabled={creatingFolder}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => {
                uploadTargetDirRef.current = '';
                fileInputRef.current?.click();
              }}
              title={t('fileTree.uploadFiles')}
              disabled={uploading}
            >
              <UploadCloud className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant={viewMode === 'compact' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => changeViewMode(viewMode === 'compact' ? 'detailed' : 'compact')}
              title={viewMode === 'compact' ? t('fileTree.detailedView') : t('fileTree.compactView')}
              aria-label={viewMode === 'compact' ? t('fileTree.detailedView') : t('fileTree.compactView')}
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={handleManualRefresh}
              title={t('fileTree.refresh')}
              disabled={refreshing}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            </Button>
            <ProjectDownloadButton selectedProject={selectedProject} />
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t('fileTree.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-7 pr-7 h-7 text-xs"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0.5 top-1/2 transform -translate-y-1/2 h-5 w-5 p-0 hover:bg-accent"
              onClick={() => setSearchQuery('')}
              title={t('fileTree.clearSearch')}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>

      </div>

      {/* Column Headers for Detailed View */}
      {viewMode === 'detailed' && displayFiles.length > 0 && (
        <div className="px-3 pt-1.5 pb-1 border-b border-border">
          <div className="grid grid-cols-12 gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            <div className="col-span-7">{t('fileTree.name')}</div>
            <div className="col-span-2">{t('fileTree.size')}</div>
            <div className="col-span-3">{t('fileTree.modified')}</div>
          </div>
        </div>
      )}

      {/* Upload status bar */}
      {uploading && (
        <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t('fileTree.uploading')}
        </div>
      )}
      {uploadError && (
        <div className="px-3 py-1.5 border-b border-border text-xs text-red-500">
          {uploadError}
        </div>
      )}
      {uploadSuccess && (
        <div className="px-3 py-1.5 border-b border-border text-xs text-green-500">
          {uploadSuccess}
        </div>
      )}

      <input
        type="file"
        ref={fileInputRef}
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      <div
        className="flex-1 relative min-h-0 overflow-hidden"
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
        <ScrollArea className="panel-scroll-area sidebar-scroll-area h-full px-2 py-1">
          {files.length === 0 && newFolderParentPath !== '' ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
                <Folder className="w-6 h-6 text-muted-foreground" />
              </div>
              <h4 className="font-medium text-foreground mb-1">{t('fileTree.noFilesFound')}</h4>
              <p className="text-sm text-muted-foreground">
                {t('fileTree.checkProjectPath')}
              </p>
            </div>
          ) : displayFiles.length === 0 && searchQuery ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
                <Search className="w-6 h-6 text-muted-foreground" />
              </div>
              <h4 className="font-medium text-foreground mb-1">{t('fileTree.noMatchesFound')}</h4>
              <p className="text-sm text-muted-foreground">
                {t('fileTree.tryDifferentSearch')}
              </p>
            </div>
          ) : displayFiles.length === 0 ? (
            <div>
              {renderNewFolderInput('', 0)}
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
                  <Folder className="w-6 h-6 text-muted-foreground" />
                </div>
                <h4 className="font-medium text-foreground mb-1">{t('fileTree.folderEmpty')}</h4>
                <p className="text-sm text-muted-foreground">
                  {t('fileTree.folderEmptyHint')}
                </p>
              </div>
            </div>
          ) : (
            <div>
              {renderNewFolderInput('', 0)}
              {viewMode === 'simple' && renderFileTree(displayFiles)}
              {viewMode === 'compact' && renderCompactView(displayFiles)}
              {viewMode === 'detailed' && renderDetailedView(displayFiles)}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* File and folder context menu */}
      {itemContextMenu && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={itemContextMenuRef}
          className="fixed z-[140] max-h-[calc(100vh-16px)] w-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
          style={{ left: itemContextMenu.x, top: itemContextMenu.y }}
          role="menu"
          aria-label={t('fileTree.itemActions', { name: itemContextMenu.item.name })}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="truncate border-b border-border px-2.5 py-2 text-xs font-semibold text-muted-foreground" title={itemContextMenu.item.path}>
            {itemContextMenu.item.name}
          </div>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-45"
            disabled={uploading}
            onClick={() => {
              const { item } = itemContextMenu;
              closeItemContextMenu();
              beginUploadForItem(item);
            }}
          >
            <UploadCloud className="h-4 w-4 shrink-0" />
            <span>{t('fileTree.uploadHere')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              const { item } = itemContextMenu;
              closeItemContextMenu();
              beginNameOperation('createFile', item);
            }}
          >
            <FilePlus2 className="h-4 w-4 shrink-0" />
            <span>{t('fileTree.newFile')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              const { item } = itemContextMenu;
              closeItemContextMenu();
              startCreateFolder(null, getItemOperationDirectory(item));
            }}
          >
            <FolderPlus className="h-4 w-4 shrink-0" />
            <span>{t('fileTree.newFolder')}</span>
          </button>
          <div className="my-1 border-t border-border" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              const { item } = itemContextMenu;
              closeItemContextMenu();
              beginNameOperation('rename', item);
            }}
          >
            <Pencil className="h-4 w-4 shrink-0" />
            <span>{t('fileTree.rename')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={(event) => {
              const { item } = itemContextMenu;
              closeItemContextMenu();
              void handleCopyPath(event, item);
            }}
          >
            <Copy className="h-4 w-4 shrink-0" />
            <span>{t('fileTree.copyPath')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              const { item } = itemContextMenu;
              closeItemContextMenu();
              copyItemToFileClipboard(item);
            }}
          >
            <Copy className="h-4 w-4 shrink-0" />
            <span>{t('fileTree.copyItem')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!fileClipboardItem || fileOperationPending}
            onClick={() => {
              const { item } = itemContextMenu;
              closeItemContextMenu();
              void pasteFileClipboardItem(item);
            }}
          >
            <ClipboardPaste className="h-4 w-4 shrink-0" />
            <span>{t('fileTree.pasteItem')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              const { item } = itemContextMenu;
              closeItemContextMenu();
              void beginMoveOperation(item);
            }}
          >
            <FolderInput className="h-4 w-4 shrink-0" />
            <span>{t('fileTree.moveItem')}</span>
          </button>
          <div className="my-1 border-t border-border" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              closeItemContextMenu();
              void fetchFiles({ silent: true });
            }}
          >
            <RefreshCw className="h-4 w-4 shrink-0" />
            <span>{t('fileTree.refresh')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!onStartWorkspaceQa}
            onClick={(event) => {
              const { item } = itemContextMenu;
              closeItemContextMenu();
              handleAddItemToNewChat(event, item);
            }}
          >
            <MessageSquarePlus className="h-4 w-4 shrink-0" />
            <span>{t('fileTree.addToNewChat')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canRevealFiles || openingFileManagerPath !== null}
            onClick={(event) => {
              const { item } = itemContextMenu;
              closeItemContextMenu();
              void handleOpenInFileManager(event, item.path);
            }}
          >
            {openingFileManagerPath === itemContextMenu.item.path
              ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              : <ExternalLink className="h-4 w-4 shrink-0" />}
            <span>{canRevealFiles ? t('fileTree.openInFileManager') : t('entitlements.lockedAction')}</span>
          </button>
          <div className="my-1 border-t border-border" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={deleting}
            onClick={() => {
              const { item } = itemContextMenu;
              closeItemContextMenu();
              handleDelete(item);
            }}
          >
            <Trash2 className="h-4 w-4 shrink-0" />
            <span>{t('fileTree.deleteFile')}</span>
          </button>
        </div>,
        document.body
      )}

      {/* Create file / rename dialog */}
      {nameOperation && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="file-tree-name-operation-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeNameOperation();
            }
          }}
        >
          <form
            className="w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void handleNameOperationSubmit();
            }}
          >
            <h2 id="file-tree-name-operation-title" className="text-base font-semibold text-foreground">
              {nameOperation.type === 'rename' ? t('fileTree.renameTitle') : t('fileTree.createFileTitle')}
            </h2>
            {nameOperation.type === 'rename' && (
              <p className="mt-1 truncate text-xs text-muted-foreground" title={nameOperation.item.path}>
                {nameOperation.item.name}
              </p>
            )}
            <Input
              autoFocus
              value={nameOperationValue}
              onChange={(event) => setNameOperationValue(event.target.value)}
              className="mt-4"
              placeholder={nameOperation.type === 'rename' ? t('fileTree.renamePlaceholder') : t('fileTree.newFilePlaceholder')}
              aria-label={nameOperation.type === 'rename' ? t('fileTree.renamePlaceholder') : t('fileTree.newFilePlaceholder')}
              disabled={fileOperationPending}
              onFocus={(event) => {
                if (nameOperation.type !== 'rename') return;
                const extensionIndex = event.currentTarget.value.lastIndexOf('.');
                event.currentTarget.setSelectionRange(0, extensionIndex > 0 ? extensionIndex : event.currentTarget.value.length);
              }}
            />
            {uploadError && (
              <p className="mt-2 text-xs text-destructive">{uploadError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={closeNameOperation} disabled={fileOperationPending}>
                {t('buttons.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={fileOperationPending || !nameOperationValue.trim()} className="gap-2">
                {fileOperationPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {nameOperation.type === 'rename' ? t('fileTree.renameAction') : t('fileTree.createFileAction')}
              </Button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* Move destination dialog */}
      {moveOperationItem && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="file-tree-move-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeMoveOperation();
            }
          }}
        >
          <div className="flex max-h-[75vh] w-full max-w-md flex-col rounded-xl border border-border bg-background p-5 shadow-2xl">
            <h2 id="file-tree-move-title" className="text-base font-semibold text-foreground">
              {t('fileTree.moveTitle', { name: moveOperationItem.name })}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{t('fileTree.chooseMoveDestination')}</p>
            {uploadError && (
              <p className="mt-2 text-xs text-destructive">{uploadError}</p>
            )}

            <div className="mt-4 min-h-32 flex-1 overflow-y-auto rounded-lg border border-border p-1.5">
              {moveDirectoriesLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('fileTree.loadingFolders')}
                </div>
              ) : (
                <>
                  {normalizeTreeMovePath(getParentDirectoryPath(moveOperationItem.path)) !== normalizeTreeMovePath(selectedProject?.path || selectedProject?.fullPath || '') && (
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent',
                        moveTargetDir === '' && 'bg-accent text-accent-foreground'
                      )}
                      onClick={() => setMoveTargetDir('')}
                    >
                      <Folder className="h-4 w-4 shrink-0" />
                      <span>{t('fileTree.projectRoot')}</span>
                    </button>
                  )}
                  {moveDirectoryOptions.map((directoryPath) => (
                    <button
                      key={directoryPath}
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent',
                        moveTargetDir === directoryPath && 'bg-accent text-accent-foreground'
                      )}
                      onClick={() => setMoveTargetDir(directoryPath)}
                    >
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate" title={directoryPath}>
                        {toProjectRelativePath(directoryPath, selectedProject?.path || selectedProject?.fullPath || '')}
                      </span>
                    </button>
                  ))}
                  {moveDirectoryOptions.length === 0
                    && !moveDirectoriesLoading
                    && normalizeTreeMovePath(getParentDirectoryPath(moveOperationItem.path)) === normalizeTreeMovePath(selectedProject?.path || selectedProject?.fullPath || '') && (
                    <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {t('fileTree.noMoveDestinations')}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={closeMoveOperation} disabled={fileOperationPending}>
                {t('buttons.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleMoveOperationSubmit()}
                disabled={fileOperationPending || moveDirectoriesLoading || moveTargetDir === null}
                className="gap-2"
              >
                {fileOperationPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('fileTree.moveAction')}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete confirmation modal */}
      {pendingDeleteItem && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="file-tree-delete-confirm-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDeleteConfirm();
            }
          }}
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-background p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <Trash2 className="h-4 w-4 text-destructive" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="file-tree-delete-confirm-title" className="text-base font-semibold text-foreground">
                  {t('fileTree.deleteConfirmTitle')}
                </h2>
                <p className="mt-2 text-sm text-foreground">
                  {t('fileTree.confirmDelete', { name: pendingDeleteItem.name })}
                </p>
                <p className="mt-2 break-all rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
                  {pendingDeleteItem.path}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('fileTree.deleteConfirmWarning')}
                </p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={closeDeleteConfirm}
                disabled={deleting}
              >
                {t('buttons.cancel')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="gap-2"
              >
                {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {deleting ? t('fileTree.deletingFile') : t('fileTree.deleteConfirmAction')}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Image Viewer Modal */}
      {selectedImage && (
        <ImageViewer
          file={selectedImage}
          onClose={() => setSelectedImage(null)}
          onPrevious={() => handleSelectAdjacentImage(-1)}
          onNext={() => handleSelectAdjacentImage(1)}
          hasPrevious={selectedImageIndex > 0}
          hasNext={selectedImageIndex >= 0 && selectedImageIndex < visibleImageFiles.length - 1}
          positionLabel={
            selectedImageIndex >= 0 && visibleImageFiles.length > 1
              ? t('fileTree.imageViewer.position', { current: selectedImageIndex + 1, total: visibleImageFiles.length })
              : null
          }
        />
      )}
    </div>
  );
}

export default FileTree;
