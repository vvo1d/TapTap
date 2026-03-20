/**
 * server/routes/auth.js — маршруты регистрации и входа.
 *
 * POST /api/auth/register  { username, password }
 * POST /api/auth/login     { username, password }
 *
 * Оба возвращают { token, user: { id, username } }
 */

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../db');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'taptap_dev_secret_REPLACE_IN_PRODUCTION';
const SALT_ROUNDS = 10;
const TOKEN_TTL   = '30d';

/** Создаёт подписанный JWT. */
function makeToken(userId, username) {
  return jwt.sign({ userId, username }, SECRET, { expiresIn: TOKEN_TTL });
}

// ── Регистрация ─────────────────────────────────────────────────────────

router.post('/register', (req, res) => {
  const { username, password } = req.body ?? {};

  // Валидация входных данных
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Укажите имя пользователя' });
  }
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Укажите пароль' });
  }

  const trimmedName = username.trim();
  if (trimmedName.length < 3 || trimmedName.length > 20) {
    return res.status(400).json({ error: 'Имя: от 3 до 20 символов' });
  }
  if (!/^[a-zA-Zа-яА-ЯёЁ0-9_-]+$/.test(trimmedName)) {
    return res.status(400).json({ error: 'Имя: только буквы, цифры, _ и -' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль: минимум 6 символов' });
  }

  try {
    const hash   = bcrypt.hashSync(password, SALT_ROUNDS);
    const result = db.stmt.insertUser.run(trimmedName, hash);
    const userId = result.lastInsertRowid;

    // Создаём пустое игровое состояние
    db.stmt.insertState.run(userId, Date.now());

    const token = makeToken(userId, trimmedName);
    res.status(201).json({ token, user: { id: userId, username: trimmedName } });

  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Это имя уже занято' });
    }
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── Вход ────────────────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Укажите имя и пароль' });
  }

  try {
    const user = db.stmt.findUser.get(username.trim());
    if (!user) {
      return res.status(401).json({ error: 'Неверное имя или пароль' });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Неверное имя или пароль' });
    }

    const token = makeToken(user.id, user.username);
    res.json({ token, user: { id: user.id, username: user.username } });

  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
