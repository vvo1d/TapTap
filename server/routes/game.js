/**
 * server/routes/game.js — игровое состояние.
 *
 * GET  /api/game/state      — загрузить состояние + оффлайн-доход + дневной бонус
 * POST /api/game/save       — сохранить состояние
 * GET  /api/game/businesses — список бизнесов (публичный)
 */

const express     = require('express');
const requireAuth = require('../middleware/auth');
const db          = require('../db');
const { BUSINESSES, calcOfflineIncome, calcExpectedTotalSpent, calcTapPower } = require('../businesses');

const router = express.Router();

// ── Список бизнесов (публичный) ──────────────────────────────────────────

router.get('/businesses', (_req, res) => {
  res.json({ businesses: BUSINESSES });
});

// ── Таблица лидеров (публичная) ───────────────────────────────────────────

router.get('/leaderboard', (req, res) => {
  try {
    const rows = db.stmt.leaderboard.all();

    const players = rows.map((row, index) => {
      let levels;
      try { levels = JSON.parse(row.upgrade_levels); } catch { levels = []; }
      const businessCount = levels.reduce((sum, lvl) => sum + (lvl > 0 ? 1 : 0), 0);

      return {
        rank:          index + 1,
        username:      row.username,
        totalEarned:   row.total_earned,
        totalTaps:     row.total_taps,
        totalSpent:    row.total_spent,
        loginStreak:   row.login_streak,
        businessCount,
      };
    });

    res.json({ players });
  } catch (err) {
    console.error('[game/leaderboard]', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── Загрузка состояния ───────────────────────────────────────────────────

router.get('/state', requireAuth, (req, res) => {
  try {
    let row = db.stmt.findState.get(req.userId);

    if (!row) {
      db.stmt.insertState.run(req.userId, Date.now());
      row = db.stmt.findState.get(req.userId);
    }

    // Парсим уровни апгрейдов
    let levels;
    try { levels = JSON.parse(row.upgrade_levels); } catch { levels = []; }
    while (levels.length < BUSINESSES.length) levels.push(0);

    // Парсим сохранённые таймеры выплат
    let nextPayouts;
    try { nextPayouts = JSON.parse(row.upgrade_next_payouts); } catch { nextPayouts = []; }
    while (nextPayouts.length < BUSINESSES.length) nextPayouts.push(0);

    // ── Оффлайн-доход (только passive-бизнесы) ──
    const { earned: offlineEarned, elapsedSeconds, newNextPayouts } =
      calcOfflineIncome(levels, nextPayouts, row.last_save_time);

    let coins         = row.coins;
    let totalEarned   = row.total_earned;
    let offlineRecord = row.offline_record;

    // ── Ежедневный бонус ──
    const todayStr  = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const lastDate  = row.last_login_date || '';
    let   streak    = row.login_streak    || 0;
    let   dailyBonus = 0;
    let   newStreak  = streak;

    if (lastDate !== todayStr) {
      const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      newStreak  = (lastDate === yesterday) ? streak + 1 : 1;
      dailyBonus = 500 * Math.min(newStreak, 30);
    }

    // ── Применяем и сохраняем если что-то изменилось ──
    // newNextPayouts всегда записываем — таймеры могли измениться даже без дохода
    coins       += offlineEarned + dailyBonus;
    totalEarned += offlineEarned + dailyBonus;
    if (offlineEarned > offlineRecord) offlineRecord = offlineEarned;

    db.stmt.upsertState.run({
      userId:        req.userId,
      coins,
      totalEarned,
      totalTaps:     row.total_taps,
      totalSpent:    row.total_spent,
      offlineRecord,
      soundEnabled:  row.sound_enabled,
      upgradeLevels: JSON.stringify(levels),
      lastSaveTime:  Date.now(),
      lastLoginDate: todayStr,
      loginStreak:   newStreak,
      nextPayouts:   JSON.stringify(newNextPayouts),
    });

    res.json({
      state: {
        coins,
        totalEarned,
        totalTaps:     row.total_taps,
        totalSpent:    row.total_spent,
        offlineRecord,
        soundEnabled:  row.sound_enabled === 1,
        loginStreak:   newStreak,
        upgradeLevels: levels,
        nextPayouts:   newNextPayouts,
      },
      businesses: BUSINESSES,
      offline: {
        earned:        offlineEarned,
        elapsedSeconds,
      },
      dailyBonus: {
        earned:  dailyBonus,
        streak:  newStreak,
        isNew:   lastDate !== todayStr,
      },
    });

  } catch (err) {
    console.error('[game/state GET]', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── Сохранение состояния ─────────────────────────────────────────────────

const MAX_LEVEL      = 1000; // жёсткий потолок уровня бизнеса
const MAX_TAPS_PER_S = 20;   // физически достижимый максимум тапов/сек

router.post('/save', requireAuth, (req, res) => {
  try {
    const {
      coins, totalEarned, totalTaps, totalSpent,
      offlineRecord, soundEnabled, upgradeLevels, nextPayouts,
    } = req.body ?? {};

    // ── Базовая проверка типов ──────────────────────────────────────────
    if (typeof coins !== 'number' || coins < 0 || !Number.isFinite(coins)) {
      return res.status(400).json({ error: 'Некорректное значение coins' });
    }
    if (!Array.isArray(upgradeLevels)) {
      return res.status(400).json({ error: 'upgradeLevels должен быть массивом' });
    }

    // ── Нормализация уровней (только числа >= 0, не выше MAX_LEVEL) ────
    const levels = BUSINESSES.map((_, i) => {
      const v = upgradeLevels[i];
      return (typeof v === 'number' && v >= 0) ? Math.min(Math.floor(v), MAX_LEVEL) : 0;
    });

    // ── Загружаем текущее состояние из БД ──────────────────────────────
    const currentRow = db.stmt.findState.get(req.userId);

    let prevLevels = [];
    try { prevLevels = JSON.parse(currentRow?.upgrade_levels || '[]'); } catch {}
    while (prevLevels.length < BUSINESSES.length) prevLevels.push(0);

    // ── Уровни могут только расти ──────────────────────────────────────
    for (let i = 0; i < BUSINESSES.length; i++) {
      if (levels[i] < prevLevels[i]) levels[i] = prevLevels[i];
    }

    // ── Проверка totalSpent относительно реальной стоимости покупок ────
    // Если totalSpent меньше суммарной стоимости купленных уровней — обман
    const expectedSpent = calcExpectedTotalSpent(levels);
    const safeTotalSpent = Math.max(Math.floor(totalSpent || 0), expectedSpent);

    // ── Проверка согласованности: earned >= coins + spent ──────────────
    const safeTotalEarned = Math.max(Math.floor(totalEarned || 0), Math.floor(coins) + safeTotalSpent);

    // ── Проверка скорости накопления монет ─────────────────────────────
    // Считаем максимально возможный заработок с момента последнего сохранения
    const prevTotalEarned  = currentRow?.total_earned ?? 0;
    const lastSaveTime     = currentRow?.last_save_time ?? Date.now();
    const elapsedSec       = Math.max((Date.now() - lastSaveTime) / 1000, 0);

    const prevTapPower     = calcTapPower(prevLevels);
    const maxFromTaps      = prevTapPower * MAX_TAPS_PER_S * elapsedSec;

    // Максимальный пассивный доход за прошедшее время
    const maxPassive = BUSINESSES.reduce((sum, biz, i) => {
      if (biz.type !== 'passive') return sum;
      const lvl = prevLevels[i] || 0;
      if (!lvl) return sum;
      const payouts = Math.ceil(elapsedSec / biz.interval);
      return sum + payouts * biz.baseIncome * lvl;
    }, 0);

    const maxPossibleDelta = maxFromTaps + maxPassive + 50_000; // +50K буфер (бонусы, погрешность)
    const earnedDelta      = safeTotalEarned - prevTotalEarned;

    if (earnedDelta > maxPossibleDelta * 2) {
      console.warn(`[CHEAT DETECTED] userId=${req.userId} earnedDelta=${earnedDelta} maxPossible=${maxPossibleDelta} elapsed=${elapsedSec}s`);
      return res.status(400).json({ error: 'Недопустимое значение монет' });
    }

    // ── Нормализация таймеров ──────────────────────────────────────────
    const normalizedNextPayouts = BUSINESSES.map((_, i) => {
      const v = Array.isArray(nextPayouts) ? nextPayouts[i] : 0;
      return (typeof v === 'number' && v > 0) ? Math.floor(v) : 0;
    });

    const todayStr    = new Date().toISOString().slice(0, 10);
    const prevRecord  = currentRow?.offline_record ?? 0;
    const finalRecord = Math.max(prevRecord, offlineRecord || 0);

    db.stmt.upsertState.run({
      userId:        req.userId,
      coins:         Math.floor(coins),
      totalEarned:   safeTotalEarned,
      totalTaps:     Math.floor(totalTaps    || 0),
      totalSpent:    safeTotalSpent,
      offlineRecord: Math.floor(finalRecord),
      soundEnabled:  soundEnabled ? 1 : 0,
      upgradeLevels: JSON.stringify(levels),
      lastSaveTime:  Date.now(),
      lastLoginDate: currentRow?.last_login_date || todayStr,
      loginStreak:   currentRow?.login_streak    || 1,
      nextPayouts:   JSON.stringify(normalizedNextPayouts),
    });

    res.json({ ok: true, savedAt: Date.now() });

  } catch (err) {
    console.error('[game/save]', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
