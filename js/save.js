/**
 * js/save.js — утилиты форматирования и гостевое сохранение (localStorage).
 *
 * Для авторизованных игроков вся логика сохранения в game.js через API.
 * Этот файл используется только для гостевого режима + хранит formatNumber/formatTime.
 *
 * Загружается ВТОРЫМ (после api.js).
 */

// ─── Утилиты ──────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Форматирование чисел ─────────────────────────────────────────────────

function formatNumber(n) {
  if (!Number.isFinite(n) || n === undefined) return '0';
  if (n >= 1e15) return (n / 1e15).toFixed(2) + 'Qd';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2)  + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2)  + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(1)  + 'K';
  return Math.floor(n).toLocaleString('ru-RU');
}

/**
 * Форматирует секунды в «1ч 23мин» / «45мин 12сек» / «8сек».
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)   return `${h}ч ${m}мин`;
  if (m > 0)   return `${m}мин ${sec}сек`;
  return `${sec}сек`;
}

/**
 * Форматирует интервал бизнеса для отображения в карточке.
 * @param {number} seconds
 * @returns {string}  «15 сек» / «30 сек» / «1 мин» / «5 мин» / «10 мин»
 */
function formatInterval(seconds) {
  if (seconds < 60)  return `${seconds} сек`;
  return `${seconds / 60} мин`;
}

// ─── Гостевое сохранение (localStorage) ──────────────────────────────────

const Save = {
  KEY: 'taptap_guest_v2',

  /**
   * Сохраняет состояние гостя.
   * @param {Object} state
   */
  saveGuest(state) {
    try {
      const payload = {
        coins:            Math.floor(state.coins),
        totalEarned:      Math.floor(state.totalEarned),
        totalTaps:        state.totalTaps,
        totalSpent:       Math.floor(state.totalSpent),
        offlineRecord:    Math.floor(state.offlineRecord),
        soundEnabled:     state.soundEnabled,
        upgradeLevels:    state.upgrades.map(u => u.level),
        upgradeNextPayouts: state.upgrades.map(u => u.nextPayoutAt || 0),
        lastSaveTime:     Date.now(),
      };
      localStorage.setItem(this.KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('[Save] localStorage не доступен:', e);
    }
  },

  /**
   * Загружает состояние гостя из localStorage.
   * @returns {Object|null}
   */
  loadGuest() {
    try {
      const raw = localStorage.getItem(this.KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  /**
   * Рассчитывает оффлайн-доход для гостя (клиентская сторона).
   * Логика идентична серверной: считаем полные циклы, а не непрерывный поток.
   *
   * @param {Object[]} upgrades    — массив апгрейдов из Game.state
   * @param {number}   lastSaveTime — Date.now() последнего сохранения
   * @returns {{ earned: number, elapsedSeconds: number }}
   */
  calcGuestOffline(upgrades, lastSaveTime) {
    const nowMs          = Date.now();
    const elapsedSeconds = Math.floor(Math.min((nowMs - lastSaveTime) / 1000, 8 * 3600));
    let earned           = 0;

    upgrades.forEach(u => {
      if (u.type !== 'passive' || u.level === 0) return;
      const savedNext = u.nextPayoutAt || 0;
      if (!savedNext || savedNext > nowMs) return;

      const intervalMs = u.interval * 1000;
      const maxBatches = Math.ceil(8 * 3600 / u.interval);
      const batches    = Math.min(
        Math.floor((nowMs - savedNext) / intervalMs) + 1,
        maxBatches,
      );
      earned += batches * u.baseIncome * u.level;
      u.nextPayoutAt = nowMs + intervalMs; // сбрасываем таймер
    });

    return { earned: Math.floor(earned), elapsedSeconds };
  },

  clear() {
    localStorage.removeItem(this.KEY);
  },
};
