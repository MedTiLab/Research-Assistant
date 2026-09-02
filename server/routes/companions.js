import crypto from 'crypto';
import express from 'express';
import { db } from '../database/db.js';

const router = express.Router();
const AVATARS = new Set(['mochi', 'ink', 'roux', 'pixel', 'bolt', 'boo']);
const MOODS = new Set(['calm', 'happy', 'focused', 'sleepy']);

function userId(req) {
  return Number(req.user?.id);
}

function mapCompanion(row) {
  return row ? {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    persona: row.persona,
    desktopEnabled: Boolean(row.desktop_enabled),
    isDefault: Boolean(row.is_default),
    mood: row.mood,
    xp: row.xp,
    level: row.level,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null;
}

function getCompanion(ownerId, companionId) {
  return db.prepare('SELECT * FROM companions WHERE user_id = ? AND id = ?').get(ownerId, companionId);
}

router.get('/', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM companions WHERE user_id = ?
      ORDER BY is_default DESC, created_at ASC
    `).all(userId(req));
    res.json({ companions: rows.map(mapCompanion) });
  } catch (error) {
    console.error('[ERROR] List companions:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req, res) => {
  try {
    const ownerId = userId(req);
    const name = String(req.body?.name || '').trim().slice(0, 48);
    const avatar = String(req.body?.avatar || 'mochi');
    if (!name) return res.status(400).json({ error: 'Companion name is required' });
    if (!AVATARS.has(avatar)) return res.status(400).json({ error: 'Unsupported companion avatar' });

    const id = crypto.randomUUID();
    const hasCompanion = db.prepare('SELECT 1 FROM companions WHERE user_id = ? LIMIT 1').get(ownerId);
    db.prepare(`
      INSERT INTO companions (id, user_id, name, avatar, persona, is_default)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, ownerId, name, avatar, String(req.body?.persona || '').trim().slice(0, 2000), hasCompanion ? 0 : 1);
    res.status(201).json({ companion: mapCompanion(getCompanion(ownerId, id)) });
  } catch (error) {
    console.error('[ERROR] Create companion:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const ownerId = userId(req);
    const current = getCompanion(ownerId, req.params.id);
    if (!current) return res.status(404).json({ error: 'Companion not found' });

    const name = req.body?.name == null ? current.name : String(req.body.name).trim().slice(0, 48);
    const avatar = req.body?.avatar == null ? current.avatar : String(req.body.avatar);
    const mood = req.body?.mood == null ? current.mood : String(req.body.mood);
    if (!name) return res.status(400).json({ error: 'Companion name is required' });
    if (!AVATARS.has(avatar)) return res.status(400).json({ error: 'Unsupported companion avatar' });
    if (!MOODS.has(mood)) return res.status(400).json({ error: 'Unsupported companion mood' });

    db.prepare(`
      UPDATE companions SET
        name = ?, avatar = ?, persona = ?, desktop_enabled = ?, mood = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND id = ?
    `).run(
      name,
      avatar,
      req.body?.persona == null ? current.persona : String(req.body.persona).trim().slice(0, 2000),
      req.body?.desktopEnabled == null ? current.desktop_enabled : (req.body.desktopEnabled ? 1 : 0),
      mood,
      ownerId,
      req.params.id,
    );
    res.json({ companion: mapCompanion(getCompanion(ownerId, req.params.id)) });
  } catch (error) {
    console.error('[ERROR] Update companion:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const ownerId = userId(req);
    const current = getCompanion(ownerId, req.params.id);
    if (!current) return res.status(404).json({ error: 'Companion not found' });
    const remove = db.transaction(() => {
      db.prepare('DELETE FROM companion_memories WHERE user_id = ? AND companion_id = ?').run(ownerId, req.params.id);
      db.prepare('DELETE FROM companions WHERE user_id = ? AND id = ?').run(ownerId, req.params.id);
      if (current.is_default) {
        const next = db.prepare('SELECT id FROM companions WHERE user_id = ? ORDER BY created_at ASC LIMIT 1').get(ownerId);
        if (next) db.prepare('UPDATE companions SET is_default = 1 WHERE user_id = ? AND id = ?').run(ownerId, next.id);
      }
    });
    remove();
    res.json({ success: true });
  } catch (error) {
    console.error('[ERROR] Delete companion:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/memories', (req, res) => {
  try {
    const ownerId = userId(req);
    if (!getCompanion(ownerId, req.params.id)) return res.status(404).json({ error: 'Companion not found' });
    const memories = db.prepare(`
      SELECT id, content, category, pinned, created_at, updated_at
      FROM companion_memories WHERE user_id = ? AND companion_id = ?
      ORDER BY pinned DESC, created_at DESC
    `).all(ownerId, req.params.id).map((row) => ({
      id: row.id,
      content: row.content,
      category: row.category,
      pinned: Boolean(row.pinned),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    res.json({ memories });
  } catch (error) {
    console.error('[ERROR] List companion memories:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/memories', (req, res) => {
  try {
    const ownerId = userId(req);
    if (!getCompanion(ownerId, req.params.id)) return res.status(404).json({ error: 'Companion not found' });
    const content = String(req.body?.content || '').trim().slice(0, 4000);
    if (!content) return res.status(400).json({ error: 'Memory content is required' });
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO companion_memories (id, user_id, companion_id, content, category, pinned)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, ownerId, req.params.id, content, String(req.body?.category || 'note').slice(0, 32), req.body?.pinned ? 1 : 0);
    db.prepare(`
      UPDATE companions SET xp = xp + 5, level = 1 + CAST((xp + 5) / 100 AS INTEGER), updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND id = ?
    `).run(ownerId, req.params.id);
    res.status(201).json({ id });
  } catch (error) {
    console.error('[ERROR] Create companion memory:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id/memories/:memoryId', (req, res) => {
  try {
    const result = db.prepare(`
      DELETE FROM companion_memories WHERE user_id = ? AND companion_id = ? AND id = ?
    `).run(userId(req), req.params.id, req.params.memoryId);
    if (!result.changes) return res.status(404).json({ error: 'Memory not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('[ERROR] Delete companion memory:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
