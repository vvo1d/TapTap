/**
 * tapHandler.js — Canvas, звук и конфетти
 *
 * Экспортирует три глобальных объекта:
 *   Sound      — Web Audio API (tap + purchase)
 *   Confetti   — оверлейный canvas с конфетти при покупке
 *   TapHandler — основной canvas с анимацией монеты и эффектами тапа
 */

// ─── Звук ─────────────────────────────────────────────────────────────────

const Sound = {
  _ctx: null,
  enabled: true,

  /** Возвращает AudioContext, создавая его при первом обращении. */
  get ctx() {
    if (!this._ctx) {
      try {
        this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        return null;
      }
    }
    // Браузер suspend-ит контекст до первого жеста — возобновляем
    if (this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }
    return this._ctx;
  },

  /** Короткий высокочастотный щелчок при тапе. */
  playTap() {
    if (!this.enabled) return;
    const c = this.ctx;
    if (!c) return;

    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);

    osc.type            = 'sine';
    osc.frequency.value = 1100;
    gain.gain.setValueAtTime(0.08, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);

    osc.start(c.currentTime);
    osc.stop(c.currentTime + 0.08);
  },

  /** Восходящая мелодия при успешной покупке. */
  playPurchase() {
    if (!this.enabled) return;
    const c = this.ctx;
    if (!c) return;

    // До-Ми-Соль-До (мажорный аккорд)
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc  = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(c.destination);

      osc.type            = 'triangle';
      osc.frequency.value = freq;

      const t = c.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

      osc.start(t);
      osc.stop(t + 0.18);
    });
  },

  /** Переключает звук on/off. Если включаем — сразу resume контекст. */
  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      // Принудительно создаём/возобновляем контекст в ответ на жест пользователя
      const c = this.ctx;
      if (c && c.state === 'suspended') c.resume().catch(() => {});
    }
    return this.enabled;
  },
};

// ─── Конфетти ─────────────────────────────────────────────────────────────

const Confetti = {
  canvas: null,
  ctx:    null,
  parts:  [],
  _raf:   null,

  init() {
    this.canvas           = document.createElement('canvas');
    this.canvas.id        = 'confetti-canvas';
    this.canvas.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:9999;';
    document.body.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d');
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._loop();
  },

  _resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  },

  /** Запускает взрыв конфетти из центра экрана. */
  burst() {
    const COLORS = [
      '#FFD700', '#FFA500', '#FF6B6B', '#4ECDC4',
      '#45B7D1', '#96CEB4', '#C084FC', '#FB923C',
    ];
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;

    for (let i = 0; i < 80; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 14;
      this.parts.push({
        x:        cx,
        y:        cy,
        vx:       Math.cos(angle) * speed,
        vy:       Math.sin(angle) * speed - 6,
        w:        6  + Math.random() * 10,
        h:        4  + Math.random() * 6,
        rot:      Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.35,
        color:    COLORS[Math.floor(Math.random() * COLORS.length)],
        life:     1,
        decay:    0.012 + Math.random() * 0.01,
      });
    }
  },

  _loop() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.parts = this.parts.filter(p => p.life > 0);

    for (const p of this.parts) {
      p.x   += p.vx;
      p.y   += p.vy;
      p.vy  += 0.35;   // гравитация
      p.vx  *= 0.99;
      p.rot += p.rotSpeed;
      p.life -= p.decay;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    requestAnimationFrame(() => this._loop());
  },
};

// ─── TapHandler (основной Canvas) ────────────────────────────────────────

const TapHandler = {
  canvas:    null,
  ctx:       null,
  particles: [],     // золотые частицы от тапа
  floats:    [],     // всплывающий текст «+X»
  shakeLeft: 0,      // секунд осталось трясти
  _lastTime: 0,
  _pulse:    0,      // фаза дыхания монеты
  _onTap:    null,   // коллбэк в game.js

  /**
   * Инициализирует canvas и навешивает события.
   * @param {string}   canvasId — id элемента <canvas>
   * @param {Function} onTap    — вызывается при каждом успешном тапе
   */
  init(canvasId, onTap) {
    this.canvas = document.getElementById(canvasId);
    this.ctx    = this.canvas.getContext('2d');
    this._onTap = onTap;

    // Мышь
    this.canvas.addEventListener('click', e => this._handlePointer(e));

    // Тач (с preventDefault, чтобы не было двойных событий)
    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const t    = e.changedTouches[0];
      const rect = this.canvas.getBoundingClientRect();
      this._handlePointer({
        clientX: t.clientX,
        clientY: t.clientY,
        _rect:   rect,
      });
    }, { passive: false });

    // Клавиатурная доступность (Enter / Пробел)
    // this.canvas.addEventListener('keydown', e => {
    //   if (e.key === 'Enter' || e.key === ' ') {
    //     e.preventDefault();
    //     const cx = this.canvas.width  / 2;
    //     const cy = this.canvas.height / 2;
    //     this._handlePointer({ clientX: cx, clientY: cy, _rect: { left: 0, top: 0, width: this.canvas.width, height: this.canvas.height } });
    //   }
    // });

    this._loop();
  },

  /** Преобразует клиентские координаты в координаты canvas. */
  _toCanvasCoords(e) {
    const rect = e._rect || this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left)  * (this.canvas.width  / rect.width),
      y: (e.clientY - rect.top)   * (this.canvas.height / rect.height),
    };
  },

  _handlePointer(e) {
    const { x, y } = this._toCanvasCoords(e);

    // Проверяем попадание в круг монеты
    const cx = this.canvas.width  / 2;
    const cy = this.canvas.height / 2;
    const r  = this.canvas.width  * 0.37;
    if (Math.hypot(x - cx, y - cy) > r) return;

    // Всплывающий текст
    this.floats.push({
      x, y,
      text:    '+1',
      opacity: 1,
      vy:      -2.5,
      scale:   1 + Math.random() * 0.3,
      life:    1,
    });

    // Частицы золота
    const count = 10 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 5;
      this.particles.push({
        x, y,
        vx:    Math.cos(angle) * speed,
        vy:    Math.sin(angle) * speed - 1.5,
        size:  2 + Math.random() * 5,
        hue:   38 + Math.random() * 20,
        light: 50 + Math.random() * 25,
        life:  1,
        decay: 0.025 + Math.random() * 0.025,
      });
    }

    // Встряска
    this.shakeLeft = 0.25;

    // Звук и коллбэк
    Sound.playTap();
    if (this._onTap) this._onTap(x, y);
  },

  // ── Отрисовка монеты ──────────────────────────────────────────────────

  _drawCoin(cx, cy, r) {
    const ctx = this.ctx;

    // Внешнее свечение (пульсация)
    const glowR = r * (1.25 + Math.sin(this._pulse) * 0.06);
    const glow  = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, glowR);
    glow.addColorStop(0, 'rgba(255,215,0,0.28)');
    glow.addColorStop(1, 'rgba(255,150,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Тень под монетой
    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur    = 30;
    ctx.shadowOffsetY = 12;

    // Основное тело монеты
    const grad = ctx.createRadialGradient(
      cx - r * 0.3, cy - r * 0.35, r * 0.05,
      cx,           cy,            r,
    );
    grad.addColorStop(0,    '#FFF3A0');
    grad.addColorStop(0.35, '#FFD700');
    grad.addColorStop(0.7,  '#FFA500');
    grad.addColorStop(1,    '#8B5E00');

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // Внутренний кант (рельеф)
    ctx.beginPath();
    ctx.arc(cx, cy, r - 10, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth   = 4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r - 14, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Символ «₮» (ТапКойн)
    const fontSize = Math.floor(r * 0.72);
    ctx.font         = `bold ${fontSize}px Georgia, serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    // Тень текста
    ctx.fillStyle = 'rgba(100,60,0,0.5)';
    ctx.fillText('₮', cx + 3, cy + 5);

    // Основной текст
    const textGrad = ctx.createLinearGradient(cx, cy - fontSize / 2, cx, cy + fontSize / 2);
    textGrad.addColorStop(0, '#FFFDE0');
    textGrad.addColorStop(1, '#E8B400');
    ctx.fillStyle = textGrad;
    ctx.fillText('₮', cx, cy + 2);

    // Надпись «ТАП!» внизу
    const labelSize = Math.floor(r * 0.22);
    ctx.font         = `bold ${labelSize}px Arial, sans-serif`;
    ctx.fillStyle    = 'rgba(120,75,0,0.7)';
    ctx.fillText('ТАП!', cx + 2, cy + r * 0.68 + 2);
    ctx.fillStyle    = '#FFFBCC';
    ctx.fillText('ТАП!', cx, cy + r * 0.68);

    // Блик
    const shine = ctx.createRadialGradient(
      cx - r * 0.32, cy - r * 0.32, 0,
      cx - r * 0.1,  cy - r * 0.15, r * 0.55,
    );
    shine.addColorStop(0,   'rgba(255,255,255,0.45)');
    shine.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    shine.addColorStop(1,   'rgba(255,255,255,0)');

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = shine;
    ctx.fill();
  },

  // ── Основной игровой цикл canvas ─────────────────────────────────────

  _loop(ts = 0) {
    const dt = Math.min((ts - this._lastTime) / 1000, 0.1);
    this._lastTime = ts;

    const ctx    = this.ctx;
    const W      = this.canvas.width;
    const H      = this.canvas.height;
    const cx     = W / 2;
    const cy     = H / 2;
    const r      = W * 0.37;

    this._pulse += dt * 1.8;

    // Смещение при встряске
    let ox = 0, oy = 0;
    if (this.shakeLeft > 0) {
      this.shakeLeft -= dt;
      const k = this.shakeLeft / 0.25;
      ox = (Math.random() - 0.5) * 8 * k;
      oy = (Math.random() - 0.5) * 8 * k;
    }

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(ox, oy);
    this._drawCoin(cx, cy, r);
    ctx.restore();

    // Частицы
    this.particles = this.particles.filter(p => p.life > 0);
    for (const p of this.particles) {
      p.x    += p.vx;
      p.y    += p.vy;
      p.vy   += 0.18;
      p.life -= p.decay;

      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = `hsl(${p.hue},100%,${p.light}%)`;
      ctx.shadowColor = `hsl(${p.hue},100%,70%)`;
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Всплывающие тексты
    this.floats = this.floats.filter(t => t.life > 0);
    for (const t of this.floats) {
      t.y    += t.vy;
      t.vy   *= 0.97;
      t.life -= dt * 1.4;

      const sz = Math.floor(28 * t.scale);
      ctx.save();
      ctx.globalAlpha  = Math.max(0, t.life);
      ctx.font         = `bold ${sz}px Arial, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle  = '#7A4F00';
      ctx.lineWidth    = 4;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle    = '#FFE066';
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }

    requestAnimationFrame(ts2 => this._loop(ts2));
  },

  /**
   * Добавляет всплывающий текст (используется при оффлайн-бонусе и т.п.).
   * @param {string} text
   */
  spawnText(text) {
    const cx = this.canvas.width  / 2;
    const cy = this.canvas.height / 2;
    this.floats.push({ x: cx, y: cy - 80, text, opacity: 1, vy: -1.5, scale: 1.4, life: 1 });
  },
};
