import crypto from 'crypto';
import express from 'express';
import { db } from '../database/db.js';

const router = express.Router();
const MAX_HTML_BYTES = 2 * 1024 * 1024;

function userId(req) {
  return Number(req.user?.id);
}

function validateHtml(value) {
  const html = String(value || '').trim();
  if (!html) return { error: 'HTML document is required' };
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) return { error: 'HTML document must not exceed 2 MiB' };
  if (!/(<!doctype\s+html|<html[\s>]|<body[\s>])/i.test(html)) return { error: 'A complete HTML document is required' };
  return { html };
}

function mapMiniApp(row, includeHtml = false) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    ...(includeHtml ? { html: row.html } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getMiniApp(ownerId, id) {
  return db.prepare('SELECT * FROM mini_apps WHERE user_id = ? AND id = ?').get(ownerId, id);
}

router.get('/', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, name, description, icon, created_at, updated_at
      FROM mini_apps WHERE user_id = ? ORDER BY updated_at DESC
    `).all(userId(req));
    res.json({ apps: rows.map((row) => mapMiniApp(row)) });
  } catch (error) {
    console.error('[ERROR] List mini apps:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const app = getMiniApp(userId(req), req.params.id);
    if (!app) return res.status(404).json({ error: 'Mini app not found' });
    res.json({ app: mapMiniApp(app, true) });
  } catch (error) {
    console.error('[ERROR] Get mini app:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/validate', (req, res) => {
  try {
    const result = validateHtml(req.body?.html);
    res.status(result.error ? 400 : 200).json(result.error ? { valid: false, error: result.error } : { valid: true });
  } catch (error) {
    console.error('[ERROR] Validate mini app:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req, res) => {
  try {
    const validation = validateHtml(req.body?.html);
    if (validation.error) return res.status(400).json({ error: validation.error });
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Mini app name is required' });
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO mini_apps (id, user_id, name, description, icon, html)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId(req),
      name,
      String(req.body?.description || '').trim().slice(0, 500),
      String(req.body?.icon || '').trim().slice(0, 16),
      validation.html,
    );
    res.status(201).json({ app: mapMiniApp(getMiniApp(userId(req), id), true) });
  } catch (error) {
    console.error('[ERROR] Create mini app:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const ownerId = userId(req);
    const current = getMiniApp(ownerId, req.params.id);
    if (!current) return res.status(404).json({ error: 'Mini app not found' });
    const name = req.body?.name == null ? current.name : String(req.body.name).trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Mini app name is required' });
    let html = current.html;
    if (req.body?.html != null) {
      const validation = validateHtml(req.body.html);
      if (validation.error) return res.status(400).json({ error: validation.error });
      html = validation.html;
    }
    db.prepare(`
      UPDATE mini_apps SET name = ?, description = ?, icon = ?, html = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND id = ?
    `).run(
      name,
      req.body?.description == null ? current.description : String(req.body.description).trim().slice(0, 500),
      req.body?.icon == null ? current.icon : String(req.body.icon).trim().slice(0, 16),
      html,
      ownerId,
      req.params.id,
    );
    res.json({ app: mapMiniApp(getMiniApp(ownerId, req.params.id), true) });
  } catch (error) {
    console.error('[ERROR] Update mini app:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM mini_apps WHERE user_id = ? AND id = ?').run(userId(req), req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Mini app not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('[ERROR] Delete mini app:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
