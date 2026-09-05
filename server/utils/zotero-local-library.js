import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promises as fsPromises } from 'fs';

const EXCLUDED_TYPES = new Set(['attachment', 'note', 'annotation', 'computerProgram']);

function expandHome(value) {
  const text = String(value || '').trim();
  if (text === '~') return os.homedir();
  if (text.startsWith(`~${path.sep}`)) return path.join(os.homedir(), text.slice(2));
  return text;
}

export function resolveZoteroDirectory(value = path.join(os.homedir(), 'Zotero')) {
  const resolved = path.resolve(expandHome(value));
  const stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) throw new Error('Zotero data directory was not found');
  const databasePath = path.join(resolved, 'zotero.sqlite');
  if (!fs.statSync(databasePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('The selected folder does not contain zotero.sqlite');
  }
  return resolved;
}

async function withDatabaseCopy(zoteroDir, callback) {
  const temporaryDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'medhelp-zotero-'));
  const source = path.join(zoteroDir, 'zotero.sqlite');
  const target = path.join(temporaryDir, 'zotero.sqlite');
  let database;
  try {
    await fsPromises.copyFile(source, target);
    for (const suffix of ['-wal', '-shm']) {
      try {
        await fsPromises.copyFile(`${source}${suffix}`, `${target}${suffix}`);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    database = new Database(target, { readonly: true, fileMustExist: true });
    database.pragma('query_only = ON');
    return await callback(database);
  } finally {
    database?.close();
    await fsPromises.rm(temporaryDir, { recursive: true, force: true });
  }
}

function safeAll(database, sql, ...params) {
  try {
    return database.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

function safeSegment(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return cleaned && cleaned !== '..' ? cleaned : null;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

export function zoteroNoteHtmlToMarkdown(value) {
  return decodeHtml(String(value || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '- ')
    .replace(/<\s*\/\s*(?:p|div|li|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function getFields(database, itemId) {
  const fields = {};
  for (const row of safeAll(database, `
    SELECT f.fieldName AS name, idv.value AS value
    FROM itemData d
    JOIN fields f ON d.fieldID = f.fieldID
    JOIN itemDataValues idv ON d.valueID = idv.valueID
    WHERE d.itemID = ?
  `, itemId)) {
    fields[row.name] = row.value == null ? '' : String(row.value);
  }
  return fields;
}

function getCreators(database, itemId) {
  const rows = safeAll(database, `
    SELECT ct.creatorType, c.firstName, c.lastName, c.fieldMode
    FROM itemCreators ic
    JOIN creators c ON ic.creatorID = c.creatorID
    JOIN creatorTypes ct ON ic.creatorTypeID = ct.creatorTypeID
    WHERE ic.itemID = ?
    ORDER BY ic.orderIndex
  `, itemId);
  const preferred = rows.filter((row) => row.creatorType === 'author');
  return (preferred.length ? preferred : rows).map((row) => row.fieldMode === 1
    ? { family: String(row.lastName || '').trim(), given: '' }
    : { family: String(row.lastName || '').trim(), given: String(row.firstName || '').trim() })
    .filter((creator) => creator.family || creator.given);
}

function getTags(database, itemId) {
  return safeAll(database, `
    SELECT t.name FROM itemTags it JOIN tags t ON it.tagID = t.tagID
    WHERE it.itemID = ? ORDER BY LOWER(t.name)
  `, itemId).map((row) => String(row.name || '').trim()).filter(Boolean);
}

function getCollections(database) {
  const map = new Map();
  for (const row of safeAll(database, 'SELECT collectionID, collectionName, parentCollectionID FROM collections')) {
    map.set(Number(row.collectionID), {
      id: Number(row.collectionID),
      name: String(row.collectionName || '').trim(),
      parentId: row.parentCollectionID == null ? null : Number(row.parentCollectionID),
    });
  }
  return map;
}

function collectionPath(collections, collectionId) {
  const result = [];
  const seen = new Set();
  let current = collectionId;
  while (current != null && !seen.has(current) && result.length < 32) {
    seen.add(current);
    const collection = collections.get(current);
    if (!collection) break;
    const segment = safeSegment(collection.name);
    if (segment) result.push(segment);
    current = collection.parentId;
  }
  return result.reverse();
}

function getPdfAttachments(database, zoteroDir, itemId) {
  return safeAll(database, `
    SELECT ia.path, ai.key
    FROM itemAttachments ia
    JOIN items ai ON ia.itemID = ai.itemID
    WHERE ia.parentItemID = ? AND ia.contentType = 'application/pdf'
      AND ia.itemID NOT IN (SELECT itemID FROM deletedItems)
  `, itemId).map((row) => {
    const storedPath = String(row.path || '').trim();
    if (storedPath.startsWith('storage:')) {
      return path.join(zoteroDir, 'storage', row.key, storedPath.slice('storage:'.length));
    }
    if (storedPath.startsWith('attachments:')) return null;
    return path.isAbsolute(storedPath) ? storedPath : null;
  }).filter((filePath) => filePath && fs.statSync(filePath, { throwIfNoEntry: false })?.isFile());
}

function getNotes(database, itemId) {
  return safeAll(database, `
    SELECT note FROM itemNotes WHERE parentItemID = ?
      AND itemID NOT IN (SELECT itemID FROM deletedItems) ORDER BY itemID
  `, itemId).map((row) => zoteroNoteHtmlToMarkdown(row.note)).filter(Boolean);
}

function getAnnotations(database, itemId) {
  return safeAll(database, `
    SELECT a.text, a.comment, a.pageLabel
    FROM itemAnnotations a
    JOIN itemAttachments att ON a.parentItemID = att.itemID
    WHERE att.parentItemID = ?
      AND a.itemID NOT IN (SELECT itemID FROM deletedItems)
    ORDER BY att.itemID, a.sortIndex
  `, itemId).map((row) => {
    const quote = String(row.text || '').replace(/\s+/g, ' ').trim();
    const comment = String(row.comment || '').trim();
    const page = String(row.pageLabel || '').trim();
    const lines = [];
    if (quote) lines.push(`> ${quote}${page ? ` (p. ${page})` : ''}`);
    else if (page) lines.push(`(p. ${page})`);
    if (comment) lines.push(comment);
    return lines.join('\n').trim();
  }).filter(Boolean);
}

function extractYear(value) {
  const year = String(value || '').match(/\b(?:1[5-9]|20|21)\d{2}\b/)?.[0];
  return year ? Number(year) : null;
}

function extractPmid(fields) {
  return fields.PMID || fields.pmid || String(fields.extra || '').match(/\bPMID\s*[:=]\s*(\d+)\b/i)?.[1] || null;
}

function extractCitationKey(fields) {
  return fields.citationKey || String(fields.extra || '').match(/Citation Key:\s*(\S+)/i)?.[1] || null;
}

async function readLibrary(database, zoteroDir) {
  const collections = getCollections(database);
  const itemCollectionRows = safeAll(database, 'SELECT itemID, collectionID FROM collectionItems');
  const membership = new Map();
  for (const row of itemCollectionRows) {
    const list = membership.get(Number(row.itemID)) || [];
    list.push(Number(row.collectionID));
    membership.set(Number(row.itemID), list);
  }

  const rows = safeAll(database, `
    SELECT i.itemID, i.key, i.dateModified, it.typeName
    FROM items i JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
    WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems)
    ORDER BY i.itemID
  `).filter((row) => !EXCLUDED_TYPES.has(row.typeName));

  const items = rows.map((row) => {
    const itemId = Number(row.itemID);
    const fields = getFields(database, itemId);
    const collectionIds = membership.get(itemId) || [];
    const collectionPaths = collectionIds.map((id) => collectionPath(collections, id)).filter((segments) => segments.length);
    const notes = getNotes(database, itemId);
    const annotations = getAnnotations(database, itemId);
    const pdfPaths = getPdfAttachments(database, zoteroDir, itemId);
    return {
      itemId,
      sourceId: String(row.key || itemId),
      dateModified: row.dateModified ? String(row.dateModified) : null,
      title: String(fields.title || 'Untitled').trim() || 'Untitled',
      authors: getCreators(database, itemId),
      year: extractYear(fields.date),
      abstract: fields.abstractNote || null,
      doi: fields.DOI || null,
      pmid: extractPmid(fields),
      url: fields.url || null,
      journal: fields.publicationTitle || fields.journalAbbreviation || null,
      itemType: row.typeName || 'article',
      keywords: getTags(database, itemId),
      citationKey: extractCitationKey(fields),
      collectionIds,
      collectionPaths,
      notes,
      annotations,
      pdfPaths,
      rawFields: fields,
    };
  });

  const counts = new Map();
  for (const item of items) {
    for (const id of item.collectionIds) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const collectionList = [...collections.values()].map((collection) => ({
    id: collection.id,
    path: collectionPath(collections, collection.id).join('/'),
    itemCount: counts.get(collection.id) || 0,
  })).filter((collection) => collection.path).sort((a, b) => a.path.localeCompare(b.path));

  return { zoteroDir, items, collections: collectionList };
}

export async function readZoteroLocalLibrary(zoteroDirectory) {
  const zoteroDir = resolveZoteroDirectory(zoteroDirectory);
  return withDatabaseCopy(zoteroDir, (database) => readLibrary(database, zoteroDir));
}

export async function scanZoteroLocalLibrary(zoteroDirectory) {
  const library = await readZoteroLocalLibrary(zoteroDirectory);
  return {
    valid: true,
    zoteroDir: library.zoteroDir,
    itemCount: library.items.length,
    withPdfCount: library.items.filter((item) => item.pdfPaths.length > 0).length,
    noteCount: library.items.reduce((sum, item) => sum + item.notes.length, 0),
    annotationCount: library.items.reduce((sum, item) => sum + item.annotations.length, 0),
    collections: library.collections,
    items: library.items.map((item) => ({
      itemId: item.itemId,
      sourceId: item.sourceId,
      title: item.title,
      itemType: item.itemType,
      year: item.year,
      hasPdf: item.pdfPaths.length > 0,
      noteCount: item.notes.length,
      annotationCount: item.annotations.length,
      collections: item.collectionIds,
      collectionPaths: item.collectionPaths.map((segments) => segments.join('/')),
      dateModified: item.dateModified,
    })),
  };
}

export function mapLocalZoteroItem(item, options = {}) {
  const notes = options.migrateNotes === false ? [] : item.notes;
  const annotations = options.migrateAnnotations === false ? [] : item.annotations;
  return {
    sourceId: item.sourceId,
    title: item.title,
    authors: item.authors,
    year: item.year,
    abstract: item.abstract,
    doi: item.doi,
    pmid: item.pmid,
    url: item.url,
    journal: item.journal,
    itemType: item.itemType,
    keywords: item.keywords,
    citationKey: item.citationKey,
    rawData: {
      zoteroLocal: {
        itemId: item.itemId,
        key: item.sourceId,
        dateModified: item.dateModified,
        collectionPaths: item.collectionPaths,
        notes,
        annotations,
      },
      fields: item.rawFields,
    },
  };
}
