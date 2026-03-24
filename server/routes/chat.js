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

const stmts = {
  recent: db.prepare(`
    SELECT id, username, message, created_at
    FROM chat_messages
    ORDER BY created_at DESC
    LIMIT 50
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
    const since = parseInt(req.query.since, 10);
    let rows;

    if (since && Number.isFinite(since)) {
      rows = stmts.since.all(since);
    } else {
      rows = stmts.recent.all().reverse();
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
