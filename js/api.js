/**
 * js/api.js — тонкая обёртка над fetch для работы с сервером.
 *
 * Хранит JWT в localStorage. Все методы асинхронны.
 * При 401 с флагом expired очищает токен и генерирует
 * событие 'taptap:sessionexpired', которое ловит game.js.
 *
 * Загружается ПЕРВЫМ из JS-скриптов (до save.js).
 */

const API = (() => {
  const TOKEN_KEY = 'taptap_jwt';
  const BASE      = ''; // пустая строка = тот же origin, что и страница

  // ── Токен ────────────────────────────────────────────────────────────────

  function getToken()        { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t)       { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken()      { localStorage.removeItem(TOKEN_KEY); }
  function isLoggedIn()      { return !!getToken(); }

  // ── Базовый запрос ───────────────────────────────────────────────────────

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token   = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(BASE + path, opts);
    } catch (networkErr) {
      throw new Error('Нет соединения с сервером');
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // Если сессия истекла — уведомляем game.js
      if (res.status === 401) {
        clearToken();
        if (data.expired) {
          window.dispatchEvent(new CustomEvent('taptap:sessionexpired'));
        }
      }
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    return data;
  }

  // ── Auth endpoints ───────────────────────────────────────────────────────

  async function register(username, password) {
    const data = await request('POST', '/api/auth/register', { username, password });
    setToken(data.token);
    return data;
  }

  async function login(username, password) {
    const data = await request('POST', '/api/auth/login', { username, password });
    setToken(data.token);
    return data;
  }

  function logout() {
    clearToken();
  }

  // ── Game endpoints ───────────────────────────────────────────────────────

  function getState() {
    return request('GET', '/api/game/state');
  }

  function saveState(payload) {
    return request('POST', '/api/game/save', payload);
  }

  function resetGame() {
    return request('POST', '/api/game/reset');
  }

  function getBusinesses() {
    return request('GET', '/api/game/businesses');
  }

  function getLeaderboard() {
    return request('GET', '/api/game/leaderboard');
  }

  /**
   * Сохраняет состояние через navigator.sendBeacon (надёжнее в beforeunload).
   * Возвращает true, если браузер принял запрос в очередь.
   */
  function saveStateBeacon(payload) {
    if (!isLoggedIn()) return false;
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    return navigator.sendBeacon('/api/game/save', blob);
  }

  // ── Публичный интерфейс ──────────────────────────────────────────────────

  return {
    getToken, setToken, clearToken, isLoggedIn,
    register, login, logout,
    getState, saveState, resetGame, getBusinesses, getLeaderboard,
    saveStateBeacon,
  };
})();
