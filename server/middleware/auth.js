/**
 * server/middleware/auth.js — JWT-мидлварь.
 * Проверяет заголовок `Authorization: Bearer <token>`.
 * При успехе добавляет `req.userId` и `req.username` к объекту запроса.
 */

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'taptap_dev_secret_REPLACE_IN_PRODUCTION';

module.exports = function requireAuth(req, res, next) {
  const header = req.headers['authorization'];

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  const token = header.slice(7);
  try {
    const payload  = jwt.verify(token, SECRET);
    req.userId     = payload.userId;
    req.username   = payload.username;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Сессия истекла, войдите снова', expired: true });
    }
    return res.status(401).json({ error: 'Недействительный токен' });
  }
};
