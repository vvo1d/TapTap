/**
 * server/businesses.js — единый источник истины для данных бизнесов.
 *
 * Два типа бизнесов:
 *
 *   type='tap'
 *     Каждый уровень добавляет tapBonus к силе тапа.
 *     Нет таймера, нет пассивного дохода.
 *     Задача: делать тап всегда выгодным.
 *
 *   type='passive'
 *     Медленный пассивный доход: интервалы 1ч / 2ч / 4ч / 8ч.
 *     Стимулирует заходить в игру несколько раз в день.
 *
 * unlockAt — порог totalEarned (накопленного за всё время), при котором
 *            бизнес становится доступен. Создаёт естественную прогрессию.
 */

// ── Tap-бизнесы: добавляют бонус к каждому тапу ──────────────────────────

const BUSINESSES_TAP = [
  {
    id:       'desk',
    name:     'Рабочее место',
    icon:     'monitor',
    desc:     'Простой стол и энтузиазм. Начало всех начал.',
    type:     'tap',
    tapBonus: 1,
    baseCost: 50,
    unlockAt: 0,
  },
  {
    id:       'workshop',
    name:     'Мастерская',
    icon:     'wrench',
    desc:     'Инструменты, навыки, дисциплина — и тап становится мощнее.',
    type:     'tap',
    tapBonus: 5,
    baseCost: 400,
    unlockAt: 500,
  },
  {
    id:       'studio',
    name:     'Студия',
    icon:     'mic',
    desc:     'Профессиональное рабочее пространство. Каждый тап — продукт.',
    type:     'tap',
    tapBonus: 20,
    baseCost: 3_000,
    unlockAt: 5_000,
  },
  {
    id:       'office',
    name:     'Офис',
    icon:     'building',
    desc:     'Команда, которая кратно усиливает каждое ваше действие.',
    type:     'tap',
    tapBonus: 80,
    baseCost: 25_000,
    unlockAt: 50_000,
  },
  {
    id:       'campus',
    name:     'Технокампус',
    icon:     'graduation',
    desc:     'R&D-центр с сотнями специалистов. Тап превращается в прорыв.',
    type:     'tap',
    tapBonus: 350,
    baseCost: 200_000,
    unlockAt: 500_000,
  },
  {
    id:       'factory',
    name:     'Завод',
    icon:     'factory',
    desc:     'Промышленные мощности на службе каждого нажатия.',
    type:     'tap',
    tapBonus: 1_500,
    baseCost: 1_500_000,
    unlockAt: 5_000_000,
  },
  {
    id:       'megacorp',
    name:     'Мегакорпорация',
    icon:     'briefcase',
    desc:     'Транснациональный гигант. Один тап — тысячи людей работают на вас.',
    type:     'tap',
    tapBonus: 7_500,
    baseCost: 12_000_000,
    unlockAt: 50_000_000,
  },
  {
    id:       'techpark',
    name:     'Технополис',
    icon:     'city',
    desc:     'Целый город, заточённый на максимизацию прибыли с каждого тапа.',
    type:     'tap',
    tapBonus: 40_000,
    baseCost: 100_000_000,
    unlockAt: 500_000_000,
  },
];

// ── Passive-бизнесы: медленный, но стабильный пассивный доход ─────────────

const BUSINESSES_PASSIVE = [
  {
    id:          'apartment',
    name:        'Сдача квартиры',
    icon:        'home',
    desc:        'Арендаторы платят раз в час. Скромно, но без усилий.',
    type:        'passive',
    baseIncome:  800,
    interval:    3_600,   // 1 час
    baseCost:    5_000,
    unlockAt:    2_000,
  },
  {
    id:          'farm',
    name:        'Ферма',
    icon:        'wheat',
    desc:        'Земля кормит стабильно. Раз в час — урожай.',
    type:        'passive',
    baseIncome:  5_000,
    interval:    3_600,   // 1 час
    baseCost:    50_000,
    unlockAt:    20_000,
  },
  {
    id:          'mall',
    name:        'Торговый центр',
    icon:        'cart',
    desc:        'Сотни магазинов работают, пока вы тапаете. Выплата раз в 2 часа.',
    type:        'passive',
    baseIncome:  35_000,
    interval:    7_200,   // 2 часа
    baseCost:    350_000,
    unlockAt:    200_000,
  },
  {
    id:          'plant',
    name:        'Промышленный завод',
    icon:        'gear',
    desc:        'Производство работает круглосуточно. Отчисление каждые 2 часа.',
    type:        'passive',
    baseIncome:  250_000,
    interval:    7_200,   // 2 часа
    baseCost:    2_500_000,
    unlockAt:    2_000_000,
  },
  {
    id:          'oilfield',
    name:        'Нефтяное месторождение',
    icon:        'fuel',
    desc:        'Нефть качается, деньги капают. Раз в 4 часа — серьёзная выплата.',
    type:        'passive',
    baseIncome:  2_000_000,
    interval:    14_400,  // 4 часа
    baseCost:    20_000_000,
    unlockAt:    20_000_000,
  },
  {
    id:          'satellite',
    name:        'Спутниковая сеть',
    icon:        'satellite',
    desc:        'Орбитальная инфраструктура. Раз в 8 часов — огромный поток монет.',
    type:        'passive',
    baseIncome:  20_000_000,
    interval:    28_800,  // 8 часов
    baseCost:    200_000_000,
    unlockAt:    200_000_000,
  },
];

// ── Единый плоский массив (индекс = позиция в upgrade_levels) ─────────────
// Порядок: сначала все tap, затем все passive. Менять порядок нельзя
// без миграции БД, т.к. индексы сохраняются в upgrade_levels.

const BUSINESSES = [...BUSINESSES_TAP, ...BUSINESSES_PASSIVE];

/** Максимальное оффлайн-время — 8 часов в секундах */
const MAX_OFFLINE_SECONDS = 8 * 3600;

/**
 * Рассчитывает оффлайн-доход ТОЛЬКО для passive-бизнесов.
 * Использует сохранённые nextPayoutAt для точного расчёта по каждому бизнесу.
 * Возвращает обновлённые nextPayouts (просроченные сброшены на now + interval).
 *
 * @param {number[]} levels       — массив уровней
 * @param {number[]} nextPayouts  — массив timestamp'ов nextPayoutAt (мс), индекс = позиция в BUSINESSES
 * @param {number}   lastSaveTime — timestamp последнего сохранения (для расчёта elapsed в модалке)
 * @returns {{ earned: number, elapsedSeconds: number, newNextPayouts: number[] }}
 */
function calcOfflineIncome(levels, nextPayouts, lastSaveTime) {
  const nowMs          = Date.now();
  const elapsedSeconds = Math.floor(Math.min((nowMs - lastSaveTime) / 1000, MAX_OFFLINE_SECONDS));
  const newNextPayouts = nextPayouts.slice();

  let earned = 0;
  BUSINESSES.forEach((biz, i) => {
    if (biz.type === 'tap') return;

    const level     = levels[i] || 0;
    if (level === 0) return;

    const savedNext = nextPayouts[i] || 0;
    if (!savedNext || savedNext > nowMs) return; // таймер ещё не истёк

    const intervalMs = biz.interval * 1000;
    const maxBatches = Math.ceil(MAX_OFFLINE_SECONDS / biz.interval);
    const batches    = Math.min(
      Math.floor((nowMs - savedNext) / intervalMs) + 1,
      maxBatches,
    );

    earned += batches * biz.baseIncome * level;
    newNextPayouts[i] = nowMs + intervalMs; // перезапускаем таймер
  });

  return {
    earned:         Math.floor(earned),
    elapsedSeconds,
    newNextPayouts,
  };
}

/**
 * Считает суммарную стоимость всех купленных уровней для набора levels.
 * Используется для серверной валидации totalSpent.
 */
function calcExpectedTotalSpent(levels) {
  let total = 0;
  BUSINESSES.forEach((biz, i) => {
    const lvl = levels[i] || 0;
    for (let l = 0; l < lvl; l++) {
      total += Math.ceil(biz.baseCost * Math.pow(1.15, l));
    }
  });
  return total;
}

/**
 * Возвращает максимальную силу тапа для набора levels.
 */
function calcTapPower(levels) {
  let power = 1;
  BUSINESSES.forEach((biz, i) => {
    if (biz.type === 'tap') power += (biz.tapBonus || 0) * (levels[i] || 0);
  });
  return power;
}

module.exports = {
  BUSINESSES, BUSINESSES_TAP, BUSINESSES_PASSIVE,
  MAX_OFFLINE_SECONDS, calcOfflineIncome,
  calcExpectedTotalSpent, calcTapPower,
};
