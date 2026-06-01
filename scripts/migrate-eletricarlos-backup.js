/**
 * Migra firestore-backup.json -> clientes, equipamentos, visitas (eletricarlos)
 * Uso: node scripts/migrate-eletricarlos-backup.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const BACKUP = path.join(ROOT, 'data', 'eletricarlos', 'firestore-backup.json');
const OUT = path.join(ROOT, 'data', 'eletricarlos');

const ADMIN = {
  uid: 'adm-el-001',
  nome: 'carlos Antonio dos Santos'
};

const CLIENTES_CANONICOS = {
  'dorys prime': 'Dorys Prime',
  'hotel guarany': 'Hotel Guarany',
  'hotel jr': 'Hotel JR',
  'pousada paraíso': 'Pousada Paraiso',
  'pousada paraiso': 'Pousada Paraiso'
};

const TIPO_POR_CATEGORIA = {
  'manutenção corretiva': 'Manutencao corretiva',
  'manutencao corretiva': 'Manutencao corretiva',
  'manutenção preventiva': 'Manutencao preventiva',
  'manutencao preventiva': 'Manutencao preventiva',
  'observação': 'Observacao',
  'observacao': 'Observacao'
};

function slugify(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function gerarId(prefixo) {
  return `${prefixo}-${crypto.randomBytes(4).toString('hex')}`;
}

function parseDataBR(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dia = m[1].padStart(2, '0');
  const mes = m[2].padStart(2, '0');
  const ano = m[3];
  const d = new Date(`${ano}-${mes}-${dia}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizarCliente(nomeChave) {
  const chave = nomeChave.trim().toLowerCase();
  return CLIENTES_CANONICOS[chave] || nomeChave.trim();
}

function parseChaveColecao(key) {
  const idx = key.lastIndexOf('_');
  if (idx === -1) return null;
  const clienteRaw = key.slice(0, idx);
  const categoriaRaw = key.slice(idx + 1);
  const categoriaKey = categoriaRaw.trim().toLowerCase();
  const tipoServico = TIPO_POR_CATEGORIA[categoriaKey];
  if (!tipoServico) {
    console.warn('[aviso] Categoria desconhecida:', key);
    return null;
  }
  return {
    cliente: normalizarCliente(clienteRaw),
    tipoServico
  };
}

function main() {
  const backup = JSON.parse(fs.readFileSync(BACKUP, 'utf-8'));
  const dados = backup.collections?.dados || {};

  const clientesLista = [
    { id: 'cli-el-dorys', nome: 'Dorys Prime', ativo: true, criadoEm: new Date().toISOString() },
    { id: 'cli-el-guarany', nome: 'Hotel Guarany', ativo: true, criadoEm: new Date().toISOString() },
    { id: 'cli-el-jr', nome: 'Hotel JR', ativo: true, criadoEm: new Date().toISOString() },
    { id: 'cli-el-paraiso', nome: 'Pousada Paraiso', ativo: true, criadoEm: new Date().toISOString() }
  ];

  /** @type {Map<string, { id, nomeModelo, clienteEmpresa, datas: string[] }>} */
  const equipMap = new Map();
  /** @type {Array<object>} */
  const visitas = [];

  for (const [key, doc] of Object.entries(dados)) {
    const meta = parseChaveColecao(key);
    if (!meta) continue;
    const entries = doc.entries || [];

    for (const entry of entries) {
      const numero = String(entry.numero ?? '').trim();
      const observacao = String(entry.observacao ?? '').trim();
      const dataIso = parseDataBR(entry.data);

      if (!numero && !dataIso && !observacao) continue;
      if (!numero) continue;

      const eqKey = `${meta.cliente}::${numero}`;
      if (!equipMap.has(eqKey)) {
        equipMap.set(eqKey, {
          id: `eq-el-${slugify(meta.cliente)}-${slugify(numero)}`.slice(0, 48),
          nomeModelo: numero,
          clienteEmpresa: meta.cliente,
          datas: []
        });
      }
      if (dataIso) equipMap.get(eqKey).datas.push(dataIso);

      if (!dataIso) continue;

      visitas.push({
        equipKey: eqKey,
        dataVisita: dataIso,
        tipoServico: meta.tipoServico,
        observacoes: observacao
      });
    }
  }

  const agora = new Date().toISOString();
  const equipamentos = [];

  for (const [, eq] of equipMap) {
    equipamentos.push({
      id: eq.id,
      nomeModelo: eq.nomeModelo,
      numeroSerie: '',
      tipoEquipamento: '',
      localizacaoSetor: '',
      clienteEmpresa: eq.clienteEmpresa,
      tecnicoResponsavelUid: ADMIN.uid,
      tecnicoResponsavelNome: ADMIN.nome,
      dataInstalacao: '',
      criadoEm: agora,
      atualizadoEm: agora
    });
  }

  equipamentos.sort((a, b) =>
    a.clienteEmpresa.localeCompare(b.clienteEmpresa, 'pt-BR')
    || a.nomeModelo.localeCompare(b.nomeModelo, 'pt-BR', { numeric: true })
  );

  const eqIdByKey = Object.fromEntries([...equipMap.entries()].map(([k, v]) => [k, v.id]));

  const visitasOut = visitas
    .map((v) => ({
      id: gerarId('vis'),
      equipamentoId: eqIdByKey[v.equipKey],
      tecnicoUid: ADMIN.uid,
      tecnicoNome: ADMIN.nome,
      dataVisita: v.dataVisita,
      tipoServico: v.tipoServico,
      descricaoServico: '',
      defeitosEncontrados: '',
      pecasTrocadas: '',
      observacoes: v.observacoes,
      criadoEm: v.dataVisita
    }))
    .sort((a, b) => new Date(b.dataVisita) - new Date(a.dataVisita));

  const usuarios = JSON.parse(fs.readFileSync(path.join(OUT, 'usuarios.json'), 'utf-8'));
  const adminOnly = usuarios.filter((u) => u.uid === ADMIN.uid);

  fs.writeFileSync(path.join(OUT, 'clientes.json'), JSON.stringify(clientesLista, null, 2), 'utf-8');
  fs.writeFileSync(path.join(OUT, 'equipamentos.json'), JSON.stringify(equipamentos, null, 2), 'utf-8');
  fs.writeFileSync(path.join(OUT, 'visitas.json'), JSON.stringify(visitasOut, null, 2), 'utf-8');
  fs.writeFileSync(path.join(OUT, 'usuarios.json'), JSON.stringify(adminOnly, null, 2), 'utf-8');

  const configPath = path.join(OUT, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  if (!config.visitaTipos.includes('Observacao')) {
    config.visitaTipos.push('Observacao');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  console.log('Migracao eletricarlos concluida:');
  console.log(`  Clientes: ${clientesLista.length}`);
  console.log(`  Equipamentos: ${equipamentos.length}`);
  console.log(`  Visitas: ${visitasOut.length}`);
  console.log(`  Usuarios: ${adminOnly.length} (apenas admin)`);

  const porCliente = {};
  for (const c of clientesLista) {
    porCliente[c.nome] = {
      equipamentos: equipamentos.filter((e) => e.clienteEmpresa === c.nome).length,
      visitas: visitasOut.filter((v) => {
        const eq = equipamentos.find((e) => e.id === v.equipamentoId);
        return eq?.clienteEmpresa === c.nome;
      }).length
    };
  }
  console.log('  Por cliente:', porCliente);
}

main();
