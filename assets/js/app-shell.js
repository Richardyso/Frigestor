/**
 * app-shell.js
 * Header das paginas internas (logo + empresa + categoria + usuario).
 */
(function () {
  'use strict';

  function labelRole(role) {
    if (role === 'admin') return 'Admin';
    if (role === 'tecnico') return 'Tecnico';
    if (role === 'super_admin') return 'Admin plataforma';
    return role || '';
  }

  /** Formata nome para exibicao (Carlos Antônio dos santos). */
  function formatarNomeExibicao(nome) {
    const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return 'Usuario';
    const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
    return partes.map((parte, i) => {
      const lower = parte.toLocaleLowerCase('pt-BR');
      if (i > 0 && minusculas.has(lower)) return lower;
      return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
    }).join(' ');
  }

  async function renderHeader() {
    const u = window.AUTH?.usuarioAtual();
    if (!u || !document.querySelector('.app-header')) return;

    const nomeEl = document.getElementById('hdr-nome');
    const empresaEl = document.getElementById('hdr-empresa');
    const catEl = document.getElementById('hdr-categoria');

    if (nomeEl) nomeEl.textContent = formatarNomeExibicao(u.nome);
    if (catEl) catEl.textContent = labelRole(u.role);

    if (!empresaEl) return;

    if (u.role === 'super_admin') {
      empresaEl.textContent = 'Frigestor';
      return;
    }

    if (u.tenantId) {
      if (!window.TENANT.atual || window.TENANT.id() !== u.tenantId) {
        await window.TENANT.carregar(u.tenantId);
      }
      const t = window.TENANT.atual;
      empresaEl.textContent = t?.nome || 'Empresa';
    } else {
      empresaEl.textContent = '—';
    }
  }

  window.APP_SHELL = {
    renderHeader,
    async boot() {
      await renderHeader();
    }
  };
})();
