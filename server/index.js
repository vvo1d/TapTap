/**
 * server/index.js — точка входа Express-сервера.
 *
 * Запуск:
 *   node server/index.js          (production)
 *   nodemon server/index.js       (dev)
 *   npm run dev                   (через package.json)
 *
 * Сервер одновременно:
 *   - отдаёт статику (index.html + css/js/assets) из корня проекта
 *   - обрабатывает API-запросы на /api/*
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const cors    = require('cors');
const path    = require('path');

// Инициализируем БД при старте (синхронно — better-sqlite3)
require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Мидлвари ──────────────────────────────────────────────────────────────

app.use(cors());   // в проде ограничь до нужного origin
app.use(express.json({ limit: '100kb' }));
app.use(express.text({ limit: '100kb' })); // для navigator.sendBeacon

// ── Статика (фронтенд) ────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '..')));

// ── API-маршруты ──────────────────────────────────────────────────────────

app.use('/api/auth', require('./routes/auth'));
app.use('/api/game', require('./routes/game'));

// ── SPA fallback (для любых неизвестных GET-запросов отдаём index.html) ───

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Маршрут не найден' });
  }
  res.sendFile(path.join(__dirname, '../index.html'));
});

// ── Глобальный обработчик ошибок ──────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// ── Запуск ────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 ТапТапМиллионер запущен!`);
  console.log(`   http://localhost:${PORT}\n`);
});
