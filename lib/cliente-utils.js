/**
 * lib/cliente-utils.js — normalizacao de clientes (documento, endereco, listas)
 */

function apenasDigitos(val) {
  return String(val || '').replace(/\D/g, '');
}

function formatarCpf(d) {
  const n = apenasDigitos(d);
  if (n.length !== 11) return null;
  return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
}

function formatarCnpj(d) {
  const n = apenasDigitos(d);
  if (n.length !== 14) return null;
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
}

/** Normaliza CPF (11 digitos) ou CNPJ (14). Retorna string formatada ou '' se vazio. */
function normalizarDocumento(val) {
  const raw = String(val || '').trim();
  if (!raw) return '';
  const n = apenasDigitos(raw);
  if (n.length === 11) return formatarCpf(n);
  if (n.length === 14) return formatarCnpj(n);
  return null;
}

function validarDocumento(val) {
  if (!val || !String(val).trim()) return null;
  const n = apenasDigitos(val);
  if (n.length === 11 || n.length === 14) return null;
  return 'Informe CPF (11 digitos) ou CNPJ (14 digitos).';
}

function normalizarContatos(val) {
  if (!val) return [];
  const lista = Array.isArray(val) ? val : normalizarListaTexto(val);
  return lista.map((item) => {
    if (typeof item === 'object' && item !== null) {
      const telefone = String(item.telefone || '').trim();
      const rotulo = String(item.rotulo || '').trim();
      if (!telefone && !rotulo) return null;
      return { telefone, rotulo };
    }
    const s = String(item || '').trim();
    if (!s) return null;
    const sep = s.match(/^(.+?)\s*[—\-|]\s*(.+)$/);
    if (sep) return { telefone: sep[1].trim(), rotulo: sep[2].trim() };
    return { telefone: s, rotulo: '' };
  }).filter(Boolean);
}

function mesclarContatosLegado(contatos, responsaveis) {
  const nums = normalizarContatos(contatos);
  const rotulos = normalizarListaTexto(responsaveis);
  if (!rotulos.length) return nums;
  if (!nums.length) {
    return rotulos.map((rotulo) => ({ telefone: '', rotulo }));
  }
  return nums.map((item, i) => ({
    telefone: item.telefone,
    rotulo: item.rotulo || rotulos[i] || ''
  }));
}
function normalizarListaTexto(val) {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof val === 'string') {
    return val.split(/[\n;]+/).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function montarEndereco(partes) {
  const log = String(partes.logradouro || '').trim();
  const num = String(partes.numero || '').trim();
  const bairro = String(partes.bairro || '').trim();
  const cidade = String(partes.cidade || '').trim();
  const cep = formatarCep(partes.cep);
  const pedacos = [];
  if (log) pedacos.push(num ? `${log}, ${num}` : log);
  if (bairro) pedacos.push(bairro);
  if (cidade) pedacos.push(cidade);
  if (cep) pedacos.push(`CEP ${cep}`);
  return pedacos.join(' — ').trim();
}

function formatarCep(val) {
  const n = apenasDigitos(val);
  if (n.length !== 8) return String(val || '').trim();
  return `${n.slice(0, 5)}-${n.slice(5)}`;
}

function validarEnderecoPartes(partes) {
  if (!String(partes.logradouro || '').trim()) return 'Informe o logradouro.';
  if (!String(partes.cidade || '').trim()) return 'Informe a cidade.';
  const cepN = apenasDigitos(partes.cep);
  if (partes.cep && cepN.length !== 8) return 'CEP deve ter 8 digitos.';
  return null;
}

function normalizarClientePayload(body, existente = null) {
  const nome = String(body.nome ?? existente?.nome ?? '').trim();
  const obsRaw = body.observacoes != null ? body.observacoes : existente?.observacoes;
  const observacoes = obsRaw != null ? String(obsRaw).trim() : '';

  const docRaw = body.documento != null ? body.documento
    : (body.cnpj != null ? body.cnpj : existente?.documento ?? existente?.cnpj);
  const documento = docRaw != null && String(docRaw).trim()
    ? normalizarDocumento(docRaw)
    : '';

  const contatosRaw = 'contatos' in (body || {})
    ? body.contatos
    : (existente?.contatos || []);
  const respLegado = 'responsaveis' in (body || {})
    ? body.responsaveis
    : (existente?.responsaveis || []);
  const contatos = 'contatos' in (body || {})
    ? normalizarContatos(contatosRaw)
    : mesclarContatosLegado(existente?.contatos, existente?.responsaveis);
  const responsaveis = contatos.map((c) => c.rotulo).filter(Boolean);

  const partes = {
    logradouro: String(body.logradouro ?? existente?.logradouro ?? '').trim(),
    numero: String(body.numero ?? existente?.numero ?? '').trim(),
    bairro: String(body.bairro ?? existente?.bairro ?? '').trim(),
    cidade: String(body.cidade ?? existente?.cidade ?? '').trim(),
    cep: body.cep != null ? body.cep : (existente?.cep ?? '')
  };

  let endereco = montarEndereco(partes);
  if (!endereco && existente?.endereco && !('logradouro' in (body || {}))) {
    endereco = String(existente.endereco).trim();
  }
  if (!partes.logradouro && body.endereco) {
    endereco = String(body.endereco).trim();
  }

  return {
    nome,
    documento: documento || null,
    cnpj: documento || null,
    logradouro: partes.logradouro || null,
    numero: partes.numero || null,
    bairro: partes.bairro || null,
    cidade: partes.cidade || null,
    cep: partes.cep ? formatarCep(partes.cep) : null,
    endereco,
    contatos,
    responsaveis,
    observacoes: observacoes || null,
    areas: existente?.areas || []
  };
}

module.exports = {
  apenasDigitos,
  normalizarDocumento,
  validarDocumento,
  normalizarListaTexto,
  normalizarContatos,
  mesclarContatosLegado,
  montarEndereco,
  formatarCep,
  validarEnderecoPartes,
  normalizarClientePayload
};
