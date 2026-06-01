/**
 * lib/email.js — envio de e-mails transacionais (SMTP / Gmail)
 */

const nodemailer = require('nodemailer');
const { resolveSiteUrl, pageUrl } = require('./site-url');

function baseUrl() {
  return resolveSiteUrl();
}

function loginUrl() {
  return pageUrl('/pages/login.html');
}

function esqueciSenhaUrl() {
  return pageUrl('/pages/esqueci-senha.html');
}

function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || 'Usuario';
}

function getTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass }
  });
}

async function enviarEmail(destinatario, mail) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP nao configurado — e-mail nao enviado.');
    return { ok: false, motivo: 'smtp_nao_configurado' };
  }

  const from = process.env.SMTP_FROM || `"Frigestor" <${process.env.SMTP_USER}>`;

  try {
    await transporter.sendMail({
      from,
      to: destinatario,
      subject: mail.subject,
      text: mail.text,
      html: mail.html
    });
    return { ok: true };
  } catch (err) {
    console.error('[email] Falha ao enviar:', err.message);
    return { ok: false, motivo: err.message };
  }
}

function layoutEmail(conteudoHtml, urlLogin) {
  const fromName = process.env.SMTP_FROM_NAME || 'Frigestor';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Inter,Arial,sans-serif;color:#0a1626;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e0e6f0;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:32px 36px 24px;background:linear-gradient(155deg,#0e3d7a,#062038);">
              <a href="${urlLogin}" style="text-decoration:none;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.02em;">
                <span style="color:#52b8e8;">FRI</span>gestor
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 36px;font-size:16px;line-height:1.65;color:#243247;">
              ${conteudoHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 36px 32px;border-top:1px solid #e0e6f0;text-align:center;">
              <p style="margin:0;font-size:13px;color:#6c7e97;">Atenciosamente,<br/><strong style="color:#0a1626;">Equipe ${fromName}</strong></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function botaoLogin(urlLogin) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
    <tr>
      <td style="border-radius:8px;background:#1e5bb8;">
        <a href="${urlLogin}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-weight:700;text-decoration:none;font-size:15px;">Ir para o login</a>
      </td>
    </tr>
  </table>`;
}

function botaoRecuperacaoSenha(urlRecuperacao) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
    <tr>
      <td style="border-radius:8px;background:#1e5bb8;">
        <a href="${urlRecuperacao}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-weight:700;text-decoration:none;font-size:15px;">Redefinir minha senha</a>
      </td>
    </tr>
  </table>`;
}

function buildWelcomeEmail(nome) {
  const nomeCurto = primeiroNome(nome);
  const urlLogin = loginUrl();

  const texto = [
    `Ola, ${nomeCurto}!`,
    '',
    'Seja bem-vindo(a) ao Frigestor — plataforma de gestao de equipamentos, visitas tecnicas e QR Code.',
    '',
    'Recebemos seu cadastro com sucesso. No momento, seu acesso ainda nao esta liberado.',
    'O administrador da empresa em que voce trabalha precisa ativar seu perfil antes que voce possa entrar no sistema.',
    '',
    'Enquanto isso, aguarde a confirmacao. Ao tentar fazer login, voce vera o aviso "Cadastro nao ativado" ate que sua conta seja habilitada.',
    '',
    'Assim que sua conta for ativada, enviaremos outro e-mail e voce podera entrar em:',
    urlLogin,
    '',
    'Atenciosamente,',
    'Equipe Frigestor'
  ].join('\n');

  const html = layoutEmail(`
    <p style="margin:0 0 16px;">Ola, <strong>${nomeCurto}</strong>!</p>
    <p style="margin:0 0 16px;">Seja bem-vindo(a) ao <strong>Frigestor</strong> — plataforma de gestao de equipamentos, visitas tecnicas e QR Code.</p>
    <p style="margin:0 0 16px;">Recebemos seu cadastro com sucesso. No momento, seu acesso ainda <strong>nao esta liberado</strong>.</p>
    <p style="margin:0 0 16px;">O <strong>administrador da empresa</strong> em que voce trabalha precisa ativar seu perfil antes que voce possa entrar no sistema.</p>
    <p style="margin:0 0 8px;">Enquanto isso, aguarde a confirmacao. Ao tentar fazer login, voce vera o aviso <strong>Cadastro nao ativado</strong> ate que sua conta seja habilitada.</p>
    <p style="margin:0 0 16px;font-size:14px;color:#6c7e97;">Quando recebermos a liberacao, enviaremos outro e-mail avisando que ja pode acessar.</p>
    ${botaoLogin(urlLogin)}
    <p style="margin:0;font-size:14px;color:#6c7e97;">Duvidas? Responda este e-mail ou fale com o administrador da sua empresa.</p>
  `, urlLogin);

  return {
    subject: 'Bem-vindo ao Frigestor — aguardando ativacao do seu acesso',
    text: texto,
    html
  };
}

function buildActivationEmail(nome, opts = {}) {
  const nomeCurto = primeiroNome(nome);
  const urlLogin = loginUrl();
  const viaGoogle = opts.authGoogle === true;
  const instrucaoEntrada = viaGoogle
    ? 'Voce ja pode entrar na plataforma com o botao Continuar com Google (mesmo e-mail) ou definir uma senha em Esqueci minha senha.'
    : 'Voce ja pode entrar na plataforma com o e-mail e a senha que cadastrou.';

  const texto = [
    `Ola, ${nomeCurto}!`,
    '',
    'Seu cadastro no Frigestor foi ativado.',
    instrucaoEntrada,
    '',
    'Acesse o login em:',
    urlLogin,
    '',
    'Atenciosamente,',
    'Equipe Frigestor'
  ].join('\n');

  const html = layoutEmail(`
    <p style="margin:0 0 16px;">Ola, <strong>${nomeCurto}</strong>!</p>
    <p style="margin:0 0 16px;">Boas noticias: seu cadastro no <strong>Frigestor</strong> foi <strong>ativado</strong>.</p>
    <p style="margin:0 0 16px;">${instrucaoEntrada}</p>
    ${botaoLogin(urlLogin)}
    <p style="margin:0;font-size:14px;color:#6c7e97;">Se tiver qualquer dificuldade para acessar, fale com o administrador da sua empresa.</p>
  `, urlLogin);

  return {
    subject: 'Seu acesso ao Frigestor foi liberado',
    text: texto,
    html
  };
}

async function sendWelcomeEmail(destinatario, nome) {
  const mail = buildWelcomeEmail(nome);
  const result = await enviarEmail(destinatario, mail);
  if (result.ok) console.log(`[email] Boas-vindas enviado para ${destinatario}`);
  return result;
}

async function sendActivationEmail(destinatario, nome, opts) {
  const mail = buildActivationEmail(nome, opts);
  const result = await enviarEmail(destinatario, mail);
  if (result.ok) console.log(`[email] Ativacao enviada para ${destinatario}`);
  return result;
}

function buildPasswordResetEmail(nome, codigo) {
  const nomeCurto = primeiroNome(nome);
  const urlRecuperacao = esqueciSenhaUrl();

  const texto = [
    `Ola, ${nomeCurto}!`,
    '',
    'Recebemos uma solicitacao para redefinir a senha da sua conta no Frigestor.',
    '',
    `Seu codigo de verificacao e: ${codigo}`,
    '',
    'Este codigo expira em 15 minutos e so pode ser usado uma vez.',
    'Se voce nao solicitou a redefinicao, ignore este e-mail.',
    '',
    'Acesse a recuperacao de senha em:',
    urlRecuperacao,
    '',
    'Atenciosamente,',
    'Equipe Frigestor'
  ].join('\n');

  const html = layoutEmail(`
    <p style="margin:0 0 16px;">Ola, <strong>${nomeCurto}</strong>!</p>
    <p style="margin:0 0 16px;">Recebemos uma solicitacao para redefinir a senha da sua conta no <strong>Frigestor</strong>.</p>
    <p style="margin:0 0 8px;">Use o codigo abaixo na tela de recuperacao de senha:</p>
    <p style="margin:0 0 20px;text-align:center;">
      <span style="display:inline-block;padding:16px 28px;background:#f4f7fb;border:2px dashed #1e5bb8;border-radius:12px;font-size:32px;font-weight:800;letter-spacing:0.35em;color:#0e3d7a;">${codigo}</span>
    </p>
    <p style="margin:0 0 16px;font-size:14px;color:#6c7e97;">O codigo expira em <strong>15 minutos</strong>. Nao compartilhe com ninguem.</p>
    <p style="margin:0 0 16px;font-size:14px;color:#6c7e97;">Se voce nao solicitou esta alteracao, ignore este e-mail — sua senha permanece a mesma.</p>
    ${botaoRecuperacaoSenha(urlRecuperacao)}
  `, urlRecuperacao);

  return {
    subject: 'Codigo para redefinir sua senha — Frigestor',
    text: texto,
    html
  };
}

async function sendPasswordResetCodeEmail(destinatario, nome, codigo) {
  const mail = buildPasswordResetEmail(nome, codigo);
  const result = await enviarEmail(destinatario, mail);
  if (result.ok) console.log(`[email] Codigo de recuperacao enviado para ${destinatario}`);
  return result;
}

module.exports = {
  sendWelcomeEmail,
  sendActivationEmail,
  sendPasswordResetCodeEmail,
  loginUrl,
  baseUrl
};
