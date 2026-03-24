/**
 * server/db.js — инициализация SQLite и миграция схемы.
 * Экспортирует singleton-объект `db` (better-sqlite3).
 *
 * Таблицы:
 *   users       — аккаунты игроков
 *   game_states — состояние игры (1 строка на пользователя)
 */

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

// Папка для файла БД
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'game.db'));

// WAL — лучше для параллельных чтений + меньше блокировок
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Схема ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
  );

  CREATE TABLE IF NOT EXISTS game_states (
    user_id        INTEGER PRIMARY KEY,
    coins          REAL    NOT NULL DEFAULT 0,
    total_earned   REAL    NOT NULL DEFAULT 0,
    total_taps     INTEGER NOT NULL DEFAULT 0,
    total_spent    REAL    NOT NULL DEFAULT 0,
    offline_record REAL    NOT NULL DEFAULT 0,
    sound_enabled  INTEGER NOT NULL DEFAULT 1,
    -- JSON-массив целых чисел, индекс = индекс в BUSINESSES
    upgrade_levels TEXT    NOT NULL DEFAULT '[]',
    -- Момент последнего сохранения в мс (для расчёта оффлайн-дохода)
    last_save_time  INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    -- Стрик ежедневных входов
    last_login_date TEXT    NOT NULL DEFAULT '',
    login_streak    INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Таблица чата
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    username   TEXT    NOT NULL,
    message    TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
`);

// Миграция для существующих БД (игнорирует ошибку, если столбец уже есть)
try { db.exec(`ALTER TABLE game_states ADD COLUMN last_login_date TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE game_states ADD COLUMN login_streak INTEGER NOT NULL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE game_states ADD COLUMN upgrade_next_payouts TEXT NOT NULL DEFAULT '[]'`); } catch {}

// ── Подготовленные запросы (переиспользуются в routes) ────────────────────

db.stmt = {
  findUser:   db.prepare('SELECT * FROM users WHERE username = ?'),
  insertUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),

  findState:  db.prepare('SELECT * FROM game_states WHERE user_id = ?'),

  insertState: db.prepare(`
    INSERT INTO game_states (user_id, last_save_time)
    VALUES (?, ?)
  `),

  upsertState: db.prepare(`
    INSERT INTO game_states
      (user_id, coins, total_earned, total_taps, total_spent,
       offline_record, sound_enabled, upgrade_levels, last_save_time,
       last_login_date, login_streak, upgrade_next_payouts)
    VALUES
      (@userId, @coins, @totalEarned, @totalTaps, @totalSpent,
       @offlineRecord, @soundEnabled, @upgradeLevels, @lastSaveTime,
       @lastLoginDate, @loginStreak, @nextPayouts)
    ON CONFLICT(user_id) DO UPDATE SET
      coins                = excluded.coins,
      total_earned         = excluded.total_earned,
      total_taps           = excluded.total_taps,
      total_spent          = excluded.total_spent,
      offline_record       = excluded.offline_record,
      sound_enabled        = excluded.sound_enabled,
      upgrade_levels       = excluded.upgrade_levels,
      last_save_time       = excluded.last_save_time,
      last_login_date      = excluded.last_login_date,
      login_streak         = excluded.login_streak,
      upgrade_next_payouts = excluded.upgrade_next_payouts
  `),

  resetState: db.prepare(`
    UPDATE game_states
    SET coins = 0, total_earned = 0, total_taps = 0, total_spent = 0,
        offline_record = 0, sound_enabled = 1,
        upgrade_levels = '[]', last_save_time = ?
    WHERE user_id = ?
  `),

  leaderboard: db.prepare(`
    SELECT
      u.username,
      g.total_earned,
      g.total_taps,
      g.total_spent,
      g.login_streak,
      g.upgrade_levels
    FROM game_states g
    JOIN users u ON u.id = g.user_id
    WHERE g.total_earned > 0
    ORDER BY g.total_earned DESC
    LIMIT 50
  `),
};

module.exports = db;
