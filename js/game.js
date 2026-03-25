/**
 * js/game.js — главный контроллер игры.
 *
 * Два вида бизнесов:
 *   tap     — увеличивают награду за каждый тап (нет пассивного таймера)
 *   passive — медленный пассивный доход (интервалы 1ч/2ч/4ч/8ч)
 *
 * Тапать всегда выгодно: tap-бизнесы дают мгновенный рост дохода.
 * Passive-бизнесы поощряют возвращаться в игру несколько раз в день.
 */

const Game = {

  // ── Состояние ────────────────────────────────────────────────────────────

  state: {
    coins:         0,
    totalEarned:   0,
    totalTaps:     0,
    totalSpent:    0,
    offlineRecord: 0,
    soundEnabled:  true,
    loginStreak:   0,
    tapPower:      1,       // пересчитывается через Upgrades.getTapPower()
    upgrades: BUSINESSES_DATA.map(b => ({
      ...b,
      level:        0,
      nextPayoutAt: null,
    })),
  },

  _timerInterval: null,
  _saveInterval:  null,
  _isGuest:       false,

  // ── Точка входа ──────────────────────────────────────────────────────────

  async init() {
    Upgrades.setStateRef(this.state);

    if (API.isLoggedIn()) {
      await this._startOnline();
    } else {
      Auth.onSuccess(async () => { await this._startOnline(); });
      Auth.onGuest(() => { this._startGuest(); });
      Auth.show();
    }

    window.addEventListener('taptap:sessionexpired', () => {
      this._stopTimers();
      showToast('Сессия истекла — войдите снова', 4000);
      Auth.onSuccess(async () => { await this._startOnline(); });
      Auth.show();
    });
  },

  // ── Старт для авторизованного пользователя ───────────────────────────────

  async _startOnline() {
    this._isGuest = false;
    let serverData;

    try {
      serverData = await API.getState();
    } catch (err) {
      console.warn('[Game] Сервер недоступен, режим гостя:', err.message);
      showToast('Сервер недоступен — режим гостя');
      return this._startGuest();
    }

    const { state, businesses, offline, dailyBonus } = serverData;

    Upgrades.setBusinessData(businesses);

    this.state.coins         = state.coins;
    this.state.totalEarned   = state.totalEarned;
    this.state.totalTaps     = state.totalTaps;
    this.state.totalSpent    = state.totalSpent;
    this.state.offlineRecord = state.offlineRecord;
    this.state.soundEnabled  = state.soundEnabled;
    this.state.loginStreak   = state.loginStreak || 0;

    (state.upgradeLevels || []).forEach((level, i) => {
      if (this.state.upgrades[i]) this.state.upgrades[i].level = level;
    });

    // Восстанавливаем таймеры из сервера (не сбрасываем на нуль)
    const now = Date.now();
    (state.nextPayouts || []).forEach((ts, i) => {
      const u = this.state.upgrades[i];
      if (!u || u.type !== 'passive' || u.level === 0) return;
      // ts=0 или прошедший — сервер уже начислил оффлайн, запускаем заново
      u.nextPayoutAt = (ts && ts > now) ? ts : now + u.interval * 1000;
    });

    if (offline?.earned > 0) {
      this._showOfflineModal(offline.earned, offline.elapsedSeconds);
    }

    if (dailyBonus?.isNew && dailyBonus?.earned > 0) {
      this._showDailyModal(dailyBonus.earned, dailyBonus.streak);
    }

    this._updateUserHeader(serverData.user?.username || '—');
    this._launch();
  },

  // ── Старт для гостя ──────────────────────────────────────────────────────

  _startGuest() {
    this._isGuest = true;
    const saved = Save.loadGuest();

    if (saved) {
      this.state.coins         = saved.coins         || 0;
      this.state.totalEarned   = saved.totalEarned   || 0;
      this.state.totalTaps     = saved.totalTaps      || 0;
      this.state.totalSpent    = saved.totalSpent    || 0;
      this.state.offlineRecord = saved.offlineRecord || 0;
      if (typeof saved.soundEnabled === 'boolean') {
        this.state.soundEnabled = saved.soundEnabled;
      }
      (saved.upgradeLevels || []).forEach((level, i) => {
        if (this.state.upgrades[i]) this.state.upgrades[i].level = level;
      });

      // Восстанавливаем таймеры
      const nowGuest = Date.now();
      (saved.upgradeNextPayouts || []).forEach((ts, i) => {
        const u = this.state.upgrades[i];
        if (!u || u.type !== 'passive' || u.level === 0) return;
        u.nextPayoutAt = (ts && ts > nowGuest) ? ts : (u.level > 0 ? nowGuest + u.interval * 1000 : null);
      });

      if (saved.lastSaveTime) {
        const { earned, elapsedSeconds } =
          Save.calcGuestOffline(this.state.upgrades, saved.lastSaveTime);
        if (earned > 0 && elapsedSeconds > 120) {
          this.state.coins       += earned;
          this.state.totalEarned += earned;
          if (earned > this.state.offlineRecord) this.state.offlineRecord = earned;
          this._showOfflineModal(earned, elapsedSeconds);
        }
      }
    }

    this._updateUserHeader(null);
    this._launch();
  },

  // ── Общий запуск ─────────────────────────────────────────────────────────

  _launch() {
    Sound.enabled = this.state.soundEnabled;
    Confetti.init();
    TapHandler.init('tap-canvas', () => this._onTap());
    this._setupUI();
    this._recalcTapPower();
    Upgrades.render();
    this._updateHeader();
    this._startTimers();
  },

  // ── Таймеры ───────────────────────────────────────────────────────────────

  _startTimers() {
    // Обновление прогресс-баров и таймеров (250ms)
    this._timerInterval = setInterval(() => Upgrades.updateTimers(), 250);

    // Автосохранение каждые 30 сек
    this._saveInterval = setInterval(() => this._saveGame(), 30_000);

    window.addEventListener('beforeunload', () => {
      Save.saveGuest(this.state); // синхронный резерв всегда
      if (!this._isGuest) API.saveStateBeacon(this._buildSavePayload());
    });
  },

  _stopTimers() {
    if (this._timerInterval) clearInterval(this._timerInterval);
    if (this._saveInterval)  clearInterval(this._saveInterval);
  },

  // ── Ручной сбор пассивного дохода ────────────────────────────────────────

  _collectPayout(upgradeId) {
    const u = this.state.upgrades.find(u => u.id === upgradeId);
    if (!u || u.type !== 'passive' || u.level === 0) return;
    if (!u.nextPayoutAt || Date.now() < u.nextPayoutAt) return;

    const earned = u.baseIncome * u.level;
    this.state.coins       += earned;
    this.state.totalEarned += earned;
    u.nextPayoutAt = Date.now() + u.interval * 1000;

    Upgrades.flashCard(u.id, earned);
    Sound.playPurchase();
    this._updateHeader();
    Upgrades.render();
    // Сразу сохраняем новый nextPayoutAt
    this._saveGame();
  },

  // ── Тап ───────────────────────────────────────────────────────────────────

  _onTap() {
    const power = this.state.tapPower;
    this.state.coins       += power;
    this.state.totalEarned += power;
    this.state.totalTaps   += 1;

    this._updateHeader();
    Upgrades.render();
  },

  // ── Сила тапа ────────────────────────────────────────────────────────────

  _recalcTapPower() {
    this.state.tapPower = Upgrades.getTapPower();
  },

  // ── Шапка ────────────────────────────────────────────────────────────────

  _updateHeader() {
    this._recalcTapPower();
    document.getElementById('coin-count').textContent  = formatNumber(this.state.coins);
    document.getElementById('tap-power').textContent   = formatNumber(this.state.tapPower);
    document.getElementById('income-rate').textContent = formatNumber(
      Upgrades.getPassiveIncomePerHour()
    );
  },

  _updateUserHeader(username) {
    const infoEl   = document.getElementById('user-info');
    const logoutEl = document.getElementById('logout-btn');
    if (!infoEl || !logoutEl) return;

    infoEl.textContent = username ? `👤 ${username}` : '👤 Гость';
    infoEl.classList.remove('hidden');
    logoutEl.classList.toggle('hidden', !username || this._isGuest);
  },

  // ── UI ────────────────────────────────────────────────────────────────────

  _setupUI() {
    // Кнопки панели бизнесов — покупка и сбор дохода
    document.getElementById('upgrades-list').addEventListener('click', e => {
      // Сбор пассивного дохода
      const collectBtn = e.target.closest('.collect-btn');
      if (collectBtn) {
        const item = collectBtn.closest('.upgrade-item');
        if (item) this._collectPayout(item.dataset.upgradeId);
        return;
      }

      // Покупка улучшения
      const btn = e.target.closest('.buy-btn');
      if (!btn || btn.disabled) return;
      const item = btn.closest('.upgrade-item');
      if (!item) return;

      const id = item.dataset.upgradeId;
      if (Upgrades.purchase(id)) {
        Sound.playPurchase();
        Confetti.burst();
        this._recalcTapPower();
        Upgrades.render();
        this._updateHeader();
        this._saveGame(); // сохраняем новый nextPayoutAt сразу

        item.classList.remove('just-bought');
        void item.offsetWidth;
        item.classList.add('just-bought');
        setTimeout(() => item.classList.remove('just-bought'), 600);
      }
    });

    // Таблица лидеров
    document.getElementById('leaderboard-btn').addEventListener('click', () => this._showLeaderboard());
    document.getElementById('close-leaderboard').addEventListener('click', () =>
      document.getElementById('leaderboard-modal').classList.add('hidden')
    );

    // Статистика
    document.getElementById('stats-btn').addEventListener('click', () => this._showStats());
    document.getElementById('close-stats').addEventListener('click', () =>
      document.getElementById('stats-modal').classList.add('hidden')
    );

    // Оффлайн-модаль
    document.getElementById('close-offline').addEventListener('click', () =>
      document.getElementById('offline-modal').classList.add('hidden')
    );

    // Дневной бонус
    document.getElementById('close-daily')?.addEventListener('click', () =>
      document.getElementById('daily-modal').classList.add('hidden')
    );

    // Звук
    const soundBtn = document.getElementById('sound-btn');
    this._syncSoundBtn(soundBtn);
    soundBtn.addEventListener('click', () => {
      this.state.soundEnabled = Sound.toggle();
      this._syncSoundBtn(soundBtn);
    });

    // Выход из аккаунта
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      if (confirm('Выйти из аккаунта?')) {
        this._stopTimers();
        // Сохраняем nextPayouts ДО удаления токена
        API.saveStateBeacon(this._buildSavePayload());
        API.logout();
        location.reload();
      }
    });

    // Закрытие модалок по клику на фон
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    });
  },

  _syncSoundBtn(btn) {
    if (!btn) return;
    btn.textContent = this.state.soundEnabled ? '🔊' : '🔇';
    btn.title       = this.state.soundEnabled ? 'Выключить звук' : 'Включить звук';
  },

  // ── Статистика ────────────────────────────────────────────────────────────

  _showStats() {
    const activeTap = this.state.upgrades
      .filter(u => u.type === 'tap' && u.level > 0)
      .map(u => `<li>${u.icon} ${u.name} — ур. <strong>${u.level}</strong>, +${formatNumber(u.tapBonus * u.level)}/тап</li>`)
      .join('') || '<li>Нет улучшений тапа</li>';

    const activePassive = this.state.upgrades
      .filter(u => u.type === 'passive' && u.level > 0)
      .map(u => `<li>${u.icon} ${u.name} — ур. <strong>${u.level}</strong>, ${formatNumber(u.baseIncome * u.level)} / ${formatInterval(u.interval)}</li>`)
      .join('') || '<li>Нет пассивных бизнесов</li>';

    document.getElementById('stats-content').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">👆</div>
          <div class="stat-label">Тапов</div>
          <div class="stat-value">${formatNumber(this.state.totalTaps)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">⚡</div>
          <div class="stat-label">Сила тапа</div>
          <div class="stat-value">+${formatNumber(this.state.tapPower)}/тап</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">💰</div>
          <div class="stat-label">Всего заработано</div>
          <div class="stat-value">${formatNumber(this.state.totalEarned)} 🪙</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🏢</div>
          <div class="stat-label">Пассивный доход</div>
          <div class="stat-value">${formatNumber(Upgrades.getPassiveIncomePerHour())} 🪙/ч</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🔥</div>
          <div class="stat-label">Дней подряд</div>
          <div class="stat-value">${this.state.loginStreak}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">😴</div>
          <div class="stat-label">Рекорд оффлайн</div>
          <div class="stat-value">${formatNumber(this.state.offlineRecord)} 🪙</div>
        </div>
      </div>
      <h3 class="businesses-title">👆 Улучшения тапа</h3>
      <ul class="businesses-list">${activeTap}</ul>
      <h3 class="businesses-title" style="margin-top:14px">🏢 Пассивный доход</h3>
      <ul class="businesses-list">${activePassive}</ul>
    `;

    document.getElementById('stats-modal').classList.remove('hidden');
  },

  // ── Модалки ───────────────────────────────────────────────────────────────

  async _showLeaderboard() {
    const modal = document.getElementById('leaderboard-modal');
    const body  = document.getElementById('lb-body');

    body.innerHTML = '<div class="lb-loading">Загрузка…</div>';
    modal.classList.remove('hidden');

    let players;
    try {
      ({ players } = await API.getLeaderboard());
    } catch {
      body.innerHTML = '<div class="lb-loading lb-error">Не удалось загрузить данные</div>';
      return;
    }

    if (!players.length) {
      body.innerHTML = '<div class="lb-loading">Ещё никто не набрал монет 🙁</div>';
      return;
    }

    const myName = document.getElementById('user-info')?.textContent?.replace('👤 ', '') ?? '';

    const rows = players.map(p => {
      const isMe = !this._isGuest && p.username === myName;
      return `
        <tr class="${isMe ? 'lb-me' : ''}">
          <td class="lb-rank">${p.rank <= 3 ? ['🥇','🥈','🥉'][p.rank - 1] : p.rank}</td>
          <td class="lb-name">${escapeHtml(p.username)}${isMe ? ' <span class="lb-you">вы</span>' : ''}</td>
          <td class="lb-num">${formatNumber(p.totalEarned)}</td>
          <td class="lb-num">${formatNumber(p.totalTaps)}</td>
          <td class="lb-num">${p.businessCount}</td>
          <td class="lb-num lb-streak">${p.loginStreak} 🔥</td>
        </tr>
      `;
    }).join('');

    body.innerHTML = `
      <div class="lb-table-wrap">
        <table class="lb-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Игрок</th>
              <th>Заработано 🪙</th>
              <th>Тапов 👆</th>
              <th>Бизнесов 🏢</th>
              <th>Стрик</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  },

  _showOfflineModal(earned, elapsedSeconds) {
    setTimeout(() => {
      document.getElementById('offline-time').textContent   = formatTime(elapsedSeconds);
      document.getElementById('offline-earned').textContent = formatNumber(earned);
      document.getElementById('offline-modal').classList.remove('hidden');
    }, 600);
  },

  _showDailyModal(earned, streak) {
    // Показываем с задержкой, чтобы не накладывалось на оффлайн-модаль
    setTimeout(() => {
      document.getElementById('daily-streak').textContent = streak;
      document.getElementById('daily-earned').textContent = formatNumber(earned);
      document.getElementById('daily-modal').classList.remove('hidden');
    }, 1400);
  },

  // ── Сохранение ────────────────────────────────────────────────────────────

  _buildSavePayload() {
    return {
      coins:         Math.floor(this.state.coins),
      totalEarned:   Math.floor(this.state.totalEarned),
      totalTaps:     this.state.totalTaps,
      totalSpent:    Math.floor(this.state.totalSpent),
      offlineRecord: Math.floor(this.state.offlineRecord),
      soundEnabled:  this.state.soundEnabled,
      upgradeLevels: this.state.upgrades.map(u => u.level),
      nextPayouts:   this.state.upgrades.map(u => u.nextPayoutAt || 0),
    };
  },

  async _saveGame() {
    if (this._isGuest) {
      Save.saveGuest(this.state);
      return;
    }
    try {
      await API.saveState(this._buildSavePayload());
    } catch (err) {
      console.warn('[Game] Autosave API fail, localStorage fallback:', err.message);
      Save.saveGuest(this.state);
    }
  },
};

// ── Toast ─────────────────────────────────────────────────────────────────

let _toastTimer = null;
function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ── Запуск ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  Game.init();
});
