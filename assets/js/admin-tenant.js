/**
 * admin-tenant.js
 * --------------------------------------------------------------------------
 * Dashboard administrativo da empresa (tenant):
 *   - Estatisticas rapidas
 *   - Gestao de tecnicos (criar, ativar/desativar)
 *   - Tabela de equipamentos com filtros (cliente, tipo, tecnico, datas)
 *   - Edicao de equipamentos (instalador e data de instalacao pelo admin)
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
  let editEquipIdPendente = null;
  const INSTALADOR_MANUAL = '__manual__';

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

    const tecnicos = listarTecnicosCadastrados();
    const fTec = document.getElementById('f-tec');
    fTec.innerHTML = '<option value="">Todos</option>' +
      tecnicos.map((t) => `<option value="${UI.escapeHtml(t.uid)}">${UI.escapeHtml(t.nome)}</option>`).join('');

    preencherSelectInstaladorEdit();
  }

  function listarTecnicosCadastrados() {
    return usuarios.filter((u) => u.role === 'tecnico');
  }

  function preencherSelectInstaladorEdit(selecionadoUid, nomeManual) {
    const sel = document.getElementById('edit-tec');
    if (!sel) return;
    const tecnicos = listarTecnicosCadastrados();
    const opts = tecnicos.map((t) =>
      `<option value="${UI.escapeHtml(t.uid)}">${UI.escapeHtml(t.nome)}</option>`
    );
    opts.push(`<option value="${INSTALADOR_MANUAL}">Informar nome (sem cadastro)</option>`);
    sel.innerHTML = opts.join('');

    const manualInp = document.getElementById('edit-tec-nome-manual');
    const uidValido = selecionadoUid && tecnicos.some((t) => t.uid === selecionadoUid);
    if (uidValido) {
      sel.value = selecionadoUid;
      if (manualInp) { manualInp.hidden = true; manualInp.value = ''; }
    } else if (nomeManual || selecionadoUid) {
      sel.value = INSTALADOR_MANUAL;
      if (manualInp) {
        manualInp.hidden = false;
        manualInp.value = nomeManual || '';
      }
    } else if (tecnicos.length) {
      sel.value = tecnicos[0].uid;
      if (manualInp) { manualInp.hidden = true; manualInp.value = ''; }
    } else {
      sel.value = INSTALADOR_MANUAL;
      if (manualInp) { manualInp.hidden = false; manualInp.value = nomeManual || ''; }
    }
    atualizarCampoInstaladorManual();
  }

  function atualizarCampoInstaladorManual() {
    const sel = document.getElementById('edit-tec');
    const manualInp = document.getElementById('edit-tec-nome-manual');
    if (!sel || !manualInp) return;
    const manual = sel.value === INSTALADOR_MANUAL;
    manualInp.hidden = !manual;
    if (!manual) manualInp.value = '';
  }

  function lerInstaladorDoFormulario() {
    const sel = document.getElementById('edit-tec');
    const manualInp = document.getElementById('edit-tec-nome-manual');
    if (!sel) return null;
    if (sel.value === INSTALADOR_MANUAL) {
      const nome = manualInp?.value.trim() || '';
      if (!nome) return null;
      return { tecnicoResponsavelUid: null, tecnicoResponsavelNome: nome };
    }
    const tec = usuarios.find((u) => u.uid === sel.value);
    if (!tec) return null;
    return { tecnicoResponsavelUid: tec.uid, tecnicoResponsavelNome: tec.nome };
  }

  function dataInstalacaoParaInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
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
            <button class="row-actions__btn" data-a="detalhes" title="Ver detalhes e QR Code">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              <span>Ver detalhes / QR</span>
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
      tr.querySelector('[data-a="detalhes"]')?.addEventListener('click', () => abrirDetalhes(id));
      tr.querySelector('[data-a="hist"]')?.addEventListener('click', () => abrirHistEquip(id));
    });
  }

  // -----------------------------------------------------------------------
  // Edicao de equipamento
  // -----------------------------------------------------------------------
  function abrirEdicao(id) {
    const e = equipamentos.find((x) => x.id === id);
    if (!e) return;
    editEquipIdPendente = id;
    document.getElementById('edit-id').value = e.id;
    document.getElementById('edit-nome').value = e.nomeModelo;
    preencherTiposEquipamento('edit-tipo', e.tipoEquipamento);
    document.getElementById('edit-serie').value = e.numeroSerie;
    document.getElementById('edit-local').value = e.localizacaoSetor;
    preencherSelectClientes('edit-cliente', e.clienteEmpresa, false);
    preencherSelectInstaladorEdit(e.tecnicoResponsavelUid, e.tecnicoResponsavelNome);
    document.getElementById('edit-data').value = dataInstalacaoParaInput(e.dataInstalacao);
    document.getElementById('edit-atualizado-display').value = UI.formatarData(e.atualizadoEm);
    document.getElementById('err-edit-instalador').textContent = '';
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
    const instalador = lerInstaladorDoFormulario();
    const errInst = document.getElementById('err-edit-instalador');
    if (!instalador) {
      errInst.textContent = 'Selecione um tecnico ou informe o nome do instalador.';
      return;
    }
    errInst.textContent = '';

    const dataInst = document.getElementById('edit-data').value;
    if (!dataInst) {
      window.UI.toast('Informe a data de instalacao.', 'danger');
      return;
    }

    const payload = {
      nomeModelo:       document.getElementById('edit-nome').value.trim(),
      tipoEquipamento:  document.getElementById('edit-tipo').value,
      numeroSerie:      document.getElementById('edit-serie').value.trim(),
      localizacaoSetor: document.getElementById('edit-local').value.trim(),
      clienteEmpresa:   document.getElementById('edit-cliente').value.trim(),
      tecnicoResponsavelUid:  instalador.tecnicoResponsavelUid,
      tecnicoResponsavelNome: instalador.tecnicoResponsavelNome,
      dataInstalacao: dataInst,
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
  // Detalhes + QR Code (mesmo fluxo do tecnico em campo)
  // -----------------------------------------------------------------------
  function abrirDetalhes(id) {
    const e = equipamentos.find((x) => x.id === id);
    if (!e) return;

    document.getElementById('md-titulo').textContent = e.nomeModelo;
    const body = document.getElementById('md-body');
    body.innerHTML = `
      <dl class="detalhe-grid">
        <div><dt>Tipo</dt><dd>${UI.escapeHtml(e.tipoEquipamento)}</dd></div>
        <div><dt>Numero de serie</dt><dd>${UI.escapeHtml(e.numeroSerie || '—')}</dd></div>
        <div><dt>Cliente / Empresa</dt><dd>${UI.escapeHtml(e.clienteEmpresa)}</dd></div>
        <div><dt>Localizacao</dt><dd>${UI.escapeHtml(e.localizacaoSetor)}</dd></div>
        <div><dt>Tecnico responsavel</dt><dd>${UI.escapeHtml(e.tecnicoResponsavelNome)}</dd></div>
        <div><dt>Data de instalacao</dt><dd>${UI.formatarData(e.dataInstalacao, { hora: false })}</dd></div>
        <div><dt>Cadastrado em</dt><dd>${UI.formatarData(e.criadoEm)}</dd></div>
        <div><dt>Ultima atualizacao</dt><dd>${UI.formatarData(e.atualizadoEm)}</dd></div>
        ${window.ESPEC_AR?.htmlDetalhe(e) || ''}
      </dl>
      <div class="qr-card">
        <div class="qr-card__box" id="qr-detalhes"></div>
        <div class="qr-card__actions">
          <strong>QR Code do equipamento</strong>
          <span class="text-muted" style="font-size: 0.86rem;">Cole no equipamento para acesso rapido ao historico.</span>
          <div class="flex gap-8" style="margin-top: 6px;">
            <button type="button" class="btn btn--sm" id="btn-baixar-qr">Baixar PNG</button>
            <button type="button" class="btn btn--ghost btn--sm" id="btn-imprimir-qr">Imprimir</button>
          </div>
          <div class="qr-card__url" id="qr-url"></div>
        </div>
      </div>
    `;

    abrirModal('modal-detalhes');

    try {
      window.QR.gerarQRCode('qr-detalhes', e.id, { size: 144 });
      document.getElementById('qr-url').textContent = window.QR.urlPublica(e.id);
    } catch (err) {
      console.error(err);
    }

    document.getElementById('btn-baixar-qr')?.addEventListener('click', () => {
      window.QR.baixarQRCode(e.id, e.nomeModelo);
    });
    document.getElementById('btn-imprimir-qr')?.addEventListener('click', () => {
      window.QR.imprimirQRCode(e);
    });
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

  document.getElementById('edit-tec')?.addEventListener('change', atualizarCampoInstaladorManual);

  document.getElementById('btn-add-tec-from-edit')?.addEventListener('click', () => {
    editEquipIdPendente = document.getElementById('edit-id')?.value || editEquipIdPendente;
    document.getElementById('form-novo-tec')?.reset();
    ['err-tec-nome', 'err-tec-email', 'err-tec-senha'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
    abrirModal('modal-novo-tec');
  });

  document.getElementById('btn-novo-tec').addEventListener('click', () => {
    editEquipIdPendente = null;
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
      const criado = await window.DB.usuarios.criar({ nome, email, senha, role: 'tecnico' });
      window.UI.toast('Tecnico criado com sucesso!', 'success');
      fecharModal('modal-novo-tec');
      usuarios = await window.DB.usuarios.listar();
      renderFiltrosOptions();
      renderTecnicos();
      if (editEquipIdPendente && document.getElementById('modal-edit')?.classList.contains('is-open')) {
        preencherSelectInstaladorEdit(criado?.uid, null);
      } else {
        await carregarTudo();
      }
    } catch (err) {
      window.UI.toast(`Erro: ${err.message}`, 'danger');
    } finally {
      fim();
    }
  });

  // -----------------------------------------------------------------------
  // Clientes (empresas atendidas)
  // -----------------------------------------------------------------------
  let clienteEditandoId = null;
  let clienteEditandoAtivo = true;
  const CF = () => window.CLIENTE_FORM;

  function atualizarBotaoToggleCliente() {
    const btn = document.getElementById('btn-toggle-cliente');
    if (!btn) return;
    if (!clienteEditandoId) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    btn.textContent = clienteEditandoAtivo ? 'Desativar cliente' : 'Ativar cliente';
    btn.classList.toggle('btn--accent', !clienteEditandoAtivo);
    btn.classList.toggle('btn--ghost', clienteEditandoAtivo);
  }

  function limparFormCliente() {
    clienteEditandoId = null;
    clienteEditandoAtivo = true;
    ultimoCepBuscado = '';
    document.getElementById('modal-cliente-titulo').textContent = 'Cadastrar cliente';
    document.getElementById('form-cliente')?.reset();
    document.getElementById('err-cliente-documento').textContent = '';
    const lista = document.getElementById('cliente-contatos-list');
    const emails = document.getElementById('cliente-emails-list');
    if (lista) lista.innerHTML = '';
    if (emails) emails.innerHTML = '';
    document.getElementById('err-cliente-email').textContent = '';
    atualizarBotaoToggleCliente();
  }

  function adicionarEmailRow(email = '', responsavel = '') {
    const lista = document.getElementById('cliente-emails-list');
    if (!lista) return;
    const row = document.createElement('div');
    row.className = 'contato-row';
    row.innerHTML = `
      <input type="email" class="form-control cliente-email-endereco" inputmode="email" autocomplete="email" placeholder="contato@empresa.com.br" value="${UI.escapeHtml(email)}" />
      <input type="text" class="form-control cliente-email-responsavel" placeholder="Recepcao, Gerencia..." value="${UI.escapeHtml(responsavel)}" />
      <button type="button" class="btn btn--ghost btn--sm contato-row__rem" data-a="rem-item" title="Remover">&times;</button>
    `;
    row.querySelector('[data-a="rem-item"]').addEventListener('click', () => {
      const emailInp = row.querySelector('.cliente-email-endereco');
      const respInp = row.querySelector('.cliente-email-responsavel');
      if (lista.querySelectorAll('.contato-row').length <= 1) {
        emailInp.value = '';
        respInp.value = '';
        return;
      }
      row.remove();
    });
    lista.appendChild(row);
  }

  function parseEmailsCliente(c) {
    const raw = Array.isArray(c.emails) ? c.emails : [];
    const items = raw.map((item) => {
      if (typeof item === 'object' && item !== null) {
        return {
          email: String(item.email || '').trim(),
          responsavel: String(item.responsavel || item.rotulo || '').trim()
        };
      }
      const s = String(item || '').trim();
      if (!s) return { email: '', responsavel: '' };
      const sep = s.match(/^(.+?)\s*[—\-|]\s*(.+)$/);
      if (sep) return { email: sep[1].trim(), responsavel: sep[2].trim() };
      if (s.includes('@')) return { email: s, responsavel: '' };
      return { email: '', responsavel: s };
    });
    return items.length ? items : [{ email: '', responsavel: '' }];
  }

  function lerEmailsDoFormulario() {
    return Array.from(document.querySelectorAll('#cliente-emails-list .contato-row'))
      .map((row) => ({
        email: row.querySelector('.cliente-email-endereco')?.value.trim() || '',
        responsavel: row.querySelector('.cliente-email-responsavel')?.value.trim() || ''
      }))
      .filter((item) => item.email || item.responsavel);
  }

  function validarEmailsFormulario() {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const errEl = document.getElementById('err-cliente-email');
    for (const item of lerEmailsDoFormulario()) {
      if (item.email && !re.test(item.email)) {
        errEl.textContent = 'Informe um e-mail valido ou deixe o campo vazio.';
        return false;
      }
    }
    errEl.textContent = '';
    return true;
  }

  function adicionarContatoRow(telefone = '', rotulo = '') {
    const lista = document.getElementById('cliente-contatos-list');
    if (!lista) return;
    const row = document.createElement('div');
    row.className = 'contato-row';
    row.innerHTML = `
      <input type="tel" class="form-control cliente-contato-tel" inputmode="tel" placeholder="(83) 99999-9999" value="${UI.escapeHtml(telefone)}" />
      <input type="text" class="form-control cliente-contato-rotulo" placeholder="Recepcao, Gerencia..." value="${UI.escapeHtml(rotulo)}" />
      <button type="button" class="btn btn--ghost btn--sm contato-row__rem" data-a="rem-item" title="Remover">&times;</button>
    `;
    const tel = row.querySelector('.cliente-contato-tel');
    tel.addEventListener('input', () => {
      tel.value = CF()?.formatarTelefoneInput(tel.value) || tel.value;
    });
    row.querySelector('[data-a="rem-item"]').addEventListener('click', () => {
      if (lista.querySelectorAll('.contato-row').length <= 1) {
        tel.value = '';
        row.querySelector('.cliente-contato-rotulo').value = '';
        return;
      }
      row.remove();
    });
    lista.appendChild(row);
  }

  function parseContatosCliente(c) {
    const raw = Array.isArray(c.contatos) ? c.contatos : [];
    const resp = Array.isArray(c.responsaveis) ? c.responsaveis : [];
    const items = raw.map((item, i) => {
      if (typeof item === 'object' && item !== null) {
        return {
          telefone: String(item.telefone || '').trim(),
          rotulo: String(item.rotulo || '').trim()
        };
      }
      const s = String(item || '').trim();
      if (!s) return { telefone: '', rotulo: '' };
      const sep = s.match(/^(.+?)\s*[—\-|]\s*(.+)$/);
      if (sep) return { telefone: sep[1].trim(), rotulo: sep[2].trim() };
      return { telefone: s, rotulo: resp[i] || '' };
    });
    if (!items.length && resp.length) {
      return resp.map((rotulo) => ({ telefone: '', rotulo: String(rotulo).trim() }));
    }
    if (items.length && resp.length && items.every((x) => !x.rotulo)) {
      return items.map((item, i) => ({ ...item, rotulo: resp[i] || '' }));
    }
    return items.length ? items : [{ telefone: '', rotulo: '' }];
  }

  function lerContatosDoFormulario() {
    return Array.from(document.querySelectorAll('#cliente-contatos-list .contato-row'))
      .map((row) => ({
        telefone: row.querySelector('.cliente-contato-tel')?.value.trim() || '',
        rotulo: row.querySelector('.cliente-contato-rotulo')?.value.trim() || ''
      }))
      .filter((item) => item.telefone || item.rotulo);
  }

  function preencherFormCliente(c) {
    clienteEditandoId = c.id;
    clienteEditandoAtivo = c.ativo !== false;
    ultimoCepBuscado = '';
    document.getElementById('modal-cliente-titulo').textContent = 'Editar cliente';
    document.getElementById('cliente-nome').value = c.nome || '';
    document.getElementById('cliente-documento').value = c.documento || c.cnpj || '';
    document.getElementById('cliente-logradouro').value = c.logradouro || c.endereco || '';
    document.getElementById('cliente-numero').value = c.numero || '';
    document.getElementById('cliente-bairro').value = c.bairro || '';
    document.getElementById('cliente-cidade').value = c.cidade || '';
    document.getElementById('cliente-cep').value = c.cep || '';
    document.getElementById('cliente-obs').value = c.observacoes || '';
    document.getElementById('err-cliente-documento').textContent = '';

    const contatos = document.getElementById('cliente-contatos-list');
    if (contatos) contatos.innerHTML = '';
    parseContatosCliente(c).forEach((item) => adicionarContatoRow(item.telefone, item.rotulo));
    const emailsList = document.getElementById('cliente-emails-list');
    if (emailsList) emailsList.innerHTML = '';
    parseEmailsCliente(c).forEach((item) => adicionarEmailRow(item.email, item.responsavel));
    atualizarBotaoToggleCliente();

    const cepInp = document.getElementById('cliente-cep');
    if (cepInp && CF()?.apenasDigitos(cepInp.value).length === 8) {
      consultarCepCliente(cepInp);
    }
  }

  function abrirEquipamentosCliente(nomeCliente) {
    const lista = equipamentos
      .filter((e) => e.clienteEmpresa === nomeCliente)
      .sort((a, b) => a.nomeModelo.localeCompare(b.nomeModelo, 'pt-BR'));
    document.getElementById('cliente-equip-titulo').textContent = `Equipamentos — ${nomeCliente}`;
    const body = document.getElementById('cliente-equip-body');
    if (!lista.length) {
      body.innerHTML = '<p class="text-muted">Nenhum equipamento cadastrado para este cliente.</p>';
    } else {
      body.innerHTML = `
        <div class="table-wrap">
          <table class="table table--equip">
            <thead>
              <tr>
                <th class="th-actions">Acoes</th>
                <th>Nome / Modelo</th>
                <th>Tipo</th>
                <th>Localizacao</th>
                <th>Tecnico</th>
              </tr>
            </thead>
            <tbody>
              ${lista.map((e) => `
                <tr data-id="${UI.escapeHtml(e.id)}">
                  <td class="td-actions" data-label="Acoes">
                    <div class="row-actions">
                      <button type="button" class="row-actions__btn" data-a="detalhes" title="Ver detalhes e QR">
                        <span>Ver detalhes / QR</span>
                      </button>
                      <button type="button" class="row-actions__btn" data-a="edit" title="Editar">
                        <span>Editar</span>
                      </button>
                    </div>
                  </td>
                  <td data-label="Nome"><strong>${UI.escapeHtml(e.nomeModelo)}</strong></td>
                  <td data-label="Tipo">${UI.escapeHtml(e.tipoEquipamento)}</td>
                  <td data-label="Localizacao">${UI.escapeHtml(e.localizacaoSetor)}</td>
                  <td data-label="Tecnico">${UI.escapeHtml(e.tecnicoResponsavelNome)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
      body.querySelectorAll('tr[data-id]').forEach((tr) => {
        const eqId = tr.dataset.id;
        tr.querySelector('[data-a="detalhes"]')?.addEventListener('click', () => {
          fecharModal('modal-cliente-equip');
          abrirDetalhes(eqId);
        });
        tr.querySelector('[data-a="edit"]')?.addEventListener('click', () => {
          fecharModal('modal-cliente-equip');
          abrirEdicao(eqId);
        });
      });
    }
    abrirModal('modal-cliente-equip');
  }

  function renderClientes() {
    const lista = document.getElementById('clientes-list');
    if (!lista) return;
    if (!clientes.length) {
      lista.innerHTML = '<p class="text-center text-muted clientes-empty">Nenhum cliente cadastrado.</p>';
      return;
    }
    lista.innerHTML = clientes
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((c) => {
        const doc = c.documento || c.cnpj;
        const inativo = c.ativo === false;
        return `
        <article class="cliente-card${inativo ? ' cliente-card--inativo' : ''}" data-id="${UI.escapeHtml(c.id)}">
          <button type="button" class="cliente-card__info" data-a="abrir-equip">
            <strong class="cliente-card__nome">${UI.escapeHtml(c.nome)}</strong>
            ${doc ? `<span class="text-dim cell-sub">${UI.escapeHtml(doc)}</span>` : ''}
            ${inativo ? '<span class="badge badge--muted">Inativo</span>' : ''}
          </button>
          <div class="cliente-card__actions">
            <button type="button" class="btn btn--ghost btn--sm" data-a="edit">Editar</button>
          </div>
        </article>`;
      }).join('');

    lista.querySelectorAll('.cliente-card').forEach((card) => {
      const id = card.dataset.id;
      const c = clientes.find((x) => x.id === id);
      card.querySelector('[data-a="edit"]')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!c) return;
        preencherFormCliente(c);
        abrirModal('modal-cliente');
      });
      card.querySelector('[data-a="abrir-equip"]')?.addEventListener('click', () => {
        if (!c) return;
        abrirEquipamentosCliente(c.nome);
      });
    });
  }

  document.getElementById('btn-novo-cliente')?.addEventListener('click', () => {
    limparFormCliente();
    adicionarContatoRow();
    adicionarEmailRow();
    abrirModal('modal-cliente');
  });

  document.getElementById('btn-add-contato')?.addEventListener('click', () => {
    adicionarContatoRow();
  });

  document.getElementById('btn-add-email')?.addEventListener('click', () => {
    adicionarEmailRow();
  });

  document.getElementById('btn-toggle-cliente')?.addEventListener('click', async () => {
    if (!clienteEditandoId) return;
    const c = clientes.find((x) => x.id === clienteEditandoId);
    if (!c) return;
    const acao = clienteEditandoAtivo ? 'desativar' : 'ativar';
    if (!confirm(`Confirma ${acao} o cliente "${c.nome}"?`)) return;
    try {
      await window.DB.clientes.atualizar(clienteEditandoId, { ativo: !clienteEditandoAtivo });
      window.UI.toast(`Cliente ${clienteEditandoAtivo ? 'desativado' : 'ativado'}.`, 'success');
      fecharModal('modal-cliente');
      limparFormCliente();
      await carregarTudo();
    } catch (err) {
      window.UI.toast(err.message, 'danger');
    }
  });

  document.getElementById('cliente-documento')?.addEventListener('input', (ev) => {
    const inp = ev.target;
    inp.value = CF()?.formatarDocumentoInput(inp.value) || inp.value;
    document.getElementById('err-cliente-documento').textContent = '';
  });

  let ultimoCepBuscado = '';

  function aplicarEnderecoCep(dados, cepInput) {
    if (!dados) return false;
    const log = document.getElementById('cliente-logradouro');
    const bairro = document.getElementById('cliente-bairro');
    const cidade = document.getElementById('cliente-cidade');
    if (log) log.value = dados.logradouro || '';
    if (bairro) bairro.value = dados.bairro || '';
    if (cidade) {
      cidade.value = dados.uf && dados.cidade
        ? `${dados.cidade} — ${dados.uf}`
        : (dados.cidade || '');
    }
    if (dados.cep && cepInput) cepInput.value = dados.cep;
    return true;
  }

  async function consultarCepCliente(cepInput) {
    const cep = cepInput?.value || '';
    const d = CF()?.apenasDigitos(cep) || '';
    if (d.length !== 8 || d === ultimoCepBuscado) return;
    ultimoCepBuscado = d;
    cepInput.disabled = true;
    try {
      const dados = await CF()?.buscarEnderecoPorCep(cep);
      if (!aplicarEnderecoCep(dados, cepInput)) {
        window.UI?.toast('CEP nao encontrado.', 'warning');
      }
    } catch (_) {
      window.UI?.toast('Erro ao buscar CEP. Tente novamente.', 'danger');
    } finally {
      cepInput.disabled = false;
    }
  }

  document.getElementById('cliente-cep')?.addEventListener('input', (ev) => {
    const inp = ev.target;
    inp.value = CF()?.formatarCepInput(inp.value) || inp.value;
    if (CF()?.apenasDigitos(inp.value).length === 8) {
      consultarCepCliente(inp);
    }
  });

  document.getElementById('cliente-cep')?.addEventListener('blur', (ev) => {
    consultarCepCliente(ev.target);
  });

  document.getElementById('form-cliente')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = document.getElementById('form-cliente');
    if (!form.reportValidity()) return;

    const documento = document.getElementById('cliente-documento').value.trim();
    const errDoc = CF()?.validarDocumento(documento);
    const errEl = document.getElementById('err-cliente-documento');
    if (errDoc) {
      errEl.textContent = errDoc;
      return;
    }
    errEl.textContent = '';

    if (!validarEmailsFormulario()) return;

    const payload = {
      nome: document.getElementById('cliente-nome').value.trim(),
      documento,
      logradouro: document.getElementById('cliente-logradouro').value.trim(),
      numero: document.getElementById('cliente-numero').value.trim(),
      bairro: document.getElementById('cliente-bairro').value.trim(),
      cidade: document.getElementById('cliente-cidade').value.trim(),
      cep: document.getElementById('cliente-cep').value.trim(),
      contatos: lerContatosDoFormulario(),
      emails: lerEmailsDoFormulario(),
      observacoes: document.getElementById('cliente-obs').value.trim()
    };
    const btn = document.getElementById('btn-salvar-cliente');
    const fim = window.UI.botaoLoading(btn, 'Salvando...');
    try {
      if (clienteEditandoId) {
        await window.DB.clientes.atualizar(clienteEditandoId, payload);
        window.UI.toast('Cliente atualizado!', 'success');
      } else {
        await window.DB.clientes.criar(payload);
        window.UI.toast('Cliente cadastrado!', 'success');
      }
      fecharModal('modal-cliente');
      limparFormCliente();
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
  (async function boot() {
    if (typeof window.initApp === 'function') await window.initApp();
    await carregarTudo();
  })();
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
