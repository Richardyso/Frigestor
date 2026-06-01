/**
 * equipamento.js
 * --------------------------------------------------------------------------
 * Pagina publica lida pelo QR Code.
 *   - Le `?id=` da URL
 *   - Busca o equipamento e exibe seus dados
 *   - Mostra historico de visitas em ordem decrescente
 *   - Atualizacoes em "tempo real" via window.DB.visitas.assinar
 *     (polling em etapa 1 / onSnapshot em etapa 2)
 *   - Tema claro, otimizado para impressao A4
 */

(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const equipId = params.get('id');
  const root = document.getElementById('conteudo');

  if (!equipId) {
    root.innerHTML = `
      <div class="pub-state">
        <h2>Equipamento nao informado</h2>
        <p>Use o QR Code do equipamento para acessar esta pagina.</p>
      </div>`;
    return;
  }

  // -----------------------------------------------------------------------
  // Helpers de formatacao
  // -----------------------------------------------------------------------
  function fmtData(iso, comHora = true) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('pt-BR', comHora
      ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function esc(t) {
    return window.UI ? window.UI.escapeHtml(t) : String(t || '');
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  function renderEquipamento(e) {
    root.innerHTML = `
      <section class="pub-hero">
        <span class="pub-hero__type">${esc(e.tipoEquipamento)}</span>
        <h1>${esc(e.nomeModelo)}</h1>
        <p class="cliente">${esc(e.clienteEmpresa)}</p>
      </section>

      <section class="pub-info">
        <h2>Dados do equipamento</h2>
        <dl>
          <div><dt>Numero de serie</dt><dd>${esc(e.numeroSerie || '—')}</dd></div>
          <div><dt>Localizacao / Setor</dt><dd>${esc(e.localizacaoSetor)}</dd></div>
          <div><dt>Cliente / Empresa</dt><dd>${esc(e.clienteEmpresa)}</dd></div>
          <div><dt>Tecnico responsavel</dt><dd>${esc(e.tecnicoResponsavelNome)}</dd></div>
          <div><dt>Data de instalacao</dt><dd>${fmtData(e.dataInstalacao, false)}</dd></div>
          <div><dt>Ultima atualizacao</dt><dd>${fmtData(e.atualizadoEm)}</dd></div>
          ${window.ESPEC_AR?.htmlDetalhe(e) || ''}
        </dl>
      </section>

      <div class="pub-section-title">
        <h2>Historico de visitas</h2>
        <span class="count" id="vis-count">carregando...</span>
      </div>
      <section id="visitas-publicas">
        <div class="pub-empty">Carregando historico...</div>
      </section>
    `;
  }

  function renderVisitas(lista) {
    const cont = document.getElementById('visitas-publicas');
    const cnt  = document.getElementById('vis-count');
    if (!cont) return;
    cnt.textContent = `${lista.length} registro(s)`;

    if (!lista.length) {
      cont.innerHTML = `<div class="pub-empty">Nenhuma visita registrada para este equipamento ate o momento.</div>`;
      return;
    }
    cont.innerHTML = lista.map((v) => `
      <article class="pub-visita">
        <div class="pub-visita__head">
          <div>
            <span class="pub-visita__tipo">${esc(v.tipoServico)}</span>
            <div class="pub-visita__tec">${esc(v.tecnicoNome)}</div>
          </div>
          <span class="pub-visita__data">${fmtData(v.dataVisita)}</span>
        </div>
        <p><strong>Observacoes:</strong> ${esc(v.observacoes || v.descricaoServico || '')}</p>
        ${v.defeitosEncontrados ? `<p><strong>Defeitos encontrados:</strong> ${esc(v.defeitosEncontrados)}</p>` : ''}
        ${v.pecasTrocadas       ? `<p><strong>Pecas trocadas:</strong> ${esc(v.pecasTrocadas)}</p>` : ''}
        ${v.observacoes         ? `<p><strong>Observacoes:</strong> ${esc(v.observacoes)}</p>` : ''}
      </article>
    `).join('');
  }

  function aplicarMarcaTenant(equip) {
    const nome = equip.tenantNome || 'Empresa';
    const sub = equip.tenantSubtitulo || 'Climatizacao e ar condicionado';
    const email = equip.tenantEmail || '';
    const tel = equip.tenantTelefone || '';
    document.title = `${equip.nomeModelo} - ${nome}`;
    const elNome = document.getElementById('pub-brand-nome');
    const elSub = document.getElementById('pub-brand-sub');
    const elFoot = document.getElementById('pub-foot-contato');
    const elTel = document.getElementById('pub-foot-tel');
    if (elNome) elNome.textContent = nome;
    if (elSub) elSub.textContent = sub;
    if (elFoot) elFoot.textContent = email ? `${nome} - ${email}` : nome;
    if (elTel) elTel.textContent = tel || '';
  }

  // -----------------------------------------------------------------------
  // Carregar dados
  // -----------------------------------------------------------------------
  async function carregar() {
    try {
      const equip = await window.DB.equipamentos.buscar(equipId);
      aplicarMarcaTenant(equip);
      renderEquipamento(equip);

      // assinatura "em tempo real" (polling local; onSnapshot na etapa 2)
      window.DB.visitas.assinar(equipId, renderVisitas, 8000);
    } catch (err) {
      if (err.status === 404) {
        root.innerHTML = `
          <div class="pub-state">
            <h2>Equipamento nao encontrado</h2>
            <p>O codigo escaneado nao corresponde a nenhum equipamento ativo.</p>
            <p class="pub-no-print"><a href="/">Voltar ao site</a></p>
          </div>`;
      } else {
        root.innerHTML = `
          <div class="pub-state">
            <h2>Falha ao carregar</h2>
            <p>${err.message || 'Erro desconhecido. Tente novamente.'}</p>
          </div>`;
      }
    }
  }

  carregar();
})();

// TODO: Firestore Security Rules
// match /equipamentos/{id} {
//   allow read: if true;
//   match /visitas/{visitaId} {
//     allow read: if true;
//   }
// }
