/**
 * lib/auth-token.js — JWT de sessao assinado no servidor
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'frigestor_token';
const TTL = process.env.JWT_TTL || '7d';

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && String(secret).trim()) return String(secret).trim();
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET obrigatorio em producao. Configure na Vercel / .env');
  }
  return 'frigestor-dev-only-' + crypto.randomBytes(16).toString('hex');
}

const SECRET = jwtSecret();

function payloadFromUsuario(usuario, tenantId) {
  return {
    uid: usuario.uid,
    role: usuario.role,
    tenantId: tenantId ?? usuario.tenantId ?? null,
    email: usuario.email
  };
}

function signToken(usuario, tenantId) {
  return jwt.sign(payloadFromUsuario(usuario, tenantId), SECRET, { expiresIn: TTL });
}

function verifyToken(token) {
  return jwt.verify(String(token), SECRET);
}

function extrairToken(req) {
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }
  return null;
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production'),
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function responderAutenticado(res, usuario, tenantId) {
  const token = signToken(usuario, tenantId);
  setAuthCookie(res, token);
  const { senha: _omit, ...sem } = usuario;
  return res.json({ ...sem, tenantId: tenantId ?? null, token });
}

module.exports = {
  COOKIE_NAME,
  signToken,
  verifyToken,
  extrairToken,
  setAuthCookie,
  clearAuthCookie,
  responderAutenticado
};
