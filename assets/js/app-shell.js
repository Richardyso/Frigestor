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

  async function renderHeader() {
    const u = window.AUTH?.usuarioAtual();
    if (!u || !document.querySelector('.app-header')) return;

    const nomeEl = document.getElementById('hdr-nome');
    const empresaEl = document.getElementById('hdr-empresa');
    const catEl = document.getElementById('hdr-categoria');

    if (nomeEl) nomeEl.textContent = (u.nome || '').split(' ')[0] || 'Usuario';
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
      empresaEl.textContent = t?.nome || u.tenantId;
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
