import jwt from 'jsonwebtoken';
import { config } from './config.js';

export function setSession(res, payload) {
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: `${config.sessionHours}h` });
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.sessionHours * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(config.cookieName, { path: '/' });
}

function readToken(req) {
  const fromCookie = req.cookies?.[config.cookieName];
  if (fromCookie) return fromCookie;
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

// 모든 요청에 붙여 req.user 를 채움(없으면 null)
export function authenticate(req, _res, next) {
  const token = readToken(req);
  req.user = null;
  if (token) {
    try { req.user = jwt.verify(token, config.jwtSecret); } catch { /* 무효 토큰 무시 */ }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ error: '로그인이 필요합니다.' });
}

export function requireTeacher(req, res, next) {
  if (req.user?.role === 'teacher') return next();
  return res.status(403).json({ error: '관리자만 접근할 수 있습니다.' });
}

export function requireStudent(req, res, next) {
  if (req.user?.role === 'student') return next();
  return res.status(403).json({ error: '학생 로그인이 필요합니다.' });
}
