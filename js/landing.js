/**
 * js/landing.js — логика главной страницы.
 * Авторизация → редирект на /game
 * Чат — polling каждые 5 секунд
 * Мини-лидерборд — загрузка при старте
 */

const TOKEN_KEY = 'taptap_jwt';

// ── Токен ──────────────────────────────────────────────────────────────────

function getToken()   { return localStorage.getItem(TOKEN_KEY); }
function isLoggedIn() { return !!getToken(); }

// ── Запрос ─────────────────────────────────────────────────────────────────

async function req(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (getToken()) headers['Authorization'] = `Bearer ${getToken()}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Утилиты ────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e9)  return (n / 1e9).toFixed(1)  + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(1)  + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(1)  + 'K';
  return Math.floor(n).toString();
}

// ── Авторизация ────────────────────────────────────────────────────────────

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch { return null; }
}

function getUsername() {
  const payload = parseJwt(getToken());
  return payload?.username || null;
}

function updateNavAuth() {
  const actionsEl = document.getElementById('nav-actions');
  if (!actionsEl) return;

  if (isLoggedIn()) {
    const name = getUsername() || '—';
    actionsEl.innerHTML = `
      <span class="nav-user">👤 ${escHtml(name)}</span>
      <a href="/game" class="btn btn-primary">▶ Играть</a>
    `;
  } else {
    actionsEl.innerHTML = `
      <button class="btn btn-outline" id="nav-login-btn">Войти</button>
      <button class="btn btn-primary" id="nav-reg-btn">Начать играть</button>
    `;
    document.getElementById('nav-login-btn')?.addEventListener('click', () => showAuth('login'));
    document.getElementById('nav-reg-btn')?.addEventListener('click',   () => showAuth('register'));
  }
}

function showAuth(tab = 'login') {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  // Активируем нужную вкладку
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('login-form')?.classList.toggle('hidden',    tab !== 'login');
  document.getElementById('register-form')?.classList.toggle('hidden', tab !== 'register');
  document.getElementById('auth-error')?.classList.add('hidden');
}

function hideAuth() {
  document.getElementById('auth-modal')?.classList.add('hidden');
}

function initAuth() {
  // Вкладки
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const t = tab.dataset.tab;
      document.querySelectorAll('.auth-tab').forEach(x => x.classList.toggle('active', x.dataset.tab === t));
      document.getElementById('login-form')?.classList.toggle('hidden',    t !== 'login');
      document.getElementById('register-form')?.classList.toggle('hidden', t !== 'register');
      document.getElementById('auth-error')?.classList.add('hidden');
    });
  });

  // Логин
  document.getElementById('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('auth-error');
    const btn   = e.target.querySelector('.auth-submit');
    errEl?.classList.add('hidden');
    btn.disabled = true; btn.textContent = '…';
    try {
      const data = await req('POST', '/api/auth/login', {
        username: e.target.username.value.trim(),
        password: e.target.password.value,
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      window.location.href = '/game';
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    } finally {
      btn.disabled = false; btn.textContent = 'Войти';
    }
  });

  // Регистрация
  document.getElementById('register-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('auth-error');
    const btn   = e.target.querySelector('.auth-submit');
    errEl?.classList.add('hidden');
    if (e.target.password.value !== e.target.password2.value) {
      if (errEl) { errEl.textContent = 'Пароли не совпадают'; errEl.classList.remove('hidden'); }
      return;
    }
    btn.disabled = true; btn.textContent = '…';
    try {
      const data = await req('POST', '/api/auth/register', {
        username: e.target.username.value.trim(),
        password: e.target.password.value,
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      window.location.href = '/game';
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    } finally {
      btn.disabled = false; btn.textContent = 'Зарегистрироваться';
    }
  });

  // Закрытие по фону
  document.getElementById('auth-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) hideAuth();
  });

  // CTA-кнопки
  document.getElementById('hero-play-btn')?.addEventListener('click', () => {
    if (isLoggedIn()) window.location.href = '/game';
    else showAuth('register');
  });
  document.getElementById('cta-play-btn')?.addEventListener('click', () => {
    if (isLoggedIn()) window.location.href = '/game';
    else showAuth('register');
  });
}

// ── Мини-лидерборд ─────────────────────────────────────────────────────────

async function loadLeaderboard() {
  const el = document.getElementById('mini-lb');
  if (!el) return;
  try {
    const { players } = await req('GET', '/api/game/leaderboard');
    if (!players.length) {
      el.innerHTML = '<div class="mini-lb-empty">Пока никого нет 🙁</div>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    el.innerHTML = players.slice(0, 10).map((p, i) => `
      <div class="mini-lb-row">
        <span class="mini-lb-rank">${medals[i] ?? (i + 1)}</span>
        <span class="mini-lb-name">${escHtml(p.username)}</span>
        <span class="mini-lb-score">${fmtNum(p.totalEarned)} 🪙</span>
      </div>
    `).join('');
  } catch {
    el.innerHTML = '<div class="mini-lb-empty">Не удалось загрузить</div>';
  }
}

// ── Счётчики в hero ────────────────────────────────────────────────────────

async function loadHeroStats() {
  try {
    const { players } = await req('GET', '/api/game/leaderboard');
    const countEl = document.getElementById('stat-players');
    if (countEl) countEl.textContent = players.length;
  } catch { /* игнорируем */ }
}

// ── Инициализация ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  updateNavAuth();
  initAuth();
  loadLeaderboard();
  loadHeroStats();
});
