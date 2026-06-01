/**
 * equipamento-ar-specs.js
 * Especificacoes tecnicas de ar condicionado (listas fixas + helpers de formulario).
 */
(function () {
  'use strict';

  const ESPEC_AR_OPCOES_PADRAO = {
    eficienciaEnergetica: ['A', 'B', 'C', 'D', 'E', 'F'],
    tensao: ['110V', '220V', '330V'],
    tipoAlimentacao: ['Monofasico', 'Bifasico', 'Trifasico'],
    tipoGas: ['R-32', 'R-410A', 'R-22', 'R-407C', 'R-134a', 'R-1234yf', 'R-12', 'R-600'],
    capacidadeBtus: [
      '7.500', '9.000', '12.000', '18.000', '19.000', '22.000', '24.000',
      '30.000', '36.000', '48.000', '54.000', '56.000', '60.000', '80.000', '120.000'
    ]
  };

  const ESPEC_AR_CAMPOS = [
    { key: 'eficienciaEnergetica', label: 'Eficiencia energetica (Inmetro)' },
    { key: 'tensao', label: 'Tensao' },
    { key: 'tipoAlimentacao', label: 'Tipo de alimentacao' },
    { key: 'tipoGas', label: 'Tipo de gas' },
    { key: 'capacidadeBtus', label: 'Capacidade (BTUs)' }
  ];

  function opcoes() {
    return window.TENANT?.atual?.especificacoesArOpcoes || ESPEC_AR_OPCOES_PADRAO;
  }

  function ativo() {
    return window.TENANT?.atual?.usaEspecificacoesAr !== false;
  }

  function montarSelectHtml(campo, prefix, valorAtual) {
    const lista = opcoes()[campo.key] || [];
    const id = `${prefix}-${campo.key}`;
    const opts = ['<option value="">Selecione...</option>']
      .concat(lista.map((v) =>
        `<option value="${escapeAttr(v)}"${v === valorAtual ? ' selected' : ''}>${escapeHtml(v)}</option>`
      ));
    return `
      <div class="form-group ar-spec-field">
        <label class="form-label" for="${id}">${campo.label} *</label>
        <select class="form-control ar-spec-select" id="${id}" data-campo="${campo.key}" required>${opts.join('')}</select>
        <small class="form-error" id="err-${prefix}-${campo.key}"></small>
      </div>`;
  }

  function renderFormulario(containerId, prefix, valores = {}) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!ativo()) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = `
      <h4 class="form-section-title">Especificacoes tecnicas</h4>
      <div class="ar-specs-grid">${ESPEC_AR_CAMPOS.map((c) => montarSelectHtml(c, prefix, valores[c.key] || '')).join('')}</div>`;
  }

  function lerValores(prefix) {
    const out = {};
    ESPEC_AR_CAMPOS.forEach((c) => {
      const sel = document.getElementById(`${prefix}-${c.key}`);
      if (sel) out[c.key] = sel.value;
    });
    return out;
  }

  function validar(prefix) {
    if (!ativo()) return true;
    let ok = true;
    ESPEC_AR_CAMPOS.forEach((c) => {
      const errEl = document.getElementById(`err-${prefix}-${c.key}`);
      const sel = document.getElementById(`${prefix}-${c.key}`);
      const val = sel?.value || '';
      const lista = opcoes()[c.key] || [];
      let msg = '';
      if (!val) msg = 'Selecione uma opcao.';
      else if (!lista.includes(val)) msg = 'Opcao invalida.';
      if (errEl) errEl.textContent = msg;
      if (msg) ok = false;
    });
    return ok;
  }

  function limparErros(prefix) {
    ESPEC_AR_CAMPOS.forEach((c) => {
      const errEl = document.getElementById(`err-${prefix}-${c.key}`);
      if (errEl) errEl.textContent = '';
    });
  }

  function htmlDetalhe(equip) {
    if (!equip?.eficienciaEnergetica) return '';
    return ESPEC_AR_CAMPOS.map((c) =>
      `<div><dt>${c.label}</dt><dd>${escapeHtml(equip[c.key] || '—')}</dd></div>`
    ).join('');
  }

  function listaImpressao(equip) {
    if (!equip?.eficienciaEnergetica) return [];
    return ESPEC_AR_CAMPOS.map((c) => ({ label: c.label, valor: equip[c.key] || '—' }));
  }

  function escapeHtml(t) {
    if (t === null || t === undefined) return '';
    return String(t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(t) { return escapeHtml(t); }

  window.ESPEC_AR = {
    CAMPOS: ESPEC_AR_CAMPOS,
    OPCOES_PADRAO: ESPEC_AR_OPCOES_PADRAO,
    opcoes,
    ativo,
    renderFormulario,
    lerValores,
    validar,
    limparErros,
    htmlDetalhe,
    listaImpressao
  };
})();
