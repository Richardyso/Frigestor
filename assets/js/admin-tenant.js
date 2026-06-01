/**
 * admin-tenant.js
 * --------------------------------------------------------------------------
 * Dashboard administrativo da empresa (tenant):
 *   - Estatisticas rapidas
 *   - Gestao de tecnicos (criar, ativar/desativar)
 *   - Tabela de equipamentos com filtros (cliente, tipo, tecnico, datas)
 *   - Edicao (sem dataInstalacao), exclusao, QR e historico de cada equipamento
 *   - Aba "Historico global" com todas as visitas
 */

(function () {
  'use strict';

  let usuario = window.AUTH.requireRole(['admin']);
  if (!usuario) return;

  // Re-sincroniza com /api/usuarios para refletir mudancas no JSON sem precisar relogar
  window.AUTH.resincronizar().then((u) => {
    if (u) {
      usuario = u;
      window.APP_SHELL?.renderHeader();
    }
  });

  // -----------------------------------------------------------------------
  // Estado
  // -----------------------------------------------------------------------
  let equipamentos = [];
  let usuarios     = [];
  let visitas      = [];
  let clientes     = [];

  // -----------------------------------------------------------------------
  // Modais
  // -----------------------------------------------------------------------
  document.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => fecharModal(b.getAttribute('data-close')));
  });
  document.querySelectorAll('.modal-backdrop').forEach((bd) => {
    bd.addEventListener('click', (ev) => { if (ev.target === bd) fecharModal(bd.id); });
  });
  function abrirModal(id)  { document.getElementById(id)?.classList.add('is-open'); }
  function fecharModal(id) { document.getElementById(id)?.classList.remove('is-open'); }

  function preencherTiposEquipamento(selectId, valorAtual) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const tipos = window.TENANT?.atual?.equipamentoTipos || [
      'Split', 'Janela', 'Ar condicionado de teto', 'Chiller', 'VRF'
    ];
    sel.innerHTML = tipos.map((t) =>
      `<option value="${UI.escapeHtml(t)}"${t === valorAtual ? ' selected' : ''}>${UI.escapeHtml(t)}</option>`
    ).join('');
  }

  function preencherSelectClientes(selectId, valorAtual, incluirInativos) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const lista = incluirInativos ? clientes : clientes.filter((c) => c.ativo !== false);
    const opts = selectId === 'f-cliente'
      ? ['<option value="">Todos</option>']
      : ['<option value="">Selecione...</option>'];
    lista.forEach((c) => {
      opts.push(`<option value="${UI.escapeHtml(c.nome)}"${c.nome === valorAtual ? ' selected' : ''}>${UI.escapeHtml(c.nome)}</option>`);
    });
    sel.innerHTML = opts.join('');
    if (valorAtual) sel.value = valorAtual;
  }

  // -----------------------------------------------------------------------
  // Tabs
  // -----------------------------------------------------------------------
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('is-active', x === b));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === id));
    });
  });

  // -----------------------------------------------------------------------
  // Carregamento inicial
  // -----------------------------------------------------------------------
  async function carregarTudo() {
    try {
      [equipamentos, usuarios, visitas, clientes] = await Promise.all([
        window.DB.equipamentos.listar(),
        window.DB.usuarios.listar(),
        window.DB.visitas.listar(),
        window.DB.clientes.listarTodos()
      ]);
      renderEstatisticas();
      renderFiltrosOptions();
      renderTabelaEquip();
      renderClientes();
      renderTecnicos();
      renderHistoricoGlobal();
    } catch (err) {
      window.UI.toast(`Erro ao carregar dados: ${err.message}`, 'danger');
    }
  }

  // -----------------------------------------------------------------------
  // Estatisticas
  // -----------------------------------------------------------------------
  function renderEstatisticas() {
    document.getElementById('stat-equip').textContent = equipamentos.length;
    document.getElementById('stat-tec').textContent = usuarios.filter((u) => u.role === 'tecnico' && u.ativo).length;
    document.getElementById('stat-vis').textContent = visitas.length;

    if (equipamentos.length) {
      const maisRecente = equipamentos.reduce((acc, e) => {
        return (!acc || new Date(e.atualizadoEm) > new Date(acc.atualizadoEm)) ? e : acc;
      }, null);
      document.getElementById('stat-upd').textContent = UI.formatarData(maisRecente.atualizadoEm);
      document.getElementById('stat-upd-equip').textContent = maisRecente.nomeModelo;
    } else {
      document.getElementById('stat-upd').textContent = '-';
      document.getElementById('stat-upd-equip').textContent = 'sem equipamentos';
    }
  }

  // -----------------------------------------------------------------------
  // Filtros (popula selects)
  // -----------------------------------------------------------------------
  function renderFiltrosOptions() {
    const tipos = Array.from(new Set(equipamentos.map((e) => e.tipoEquipamento))).sort();
    const fTipo = document.getElementById('f-tipo');
    fTipo.innerHTML = '<option value="">Todos</option>' +
      tipos.map((t) => `<option>${UI.escapeHtml(t)}</option>`).join('');

    // Clientes cadastrados (lista oficial)
    const fCliente = document.getElementById('f-cliente');
    const valorClienteAtual = fCliente.value;
    preencherSelectClientes('f-cliente', valorClienteAtual, false);
    fCliente.value = valorClienteAtual;

    preencherSelectClientes('edit-cliente', '', false);

    const tecnicos = usuarios.filter((u) => u.role === 'tecnico');
    const fTec = document.getElementById('f-tec');
    fTec.innerHTML = '<option value="">Todos</option>' +
      tecnicos.map((t) => `<option value="${UI.escapeHtml(t.uid)}">${UI.escapeHtml(t.nome)}</option>`).join('');

    // popular tambem o select de edicao
    const editTec = document.getElementById('edit-tec');
    editTec.innerHTML = tecnicos.map((t) => `<option value="${UI.escapeHtml(t.uid)}">${UI.escapeHtml(t.nome)}</option>`).join('');
  }

  // listeners dos filtros
  const idsFiltro = ['f-cliente', 'f-tipo', 'f-tec', 'f-de', 'f-ate'];
  idsFiltro.forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => { renderTabelaEquip(); atualizarBadgeFiltros(); });
    el.addEventListener('change', () => { renderTabelaEquip(); atualizarBadgeFiltros(); });
  });

  // Badge com contador de filtros ativos no <summary>
  function atualizarBadgeFiltros() {
    const ativos = idsFiltro.filter((id) => (document.getElementById(id).value || '').trim() !== '').length;
    const badge = document.getElementById('filters-count');
    if (!badge) return;
    badge.textContent = ativos;
    badge.hidden = ativos === 0;
  }

  // Botao "Limpar filtros"
  document.getElementById('btn-limpar-filtros')?.addEventListener('click', () => {
    idsFiltro.forEach((id) => { document.getElementById(id).value = ''; });
    renderTabelaEquip();
    atualizarBadgeFiltros();
  });

  // Em telas pequenas, comeca com o painel de filtros fechado
  (function ajustarFiltrosMobile() {
    const det = document.getElementById('filters-details');
    if (!det) return;
    if (window.matchMedia('(max-width: 720px)').matches) {
      det.removeAttribute('open');
    } else {
      det.setAttribute('open', '');
    }
  })();

  // -----------------------------------------------------------------------
  // Tabela de equipamentos
  // -----------------------------------------------------------------------
  function renderTabelaEquip() {
    const cli = document.getElementById('f-cliente').value;
    const tipo = document.getElementById('f-tipo').value;
    const tec = document.getElementById('f-tec').value;
    const de = document.getElementById('f-de').value;
    const ate = document.getElementById('f-ate').value;

    const filtrados = equipamentos.filter((e) => {
      if (cli && e.clienteEmpresa !== cli) return false;
      if (tipo && e.tipoEquipamento !== tipo) return false;
      if (tec && e.tecnicoResponsavelUid !== tec) return false;
      if (de && new Date(e.atualizadoEm) < new Date(de + 'T00:00:00')) return false;
      if (ate && new Date(e.atualizadoEm) > new Date(ate + 'T23:59:59')) return false;
      return true;
    });

    const tbody = document.getElementById('tbl-equip');
    if (!filtrados.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted tbl-empty">Nenhum equipamento encontrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtrados.map((e) => `
      <tr data-id="${UI.escapeHtml(e.id)}">
        <td class="td-actions" data-label="Acoes">
          <div class="row-actions">
            <button class="row-actions__btn" data-a="edit" title="Editar equipamento">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Editar</span>
            </button>
            <button class="row-actions__btn" data-a="qr" title="Gerar QR Code">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              <span>QR</span>
            </button>
            <button class="row-actions__btn" data-a="hist" title="Ver historico de visitas">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>Historico</span>
            </button>
          </div>
        </td>
        <td data-label="Cliente">${UI.escapeHtml(e.clienteEmpresa)}</td>
        <td data-label="Tecnico">${UI.escapeHtml(e.tecnicoResponsavelNome)}</td>
        <td data-label="Nome / Modelo"><strong>${UI.escapeHtml(e.nomeModelo)}</strong><br/><span class="text-dim cell-sub">${UI.escapeHtml(e.tipoEquipamento)}</span></td>
        <td data-label="Localizacao">${UI.escapeHtml(e.localizacaoSetor)}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr').forEach((tr) => {
      const id = tr.dataset.id;
      tr.querySelector('[data-a="edit"]')?.addEventListener('click', () => abrirEdicao(id));
      tr.querySelector('[data-a="qr"]')?.addEventListener('click', () => abrirQR(id));
      tr.querySelector('[data-a="hist"]')?.addEventListener('click', () => abrirHistEquip(id));
    });
  }

  // -----------------------------------------------------------------------
  // Edicao de equipamento
  // -----------------------------------------------------------------------
  function abrirEdicao(id) {
    const e = equipamentos.find((x) => x.id === id);
    if (!e) return;
    document.getElementById('edit-id').value = e.id;
    document.getElementById('edit-nome').value = e.nomeModelo;
    preencherTiposEquipamento('edit-tipo', e.tipoEquipamento);
    document.getElementById('edit-serie').value = e.numeroSerie;
    document.getElementById('edit-local').value = e.localizacaoSetor;
    preencherSelectClientes('edit-cliente', e.clienteEmpresa, false);
    document.getElementById('edit-tec').value = e.tecnicoResponsavelUid;
    document.getElementById('edit-data-display').value = UI.formatarData(e.dataInstalacao, { hora: false });
    document.getElementById('edit-atualizado-display').value = UI.formatarData(e.atualizadoEm);
    window.ESPEC_AR?.renderFormulario('edit-ar-specs', 'edit', e);
    abrirModal('modal-edit');
  }

  // Botao Excluir (rodape do modal de edicao)
  document.getElementById('btn-excluir-edit')?.addEventListener('click', () => {
    const id = document.getElementById('edit-id').value;
    if (id) excluirEquip(id);
  });

  document.getElementById('form-edit').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = document.getElementById('form-edit');
    if (!form.reportValidity()) return;
    if (window.ESPEC_AR?.ativo() && !window.ESPEC_AR.validar('edit')) {
      window.UI.toast('Preencha todas as especificacoes tecnicas.', 'danger');
      return;
    }
    const id = document.getElementById('edit-id').value;
    const tecUid = document.getElementById('edit-tec').value;
    const tec = usuarios.find((u) => u.uid === tecUid);
    if (!tec) { window.UI.toast('Tecnico invalido.', 'danger'); return; }

    const payload = {
      nomeModelo:       document.getElementById('edit-nome').value.trim(),
      tipoEquipamento:  document.getElementById('edit-tipo').value,
      numeroSerie:      document.getElementById('edit-serie').value.trim(),
      localizacaoSetor: document.getElementById('edit-local').value.trim(),
      clienteEmpresa:   document.getElementById('edit-cliente').value.trim(),
      tecnicoResponsavelUid:  tec.uid,
      tecnicoResponsavelNome: tec.nome,
      ...(window.ESPEC_AR?.lerValores('edit') || {})
    };

    const btn = document.getElementById('btn-salvar-edit');
    const fim = window.UI.botaoLoading(btn, 'Salvando...');
    try {
      await window.DB.equipamentos.atualizar(id, payload);
      window.UI.toast('Equipamento atualizado!', 'success');
      fecharModal('modal-edit');
      await carregarTudo();
    } catch (err) {
      window.UI.toast(`Erro: ${err.message}`, 'danger');
    } finally {
      fim();
    }
  });

  // -----------------------------------------------------------------------
  // QR Code rapido
  // -----------------------------------------------------------------------
  function abrirQR(id) {
    const e = equipamentos.find((x) => x.id === id);
    if (!e) return;
    window.QR.imprimirQRCode(e);
  }

  // -----------------------------------------------------------------------
  // Historico de um equipamento
  // -----------------------------------------------------------------------
  function abrirHistEquip(id) {
    const e = equipamentos.find((x) => x.id === id);
    if (!e) return;
    document.getElementById('hist-equip-titulo').textContent = `Historico - ${e.nomeModelo}`;
    const body = document.getElementById('hist-equip-body');
    const lista = visitas.filter((v) => v.equipamentoId === id)
      .sort((a, b) => new Date(b.dataVisita) - new Date(a.dataVisita));

    if (!lista.length) {
      body.innerHTML = '<p class="text-muted">Nenhuma visita registrada para este equipamento.</p>';
    } else {
      body.innerHTML = `<div class="visitas-list">${lista.map((v) => `
        <div class="visita-item">
          <div class="visita-item__head">
            <div>
              <span class="tipo">${UI.escapeHtml(v.tipoServico)}</span><br/>
              <strong>${UI.escapeHtml(v.tecnicoNome)}</strong>
            </div>
            <span class="data">${UI.formatarData(v.dataVisita)}</span>
          </div>
          <div class="visita-item__body">
            <p><strong>Descricao:</strong> ${UI.escapeHtml(v.descricaoServico)}</p>
            ${v.defeitosEncontrados ? `<p><strong>Defeitos:</strong> ${UI.escapeHtml(v.defeitosEncontrados)}</p>` : ''}
            ${v.pecasTrocadas ? `<p><strong>Pecas:</strong> ${UI.escapeHtml(v.pecasTrocadas)}</p>` : ''}
            ${v.observacoes ? `<p><strong>Observacoes:</strong> ${UI.escapeHtml(v.observacoes)}</p>` : ''}
          </div>
        </div>`).join('')}</div>`;
    }
    abrirModal('modal-hist-equip');
  }

  // -----------------------------------------------------------------------
  // Exclusao
  // -----------------------------------------------------------------------
  async function excluirEquip(id) {
    const e = equipamentos.find((x) => x.id === id);
    if (!e) return;
    if (!confirm(`Excluir o equipamento "${e.nomeModelo}"?\nIsto removera tambem todas as visitas associadas.`)) return;
    try {
      await window.DB.equipamentos.excluir(id);
      window.UI.toast('Equipamento excluido.', 'success');
      fecharModal('modal-edit');
      await carregarTudo();
    } catch (err) {
      window.UI.toast(`Erro: ${err.message}`, 'danger');
    }
  }

  // -----------------------------------------------------------------------
  // Tecnicos
  // -----------------------------------------------------------------------
  function renderTecnicos() {
    const tecnicos = usuarios.filter((u) => u.role === 'tecnico');
    const grid = document.getElementById('tec-grid');
    if (!tecnicos.length) {
      grid.innerHTML = '<p class="text-muted">Nenhum tecnico cadastrado.</p>';
      return;
    }
    grid.innerHTML = tecnicos.map((t) => `
      <div class="tecnico-card" data-uid="${UI.escapeHtml(t.uid)}">
        <span class="tecnico-card__name">${UI.escapeHtml(t.nome)}</span>
        <span class="tecnico-card__email">${UI.escapeHtml(t.email)}</span>
        <div class="tecnico-card__row">
          <span class="badge ${t.ativo ? 'badge--success' : 'badge--muted'}">${t.ativo ? 'Ativo' : 'Inativo'}</span>
          <button class="btn ${t.ativo ? 'btn--ghost' : 'btn--accent'} btn--sm" data-a="toggle">${t.ativo ? 'Desativar' : 'Ativar'}</button>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.tecnico-card').forEach((card) => {
      const uid = card.dataset.uid;
      card.querySelector('[data-a="toggle"]').addEventListener('click', () => alternarAtivo(uid));
    });
  }

  async function alternarAtivo(uid) {
    const u = usuarios.find((x) => x.uid === uid);
    if (!u) return;
    try {
      await window.DB.usuarios.atualizar(uid, { ativo: !u.ativo });
      window.UI.toast(`Tecnico ${!u.ativo ? 'ativado' : 'desativado'}.`, 'success');
      await carregarTudo();
    } catch (err) {
      window.UI.toast(`Erro: ${err.message}`, 'danger');
    }
  }

  document.getElementById('btn-novo-tec').addEventListener('click', () => {
    document.getElementById('form-novo-tec').reset();
    ['err-tec-nome', 'err-tec-email', 'err-tec-senha'].forEach((id) => document.getElementById(id).textContent = '');
    abrirModal('modal-novo-tec');
  });

  document.getElementById('form-novo-tec').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome  = document.getElementById('tec-nome').value.trim();
    const email = document.getElementById('tec-email').value.trim();
    const senha = document.getElementById('tec-senha').value;

    let ok = true;
    const setErr = (id, msg) => { document.getElementById(id).textContent = msg; if (msg) ok = false; };
    setErr('err-tec-nome',  nome  ? '' : 'Informe o nome.');
    setErr('err-tec-email', email ? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? '' : 'E-mail invalido.') : 'Informe o e-mail.');
    setErr('err-tec-senha', senha && senha.length >= 4 ? '' : 'Senha minima de 4 caracteres.');
    if (!ok) return;

    const btn = document.getElementById('btn-salvar-tec');
    const fim = window.UI.botaoLoading(btn, 'Criando...');
    try {
      await window.DB.usuarios.criar({ nome, email, senha, role: 'tecnico' });
      window.UI.toast('Tecnico criado com sucesso!', 'success');
      fecharModal('modal-novo-tec');
      await carregarTudo();
    } catch (err) {
      window.UI.toast(`Erro: ${err.message}`, 'danger');
    } finally {
      fim();
    }
  });

  // -----------------------------------------------------------------------
  // Clientes (empresas atendidas)
  // -----------------------------------------------------------------------
  function renderClientes() {
    const tbody = document.getElementById('tbl-clientes');
    if (!tbody) return;
    if (!clientes.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Nenhum cliente cadastrado.</td></tr>';
      return;
    }
    tbody.innerHTML = clientes
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((c) => `
        <tr data-id="${UI.escapeHtml(c.id)}">
          <td data-label="Nome"><strong>${UI.escapeHtml(c.nome)}</strong></td>
          <td data-label="Status">
            <span class="badge ${c.ativo !== false ? 'badge--success' : 'badge--muted'}">${c.ativo !== false ? 'Ativo' : 'Inativo'}</span>
          </td>
          <td data-label="Acoes">
            <button type="button" class="btn btn--ghost btn--sm" data-a="toggle">${c.ativo !== false ? 'Desativar' : 'Ativar'}</button>
          </td>
        </tr>
      `).join('');

    tbody.querySelectorAll('tr').forEach((tr) => {
      const id = tr.dataset.id;
      tr.querySelector('[data-a="toggle"]').addEventListener('click', () => toggleCliente(id));
    });
  }

  async function toggleCliente(id) {
    const c = clientes.find((x) => x.id === id);
    if (!c) return;
    try {
      await window.DB.clientes.atualizar(id, { ativo: c.ativo === false });
      window.UI.toast(`Cliente ${c.ativo === false ? 'ativado' : 'desativado'}.`, 'success');
      await carregarTudo();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    }
  }

  document.getElementById('btn-novo-cliente')?.addEventListener('click', () => {
    document.getElementById('form-cliente').reset();
    abrirModal('modal-cliente');
  });

  document.getElementById('form-cliente')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = document.getElementById('form-cliente');
    if (!form.reportValidity()) return;
    const nome = document.getElementById('cliente-nome').value.trim();
    const btn = document.getElementById('btn-salvar-cliente');
    const fim = window.UI.botaoLoading(btn, 'Salvando...');
    try {
      await window.DB.clientes.criar({ nome });
      window.UI.toast('Cliente cadastrado!', 'success');
      fecharModal('modal-cliente');
      await carregarTudo();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    } finally {
      fim();
    }
  });

  // -----------------------------------------------------------------------
  // Historico global
  // -----------------------------------------------------------------------
  function renderHistoricoGlobal() {
    const tbody = document.getElementById('tbl-hist');
    const lista = [...visitas].sort((a, b) => new Date(b.dataVisita) - new Date(a.dataVisita));
    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted tbl-empty">Sem visitas registradas.</td></tr>`;
      return;
    }
    tbody.innerHTML = lista.map((v) => {
      const eq = equipamentos.find((e) => e.id === v.equipamentoId);
      return `
        <tr>
          <td data-label="Data">${UI.formatarData(v.dataVisita)}</td>
          <td data-label="Equipamento">${eq ? UI.escapeHtml(eq.nomeModelo) : '<em class="text-dim">removido</em>'}</td>
          <td data-label="Cliente">${eq ? UI.escapeHtml(eq.clienteEmpresa) : '-'}</td>
          <td data-label="Tecnico">${UI.escapeHtml(v.tecnicoNome)}</td>
          <td data-label="Tipo de servico"><span class="badge badge--info">${UI.escapeHtml(v.tipoServico)}</span></td>
        </tr>`;
    }).join('');
  }

  // -----------------------------------------------------------------------
  // Boot
  // -----------------------------------------------------------------------
  carregarTudo();
})();

// TODO: Firestore Security Rules
// match /usuarios/{uid} {
//   allow read: if request.auth != null;
//   allow create, update: if request.auth.token.role == 'admin';
// }
// match /equipamentos/{id} {
//   allow read: if true;
//   allow write: if request.auth.token.role == 'admin' || ...
//     && request.resource.data.dataInstalacao == resource.data.dataInstalacao;
// }
