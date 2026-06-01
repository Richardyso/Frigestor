/**
 * qrcode-gen.js
 * --------------------------------------------------------------------------
 * Geracao, download e impressao do QR Code de cada equipamento.
 *
 * Dependencia: biblioteca QRCode.js (carregada via CDN nos HTMLs que usam):
 *   <script src="/assets/js/vendor/qrcode.min.js"></script>
 *
 * O QR codifica a URL publica da pagina equipamento.html?id={id}.
 *
 * Funcoes expostas em window.QR:
 *   - gerarQRCode(elementId, equipamentoId)
 *   - baixarQRCode(equipamentoId, nomeEquipamento)
 *   - imprimirQRCode(equipamentoId, nomeEquipamento, clienteEmpresa)
 */

(function () {
  'use strict';

  /**
   * Monta a URL publica de leitura do QR.
   * - Em DEV: usa window.BASE_URL (ex: http://localhost:3000)
   * - Em PROD: substituir window.BASE_URL no /env retornado pelo servidor
   *   ou definir diretamente em window.BASE_URL antes do load do script.
   */
  function publicBaseUrl() {
    const raw = (window.BASE_URL || window.location.origin).replace(/\/$/, '');
    if (/localhost|127\.0\.0\.1/i.test(raw) && !/localhost|127\.0\.0\.1/i.test(window.location.hostname)) {
      return window.location.origin.replace(/\/$/, '');
    }
    return raw;
  }

  function urlPublica(equipamentoId, tenantId) {
    const base = publicBaseUrl();
    const tenant = tenantId
      || window.AUTH?.usuarioAtual()?.tenantId
      || '';
    const params = new URLSearchParams({ id: equipamentoId });
    if (tenant) params.set('tenant', tenant);
    return `${base}/pages/equipamento.html?${params.toString()}`;
  }

  /**
   * Renderiza o QR no elemento alvo (limpa antes para permitir re-render).
   * Retorna o canvas/img gerado pela biblioteca QRCode.js.
   */
  function gerarQRCode(elementId, equipamentoId, opts = {}) {
    const alvo = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
    if (!alvo) throw new Error(`Elemento "${elementId}" nao encontrado para QR Code.`);
    if (typeof QRCode === 'undefined') {
      throw new Error('Biblioteca QRCode.js nao carregada. Adicione o script via CDN.');
    }

    alvo.innerHTML = '';
    const tamanho = opts.size || 220;

    // QRCode.js cria automaticamente um <canvas> e/ou <img> dentro do elemento
    new QRCode(alvo, {
      text: urlPublica(equipamentoId),
      width: tamanho,
      height: tamanho,
      colorDark: opts.colorDark || '#0E3D7A',
      colorLight: opts.colorLight || '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });

    return alvo;
  }

  /**
   * Gera o QR em um elemento offscreen, le o canvas como PNG e dispara o download.
   */
  function baixarQRCode(equipamentoId, nomeEquipamento) {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-9999px';
    document.body.appendChild(wrapper);

    try {
      gerarQRCode(wrapper, equipamentoId, { size: 480 });
      // QRCode.js renderiza um <canvas> e tambem um <img>. Preferimos o canvas.
      const canvas = wrapper.querySelector('canvas');
      const img    = wrapper.querySelector('img');

      let dataUrl;
      if (canvas) {
        dataUrl = canvas.toDataURL('image/png');
      } else if (img && img.src) {
        dataUrl = img.src;
      } else {
        throw new Error('Falha ao gerar imagem do QR Code.');
      }

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `qrcode-${slugify(nomeEquipamento || equipamentoId)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      wrapper.remove();
    }
  }

  /**
   * Abre uma janela popup com o QR + dados basicos, formatada para impressao.
   * Aceita objeto equipamento ou (id, nome, cliente) legado.
   */
  function imprimirQRCode(equipOrId, nomeEquipamento, clienteEmpresa) {
    let equip;
    if (equipOrId && typeof equipOrId === 'object') {
      equip = equipOrId;
    } else {
      equip = {
        id: equipOrId,
        nomeModelo: nomeEquipamento,
        clienteEmpresa: clienteEmpresa || ''
      };
    }

    const equipamentoId = equip.id;
    const url   = urlPublica(equipamentoId, equip.tenantId);
    const nome  = equip.nomeModelo || 'Equipamento';
    const cli   = equip.clienteEmpresa || '';
    const tenant = window.TENANT?.atual || {};
    const brandNome = equip.tenantNome || tenant.nome || 'Empresa';
    const brandSub = equip.tenantSubtitulo || tenant.brand?.subtitulo || 'Climatizacao e ar condicionado';
    const brandEmail = equip.tenantEmail || tenant.emailComercial || '';
    const brandTel = equip.tenantTelefone || tenant.telefoneComercial || '';
    const specs = window.ESPEC_AR?.listaImpressao(equip) || [];
    const specsHtml = specs.length
      ? specs.map((s) => `<div><dt>${escapeHtml(s.label)}</dt><dd>${escapeHtml(s.valor)}</dd></div>`).join('')
      : '';

    const popup = window.open('', '_blank', 'width=720,height=820');
    if (!popup) {
      window.UI?.toast('Permita popups para imprimir o QR Code.', 'danger');
      return;
    }

    popup.document.write(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Etiqueta QR - ${escapeHtml(nome)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <script src="/assets/js/vendor/qrcode.min.js"><\/script>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #0A1626; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 24mm 22mm;
      margin: 0 auto;
      display: flex; flex-direction: column;
    }
    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding-bottom: 16px;
      border-bottom: 2px solid #0E3D7A;
      margin-bottom: 28px;
    }
    .brand {
      font-family: 'Inter', sans-serif;
      font-weight: 800;
      color: #0E3D7A;
      font-size: 22px;
      letter-spacing: -0.02em;
    }
    .brand small { display: block; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 11px; color: #6C7E97; letter-spacing: 0.1em; text-transform: uppercase; }
    .title {
      font-family: 'Inter', sans-serif; font-weight: 700; font-size: 28px;
      letter-spacing: -0.02em;
      margin: 0 0 6px 0;
    }
    .subtitle { color: #6C7E97; font-size: 14px; margin: 0; }
    .qr-box {
      display: flex; flex-direction: column; align-items: center;
      padding: 32px;
      border: 2px dashed #0E3D7A;
      border-radius: 16px;
      margin: 28px 0;
    }
    .qr-box .canvas-wrap { padding: 18px; background: #fff; }
    .qr-url {
      margin-top: 18px;
      font-size: 12px;
      color: #6C7E97;
      word-break: break-all;
      text-align: center;
      max-width: 80%;
    }
    .info {
      display: grid; grid-template-columns: 1fr 1fr; gap: 14px 24px;
      font-size: 14px;
    }
    .info dt { color: #6C7E97; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px; }
    .info dd { margin: 0 0 12px 0; font-weight: 500; color: #0A1626; }
    .footer {
      margin-top: auto; padding-top: 18px;
      border-top: 1px solid #E0E6F0;
      display: flex; justify-content: space-between;
      font-size: 11px; color: #6C7E97;
    }
    .actions { padding: 14px 22mm; text-align: center; background: #f4f7fb; }
    .actions button { padding: 10px 20px; margin: 0 6px; border-radius: 8px; border: 0; cursor: pointer; font-weight: 600; }
    .actions .print { background: #0E3D7A; color: #fff; }
    .actions .close { background: #fff; color: #0E3D7A; border: 1px solid #0E3D7A; }
    @media print {
      .actions { display: none; }
      .page { padding: 16mm 14mm; }
    }
  </style>
</head>
<body>
  <div class="actions">
    <button class="print" onclick="window.print()">Imprimir</button>
    <button class="close" onclick="window.close()">Fechar</button>
  </div>

  <div class="page">
    <div class="header">
      <div class="brand">${escapeHtml(brandNome)}<small>${escapeHtml(brandSub)}</small></div>
      <div style="text-align:right; font-size: 12px; color:#6C7E97;">
        Etiqueta de identificacao<br/>
        ID: <strong>${escapeHtml(equipamentoId)}</strong>
      </div>
    </div>

    <h1 class="title">${escapeHtml(nome)}</h1>
    <p class="subtitle">${escapeHtml(cli)}</p>

    <div class="qr-box">
      <div id="qr" class="canvas-wrap"></div>
      <p class="qr-url">Escaneie para visualizar o historico completo:<br/>${escapeHtml(url)}</p>
    </div>

    <dl class="info">
      <div><dt>Equipamento</dt><dd>${escapeHtml(nome)}</dd></div>
      <div><dt>Cliente / Empresa</dt><dd>${escapeHtml(cli || '-')}</dd></div>
      <div><dt>Tipo</dt><dd>${escapeHtml(equip.tipoEquipamento || '-')}</dd></div>
      <div><dt>Capacidade</dt><dd>${escapeHtml(equip.capacidadeBtus ? equip.capacidadeBtus + ' BTUs' : '-')}</dd></div>
      ${specsHtml}
      <div><dt>ID interno</dt><dd>${escapeHtml(equipamentoId)}</dd></div>
      <div><dt>Emitido em</dt><dd>${new Date().toLocaleString('pt-BR')}</dd></div>
    </dl>

    <div class="footer">
      <span>${escapeHtml(brandEmail ? `${brandNome} - ${brandEmail}` : brandNome)}</span>
      <span>${brandTel ? `Tel: ${escapeHtml(brandTel)}` : ''}</span>
    </div>
  </div>

  <script>
    new QRCode(document.getElementById('qr'), {
      text: ${JSON.stringify(url)},
      width: 280,
      height: 280,
      colorDark: '#0E3D7A',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
    // Espera o QR pintar antes de oferecer a impressao
    setTimeout(function(){ /* pronto para o usuario clicar em Imprimir */ }, 250);
  <\/script>
</body>
</html>
    `);
    popup.document.close();
  }

  // -----------------------------------------------------------------------
  // Helpers internos
  // -----------------------------------------------------------------------
  function slugify(texto) {
    return String(texto || 'qr')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'qr';
  }
  function escapeHtml(t) {
    if (t === null || t === undefined) return '';
    return String(t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // -----------------------------------------------------------------------
  // Expoe globalmente
  // -----------------------------------------------------------------------
  window.QR = {
    gerarQRCode,
    baixarQRCode,
    imprimirQRCode,
    urlPublica
  };
})();

// TODO: Firestore Security Rules
// Nao se aplica diretamente (gera apenas URL publica). Garantir que as regras
// do Firestore permitam leitura publica da colecao `equipamentos` para que o
// QR escaneado funcione sem autenticacao.
