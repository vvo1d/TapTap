/**
 * server/routes/chat.js — публичный чат игроков.
 *
 * GET  /api/chat/messages?since=TS  — последние 50 сообщений (или после timestamp)
 * POST /api/chat/message            — отправить сообщение (требует авторизации)
 */

const express     = require('express');
const requireAuth = require('../middleware/auth');
const db          = require('../db');

const router = express.Router();

const MAX_MSG_LEN  = 200;
const KEEP_MESSAGES = 500; // максимум хранить в БД

const PAGE_SIZE = 40;

const stmts = {
  recent: db.prepare(`
    SELECT id, username, message, created_at
    FROM chat_messages
    ORDER BY created_at DESC
    LIMIT ?
  `),
  before: db.prepare(`
    SELECT id, username, message, created_at
    FROM chat_messages
    WHERE id < ?
    ORDER BY created_at DESC
    LIMIT ?
  `),
  since: db.prepare(`
    SELECT id, username, message, created_at
    FROM chat_messages
    WHERE created_at > ?
    ORDER BY created_at ASC
    LIMIT 100
  `),
  insert: db.prepare(`
    INSERT INTO chat_messages (user_id, username, message) VALUES (?, ?, ?)
  `),
  trim: db.prepare(`
    DELETE FROM chat_messages
    WHERE id NOT IN (
      SELECT id FROM chat_messages ORDER BY created_at DESC LIMIT ?
    )
  `),
  count: db.prepare(`SELECT COUNT(*) as cnt FROM chat_messages`),
};

// ── Получить сообщения ────────────────────────────────────────────────────

router.get('/messages', (req, res) => {
  try {
    const since  = parseInt(req.query.since, 10);
    const before = parseInt(req.query.before, 10);
    const limit  = Math.min(parseInt(req.query.limit, 10) || PAGE_SIZE, 100);
    let rows;

    if (since && Number.isFinite(since)) {
      // Polling — новые сообщения после timestamp
      rows = stmts.since.all(since);
    } else if (before && Number.isFinite(before)) {
      // Пагинация — старые сообщения до ID
      rows = stmts.before.all(before, limit).reverse();
    } else {
      // Первая загрузка — последние N сообщений
      rows = stmts.recent.all(limit).reverse();
    }

    res.json({ messages: rows });
  } catch (err) {
    console.error('[chat/messages]', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── Отправить сообщение ───────────────────────────────────────────────────

router.post('/message', requireAuth, (req, res) => {
  try {
    let { message } = req.body ?? {};

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Пустое сообщение' });
    }

    message = message.trim().slice(0, MAX_MSG_LEN);

    stmts.insert.run(req.userId, req.username, message);

    // Чистим старые сообщения если накопилось много
    const { cnt } = stmts.count.get();
    if (cnt > KEEP_MESSAGES) {
      stmts.trim.run(KEEP_MESSAGES);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[chat/message]', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
