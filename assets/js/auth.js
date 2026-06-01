/**
 * auth.js — tela de login
 */

(function () {
  'use strict';

  const form     = document.getElementById('form-login');
  const inpEmail = document.getElementById('login-email');
  const inpSenha = document.getElementById('login-senha');
  const errEmail = document.getElementById('err-email');
  const errSenha = document.getElementById('err-senha');
  const errGeral = document.getElementById('err-geral');
  const btnEntrar= document.getElementById('btn-entrar');
  const alertPendente = document.getElementById('alert-pendente');
  const alertPendenteTexto = document.getElementById('alert-pendente-texto');

  if (!form) return;

  const sessaoExistente = window.AUTH.usuarioAtual();
  if (sessaoExistente) {
    redirecionarPorRole(sessaoExistente.role);
    return;
  }

  function limparErros() {
    errEmail.textContent = '';
    errSenha.textContent = '';
    errGeral.textContent = '';
    alertPendente?.classList.add('hidden');
  }

  function mostrarCadastroNaoAtivado(err) {
    const detalhe = err.data?.detalhe
      || 'Seu cadastro foi recebido, mas ainda aguarda liberacao pelo administrador da sua empresa.';
    if (alertPendente && alertPendenteTexto) {
      alertPendenteTexto.textContent = detalhe;
      alertPendente.classList.remove('hidden');
      alertPendente.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    errGeral.textContent = err.data?.error === 'Cadastro nao ativado'
      ? 'Cadastro não ativado.'
      : (err.data?.error || err.message || 'Cadastro não ativado.');
  }

  function validar(email, senha) {
    let ok = true;
    if (!email) { errEmail.textContent = 'Informe o e-mail.'; ok = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEmail.textContent = 'E-mail invalido.'; ok = false;
    }
    if (!senha) { errSenha.textContent = 'Informe a senha.'; ok = false; }
    else if (senha.length < 4) { errSenha.textContent = 'Senha muito curta.'; ok = false; }
    return ok;
  }

  function redirecionarPorRole(role) {
    if (role === 'super_admin') window.location.href = '/pages/admin.html';
    else if (role === 'admin') window.location.href = '/pages/admin-tenant.html';
    else window.location.href = '/pages/campo.html';
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErros();

    const email = inpEmail.value.trim();
    const senha = inpSenha.value;
    if (!validar(email, senha)) return;

    const finalizar = window.UI.botaoLoading(btnEntrar, 'Entrando...');

    try {
      const usuario = await window.AUTH.login(email, senha);
      redirecionarPorRole(usuario.role);
    } catch (err) {
      if (err.status === 403 && err.data?.codigo === 'CADASTRO_NAO_ATIVADO') {
        mostrarCadastroNaoAtivado(err);
      } else {
        errGeral.textContent = err.message || 'Falha no login.';
      }
      finalizar();
    }
  });

  [inpEmail, inpSenha].forEach((el) => {
    el.addEventListener('input', limparErros);
  });

  const btnGoogle = document.getElementById('btn-google');
  const googleHint = document.getElementById('google-hint');

  if (btnGoogle) {
    window.initApp().then(() => {
      if (!window.FIREBASE_AUTH_CLIENT?.isConfigured?.()) {
        btnGoogle.disabled = true;
        if (googleHint) {
          googleHint.textContent = 'Google: configure FIREBASE_API_KEY no .env e ative o provedor no Firebase.';
          googleHint.classList.remove('hidden');
        }
      }
    });

    btnGoogle.addEventListener('click', async () => {
      limparErros();
      const finalizar = window.UI.botaoLoading(btnGoogle, 'Conectando...');
      try {
        const usuario = await window.AUTH.loginGoogle();
        redirecionarPorRole(usuario.role);
      } catch (err) {
        if (err.status === 403 && err.data?.codigo === 'CADASTRO_NAO_ATIVADO') {
          mostrarCadastroNaoAtivado(err);
        } else if (err.code === 'auth/popup-closed-by-user') {
          /* cancelou popup */
        } else {
          errGeral.textContent = err.message || 'Falha no login com Google.';
        }
        finalizar();
      }
    });
  }
})();
