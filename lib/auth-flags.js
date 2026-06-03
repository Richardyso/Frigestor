/**
 * Flags de autenticacao publica (servidor).
 * Padrao: tudo desligado — UI pode estar comentada, mas a API tambem recusa (F12 nao adianta).
 *
 * Para reativar Google OAuth:
 *   Vercel → Environment Variables → ENABLE_GOOGLE_OAUTH=true
 *   + descomentar bloco GOOGLE OAUTH em pages/login.html e pages/cadastro.html
 *   + descomentar scripts Firebase no final desses HTML
 *
 * Para reativar cadastro publico por e-mail:
 *   ENABLE_PUBLIC_SIGNUP=true
 */

function flagAtiva(nome) {
  const v = String(process.env[nome] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function googleOAuthHabilitado() {
  return flagAtiva('ENABLE_GOOGLE_OAUTH');
}

function cadastroPublicoHabilitado() {
  return flagAtiva('ENABLE_PUBLIC_SIGNUP');
}

module.exports = {
  googleOAuthHabilitado,
  cadastroPublicoHabilitado
};
