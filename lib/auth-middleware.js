/**
 * lib/auth-middleware.js — middleware de autenticacao e autorizacao (JWT)
 */

const path = require('path');
const { verifyToken, extrairToken } = require('./auth-token');

function unauthorized(res, msg = 'Nao autenticado.') {
  return res.status(401).json({ error: msg });
}

function forbidden(res, msg = 'Acesso negado.') {
  return res.status(403).json({ error: msg });
}

/** Anexa req.auth = { uid, role, tenantId, email } ou responde 401. */
function authenticate(req, res, next) {
  const raw = extrairToken(req);
  if (!raw) return unauthorized(res);
  try {
    const payload = verifyToken(raw);
    if (!payload.uid || !payload.role) return unauthorized(res, 'Sessao invalida.');
    req.auth = {
      uid: payload.uid,
      role: payload.role,
      tenantId: payload.tenantId || null,
      email: payload.email || null
    };
    return next();
  } catch (_) {
    return unauthorized(res, 'Sessao expirada ou invalida.');
  }
}

function requireRoles(...roles) {
  const permitidos = roles.flat();
  return (req, res, next) => {
    if (!req.auth) return unauthorized(res);
    if (!permitidos.includes(req.auth.role)) return forbidden(res);
    return next();
  };
}

function requireSuperAdmin(req, res, next) {
  if (!req.auth) return unauthorized(res);
  if (req.auth.role !== 'super_admin') {
    return forbidden(res, 'Acesso restrito ao administrador da plataforma.');
  }
  return next();
}

/** Usuario de tenant (admin ou tecnico) com tenantId no token. */
function requireTenantMember(req, res, next) {
  if (!req.auth) return unauthorized(res);
  if (req.auth.role === 'super_admin') return forbidden(res, 'Use as rotas da plataforma.');
  if (!req.auth.tenantId) return forbidden(res, 'Conta sem empresa vinculada.');
  return next();
}

function requireTenantAdmin(req, res, next) {
  if (!req.auth) return unauthorized(res);
  if (req.auth.role !== 'admin' || !req.auth.tenantId) {
    return forbidden(res, 'Apenas administradores da empresa podem executar esta acao.');
  }
  return next();
}

/** Tenant da sessao JWT (nao confia em headers do cliente). */
function tenantIdAutenticado(req) {
  return req.auth?.tenantId || null;
}

/** Protege HTML interno via cookie JWT — redireciona para login. */
function requirePageRoles(rolesPermitidos) {
  const lista = Array.isArray(rolesPermitidos) ? rolesPermitidos : [rolesPermitidos];
  return (req, res, next) => {
    const raw = extrairToken(req);
    if (!raw) {
      return res.redirect(302, '/pages/login.html');
    }
    try {
      const payload = verifyToken(raw);
      const tenantOk = lista.includes('super_admin') || payload.tenantId;
      if (!lista.includes(payload.role) || !tenantOk) {
        return res.redirect(302, '/pages/login.html');
      }
      return next();
    } catch (_) {
      return res.redirect(302, '/pages/login.html');
    }
  };
}

function servirPaginaInterna(nomeArquivo) {
  const ROOT = path.join(__dirname, '..');
  return (_req, res) => {
    res.sendFile(path.join(ROOT, 'pages', nomeArquivo));
  };
}

module.exports = {
  authenticate,
  requireRoles,
  requireSuperAdmin,
  requireTenantMember,
  requireTenantAdmin,
  tenantIdAutenticado,
  requirePageRoles,
  servirPaginaInterna,
  unauthorized,
  forbidden
};
