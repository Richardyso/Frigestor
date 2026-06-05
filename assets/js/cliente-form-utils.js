/**
 * cliente-form-utils.js — CPF/CNPJ, CEP e listas dinamicas (formulario de clientes)
 */
(function () {
  'use strict';

  function apenasDigitos(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function formatarCpf(n) {
    const d = apenasDigitos(n);
    if (d.length !== 11) return '';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  function formatarCnpj(n) {
    const d = apenasDigitos(n);
    if (d.length !== 14) return '';
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }

  function formatarDocumentoInput(val) {
    const d = apenasDigitos(val);
    if (d.length <= 11) {
      const p = d.slice(0, 11);
      if (p.length <= 3) return p;
      if (p.length <= 6) return `${p.slice(0, 3)}.${p.slice(3)}`;
      if (p.length <= 9) return `${p.slice(0, 3)}.${p.slice(3, 6)}.${p.slice(6)}`;
      return `${p.slice(0, 3)}.${p.slice(3, 6)}.${p.slice(6, 9)}-${p.slice(9)}`;
    }
    const p = d.slice(0, 14);
    if (p.length <= 2) return p;
    if (p.length <= 5) return `${p.slice(0, 2)}.${p.slice(2)}`;
    if (p.length <= 8) return `${p.slice(0, 2)}.${p.slice(2, 5)}.${p.slice(5)}`;
    if (p.length <= 12) return `${p.slice(0, 2)}.${p.slice(2, 5)}.${p.slice(5, 8)}/${p.slice(8)}`;
    return `${p.slice(0, 2)}.${p.slice(2, 5)}.${p.slice(5, 8)}/${p.slice(8, 12)}-${p.slice(12)}`;
  }

  function validarDocumento(val) {
    if (!val || !String(val).trim()) return null;
    const n = apenasDigitos(val);
    if (n.length === 11 || n.length === 14) return null;
    return 'CPF deve ter 11 digitos ou CNPJ 14 digitos.';
  }

  function formatarCepInput(val) {
    const d = apenasDigitos(val).slice(0, 8);
    if (d.length <= 5) return d;
    return `${d.slice(0, 5)}-${d.slice(5)}`;
  }

  function formatarTelefoneInput(val) {
    const d = apenasDigitos(val).slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  function normalizarRespostaCep(dados) {
    if (!dados) return null;
    const logradouro = String(dados.logradouro || '').trim();
    const bairro = String(dados.bairro || '').trim();
    const cidade = String(dados.cidade || '').trim();
    const uf = String(dados.uf || '').trim().toUpperCase();
    if (!logradouro && !bairro && !cidade) return null;
    return {
      logradouro,
      bairro,
      cidade,
      uf,
      cep: dados.cep ? formatarCepInput(dados.cep) : ''
    };
  }

  async function fetchJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return r.json();
  }

  /** BrasilAPI v2 (OpenCEP) — base mais atual que ViaCEP em CEPs novos. */
  async function buscarBrasilApiV2(d) {
    const j = await fetchJson(`https://brasilapi.com.br/api/cep/v2/${d}`);
    if (!j || j.errors || j.type === 'service_error') return null;
    return normalizarRespostaCep({
      logradouro: j.street,
      bairro: j.neighborhood,
      cidade: j.city,
      uf: j.state,
      cep: j.cep || d
    });
  }

  /** OpenCEP direto (mesma fonte usada pela BrasilAPI v2). */
  async function buscarOpenCep(d) {
    const j = await fetchJson(`https://opencep.com/v1/${d}`);
    if (!j || j.erro || j.error) return null;
    return normalizarRespostaCep({
      logradouro: j.logradouro,
      bairro: j.bairro,
      cidade: j.localidade,
      uf: j.uf,
      cep: j.cep || d
    });
  }

  /** ViaCEP — fallback; alguns CEPs novos ficam desatualizados (ex.: 58073-171). */
  async function buscarViaCep(d) {
    const j = await fetchJson(`https://viacep.com.br/ws/${d}/json/`);
    if (!j || j.erro) return null;
    return normalizarRespostaCep({
      logradouro: j.logradouro,
      bairro: j.bairro,
      cidade: j.localidade,
      uf: j.uf,
      cep: j.cep || d
    });
  }

  async function buscarEnderecoPorCep(cep) {
    const d = apenasDigitos(cep);
    if (d.length !== 8) return null;

    const fontes = [buscarBrasilApiV2, buscarOpenCep, buscarViaCep];
    for (const buscar of fontes) {
      try {
        const res = await buscar(d);
        if (res) return { ...res, cep: res.cep || formatarCepInput(d) };
      } catch (_) { /* proxima fonte */ }
    }
    return null;
  }

  window.CLIENTE_FORM = {
    apenasDigitos,
    formatarDocumentoInput,
    validarDocumento,
    formatarCepInput,
    formatarTelefoneInput,
    buscarEnderecoPorCep
  };
})();
