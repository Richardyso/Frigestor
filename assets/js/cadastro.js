/**
 * cadastro.js — formulario de criacao de conta
 */

(function () {
  'use strict';

  const form      = document.getElementById('form-cadastro');
  const inpNome   = document.getElementById('cad-nome');
  const inpEmail  = document.getElementById('cad-email');
  const inpSenha  = document.getElementById('cad-senha');
  const inpSenha2 = document.getElementById('cad-senha2');
  const errNome   = document.getElementById('err-nome');
  const errEmail  = document.getElementById('err-email');
  const errSenha  = document.getElementById('err-senha');
  const errSenha2 = document.getElementById('err-senha2');
  const errGeral  = document.getElementById('err-geral');
  const msgSucessoTexto = document.getElementById('msg-sucesso-texto');
  const btnCad    = document.getElementById('btn-cadastrar');
  const btnGoogle = document.getElementById('btn-google');
  const googleHint = document.getElementById('google-hint');
  const blocoIntro = document.getElementById('cadastro-intro');
  const blocoForm = document.getElementById('cadastro-formulario');
  const blocoSucesso = document.getElementById('cadastro-sucesso');

  if (!form) return;

  if (window.AUTH.usuarioAtual()) {
    window.location.replace('/pages/login.html');
    return;
  }

  function limparErros() {
    errNome.textContent = '';
    errEmail.textContent = '';
    errSenha.textContent = '';
    errSenha2.textContent = '';
    errGeral.textContent = '';
  }

  function validar(nome, email, senha, senha2) {
    let ok = true;
    if (!nome || nome.length < 2) {
      errNome.textContent = 'Informe seu nome completo.';
      ok = false;
    }
    if (!email) {
      errEmail.textContent = 'Informe o e-mail.';
      ok = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEmail.textContent = 'E-mail invalido.';
      ok = false;
    }
    if (!senha) {
      errSenha.textContent = 'Informe a senha.';
      ok = false;
    } else if (senha.length < 6) {
      errSenha.textContent = 'Minimo de 6 caracteres.';
      ok = false;
    }
    if (senha !== senha2) {
      errSenha2.textContent = 'As senhas nao conferem.';
      ok = false;
    }
    return ok;
  }

  function mostrarSucesso(res, email) {
    blocoIntro?.classList.add('hidden');
    blocoForm?.classList.add('hidden');
    blocoSucesso?.classList.remove('hidden');

    const texto = res.emailEnviado
      ? `Enviamos um e-mail de boas-vindas para ${email}. Aguarde seu administrador aprovar seu cadastro antes de entrar no sistema.`
      : (res.mensagem || res.detalhe || 'Cadastro recebido. Aguarde seu administrador aprovar seu cadastro antes de entrar no sistema.');

    if (msgSucessoTexto) msgSucessoTexto.textContent = texto;
    document.title = 'Cadastro recebido | Frigestor';
    blocoSucesso?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

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
        const res = await window.AUTH.cadastroGoogle();
        mostrarSucesso(res, res.email);
      } catch (err) {
        if (err.status === 403 && err.data?.codigo === 'CADASTRO_NAO_ATIVADO') {
          mostrarSucesso(
            { emailEnviado: false, detalhe: err.data.detalhe },
            err.data?.email || 'seu e-mail'
          );
        } else if (err.status === 409) {
          errGeral.textContent = `${err.message} Use a pagina de login se ja foi aprovado.`;
          finalizar();
        } else if (err.code === 'auth/popup-closed-by-user') {
          finalizar();
        } else {
          errGeral.textContent = err.message || 'Falha no cadastro com Google.';
          finalizar();
        }
      }
    });
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErros();

    const nome = inpNome.value.trim();
    const email = inpEmail.value.trim();
    const senha = inpSenha.value;
    const senha2 = inpSenha2.value;
    if (!validar(nome, email, senha, senha2)) return;

    const finalizar = window.UI.botaoLoading(btnCad, 'Enviando...');

    try {
      const res = await window.AUTH.cadastro(nome, email, senha);
      mostrarSucesso(res, email);
    } catch (err) {
      if (err.status === 403 && err.data?.codigo === 'CADASTRO_NAO_ATIVADO') {
        mostrarSucesso({ emailEnviado: false, detalhe: err.data.detalhe }, email);
      } else {
        errGeral.textContent = err.message || 'Falha ao cadastrar.';
        finalizar();
      }
    }
  });

  [inpNome, inpEmail, inpSenha, inpSenha2].forEach((el) => {
    el.addEventListener('input', limparErros);
  });
})();
