/**
 * esqueci-senha.js — recuperacao de senha em 3 etapas
 */

(function () {
  'use strict';

  const stepEmail = document.getElementById('step-email');
  const stepCodigo = document.getElementById('step-codigo');
  const stepSenha = document.getElementById('step-senha');
  const stepSucesso = document.getElementById('step-sucesso');

  const formEmail = document.getElementById('form-email');
  const formCodigo = document.getElementById('form-codigo');
  const formSenha = document.getElementById('form-senha');

  const inpEmail = document.getElementById('rec-email');
  const inpCodigo = document.getElementById('rec-codigo');
  const inpSenha = document.getElementById('rec-senha');
  const inpSenha2 = document.getElementById('rec-senha2');
  const emailLabel = document.getElementById('rec-email-label');
  const msgSucesso = document.getElementById('msg-sucesso');

  const btnEnviar = document.getElementById('btn-enviar-codigo');
  const btnVerificar = document.getElementById('btn-verificar-codigo');
  const btnSalvar = document.getElementById('btn-salvar-senha');
  const btnReenviar = document.getElementById('btn-reenviar');

  if (!formEmail) return;

  let emailAtual = '';
  let resetToken = '';

  function irParaEtapa(n) {
    [stepEmail, stepCodigo, stepSenha, stepSucesso].forEach((el) => el?.classList.add('hidden'));
    if (n === 1) stepEmail?.classList.remove('hidden');
    if (n === 2) stepCodigo?.classList.remove('hidden');
    if (n === 3) stepSenha?.classList.remove('hidden');
    if (n === 4) stepSucesso?.classList.remove('hidden');

    document.querySelectorAll('[data-step-dot]').forEach((dot) => {
      const num = Number(dot.getAttribute('data-step-dot'));
      dot.classList.toggle('is-active', num === n);
      dot.classList.toggle('is-done', num < n);
    });
  }

  function limparErros(ids) {
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
  }

  function validarEmail(email) {
    limparErros(['err-email', 'err-geral-1']);
    if (!email) {
      document.getElementById('err-email').textContent = 'Informe o e-mail.';
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('err-email').textContent = 'E-mail invalido.';
      return false;
    }
    return true;
  }

  async function enviarCodigo(email) {
    if (!validarEmail(email)) return false;
    const finalizar = window.UI.botaoLoading(btnEnviar, 'Enviando...');
    try {
      const res = await window.AUTH.esqueciSenha(email);
      emailAtual = email;
      if (emailLabel) emailLabel.textContent = email;
      window.UI.toast(res.mensagem || 'Codigo enviado. Verifique seu e-mail.', 'success');
      irParaEtapa(2);
      inpCodigo?.focus();
      return true;
    } catch (err) {
      document.getElementById('err-geral-1').textContent = err.message || 'Falha ao enviar codigo.';
      return false;
    } finally {
      finalizar();
    }
  }

  formEmail.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await enviarCodigo(inpEmail.value.trim());
  });

  btnReenviar?.addEventListener('click', async () => {
    limparErros(['err-codigo', 'err-geral-2']);
    if (!emailAtual) {
      irParaEtapa(1);
      return;
    }
    const finalizar = window.UI.botaoLoading(btnReenviar, 'Reenviando...');
    try {
      const res = await window.AUTH.esqueciSenha(emailAtual);
      window.UI.toast(res.mensagem || 'Novo codigo enviado.', 'success');
      inpCodigo.value = '';
      resetToken = '';
    } catch (err) {
      document.getElementById('err-geral-2').textContent = err.message || 'Falha ao reenviar.';
    } finally {
      finalizar();
    }
  });

  inpCodigo?.addEventListener('input', () => {
    inpCodigo.value = inpCodigo.value.replace(/\D/g, '').slice(0, 6);
    limparErros(['err-codigo', 'err-geral-2']);
  });

  formCodigo.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErros(['err-codigo', 'err-geral-2']);

    const codigo = inpCodigo.value.trim();
    if (!/^\d{6}$/.test(codigo)) {
      document.getElementById('err-codigo').textContent = 'Informe o codigo de 6 digitos.';
      return;
    }

    const finalizar = window.UI.botaoLoading(btnVerificar, 'Verificando...');
    try {
      const res = await window.AUTH.verificarCodigoRecuperacao(emailAtual, codigo);
      resetToken = res.resetToken;
      irParaEtapa(3);
      inpSenha?.focus();
    } catch (err) {
      document.getElementById('err-geral-2').textContent = err.message || 'Codigo invalido.';
    } finally {
      finalizar();
    }
  });

  formSenha.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErros(['err-senha', 'err-senha2', 'err-geral-3']);

    const senha = inpSenha.value;
    const senha2 = inpSenha2.value;
    let ok = true;

    if (!senha) {
      document.getElementById('err-senha').textContent = 'Informe a nova senha.';
      ok = false;
    } else if (senha.length < 6) {
      document.getElementById('err-senha').textContent = 'Minimo de 6 caracteres.';
      ok = false;
    }
    if (senha !== senha2) {
      document.getElementById('err-senha2').textContent = 'As senhas nao conferem.';
      ok = false;
    }
    if (!resetToken) {
      document.getElementById('err-geral-3').textContent = 'Sessao expirada. Volte e valide o codigo novamente.';
      ok = false;
    }
    if (!ok) return;

    const finalizar = window.UI.botaoLoading(btnSalvar, 'Salvando...');
    try {
      const res = await window.AUTH.redefinirSenha(emailAtual, resetToken, senha, senha2);
      if (msgSucesso) msgSucesso.textContent = res.mensagem || 'Senha alterada com sucesso.';
      irParaEtapa(4);
    } catch (err) {
      document.getElementById('err-geral-3').textContent = err.message || 'Falha ao salvar senha.';
    } finally {
      finalizar();
    }
  });

  irParaEtapa(1);
})();
