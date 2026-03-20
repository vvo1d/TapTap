/**
 * js/auth.js — контроллер модального окна авторизации.
 *
 * Управляет #auth-modal: вкладки "Войти" / "Регистрация", форма,
 * кнопка "Играть как гость".
 *
 * Зависит от: api.js (должен быть загружен раньше).
 */

const Auth = (() => {
  let _onSuccessCallback = null;
  let _onGuestCallback   = null;

  // ── Показ/скрытие ────────────────────────────────────────────────────────

  function show() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function hide() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.add('hidden');
  }

  /**
   * Регистрирует колбэк на успешный вход/регистрацию.
   * Вызывается с { token, user: { id, username } }.
   */
  function onSuccess(cb) { _onSuccessCallback = cb; }

  /**
   * Регистрирует колбэк на "играть как гость".
   */
  function onGuest(cb)   { _onGuestCallback = cb; }

  // ── Вспомогательные ─────────────────────────────────────────────────────

  function setError(msg) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
  }

  function setLoading(formId, loading) {
    const btn = document.querySelector(`#${formId} .auth-submit`);
    if (!btn) return;
    btn.disabled     = loading;
    btn.textContent  = loading ? '...' : btn.dataset.label;
  }

  // ── Инициализация (навешиваем обработчики после загрузки DOM) ────────────

  function init() {
    // Переключение вкладок
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab; // 'login' | 'register'
        document.querySelectorAll('.auth-tab').forEach(t =>
          t.classList.toggle('active', t.dataset.tab === target)
        );
        document.getElementById('login-form').classList.toggle('hidden',    target !== 'login');
        document.getElementById('register-form').classList.toggle('hidden', target !== 'register');
        setError('');
      });
    });

    // Форма входа
    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      setError('');
      const username = e.target.username.value.trim();
      const password = e.target.password.value;
      setLoading('login-form', true);

      try {
        const data = await API.login(username, password);
        hide();
        if (_onSuccessCallback) _onSuccessCallback(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading('login-form', false);
      }
    });

    // Форма регистрации
    document.getElementById('register-form').addEventListener('submit', async e => {
      e.preventDefault();
      setError('');
      const username  = e.target.username.value.trim();
      const password  = e.target.password.value;
      const password2 = e.target.password2.value;

      if (password !== password2) {
        return setError('Пароли не совпадают');
      }

      setLoading('register-form', true);
      try {
        const data = await API.register(username, password);
        hide();
        if (_onSuccessCallback) _onSuccessCallback(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading('register-form', false);
      }
    });

    // Играть как гость
    const guestBtn = document.getElementById('guest-btn');
    if (guestBtn) {
      guestBtn.addEventListener('click', () => {
        hide();
        if (_onGuestCallback) _onGuestCallback();
      });
    }
  }

  // Запускаем после готовности DOM
  document.addEventListener('DOMContentLoaded', init);

  return { show, hide, onSuccess, onGuest };
})();
