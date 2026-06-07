/**
 * admin.js — Painel supremo da plataforma Frigestor
 * Controle de tenants, usuarios, cadastros pendentes e visao operacional.
 */

(function () {
  'use strict';

  const usuario = window.AUTH.requireRole(['super_admin'], {
    exigeTenant: false,
    loginUrl: '/pages/login.html'
  });
  if (!usuario) return;

  let tenants = [];
  let usuariosTenant = [];
  let pendentes = [];
  let equipamentos = [];
  let visitas = [];
  let tenantSelecionado = '';
  let filtroOperacional = '';

  // -----------------------------------------------------------------------
  // Modais e tabs
  // -----------------------------------------------------------------------
  document.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => fecharModal(b.getAttribute('data-close')));
  });
  document.querySelectorAll('.modal-backdrop').forEach((bd) => {
    bd.addEventListener('click', (ev) => { if (ev.target === bd) fecharModal(bd.id); });
  });
  function abrirModal(id) { document.getElementById(id)?.classList.add('is-open'); }
  function fecharModal(id) { document.getElementById(id)?.classList.remove('is-open'); }

  document.querySelectorAll('.platform-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.platform-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
      document.querySelectorAll('.platform-panel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === tab));
      if (tab === 'operacional') carregarOperacional();
    });
  });

  document.querySelectorAll('.platform-subtab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sub = btn.dataset.subtab;
      document.querySelectorAll('.platform-subtab').forEach((b) => b.classList.toggle('is-active', b === btn));
      document.querySelectorAll('.platform-subpanel').forEach((p) => p.classList.toggle('is-active', p.dataset.subpanel === sub));
    });
  });

  document.getElementById('sel-operacional-tenant').addEventListener('change', (ev) => {
    filtroOperacional = ev.target.value;
    renderEquipamentos();
    renderVisitas();
  });

  // -----------------------------------------------------------------------
  // Carregar dados
  // -----------------------------------------------------------------------
  async function carregarTudo() {
    try {
      [tenants, pendentes] = await Promise.all([
        window.DB.plataforma.tenants.listar(),
        window.DB.plataforma.pendentes.listar()
      ]);
      if (!tenantSelecionado && tenants.length) tenantSelecionado = tenants[0].id;
      renderStats();
      renderTenants();
      renderTenantSelect();
      renderOperacionalSelect();
      if (tenantSelecionado) await carregarUsuarios(tenantSelecionado);
      renderPendentes();
    } catch (err) {
      window.UI.toast(`Erro: ${err.message}`, 'danger');
    }
  }

  function renderStats() {
    document.getElementById('stat-tenants').textContent = tenants.length;
    document.getElementById('stat-users').textContent = tenants.reduce((s, t) => s + (t.stats?.usuarios || 0), 0);
    document.getElementById('stat-equip').textContent = tenants.reduce((s, t) => s + (t.stats?.equipamentos || 0), 0);
    document.getElementById('stat-pending').textContent = pendentes.length;
  }

  // -----------------------------------------------------------------------
  // Empresas
  // -----------------------------------------------------------------------
  function renderTenants() {
    const grid = document.getElementById('tenant-grid');
    if (!tenants.length) {
      grid.innerHTML = '<div class="empty-state">Nenhuma empresa cadastrada. Clique em <strong>+ Nova empresa</strong> para comecar.</div>';
      return;
    }
    grid.innerHTML = tenants.map((t) => `
      <article class="tenant-card ${t.ativo === false ? 'is-inactive' : ''}" data-id="${UI.escapeHtml(t.id)}">
        <div class="tenant-card__head">
          <h3 class="tenant-card__name">${UI.escapeHtml(t.nome)}</h3>
          <span class="badge ${t.ativo !== false ? 'badge--success' : 'badge--muted'}">${t.ativo !== false ? 'Ativo' : 'Inativo'}</span>
        </div>
        <div class="tenant-card__meta">
          <span class="tenant-card__id">ID: ${UI.escapeHtml(t.id)}</span>
          ${t.responsavel ? `<span>Resp.: ${UI.escapeHtml(t.responsavel)}</span>` : ''}
          ${t.emailComercial ? `<span>${UI.escapeHtml(t.emailComercial)}</span>` : ''}
        </div>
        <div class="tenant-card__stats">
          <div class="tenant-card__stat"><strong>${t.stats?.usuarios || 0}</strong>usuarios</div>
          <div class="tenant-card__stat"><strong>${t.stats?.clientes || 0}</strong>clientes</div>
          <div class="tenant-card__stat"><strong>${t.stats?.equipamentos || 0}</strong>equip.</div>
          <div class="tenant-card__stat"><strong>${t.stats?.visitas || 0}</strong>visitas</div>
        </div>
        <div class="tenant-card__actions">
          <button class="btn btn--ghost btn--sm" data-a="users">Ver usuarios</button>
          <button class="btn btn--ghost btn--sm" data-a="edit">Editar dados</button>
          <button class="btn btn--ghost btn--sm" data-a="toggle">${t.ativo !== false ? 'Desativar' : 'Ativar'}</button>
        </div>
      </article>
    `).join('');

    grid.querySelectorAll('.tenant-card').forEach((card) => {
      const id = card.dataset.id;
      card.querySelector('[data-a="users"]').addEventListener('click', () => {
        tenantSelecionado = id;
        document.getElementById('sel-tenant').value = id;
        document.querySelector('[data-tab="usuarios"]').click();
        carregarUsuarios(id);
      });
      card.querySelector('[data-a="edit"]').addEventListener('click', () => abrirEditarTenant(id));
      card.querySelector('[data-a="toggle"]').addEventListener('click', () => alternarTenant(id));
    });
  }

  async function alternarTenant(id) {
    const t = tenants.find((x) => x.id === id);
    if (!t) return;
    try {
      await window.DB.plataforma.tenants.atualizar(id, { ativo: t.ativo === false });
      window.UI.toast(`Empresa ${t.ativo === false ? 'ativada' : 'desativada'}.`, 'success');
      await carregarTudo();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    }
  }

  // -----------------------------------------------------------------------
  // Nova empresa
  // -----------------------------------------------------------------------
  function slugifyTenantId(str) {
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'empresa';
  }

  let idTenantManual = false;
  const inpNome = document.getElementById('tenant-nome');
  const inpId = document.getElementById('tenant-id');
  const idPreview = document.getElementById('tenant-id-preview');

  function atualizarPreviewId() {
    if (idTenantManual) return;
    const slug = slugifyTenantId(inpNome?.value || '');
    if (inpId) inpId.value = slug;
    if (idPreview) {
      idPreview.textContent = slug
        ? `Firestore · /api/tenants/${slug}`
        : 'Gerado automaticamente a partir do nome.';
    }
  }

  inpNome?.addEventListener('input', atualizarPreviewId);
  inpId?.addEventListener('input', () => {
    idTenantManual = true;
    if (idPreview && inpId.value) {
      idPreview.textContent = `Firestore · /api/tenants/${inpId.value}`;
    }
  });

  document.getElementById('btn-nova-empresa').addEventListener('click', () => {
    document.getElementById('form-tenant').reset();
    idTenantManual = false;
    atualizarPreviewId();
    abrirModal('modal-tenant');
  });

  document.getElementById('form-tenant').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const payload = {
      nome: document.getElementById('tenant-nome').value.trim(),
      id: document.getElementById('tenant-id').value.trim(),
      brandSubtitulo: document.getElementById('tenant-brand-sub').value.trim(),
      responsavel: document.getElementById('tenant-responsavel').value.trim(),
      telefoneComercial: document.getElementById('tenant-telefone').value.trim(),
      emailComercial: document.getElementById('tenant-email').value.trim(),
      cnpj: document.getElementById('tenant-cnpj').value.trim(),
      adminNome: document.getElementById('tenant-admin-nome').value.trim(),
      adminEmail: document.getElementById('tenant-admin-email').value.trim(),
      adminSenha: document.getElementById('tenant-admin-senha').value
    };

    if (!payload.nome) {
      window.UI.toast('Informe o nome da empresa.', 'danger');
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(payload.id)) {
      window.UI.toast('ID invalido. Use letras minusculas, numeros e hifens.', 'danger');
      return;
    }

    const btn = document.getElementById('btn-salvar-tenant');
    const fim = window.UI.botaoLoading(btn, 'Criando...');
    try {
      const resultado = await window.DB.plataforma.tenants.criar(payload);
      window.UI.toast(`Empresa "${resultado.tenant.nome}" criada com sucesso!`, 'success');
      fecharModal('modal-tenant');
      tenantSelecionado = resultado.tenant.id;
      await carregarTudo();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    } finally {
      fim();
    }
  });

  function listaParaTextarea(arr) {
    return Array.isArray(arr) ? arr.join('\n') : '';
  }

  function textareaParaLista(val) {
    return String(val || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  }

  async function abrirEditarTenant(id) {
    try {
      const t = await window.DB.plataforma.tenants.buscar(id);
      document.getElementById('edit-tenant-id').value = t.id;
      document.getElementById('edit-tenant-id-display').textContent = t.id;
      document.getElementById('edit-tenant-nome').value = t.nome || '';
      document.getElementById('edit-tenant-responsavel').value = t.responsavel || '';
      document.getElementById('edit-tenant-telefone').value = t.telefoneComercial || '';
      document.getElementById('edit-tenant-email').value = t.emailComercial || '';
      document.getElementById('edit-tenant-cnpj').value = t.cnpj || '';
      document.getElementById('edit-tenant-contrato').value = t.contratoDesde || '';
      document.getElementById('edit-tenant-ativo').checked = t.ativo !== false;
      document.getElementById('edit-tenant-brand-sub').value = t.brandSubtitulo || '';
      document.getElementById('edit-tenant-usa-spec').checked = t.usaEspecificacoesAr !== false;
      document.getElementById('edit-tenant-tipos-equip').value = listaParaTextarea(t.equipamentoTipos);
      document.getElementById('edit-tenant-tipos-visita').value = listaParaTextarea(t.visitaTipos);
      document.getElementById('modal-tenant-edit-title').textContent = `Editar — ${t.nome}`;

      const statsEl = document.getElementById('edit-tenant-stats');
      if (statsEl) {
        const s = t.stats || {};
        statsEl.innerHTML = `
          <div class="tenant-edit-stats__grid">
            <div><strong>${s.usuarios || 0}</strong><span>Usuarios</span></div>
            <div><strong>${s.clientes || 0}</strong><span>Clientes</span></div>
            <div><strong>${s.equipamentos || 0}</strong><span>Equipamentos</span></div>
            <div><strong>${s.visitas || 0}</strong><span>Visitas</span></div>
          </div>
        `;
      }
      abrirModal('modal-tenant-edit');
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    }
  }

  document.getElementById('form-tenant-edit').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = document.getElementById('edit-tenant-id').value;
    const payload = {
      nome: document.getElementById('edit-tenant-nome').value.trim(),
      responsavel: document.getElementById('edit-tenant-responsavel').value.trim(),
      telefoneComercial: document.getElementById('edit-tenant-telefone').value.trim(),
      emailComercial: document.getElementById('edit-tenant-email').value.trim(),
      cnpj: document.getElementById('edit-tenant-cnpj').value.trim(),
      contratoDesde: document.getElementById('edit-tenant-contrato').value,
      ativo: document.getElementById('edit-tenant-ativo').checked,
      brandSubtitulo: document.getElementById('edit-tenant-brand-sub').value.trim(),
      usaEspecificacoesAr: document.getElementById('edit-tenant-usa-spec').checked,
      equipamentoTipos: textareaParaLista(document.getElementById('edit-tenant-tipos-equip').value),
      visitaTipos: textareaParaLista(document.getElementById('edit-tenant-tipos-visita').value)
    };
    if (!payload.nome || !payload.responsavel || !payload.telefoneComercial || !payload.emailComercial) {
      window.UI.toast('Preencha nome, responsavel, telefone e e-mail comercial.', 'danger');
      return;
    }
    const btn = document.getElementById('btn-salvar-tenant-edit');
    const fim = window.UI.botaoLoading(btn, 'Salvando...');
    try {
      await window.DB.plataforma.tenants.atualizar(id, payload);
      window.UI.toast('Dados da empresa atualizados.', 'success');
      fecharModal('modal-tenant-edit');
      await carregarTudo();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    } finally {
      fim();
    }
  });

  document.getElementById('btn-excluir-tenant')?.addEventListener('click', async () => {
    const id = document.getElementById('edit-tenant-id').value;
    const nome = document.getElementById('edit-tenant-nome').value.trim();
    if (!id) return;
    const msg = `ATENCAO: excluir "${nome}" apaga PERMANENTEMENTE no Firestore:\n` +
      '- todos os usuarios\n- clientes\n- equipamentos\n- visitas\n- configuracoes\n\n' +
      `Digite o ID da empresa para confirmar:\n${id}`;
    const confirmacao = prompt(msg);
    if (confirmacao !== id) {
      if (confirmacao !== null) window.UI.toast('Exclusao cancelada — ID nao confere.', 'warning');
      return;
    }
    const btn = document.getElementById('btn-excluir-tenant');
    const fim = window.UI.botaoLoading(btn, 'Excluindo...');
    try {
      await window.DB.plataforma.tenants.excluir(id);
      window.UI.toast('Empresa excluida permanentemente.', 'success');
      fecharModal('modal-tenant-edit');
      if (tenantSelecionado === id) tenantSelecionado = '';
      await carregarTudo();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    } finally {
      fim();
    }
  });

  // -----------------------------------------------------------------------
  // Usuarios
  // -----------------------------------------------------------------------
  function renderTenantSelect() {
    const sel = document.getElementById('sel-tenant');
    sel.innerHTML = tenants.map((t) =>
      `<option value="${UI.escapeHtml(t.id)}" ${t.id === tenantSelecionado ? 'selected' : ''}>${UI.escapeHtml(t.nome)}</option>`
    ).join('');
  }

  selTenantChange();
  function selTenantChange() {
    document.getElementById('sel-tenant').addEventListener('change', async (ev) => {
      tenantSelecionado = ev.target.value;
      await carregarUsuarios(tenantSelecionado);
    });
  }

  async function carregarUsuarios(tenantId) {
    if (!tenantId) return;
    try {
      usuariosTenant = await window.DB.plataforma.usuarios.listar(tenantId);
      renderUsuarios();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    }
  }

  function renderUsuarios() {
    const tbody = document.getElementById('tbl-users');
    if (!usuariosTenant.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Nenhum usuario nesta empresa.</td></tr>';
      return;
    }
    tbody.innerHTML = usuariosTenant.map((u) => `
      <tr data-uid="${UI.escapeHtml(u.uid)}">
        <td data-label="Nome"><strong>${UI.escapeHtml(u.nome)}</strong></td>
        <td data-label="E-mail">${UI.escapeHtml(u.email)}</td>
        <td data-label="Perfil">
          <select class="form-control form-control--sm user-role">
            <option value="tecnico" ${u.role === 'tecnico' ? 'selected' : ''}>Tecnico</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin empresa</option>
          </select>
        </td>
        <td data-label="Status">
          <span class="badge ${u.ativo ? 'badge--success' : 'badge--muted'}">${u.ativo ? 'Ativo' : 'Inativo'}</span>
        </td>
        <td data-label="Acoes">
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn--accent btn--sm btn--icon" data-a="save" title="Salvar perfil">Salvar</button>
            <button class="btn btn--ghost btn--sm" data-a="toggle">${u.ativo ? 'Desativar' : 'Ativar'}</button>
            <button class="btn btn--danger btn--sm" data-a="delete">Excluir</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr').forEach((tr) => {
      const uid = tr.dataset.uid;
      tr.querySelector('[data-a="save"]').addEventListener('click', () => salvarUsuario(uid, tr));
      tr.querySelector('[data-a="toggle"]').addEventListener('click', () => toggleUsuario(uid));
      tr.querySelector('[data-a="delete"]').addEventListener('click', () => excluirUsuario(uid));
    });
  }

  async function salvarUsuario(uid, tr) {
    const role = tr.querySelector('.user-role').value;
    try {
      await window.DB.plataforma.usuarios.atualizar(tenantSelecionado, uid, { role });
      window.UI.toast('Perfil atualizado!', 'success');
      await carregarTudo();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    }
  }

  async function toggleUsuario(uid) {
    const u = usuariosTenant.find((x) => x.uid === uid);
    if (!u) return;
    try {
      await window.DB.plataforma.usuarios.atualizar(tenantSelecionado, uid, { ativo: !u.ativo });
      window.UI.toast(`Usuario ${!u.ativo ? 'ativado' : 'desativado'}.`, 'success');
      await carregarUsuarios(tenantSelecionado);
      await carregarTudo();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    }
  }

  async function excluirUsuario(uid) {
    const u = usuariosTenant.find((x) => x.uid === uid);
    if (!u || !confirm(`Excluir "${u.nome}" da empresa?`)) return;
    try {
      await window.DB.plataforma.usuarios.excluir(tenantSelecionado, uid);
      window.UI.toast('Usuario excluido.', 'success');
      await carregarTudo();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    }
  }

  document.getElementById('btn-novo-user').addEventListener('click', () => {
    document.getElementById('form-user').reset();
    document.getElementById('modal-user-title').textContent = `Novo usuario — ${tenantSelecionado}`;
    abrirModal('modal-user');
  });

  document.getElementById('form-user').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = document.getElementById('user-nome').value.trim();
    const email = document.getElementById('user-email').value.trim();
    const senha = document.getElementById('user-senha').value;
    const role = document.getElementById('user-role').value;
    if (!nome || !email || !senha) {
      window.UI.toast('Preencha nome, e-mail e senha.', 'danger');
      return;
    }
    const btn = document.getElementById('btn-salvar-user');
    const fim = window.UI.botaoLoading(btn, 'Salvando...');
    try {
      await window.DB.plataforma.usuarios.criar(tenantSelecionado, { nome, email, senha, role });
      window.UI.toast('Usuario criado!', 'success');
      fecharModal('modal-user');
      await carregarTudo();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    } finally {
      fim();
    }
  });

  // -----------------------------------------------------------------------
  // Pendentes
  // -----------------------------------------------------------------------
  function renderPendentes() {
    const el = document.getElementById('pending-list');
    if (!pendentes.length) {
      el.innerHTML = '<div class="empty-state">Nenhum cadastro aguardando aprovacao.</div>';
      return;
    }
    const opts = tenants.filter((t) => t.ativo !== false).map((t) =>
      `<option value="${UI.escapeHtml(t.id)}">${UI.escapeHtml(t.nome)}</option>`
    ).join('');

    el.innerHTML = pendentes.map((p) => `
      <div class="pending-card" data-uid="${UI.escapeHtml(p.uid)}">
        <div class="pending-card__info">
          <strong>${UI.escapeHtml(p.nome)}</strong>
          <span>${UI.escapeHtml(p.email)}${p.authGoogle ? ' · Google' : ''} · cadastro em ${UI.formatarData(p.criadoEm)}</span>
        </div>
        <div class="pending-card__actions">
          <div class="form-group">
            <label class="form-label">Empresa</label>
            <select class="form-control pending-tenant">${opts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Perfil</label>
            <select class="form-control pending-role">
              <option value="tecnico">Tecnico</option>
              <option value="admin">Admin empresa</option>
            </select>
          </div>
          <button class="btn btn--accent btn--sm" data-a="approve">Aprovar</button>
          <button class="btn btn--ghost btn--sm" data-a="reject">Rejeitar</button>
        </div>
      </div>
    `).join('');

    el.querySelectorAll('.pending-card').forEach((card) => {
      const uid = card.dataset.uid;
      card.querySelector('[data-a="approve"]').addEventListener('click', () => {
        const tenantId = card.querySelector('.pending-tenant').value;
        const role = card.querySelector('.pending-role').value;
        aprovarPendente(uid, tenantId, role);
      });
      card.querySelector('[data-a="reject"]').addEventListener('click', () => rejeitarPendente(uid));
    });
  }

  async function aprovarPendente(uid, tenantId, role) {
    try {
      await window.DB.plataforma.pendentes.processar(uid, { acao: 'aprovar', tenantId, role });
      window.UI.toast('Cadastro aprovado!', 'success');
      await carregarTudo();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    }
  }

  async function rejeitarPendente(uid) {
    if (!confirm('Rejeitar este cadastro?')) return;
    try {
      await window.DB.plataforma.pendentes.processar(uid, { acao: 'rejeitar' });
      window.UI.toast('Cadastro rejeitado.', 'success');
      await carregarTudo();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    }
  }

  // -----------------------------------------------------------------------
  // Equipamentos e visitas (visao global)
  // -----------------------------------------------------------------------
  function renderOperacionalSelect() {
    const sel = document.getElementById('sel-operacional-tenant');
    if (!sel) return;
    const atual = filtroOperacional;
    sel.innerHTML = `<option value="">Todas as empresas</option>${tenants.map((t) =>
      `<option value="${UI.escapeHtml(t.id)}" ${t.id === atual ? 'selected' : ''}>${UI.escapeHtml(t.nome)}</option>`
    ).join('')}`;
  }

  async function carregarOperacional() {
    try {
      [equipamentos, visitas] = await Promise.all([
        window.DB.plataforma.equipamentos.listar(),
        window.DB.plataforma.visitas.listar()
      ]);
      renderEquipamentos();
      renderVisitas();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    }
  }

  function filtrarPorTenant(lista) {
    if (!filtroOperacional) return lista;
    return lista.filter((item) => item.tenantId === filtroOperacional);
  }

  function renderEquipamentos() {
    const tbody = document.getElementById('tbl-equipamentos');
    if (!tbody) return;
    const lista = filtrarPorTenant(equipamentos);
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Nenhum equipamento encontrado.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map((e) => `
      <tr>
        <td data-label="Empresa">${UI.escapeHtml(e.tenantNome || e.tenantId)}</td>
        <td data-label="Equipamento"><strong>${UI.escapeHtml(e.nomeModelo || '—')}</strong></td>
        <td data-label="Tipo">${UI.escapeHtml(e.tipoEquipamento || '—')}</td>
        <td data-label="Cliente">${UI.escapeHtml(e.clienteEmpresa || '—')}</td>
        <td data-label="Local">${UI.escapeHtml(e.localizacaoSetor || '—')}</td>
        <td data-label="Tecnico">${UI.escapeHtml(e.tecnicoResponsavelNome || '—')}</td>
        <td data-label="Instalado">${UI.formatarData(e.dataInstalacao || e.criadoEm)}</td>
      </tr>
    `).join('');
  }

  function renderVisitas() {
    const tbody = document.getElementById('tbl-visitas');
    if (!tbody) return;
    const lista = filtrarPorTenant(visitas);
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Nenhuma visita registrada.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map((v) => `
      <tr>
        <td data-label="Empresa">${UI.escapeHtml(v.tenantNome || v.tenantId)}</td>
        <td data-label="Equipamento"><strong>${UI.escapeHtml(v.equipamentoNome || v.equipamentoId)}</strong></td>
        <td data-label="Data">${UI.formatarData(v.dataVisita)}</td>
        <td data-label="Servico">${UI.escapeHtml(v.tipoServico || '—')}</td>
        <td data-label="Tecnico">${UI.escapeHtml(v.tecnicoNome || '—')}</td>
        <td data-label="Descricao">${UI.escapeHtml(v.descricaoServico || '—')}</td>
      </tr>
    `).join('');
  }

  (async function boot() {
    if (typeof window.initApp === 'function') await window.initApp();
    await carregarTudo();
  })();
})();
