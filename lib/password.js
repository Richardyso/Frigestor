/**
 * lib/password.js — hash e verificacao de senhas (bcrypt)
 */

const bcrypt = require('bcrypt');

const ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

function isSenhaHasheada(valor) {
  return typeof valor === 'string' && /^\$2[aby]\$\d{2}\$/.test(valor);
}

async function hashSenha(senhaPlana) {
  return bcrypt.hash(String(senhaPlana), ROUNDS);
}

/** Grava hash bcrypt; se ja estiver hasheada, mantem. */
async function hashSenhaSeNecessario(valor) {
  const s = String(valor);
  if (isSenhaHasheada(s)) return s;
  return hashSenha(s);
}

async function verificarSenha(senhaPlana, armazenada) {
  if (!armazenada) return false;
  if (isSenhaHasheada(armazenada)) {
    return bcrypt.compare(String(senhaPlana), armazenada);
  }
  // Legado (texto puro) — compativel ate migracao
  return String(senhaPlana) === String(armazenada);
}

module.exports = {
  hashSenha,
  hashSenhaSeNecessario,
  verificarSenha,
  isSenhaHasheada
};
