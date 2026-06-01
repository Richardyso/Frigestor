/**
 * lib/password-reset.js — codigos e tokens de recuperacao de senha
 */

const crypto = require('crypto');
const { hashSenha, verificarSenha } = require('./password');

const ARQUIVO = 'plataforma/recuperacao-senha.json';
const CODIGO_TTL_MS = 15 * 60 * 1000;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS = 5;

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function lerResets(lerJson) {
  try {
    return await lerJson(ARQUIVO);
  } catch (_) {
    return [];
  }
}

async function salvarResets(escreverJson, lista) {
  await escreverJson(ARQUIVO, lista);
}

function gerarCodigo6() {
  return String(crypto.randomInt(100000, 1000000));
}

function gerarResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function resetAtivo(registro) {
  if (!registro) return false;
  return new Date(registro.expiraEm).getTime() > Date.now();
}

function tokenAtivo(registro) {
  if (!registro?.codigoVerificado || !registro.resetToken || !registro.tokenExpiraEm) return false;
  return new Date(registro.tokenExpiraEm).getTime() > Date.now();
}

async function buscarResetPorEmail(lerJson, email) {
  const emailNorm = normalizarEmail(email);
  const lista = await lerResets(lerJson);
  return lista.find((r) => r.email === emailNorm && resetAtivo(r)) || null;
}

async function buscarResetPorToken(lerJson, email, resetToken) {
  const emailNorm = normalizarEmail(email);
  const token = String(resetToken || '').trim();
  const lista = await lerResets(lerJson);
  return lista.find((r) =>
    r.email === emailNorm
    && r.resetToken === token
    && r.codigoVerificado
    && tokenAtivo(r)
  ) || null;
}

/** Cria solicitacao nova (invalida anteriores do mesmo e-mail). Retorna codigo em texto puro. */
async function criarSolicitacao(lerJson, escreverJson, email) {
  const emailNorm = normalizarEmail(email);
  const codigo = gerarCodigo6();
  const codigoHash = await hashSenha(codigo);
  const agora = Date.now();

  let lista = await lerResets(lerJson);
  lista = lista.filter((r) => r.email !== emailNorm);

  lista.push({
    id: `pwd-${crypto.randomBytes(4).toString('hex')}`,
    email: emailNorm,
    codigoHash,
    resetToken: null,
    codigoVerificado: false,
    tentativas: 0,
    expiraEm: new Date(agora + CODIGO_TTL_MS).toISOString(),
    tokenExpiraEm: null,
    criadoEm: new Date(agora).toISOString()
  });

  await salvarResets(escreverJson, lista);
  return codigo;
}

async function verificarCodigo(lerJson, escreverJson, email, codigoInformado) {
  const emailNorm = normalizarEmail(email);
  const codigo = String(codigoInformado || '').trim();
  if (!/^\d{6}$/.test(codigo)) {
    const err = new Error('Informe o codigo de 6 digitos.');
    err.status = 400;
    throw err;
  }

  const lista = await lerResets(lerJson);
  const idx = lista.findIndex((r) => r.email === emailNorm && resetAtivo(r));
  if (idx === -1) {
    const err = new Error('Codigo expirado ou invalido. Solicite um novo codigo.');
    err.status = 400;
    throw err;
  }

  const registro = lista[idx];
  registro.tentativas = (registro.tentativas || 0) + 1;

  if (registro.tentativas > MAX_TENTATIVAS) {
    lista.splice(idx, 1);
    await salvarResets(escreverJson, lista);
    const err = new Error('Numero maximo de tentativas excedido. Solicite um novo codigo.');
    err.status = 429;
    throw err;
  }

  const codigoOk = await verificarSenha(codigo, registro.codigoHash);
  if (!codigoOk) {
    await salvarResets(escreverJson, lista);
    const err = new Error('Codigo incorreto.');
    err.status = 400;
    throw err;
  }

  const resetToken = gerarResetToken();
  registro.codigoVerificado = true;
  registro.resetToken = resetToken;
  registro.tokenExpiraEm = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  lista[idx] = registro;
  await salvarResets(escreverJson, lista);

  return resetToken;
}

async function consumirReset(lerJson, escreverJson, email, resetToken) {
  const emailNorm = normalizarEmail(email);
  const token = String(resetToken || '').trim();
  let lista = await lerResets(lerJson);
  const antes = lista.length;
  lista = lista.filter((r) => !(r.email === emailNorm && r.resetToken === token));
  if (lista.length === antes) {
    const err = new Error('Sessao de redefinicao expirada. Comece novamente.');
    err.status = 400;
    throw err;
  }
  await salvarResets(escreverJson, lista);
}

module.exports = {
  criarSolicitacao,
  verificarCodigo,
  consumirReset,
  buscarResetPorToken,
  normalizarEmail
};
