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

  async function buscarEnderecoPorCep(cep) {
    const d = apenasDigitos(cep);
    if (d.length !== 8) return null;

    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { cache: 'no-store' });
      const j = await r.json();
      if (j && !j.erro) {
        return {
          logradouro: j.logradouro || '',
          bairro: j.bairro || '',
          cidade: j.localidade || '',
          uf: j.uf || '',
          cep: formatarCepInput(d)
        };
      }
    } catch (_) { /* tenta fallback */ }

    try {
      const r = await fetch(`https://brasilapi.com.br/api/cep/v1/${d}`, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        return {
          logradouro: j.street || '',
          bairro: j.neighborhood || '',
          cidade: j.city || '',
          uf: j.state || '',
          cep: formatarCepInput(d)
        };
      }
    } catch (_) { /* sem CEP */ }

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
