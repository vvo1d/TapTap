/**
 * js/upgrades.js — два вида бизнесов и логика апгрейдов.
 *
 * type='tap'     — добавляют bonus * level к каждому тапу, без таймера.
 * type='passive' — медленный пассивный доход, интервалы 1ч/2ч/4ч/8ч.
 *
 * Бизнесы блокируются пока totalEarned < unlockAt.
 */

// ── Встроенные данные (резерв для гостевого режима без сети) ──────────────

const BUSINESSES_DATA = [
  // ── Tap-бизнесы ──────────────────────────────────────────────────────────
  { id: 'desk',      name: 'Рабочее место',          icon: 'monitor',    desc: 'Простой стол и энтузиазм. С этого всё начинается.',               type: 'tap', tapBonus: 1,      baseCost: 50,          unlockAt: 0 },
  { id: 'workshop',  name: 'Мастерская',              icon: 'wrench',     desc: 'Инструменты, навыки, дисциплина.',                                  type: 'tap', tapBonus: 5,      baseCost: 400,         unlockAt: 500 },
  { id: 'studio',    name: 'Студия',                  icon: 'mic',        desc: 'Профессиональное рабочее пространство.',                            type: 'tap', tapBonus: 20,     baseCost: 3_000,       unlockAt: 5_000 },
  { id: 'office',    name: 'Офис',                    icon: 'building',   desc: 'Команда, которая кратно усиливает каждый тап.',                    type: 'tap', tapBonus: 80,     baseCost: 25_000,      unlockAt: 50_000 },
  { id: 'campus',    name: 'Технокампус',             icon: 'graduation', desc: 'R&D-центр. Каждый тап — технологический прорыв.',                   type: 'tap', tapBonus: 350,    baseCost: 200_000,     unlockAt: 500_000 },
  { id: 'factory',   name: 'Завод',                   icon: 'factory',    desc: 'Промышленные мощности усиливают каждое нажатие.',                   type: 'tap', tapBonus: 1_500,  baseCost: 1_500_000,   unlockAt: 5_000_000 },
  { id: 'megacorp',  name: 'Мегакорпорация',          icon: 'briefcase',  desc: 'Транснациональный гигант работает на каждый ваш тап.',             type: 'tap', tapBonus: 7_500,  baseCost: 12_000_000,  unlockAt: 50_000_000 },
  { id: 'techpark',  name: 'Технополис',              icon: 'city',       desc: 'Целый город, заточённый на максимизацию тапа.',                     type: 'tap', tapBonus: 40_000, baseCost: 100_000_000, unlockAt: 500_000_000 },
  // ── Passive-бизнесы ───────────────────────────────────────────────────────
  { id: 'apartment', name: 'Сдача квартиры',          icon: 'home',       desc: 'Арендаторы платят раз в час. Скромно, но без усилий.',             type: 'passive', baseIncome: 800,        interval: 3_600,  baseCost: 5_000,       unlockAt: 2_000 },
  { id: 'farm',      name: 'Ферма',                   icon: 'wheat',      desc: 'Земля кормит стабильно. Урожай раз в час.',                        type: 'passive', baseIncome: 5_000,      interval: 3_600,  baseCost: 50_000,      unlockAt: 20_000 },
  { id: 'mall',      name: 'Торговый центр',           icon: 'cart',       desc: 'Сотни магазинов работают. Выплата раз в 2 часа.',                  type: 'passive', baseIncome: 35_000,     interval: 7_200,  baseCost: 350_000,     unlockAt: 200_000 },
  { id: 'plant',     name: 'Промышленный завод',       icon: 'gear',       desc: 'Производство круглосуточно. Отчисление каждые 2 часа.',            type: 'passive', baseIncome: 250_000,    interval: 7_200,  baseCost: 2_500_000,   unlockAt: 2_000_000 },
  { id: 'oilfield',  name: 'Нефтяное месторождение',  icon: 'fuel',       desc: 'Нефть качается. Серьёзная выплата раз в 4 часа.',                  type: 'passive', baseIncome: 2_000_000,  interval: 14_400, baseCost: 20_000_000,  unlockAt: 20_000_000 },
  { id: 'satellite', name: 'Спутниковая сеть',        icon: 'satellite',  desc: 'Орбитальная инфраструктура. Огромный поток раз в 8 часов.',        type: 'passive', baseIncome: 20_000_000, interval: 28_800, baseCost: 200_000_000, unlockAt: 200_000_000 },
];

// ── Модуль апгрейдов ──────────────────────────────────────────────────────

const Upgrades = {
  state: null,

  // ── Настройка ───────────────────────────────────────────────────────────

  setStateRef(state) {
    this.state = state;
  },

  /** Перезаписывает данные бизнесов (данными с сервера). */
  setBusinessData(businesses) {
    const old = this.state?.upgrades ?? [];
    this.state.upgrades = businesses.map(biz => {
      const existing = old.find(u => u.id === biz.id);
      return {
        ...biz,
        level:        existing?.level        ?? 0,
        nextPayoutAt: existing?.nextPayoutAt ?? null,
      };
    });
  },

  // ── Расчёты ─────────────────────────────────────────────────────────────

  /** Сила тапа = 1 + Σ(tapBonus * level) по всем tap-бизнесам. */
  getTapPower() {
    if (!this.state) return 1;
    return 1 + this.state.upgrades
      .filter(u => u.type === 'tap')
      .reduce((sum, u) => sum + u.tapBonus * u.level, 0);
  },

  /** Пассивный доход в час (для отображения в шапке). */
  getPassiveIncomePerHour() {
    if (!this.state) return 0;
    return this.state.upgrades
      .filter(u => u.type === 'passive')
      .reduce((sum, u) => sum + (u.baseIncome / u.interval) * 3600 * u.level, 0);
  },

  getCurrentCost(upgrade) {
    return Math.ceil(upgrade.baseCost * Math.pow(1.15, upgrade.level));
  },

  isUnlocked(upgrade) {
    return (this.state?.totalEarned ?? 0) >= (upgrade.unlockAt ?? 0);
  },

  // ── Покупка ─────────────────────────────────────────────────────────────

  purchase(upgradeId) {
    const upgrade = this.state.upgrades.find(u => u.id === upgradeId);
    if (!upgrade)                    return false;
    if (!this.isUnlocked(upgrade))   return false;

    const cost = this.getCurrentCost(upgrade);
    if (this.state.coins < cost)     return false;

    this.state.coins      -= cost;
    this.state.totalSpent  = (this.state.totalSpent || 0) + cost;
    upgrade.level++;

    // Таймер — только для passive-бизнесов
    if (upgrade.type === 'passive') {
      if (upgrade.level === 1 || !upgrade.nextPayoutAt) {
        upgrade.nextPayoutAt = Date.now() + upgrade.interval * 1000;
      }
    } else {
      upgrade.nextPayoutAt = null;
    }

    return true;
  },

  // ── Рендер ──────────────────────────────────────────────────────────────

  render() {
    const list = document.getElementById('upgrades-list');
    if (!list || !this.state) return;

    let lastType = null;

    this.state.upgrades.forEach(upgrade => {
      const unlocked  = this.isUnlocked(upgrade);
      const cost      = this.getCurrentCost(upgrade);
      const canAfford = unlocked && this.state.coins >= cost;

      // ── Заголовок секции ──
      if (upgrade.type !== lastType) {
        lastType = upgrade.type;
        const sectionId = `section-header-${upgrade.type}`;
        if (!list.querySelector(`#${sectionId}`)) {
          const hdr = document.createElement('div');
          hdr.id        = sectionId;
          hdr.className = 'tier-header';
          hdr.innerHTML = upgrade.type === 'tap'
            ? `${icon('tap')} Улучшения тапа — бонус к каждому нажатию`
            : `${icon('building')} Пассивный доход — работает пока вас нет`;
          list.appendChild(hdr);
        }
      }

      // ── Карточка ──
      let item = list.querySelector(`.upgrade-item[data-upgrade-id="${upgrade.id}"]`);

      if (!item) {
        item = document.createElement('div');
        item.className            = 'upgrade-item';
        item.dataset.upgradeId    = upgrade.id;
        item.dataset.upgradeType  = upgrade.type;

        if (upgrade.type === 'tap') {
          item.innerHTML = `
            <div class="upgrade-icon" aria-hidden="true">${icon(upgrade.icon, 'xl')}</div>
            <div class="upgrade-info">
              <div class="upgrade-name">${upgrade.name}</div>
              <div class="upgrade-desc">${upgrade.desc}</div>
              <div class="upgrade-stats">
                <span class="upgrade-level">Ур. <strong class="lvl-num">0</strong></span>
                <span class="upgrade-tap-bonus">
                  ${icon('tap')} +<span class="bonus-num">0</span>/тап
                </span>
              </div>
            </div>
            <div class="upgrade-buy">
              <div class="upgrade-cost">${icon('coin')} <span class="cost-num"></span></div>
              <button class="buy-btn" type="button"></button>
            </div>
          `;
        } else {
          item.innerHTML = `
            <div class="upgrade-icon" aria-hidden="true">${icon(upgrade.icon, 'xl')}</div>
            <div class="upgrade-info">
              <div class="upgrade-name">${upgrade.name}</div>
              <div class="upgrade-desc">${upgrade.desc}</div>
              <div class="upgrade-progress-wrap" style="display:none">
                <div class="upgrade-timer-row">
                  <div class="upgrade-progress-bar">
                    <div class="upgrade-progress-fill"></div>
                  </div>
                  <span class="upgrade-timer-label">—</span>
                </div>
                <button class="collect-btn hidden" type="button">${icon('money')} Забрать</button>
              </div>
              <div class="upgrade-stats">
                <span class="upgrade-level">Ур. <strong class="lvl-num">0</strong></span>
                <span class="upgrade-income">
                  <span class="income-num">0</span>
                  / ${formatInterval(upgrade.interval)}
                </span>
              </div>
            </div>
            <div class="upgrade-buy">
              <div class="upgrade-cost">${icon('coin')} <span class="cost-num"></span></div>
              <button class="buy-btn" type="button"></button>
            </div>
          `;
        }

        list.appendChild(item);
      }

      // ── Обновление данных ──

      item.querySelector('.lvl-num').textContent  = upgrade.level;
      item.querySelector('.cost-num').innerHTML = unlocked
        ? formatNumber(cost)
        : `${icon('lock')} ${formatNumber(upgrade.unlockAt)}`;

      const btn = item.querySelector('.buy-btn');
      if (!unlocked) {
        btn.textContent = 'Не открыт';
        btn.disabled    = true;
      } else if (upgrade.level === 0) {
        btn.textContent = 'Открыть';
        btn.disabled    = !canAfford;
      } else {
        btn.textContent = 'Улучшить';
        btn.disabled    = !canAfford;
      }

      if (upgrade.type === 'tap') {
        item.querySelector('.bonus-num').textContent = formatNumber(
          upgrade.level > 0 ? upgrade.tapBonus * upgrade.level : upgrade.tapBonus
        );
      } else {
        const incomeVal = upgrade.baseIncome * upgrade.level;
        item.querySelector('.income-num').textContent = formatNumber(incomeVal);
        item.querySelector('.upgrade-progress-wrap').style.display =
          upgrade.level > 0 ? 'flex' : 'none';
      }

      item.classList.toggle('affordable', canAfford);
      item.classList.toggle('owned',      upgrade.level > 0);
      item.classList.toggle('locked',     !unlocked);
      item.classList.toggle('type-tap',   upgrade.type === 'tap');
      item.classList.toggle('type-passive', upgrade.type === 'passive');
    });
  },

  /** Обновляет прогресс-бары и таймеры ТОЛЬКО passive-бизнесов (250ms). */
  updateTimers() {
    if (!this.state) return;
    const now = Date.now();

    this.state.upgrades.forEach(u => {
      if (u.type === 'tap' || u.level === 0 || !u.nextPayoutAt) return;

      const item = document.querySelector(`.upgrade-item[data-upgrade-id="${u.id}"]`);
      if (!item) return;

      const fill       = item.querySelector('.upgrade-progress-fill');
      const label      = item.querySelector('.upgrade-timer-label');
      const collectBtn = item.querySelector('.collect-btn');
      if (!fill || !label || !collectBtn) return;

      const intervalMs = u.interval * 1000;
      const remaining  = u.nextPayoutAt - now;
      const ready      = remaining <= 0;

      const pct = ready ? 100 : Math.max(0, ((intervalMs - remaining) / intervalMs) * 100);
      fill.style.width = `${pct.toFixed(1)}%`;

      if (ready) {
        label.textContent = '';
        collectBtn.classList.remove('hidden');
        item.classList.add('payout-ready');
      } else {
        label.textContent = formatTime(remaining / 1000);
        collectBtn.classList.add('hidden');
        item.classList.remove('payout-ready');
      }
    });
  },

  /** Вспышка золота на карточке при выплате пассивного дохода. */
  flashCard(upgradeId, amount) {
    const item = document.querySelector(`.upgrade-item[data-upgrade-id="${upgradeId}"]`);
    if (!item) return;

    item.classList.remove('payout-flash');
    void item.offsetWidth;
    item.classList.add('payout-flash');
    setTimeout(() => item.classList.remove('payout-flash'), 700);

    const float = document.createElement('div');
    float.className   = 'payout-float';
    float.textContent = `+${formatNumber(amount)}`;
    item.appendChild(float);
    setTimeout(() => float.remove(), 900);
  },
};
