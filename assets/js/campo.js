/**
 * campo.js
 * --------------------------------------------------------------------------
 * Painel do tecnico de campo:
 *   - Lista todos os equipamentos do tenant (com filtros)
 *   - Detalhes, QR Code, registro de visitas
 *   - Cadastro de equipamento / instalacao
 */

(function () {
  'use strict';

  let usuario = window.AUTH.requireRole(['tecnico', 'admin']);
  if (!usuario) return;

  window.AUTH.resincronizar().then((u) => {
    if (u) {
      usuario = u;
      window.APP_SHELL?.renderHeader();
    }
  });

  let equipamentos = [];
  let clientes = [];
  let equipAtual = null;

  const $listaEquip = document.getElementById('lista-equipamentos');
  const $metaEquip = document.getElementById('meta-equip');
  const $btnNovo = document.getElementById('btn-novo-equip');
  const $btnInstalacao = document.getElementById('btn-nova-instalacao');
  const $btnCadastrarVisita = document.getElementById('btn-cadastrar-visita');
  const idsFiltro = ['f-cliente', 'f-tipo', 'f-de', 'f-ate'];

  document.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => fecharModal(b.getAttribute('data-close')));
  });
  document.querySelectorAll('.modal-backdrop').forEach((bd) => {
    bd.addEventListener('click', (ev) => {
      if (ev.target === bd) fecharModal(bd.id);
    });
  });

  function abrirModal(id) { document.getElementById(id)?.classList.add('is-open'); }
  function fecharModal(id) { document.getElementById(id)?.classList.remove('is-open'); }

  function equipFiltrados() {
    const cli = document.getElementById('f-cliente')?.value || '';
    const tipo = document.getElementById('f-tipo')?.value || '';
    const de = document.getElementById('f-de')?.value || '';
    const ate = document.getElementById('f-ate')?.value || '';

    return equipamentos.filter((e) => {
      if (cli && e.clienteEmpresa !== cli) return false;
      if (tipo && e.tipoEquipamento !== tipo) return false;
      if (de && new Date(e.atualizadoEm) < new Date(de + 'T00:00:00')) return false;
      if (ate && new Date(e.atualizadoEm) > new Date(ate + 'T23:59:59')) return false;
      return true;
    });
  }

  async function carregarClientes() {
    try {
      clientes = await window.DB.clientes.listar();
    } catch (err) {
      clientes = [];
      console.warn('[campo] Falha ao carregar clientes:', err.message);
    }
  }

  function nomesClientesParaFiltro() {
    const nomes = new Set(
      clientes.filter((c) => c.ativo !== false).map((c) => c.nome)
    );
    equipamentos.forEach((e) => {
      if (e.clienteEmpresa) nomes.add(e.clienteEmpresa);
    });
    return Array.from(nomes).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function preencherSelectClientes(selectId, valorAtual) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const isFiltro = selectId === 'f-cliente';
    const opts = isFiltro
      ? ['<option value="">Todos</option>']
      : ['<option value="">Selecione...</option>'];
    const lista = isFiltro
      ? nomesClientesParaFiltro()
      : clientes.filter((c) => c.ativo !== false).map((c) => c.nome);
    lista.forEach((nome) => {
      opts.push(`<option value="${UI.escapeHtml(nome)}"${nome === valorAtual ? ' selected' : ''}>${UI.escapeHtml(nome)}</option>`);
    });
    sel.innerHTML = opts.join('');
    if (valorAtual) sel.value = valorAtual;
  }

  function renderFiltrosOptions() {
    const tipos = Array.from(new Set(equipamentos.map((e) => e.tipoEquipamento))).sort();
    const fTipo = document.getElementById('f-tipo');
    if (fTipo) {
      const atual = fTipo.value;
      fTipo.innerHTML = '<option value="">Todos</option>' +
        tipos.map((t) => `<option value="${UI.escapeHtml(t)}">${UI.escapeHtml(t)}</option>`).join('');
      fTipo.value = atual;
    }

    const fCliente = document.getElementById('f-cliente');
    const valorCliente = fCliente?.value || '';
    preencherSelectClientes('f-cliente', valorCliente);
    if (fCliente) fCliente.value = valorCliente;
  }

  function atualizarBadgeFiltros() {
    const ativos = idsFiltro.filter((id) => (document.getElementById(id)?.value || '').trim() !== '').length;
    const badge = document.getElementById('filters-count');
    if (!badge) return;
    badge.textContent = ativos;
    badge.hidden = ativos === 0;
  }

  async function carregarEquipamentos() {
    $metaEquip.textContent = 'carregando...';
    try {
      await carregarClientes();
      equipamentos = await window.DB.equipamentos.listar();
      renderFiltrosOptions();
      renderizar();
      atualizarBadgeFiltros();
    } catch (err) {
      $metaEquip.textContent = 'erro ao carregar';
      window.UI.toast(`Falha ao carregar equipamentos: ${err.message}`, 'danger');
    }
  }

  function renderizar() {
    const lista = equipFiltrados();
    $metaEquip.textContent = `${lista.length} de ${equipamentos.length} equipamento(s)`;

    if (!equipamentos.length) {
      $listaEquip.innerHTML = `
        <div class="empty" style="grid-column: 1 / -1;">
          <h3>Nenhum equipamento cadastrado</h3>
          <p>Cadastre o primeiro equipamento usando os botoes acima.</p>
        </div>`;
      return;
    }

    if (!lista.length) {
      $listaEquip.innerHTML = `
        <div class="empty" style="grid-column: 1 / -1;">
          <h3>Nenhum equipamento encontrado</h3>
          <p>Ajuste os filtros ou limpe a selecao.</p>
        </div>`;
      return;
    }

    $listaEquip.innerHTML = lista.map((e) => `
      <article class="equip-card" data-id="${UI.escapeHtml(e.id)}">
        <span class="equip-card__type">${UI.escapeHtml(e.tipoEquipamento)}</span>
        <h3>${UI.escapeHtml(e.nomeModelo)}</h3>

        <div class="equip-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg>
          <span>${UI.escapeHtml(e.clienteEmpresa)}</span>
        </div>
        <div class="equip-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>${UI.escapeHtml(e.localizacaoSetor)}</span>
        </div>
        <div class="equip-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>${UI.escapeHtml(e.tecnicoResponsavelNome || '—')}</span>
        </div>
        <div class="equip-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>Instalado em ${UI.formatarData(e.dataInstalacao, { hora: false })}</span>
        </div>

        <div class="equip-actions">
          <button class="btn btn--ghost btn--sm" data-action="ver">Ver detalhes / QR</button>
          <button class="btn btn--accent btn--sm" data-action="visita">Visita</button>
        </div>
      </article>
    `).join('');

    $listaEquip.querySelectorAll('.equip-card').forEach((card) => {
      const id = card.dataset.id;
      card.querySelector('[data-action="ver"]').addEventListener('click', () => abrirDetalhes(id));
      card.querySelector('[data-action="visita"]').addEventListener('click', () => abrirNovaVisita(id));
    });
  }

  idsFiltro.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => { renderizar(); atualizarBadgeFiltros(); });
    el.addEventListener('change', () => { renderizar(); atualizarBadgeFiltros(); });
  });

  document.getElementById('btn-limpar-filtros')?.addEventListener('click', () => {
    idsFiltro.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    renderizar();
    atualizarBadgeFiltros();
  });

  (function ajustarFiltrosMobile() {
    const det = document.getElementById('filters-details');
    if (!det) return;
    if (window.matchMedia('(max-width: 720px)').matches) det.removeAttribute('open');
    else det.setAttribute('open', '');
  })();

  function preencherTiposEquipamento(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const tipos = window.TENANT?.atual?.equipamentoTipos || [
      'Split', 'Janela', 'Ar condicionado de teto', 'Chiller', 'VRF'
    ];
    const atual = sel.value;
    sel.innerHTML = '<option value="">Selecione...</option>' +
      tipos.map((t) => `<option value="${UI.escapeHtml(t)}">${UI.escapeHtml(t)}</option>`).join('');
    if (atual) sel.value = atual;
  }

  function preencherTiposVisita() {
    const sel = document.getElementById('visita-tipo');
    if (!sel) return;
    const tipos = (window.TENANT?.atual?.visitaTipos || [
      'Manutencao preventiva', 'Manutencao corretiva', 'Higienizacao', 'Vistoria', 'Recarga de gas'
    ]).filter((t) => !/^instala/i.test(String(t).trim()));
    sel.innerHTML = '<option value="">Selecione...</option>' +
      tipos.map((t) => `<option value="${UI.escapeHtml(t)}">${UI.escapeHtml(t)}</option>`).join('');
  }

  function textoObservacoesVisita(v) {
    return (v.observacoes || v.descricaoServico || '').trim();
  }

  function initFormularioAr() {
    if (window.ESPEC_AR?.ativo()) {
      window.ESPEC_AR.renderFormulario('novo-ar-specs', 'novo');
    }
  }

  (async function boot() {
    await window.initApp?.();
    const u = window.AUTH?.usuarioAtual();
    if (u?.tenantId) await window.TENANT.carregar(u.tenantId);
    preencherTiposEquipamento('novo-tipo');
    preencherTiposVisita();
    initFormularioAr();
    await carregarEquipamentos();
    preencherSelectClientes('novo-cliente');
  })();

  let unsubVisitas = null;

  async function abrirDetalhes(equipId) {
    equipAtual = equipamentos.find((e) => e.id === equipId);
    if (!equipAtual) return;

    document.getElementById('md-titulo').textContent = equipAtual.nomeModelo;
    const body = document.getElementById('md-body');

    body.innerHTML = `
      <dl class="detalhe-grid">
        <div><dt>Tipo</dt><dd>${UI.escapeHtml(equipAtual.tipoEquipamento)}</dd></div>
        <div><dt>Numero de serie</dt><dd>${UI.escapeHtml(equipAtual.numeroSerie || '—')}</dd></div>
        <div><dt>Cliente / Empresa</dt><dd>${UI.escapeHtml(equipAtual.clienteEmpresa)}</dd></div>
        <div><dt>Localizacao</dt><dd>${UI.escapeHtml(equipAtual.localizacaoSetor)}</dd></div>
        <div><dt>Tecnico responsavel</dt><dd>${UI.escapeHtml(equipAtual.tecnicoResponsavelNome)}</dd></div>
        <div><dt>Data de instalacao</dt><dd>${UI.formatarData(equipAtual.dataInstalacao, { hora: false })}</dd></div>
        <div><dt>Cadastrado em</dt><dd>${UI.formatarData(equipAtual.criadoEm)}</dd></div>
        <div><dt>Ultima atualizacao</dt><dd>${UI.formatarData(equipAtual.atualizadoEm)}</dd></div>
        ${window.ESPEC_AR?.htmlDetalhe(equipAtual) || ''}
      </dl>

      <div class="qr-card">
        <div class="qr-card__box" id="qr-detalhes"></div>
        <div class="qr-card__actions">
          <strong>QR Code do equipamento</strong>
          <span class="text-muted" style="font-size: 0.86rem;">Cole no equipamento para acesso rapido ao historico.</span>
          <div class="flex gap-8" style="margin-top: 6px;">
            <button class="btn btn--sm" id="btn-baixar-qr">Baixar PNG</button>
            <button class="btn btn--ghost btn--sm" id="btn-imprimir-qr">Imprimir</button>
          </div>
          <div class="qr-card__url" id="qr-url"></div>
        </div>
      </div>

      <div class="flex flex--between" style="margin-bottom: 12px;">
        <h4 style="margin: 0;">Historico de visitas</h4>
        <button class="btn btn--accent btn--sm" id="btn-add-visita">+ Nova visita</button>
      </div>
      <div class="visitas-list" id="visitas-list">
        <p class="text-muted">Carregando...</p>
      </div>
    `;

    abrirModal('modal-detalhes');

    try {
      window.QR.gerarQRCode('qr-detalhes', equipAtual.id, { size: 144 });
      document.getElementById('qr-url').textContent = window.QR.urlPublica(equipAtual.id);
    } catch (e) {
      console.error(e);
    }

    document.getElementById('btn-baixar-qr').addEventListener('click', () => {
      window.QR.baixarQRCode(equipAtual.id, equipAtual.nomeModelo);
    });
    document.getElementById('btn-imprimir-qr').addEventListener('click', () => {
      window.QR.imprimirQRCode(equipAtual);
    });
    document.getElementById('btn-add-visita').addEventListener('click', () => {
      abrirNovaVisita(equipAtual.id);
    });

    if (unsubVisitas) unsubVisitas();
    unsubVisitas = window.DB.visitas.assinar(equipAtual.id, renderizarVisitas, 6000);
  }

  function renderizarVisitas(lista) {
    const el = document.getElementById('visitas-list');
    if (!el) return;
    if (!lista || lista.length === 0) {
      el.innerHTML = '<p class="text-muted">Nenhuma visita registrada ainda.</p>';
      return;
    }
    el.innerHTML = lista.map((v) => `
      <div class="visita-item">
        <div class="visita-item__head">
          <div>
            <span class="tipo">${UI.escapeHtml(v.tipoServico)}</span><br/>
            <strong>${UI.escapeHtml(v.tecnicoNome)}</strong>
          </div>
          <span class="data">${UI.formatarData(v.dataVisita)}</span>
        </div>
        <div class="visita-item__body">
          ${textoObservacoesVisita(v) ? `<p><strong>Observacoes:</strong> ${UI.escapeHtml(textoObservacoesVisita(v))}</p>` : ''}
          ${v.defeitosEncontrados ? `<p><strong>Defeitos:</strong> ${UI.escapeHtml(v.defeitosEncontrados)}</p>` : ''}
          ${v.pecasTrocadas ? `<p><strong>Pecas:</strong> ${UI.escapeHtml(v.pecasTrocadas)}</p>` : ''}
        </div>
      </div>
    `).join('');
  }

  document.querySelectorAll('[data-close="modal-detalhes"]').forEach((b) => {
    b.addEventListener('click', () => {
      if (unsubVisitas) { unsubVisitas(); unsubVisitas = null; }
    });
  });

  function abrirNovaVisita(equipId) {
    const e = equipamentos.find((x) => x.id === equipId);
    if (!e) {
      window.UI.toast('Equipamento nao encontrado.', 'danger');
      return;
    }
    preencherTiposVisita();
    document.getElementById('visita-equip-id').value = e.id;
    document.getElementById('visita-equip-nome').textContent = e.nomeModelo;
    document.getElementById('form-visita').reset();
    document.getElementById('visita-equip-id').value = e.id;
    ['err-visita-tipo'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
    abrirModal('modal-visita');
  }

  function preencherSelectEquipamentosVisita() {
    const sel = document.getElementById('sel-equip-visita');
    if (!sel) return;
    const lista = equipamentos.length ? equipamentos : equipFiltrados();
    sel.innerHTML = '<option value="">Selecione...</option>' +
      lista.map((e) =>
        `<option value="${UI.escapeHtml(e.id)}">${UI.escapeHtml(e.nomeModelo)} — ${UI.escapeHtml(e.clienteEmpresa)}</option>`
      ).join('');
  }

  $btnCadastrarVisita?.addEventListener('click', () => {
    if (!equipamentos.length) {
      window.UI.toast('Cadastre um equipamento antes de registrar visitas.', 'info');
      return;
    }
    document.getElementById('form-selecionar-equip')?.reset();
    document.getElementById('err-sel-equip').textContent = '';
    preencherSelectEquipamentosVisita();
    abrirModal('modal-selecionar-equip');
  });

  document.getElementById('form-selecionar-equip')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = document.getElementById('form-selecionar-equip');
    if (!form.reportValidity()) return;
    const id = document.getElementById('sel-equip-visita').value;
    fecharModal('modal-selecionar-equip');
    abrirNovaVisita(id);
  });

  document.getElementById('form-visita').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const equipId = document.getElementById('visita-equip-id').value;
    const tipo = document.getElementById('visita-tipo').value;
    const obs = document.getElementById('visita-obs').value.trim();

    document.getElementById('err-visita-tipo').textContent = '';
    if (!tipo) {
      document.getElementById('err-visita-tipo').textContent = 'Selecione o tipo.';
      return;
    }

    const btn = document.getElementById('btn-salvar-visita');
    const fim = window.UI.botaoLoading(btn, 'Salvando...');

    try {
      await window.DB.visitas.criar({
        equipamentoId: equipId,
        tecnicoUid: usuario.uid,
        tecnicoNome: usuario.nome,
        dataVisita: new Date().toISOString(),
        tipoServico: tipo,
        descricaoServico: '',
        observacoes: obs,
        defeitosEncontrados: document.getElementById('visita-def').value.trim(),
        pecasTrocadas: document.getElementById('visita-pecas').value.trim()
      });
      window.UI.toast('Visita registrada com sucesso!', 'success');
      fecharModal('modal-visita');
      await carregarEquipamentos();
      if (equipAtual && equipAtual.id === equipId) {
        const novo = equipamentos.find((e) => e.id === equipId);
        if (novo) { equipAtual = novo; abrirDetalhes(equipId); }
      }
    } catch (err) {
      window.UI.toast(`Erro: ${err.message}`, 'danger');
    } finally {
      fim();
    }
  });

  async function abrirFormNovoEquip(opts = {}) {
    const titulo = opts.titulo || 'Cadastrar novo equipamento';
    const btnTexto = opts.btnTexto || 'Cadastrar equipamento';
    document.getElementById('modal-novo-titulo').textContent = titulo;
    document.getElementById('btn-salvar-equip').textContent = btnTexto;
    document.getElementById('form-novo').reset();
    document.getElementById('novo-tecnico-display').value = usuario.nome;
    await carregarClientes();
    preencherTiposEquipamento('novo-tipo');
    preencherSelectClientes('novo-cliente');
    window.ESPEC_AR?.limparErros('novo');
    window.ESPEC_AR?.renderFormulario('novo-ar-specs', 'novo');
    ['err-novo-nome', 'err-novo-tipo', 'err-novo-local', 'err-novo-cliente', 'err-novo-data']
      .forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = ''; });
    if (opts.dataHoje) {
      document.getElementById('novo-data').value = new Date().toISOString().slice(0, 10);
    }
    abrirModal('modal-novo');
  }

  $btnNovo?.addEventListener('click', () => {
    abrirFormNovoEquip({ titulo: 'Cadastrar novo equipamento', btnTexto: 'Cadastrar equipamento' });
  });

  $btnInstalacao?.addEventListener('click', () => {
    abrirFormNovoEquip({ titulo: 'Cadastrar instalacao', btnTexto: 'Cadastrar instalacao', dataHoje: true });
  });

  document.getElementById('form-novo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = document.getElementById('form-novo');
    if (!form.reportValidity()) return;

    const v = {
      nomeModelo: document.getElementById('novo-nome').value.trim(),
      tipoEquipamento: document.getElementById('novo-tipo').value,
      numeroSerie: document.getElementById('novo-serie').value.trim(),
      localizacaoSetor: document.getElementById('novo-local').value.trim(),
      clienteEmpresa: document.getElementById('novo-cliente').value,
      dataInstalacao: document.getElementById('novo-data').value
    };

    const btn = document.getElementById('btn-salvar-equip');
    const fim = window.UI.botaoLoading(btn, 'Salvando...');
    try {
      await window.DB.equipamentos.criar({
        ...v,
        ...(window.ESPEC_AR?.lerValores('novo') || {}),
        tecnicoResponsavelUid: usuario.uid,
        tecnicoResponsavelNome: usuario.nome
      });
      window.UI.toast('Equipamento cadastrado!', 'success');
      fecharModal('modal-novo');
      await carregarEquipamentos();
    } catch (err) {
      window.UI.toast(`Erro: ${err.message}`, 'danger');
    } finally {
      fim();
    }
  });
})();
