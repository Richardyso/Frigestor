/**
 * Servidor Express minimo — Frigestor (multi-tenant)
 * --------------------------------------------------------------------------
 * - Serve os arquivos estaticos (HTML, CSS, JS, imagens)
 * - Expoe rota /env com as variaveis publicas do Firebase
 * - Camada de dados: Cloud Firestore (lib/data-store.js)
 *     tenants                    — empresas
 *     tenants/{id}/*             — usuarios, equipamentos, visitas, clientes, config
 *     plataforma/*               — super admin, pendentes, recuperacao de senha
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { lerJson, escreverJson, tenantDocExiste } = require('./lib/data-store');
const { verifyGoogleIdToken } = require('./lib/firebase-admin');
const {
  sendWelcomeEmail,
  sendActivationEmail,
  sendContaCriadaPeloAdminEmail,
  sendPasswordResetCodeEmail
} = require('./lib/email');
const { hashSenha, hashSenhaSeNecessario, verificarSenha } = require('./lib/password');
const {
  criarSolicitacao,
  verificarCodigo,
  consumirReset,
  buscarResetPorToken,
  normalizarEmail
} = require('./lib/password-reset');
const { resolveSiteUrl } = require('./lib/site-url');
const { googleOAuthHabilitado, cadastroPublicoHabilitado } = require('./lib/auth-flags');
const {
  normalizarClientePayload: normalizarClienteDados,
  validarDocumento,
  validarEnderecoPartes,
  normalizarDocumento
} = require('./lib/cliente-utils');
const { verifyToken, extrairToken, responderAutenticado, clearAuthCookie } = require('./lib/auth-token');
const {
  authenticate,
  requireSuperAdmin,
  requireTenantMember,
  requireTenantAdmin,
  tenantIdAutenticado,
  requirePageRoles,
  servirPaginaInterna,
  forbidden
} = require('./lib/auth-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = resolveSiteUrl();

// --------------------------------------------------------------------------
// Middlewares
// --------------------------------------------------------------------------
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

function gerarId(prefixo) {
  return `${prefixo}-${crypto.randomBytes(4).toString('hex')}`;
}

function agoraISO() {
  return new Date().toISOString();
}

/** Tenant da requisicao (header, query tenantId ou tenant na URL publica). */
function tenantIdFromReq(req) {
  const header = req.headers['x-tenant-id'];
  if (header) return String(header).trim();
  if (req.query.tenantId) return String(req.query.tenantId).trim();
  if (req.query.tenant) return String(req.query.tenant).trim();
  return null;
}

async function listarTenantIds() {
  const tenants = await lerJson('tenants.json');
  return tenants.filter((t) => t.ativo !== false).map((t) => t.id);
}

async function tenantAtivo(tenantId) {
  const tenants = await lerJson('tenants.json');
  const t = tenants.find((x) => x.id === tenantId);
  return t && t.ativo !== false ? t : null;
}

async function lerTenantJson(tenantId, arquivo) {
  if (!(await tenantAtivo(tenantId))) {
    const err = new Error('Tenant invalido.');
    err.code = 'TENANT_INVALIDO';
    throw err;
  }
  return lerJson(path.join(tenantId, arquivo));
}

async function escreverTenantJson(tenantId, arquivo, dados) {
  if (!(await tenantAtivo(tenantId))) {
    const err = new Error('Tenant invalido.');
    err.code = 'TENANT_INVALIDO';
    throw err;
  }
  await escreverJson(path.join(tenantId, arquivo), dados);
}

async function buscarUsuarioLogin(email, senha) {
  const emailNorm = String(email).toLowerCase();
  const pendentes = await lerJson('plataforma/cadastros-pendentes.json');
  const pendente = pendentes.find((u) => u.email.toLowerCase() === emailNorm);
  if (pendente && (await verificarSenha(senha, pendente.senha))) {
    return { usuario: pendente, tenantId: null, pendente: true };
  }

  for (const tid of await listarTenantIds()) {
    const usuarios = await lerTenantJson(tid, 'usuarios.json');
    const usuario = usuarios.find((u) => u.email.toLowerCase() === emailNorm);
    if (usuario && (await verificarSenha(senha, usuario.senha))) {
      return { usuario, tenantId: tid, pendente: false };
    }
  }
  return null;
}

async function buscarAdminLogin(email, senha) {
  const emailNorm = String(email).toLowerCase();
  const admins = await lerJson('plataforma/usuarios.json');
  const usuario = admins.find((u) => u.email.toLowerCase() === emailNorm);
  if (!usuario || !(await verificarSenha(senha, usuario.senha))) return null;
  return { usuario, tenantId: null, pendente: false };
}

async function emailJaCadastrado(email) {
  const emailNorm = String(email).toLowerCase();
  const admins = await lerJson('plataforma/usuarios.json');
  if (admins.some((u) => u.email.toLowerCase() === emailNorm)) return true;
  const pendentes = await lerJson('plataforma/cadastros-pendentes.json');
  if (pendentes.some((u) => u.email.toLowerCase() === emailNorm)) return true;
  for (const tid of await listarTenantIds()) {
    const usuarios = await lerTenantJson(tid, 'usuarios.json');
    if (usuarios.some((u) => u.email.toLowerCase() === emailNorm)) return true;
  }
  return false;
}

/** Usuario ativo com login liberado (tenant ou super_admin). */
async function localizarUsuarioAtivoPorEmail(email) {
  const emailNorm = normalizarEmail(email);
  if (!emailNorm) return null;

  const admins = await lerJson('plataforma/usuarios.json');
  const admin = admins.find((u) =>
    u.email.toLowerCase() === emailNorm && u.ativo !== false && u.role === 'super_admin'
  );
  if (admin) return { tipo: 'plataforma', usuario: admin };

  for (const tid of await listarTenantIds()) {
    const usuarios = await lerTenantJson(tid, 'usuarios.json');
    const idx = usuarios.findIndex((u) =>
      u.email.toLowerCase() === emailNorm
      && u.ativo !== false
      && u.status !== 'pendente'
      && u.role
    );
    if (idx !== -1) {
      return { tipo: 'tenant', tenantId: tid, usuarios, idx, usuario: usuarios[idx] };
    }
  }
  return null;
}

async function atualizarSenhaPorEmail(email, novaSenhaHash) {
  const loc = await localizarUsuarioAtivoPorEmail(email);
  if (!loc) return false;

  if (loc.tipo === 'plataforma') {
    const admins = await lerJson('plataforma/usuarios.json');
    const idx = admins.findIndex((u) => u.email.toLowerCase() === normalizarEmail(email));
    if (idx === -1) return false;
    admins[idx].senha = novaSenhaHash;
    await escreverJson('plataforma/usuarios.json', admins);
    return true;
  }

  loc.usuarios[loc.idx].senha = novaSenhaHash;
  await escreverTenantJson(loc.tenantId, 'usuarios.json', loc.usuarios);
  return true;
}

function respostaLoginUsuario(usuario, tenantId) {
  const { senha: _omit, ...sem } = usuario;
  return { ...sem, tenantId: tenantId ?? null };
}

async function loginPorEmailGoogle(email) {
  const emailNorm = normalizarEmail(email);
  if (!emailNorm) return { erro: 400, msg: 'E-mail invalido.' };

  const pendentes = await lerJson('plataforma/cadastros-pendentes.json');
  const pendente = pendentes.find((u) => u.email.toLowerCase() === emailNorm);
  if (pendente) {
    return {
      erro: 403,
      codigo: 'CADASTRO_NAO_ATIVADO',
      msg: 'Cadastro nao ativado',
      detalhe: 'Seu cadastro foi recebido, mas ainda aguarda liberacao pelo administrador da sua empresa.'
    };
  }

  const loc = await localizarUsuarioAtivoPorEmail(emailNorm);
  if (!loc) {
    return {
      erro: 403,
      msg: 'Este e-mail Google nao esta cadastrado no Frigestor. Fale com o administrador da sua empresa.'
    };
  }

  const { usuario } = loc;
  if (loc.tipo === 'plataforma') {
    if (!usuario.ativo || usuario.role !== 'super_admin') {
      return { erro: 403, msg: 'Conta desativada. Contate o administrador.' };
    }
    return { ok: respostaLoginUsuario(usuario, null) };
  }

  if (!usuario.ativo) {
    return { erro: 403, msg: 'Usuario desativado. Contate o administrador.' };
  }
  if (!usuario.role) {
    return {
      erro: 403,
      codigo: 'CADASTRO_NAO_ATIVADO',
      msg: 'Cadastro nao ativado',
      detalhe: 'Sua conta ainda nao foi vinculada a uma empresa.'
    };
  }

  return { ok: respostaLoginUsuario(usuario, loc.tenantId) };
}

/** Login Google: entra se ativo; se desconhecido, cria cadastro pendente automaticamente. */
async function loginGoogleComCadastroAuto(decoded) {
  const resultado = await loginPorEmailGoogle(decoded.email);
  if (resultado.ok || resultado.codigo) return resultado;

  const emailDesconhecido = resultado.erro === 403
    && !resultado.codigo
    && String(resultado.msg).includes('nao esta cadastrado');
  if (!emailDesconhecido) return resultado;

  const nome = String(decoded.name || '').trim() || String(decoded.email).split('@')[0];
  const cadastro = await criarCadastroPendente({
    nome,
    email: decoded.email,
    senhaHash: null,
    authGoogle: true
  });
  if (cadastro.ok) {
    return {
      erro: 403,
      codigo: 'CADASTRO_NAO_ATIVADO',
      msg: 'Cadastro nao ativado',
      detalhe: cadastro.ok.mensagem,
      emailEnviado: cadastro.ok.emailEnviado,
      cadastroCriado: true
    };
  }
  return cadastro;
}

async function validarTokenGoogle(idToken) {
  if (!idToken) {
    return { erro: 400, msg: 'Token Google invalido.' };
  }
  let decoded;
  try {
    decoded = await verifyGoogleIdToken(idToken);
  } catch (err) {
    console.error('[Google Auth] verifyIdToken:', err.message);
    return { erro: 401, msg: 'Sessao Google invalida ou expirada. Tente novamente.' };
  }
  if (!decoded.email) {
    return { erro: 400, msg: 'Conta Google sem e-mail. Use outra conta.' };
  }
  if (decoded.email_verified === false) {
    return { erro: 403, msg: 'Confirme o e-mail da sua conta Google antes de continuar.' };
  }
  return { ok: decoded };
}

async function criarCadastroPendente({ nome, email, senhaHash, authGoogle }) {
  const emailNorm = normalizarEmail(email);
  if (!emailNorm) return { erro: 400, msg: 'E-mail invalido.' };

  const usuarios = await lerJson('plataforma/cadastros-pendentes.json');
  const pendenteExistente = usuarios.find((u) => u.email.toLowerCase() === emailNorm);
  if (pendenteExistente) {
    return {
      erro: 403,
      codigo: 'CADASTRO_NAO_ATIVADO',
      msg: 'Cadastro nao ativado',
      detalhe: 'Seu cadastro ja foi recebido e aguarda liberacao pelo administrador da sua empresa.'
    };
  }
  if (await emailJaCadastrado(email)) {
    return { erro: 409, msg: 'Ja existe uma conta com este e-mail.' };
  }

  const novo = {
    uid: gerarId('usr'),
    nome: String(nome).trim(),
    email: String(email).trim(),
    senha: senhaHash ?? null,
    authGoogle: authGoogle === true,
    role: null,
    status: 'pendente',
    ativo: false,
    criadoEm: agoraISO()
  };
  usuarios.push(novo);
  await escreverJson('plataforma/cadastros-pendentes.json', usuarios);

  const emailResult = await sendWelcomeEmail(novo.email, novo.nome);
  const { senha: _omit, ...sem } = novo;
  return {
    ok: {
      ...sem,
      emailEnviado: emailResult.ok,
      mensagem: emailResult.ok
        ? 'Cadastro recebido! Enviamos um e-mail de boas-vindas. Aguarde o administrador da sua empresa ativar seu acesso.'
        : 'Cadastro recebido. Aguarde o administrador da sua empresa ativar seu acesso.'
    }
  };
}

async function localizarUsuario(uid, tenantHint) {
  const ids = tenantHint ? [tenantHint] : await listarTenantIds();
  for (const tid of ids) {
    try {
      const usuarios = await lerTenantJson(tid, 'usuarios.json');
      const idx = usuarios.findIndex((u) => u.uid === uid);
      if (idx !== -1) return { tenantId: tid, usuarios, idx };
    } catch (_) { /* tenant invalido */ }
  }
  return null;
}

async function localizarEquipamento(id, tenantHint) {
  const ids = tenantHint ? [tenantHint, ...(await listarTenantIds())] : await listarTenantIds();
  const vistos = new Set();
  for (const tid of ids) {
    if (vistos.has(tid)) continue;
    vistos.add(tid);
    try {
      const equipamentos = await lerTenantJson(tid, 'equipamentos.json');
      const idx = equipamentos.findIndex((e) => e.id === id);
      if (idx !== -1) return { tenantId: tid, equipamentos, idx };
    } catch (_) { /* tenant invalido */ }
  }
  return null;
}

async function listarVisitasTenant(tenantId, equipamentoId) {
  let visitas = await lerTenantJson(tenantId, 'visitas.json');
  if (equipamentoId) visitas = visitas.filter((v) => v.equipamentoId === equipamentoId);
  visitas.sort((a, b) => new Date(b.dataVisita) - new Date(a.dataVisita));
  return visitas;
}

async function lerTodosTenantsComStats() {
  const tenants = await lerJson('tenants.json');
  const resultado = [];
  for (const t of tenants) {
    let usuarios = [];
    let equipamentos = [];
    let visitas = [];
    try {
      usuarios = await lerJson(path.join(t.id, 'usuarios.json'));
      equipamentos = await lerJson(path.join(t.id, 'equipamentos.json'));
      visitas = await lerJson(path.join(t.id, 'visitas.json'));
    } catch (_) { /* pasta ainda nao criada */ }
    resultado.push({
      ...t,
      stats: {
        usuarios: usuarios.length,
        equipamentos: equipamentos.length,
        visitas: visitas.length
      }
    });
  }
  return resultado;
}

async function listarEquipamentosPlataforma() {
  const tenants = await lerJson('tenants.json');
  const resultado = [];
  for (const t of tenants) {
    try {
      const equipamentos = await lerJson(path.join(t.id, 'equipamentos.json'));
      for (const e of equipamentos) {
        resultado.push({
          ...e,
          tenantId: t.id,
          tenantNome: t.nome
        });
      }
    } catch (_) { /* tenant sem equipamentos */ }
  }
  resultado.sort((a, b) => new Date(b.atualizadoEm || b.criadoEm) - new Date(a.atualizadoEm || a.criadoEm));
  return resultado;
}

async function listarVisitasPlataforma() {
  const tenants = await lerJson('tenants.json');
  const resultado = [];
  for (const t of tenants) {
    try {
      const visitas = await lerJson(path.join(t.id, 'visitas.json'));
      let eqMap = {};
      try {
        const equipamentos = await lerJson(path.join(t.id, 'equipamentos.json'));
        eqMap = Object.fromEntries(equipamentos.map((e) => [e.id, e]));
      } catch (_) { /* sem equipamentos */ }
      for (const v of visitas) {
        const eq = eqMap[v.equipamentoId];
        resultado.push({
          ...v,
          tenantId: t.id,
          tenantNome: t.nome,
          equipamentoNome: eq?.nomeModelo || v.equipamentoId
        });
      }
    } catch (_) { /* tenant sem visitas */ }
  }
  resultado.sort((a, b) => new Date(b.dataVisita) - new Date(a.dataVisita));
  return resultado;
}

function omitirSenhaUsuario(u) {
  const { senha, ...sem } = u;
  return sem;
}

const ESPEC_AR_CAMPOS = [
  'eficienciaEnergetica', 'tensao', 'tipoAlimentacao', 'tipoGas', 'capacidadeBtus'
];

async function lerConfigTenant(tenantId) {
  try {
    return await lerJson(path.join(tenantId, 'config.json'));
  } catch (_) {
    return null;
  }
}

async function tenantUsaEspecificacoesAr(tenantId) {
  const config = await lerConfigTenant(tenantId);
  if (config && config.usaEspecificacoesAr === false) return false;
  return true;
}

function extrairEspecificacoesAr(body) {
  const out = {};
  for (const c of ESPEC_AR_CAMPOS) {
    if (body[c] !== undefined && body[c] !== null && body[c] !== '') out[c] = String(body[c]);
  }
  return out;
}

async function validarEspecificacoesAr(body, tenantId, exigeTodos = true) {
  if (!(await tenantUsaEspecificacoesAr(tenantId))) return null;
  const config = await lerConfigTenant(tenantId);
  const opcoes = (config && config.especificacoesArOpcoes) || {};
  for (const campo of ESPEC_AR_CAMPOS) {
    const valor = body[campo];
    if (exigeTodos && !valor) {
      return `Campo obrigatorio ausente: ${campo}.`;
    }
    if (valor) {
      const lista = opcoes[campo];
      if (Array.isArray(lista) && !lista.includes(String(valor))) {
        return `Valor invalido para ${campo}.`;
      }
    }
  }
  return null;
}

async function lerClientesTenant(tenantId) {
  try {
    return await lerJson(path.join(tenantId, 'clientes.json'));
  } catch (_) {
    return [];
  }
}

function validarPayloadCliente(body, existente = null) {
  const docRaw = body.documento != null ? body.documento : body.cnpj;
  if (docRaw != null && String(docRaw).trim()) {
    const errDoc = validarDocumento(docRaw);
    if (errDoc) return errDoc;
    const fmt = normalizarDocumento(docRaw);
    if (fmt === null) return 'CPF ou CNPJ invalido.';
  }
  const errEnd = validarEnderecoPartes({
    logradouro: body.logradouro ?? existente?.logradouro,
    cidade: body.cidade ?? existente?.cidade,
    cep: body.cep ?? existente?.cep
  });
  if (errEnd && !body.endereco && !existente?.endereco) return errEnd;
  return null;
}

async function validarClienteEmpresa(tenantId, nome) {
  if (!nome || !String(nome).trim()) {
    return 'Cliente/empresa e obrigatorio.';
  }
  const clientes = await lerClientesTenant(tenantId);
  const nomeNorm = String(nome).trim();
  const ok = clientes.some((c) => c.ativo !== false && c.nome === nomeNorm);
  if (!ok) return 'Selecione um cliente cadastrado pela empresa.';
  return null;
}

function slugifyTenantId(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'empresa';
}

const ESPECIFICACOES_AR_OPCOES = {
  eficienciaEnergetica: ['A', 'B', 'C', 'D', 'E', 'F'],
  tensao: ['110V', '220V', '330V'],
  tipoAlimentacao: ['Monofasico', 'Bifasico', 'Trifasico'],
  tipoGas: ['R-32', 'R-410A', 'R-22', 'R-407C', 'R-134a', 'R-1234yf', 'R-12', 'R-600'],
  capacidadeBtus: [
    '7.500', '9.000', '12.000', '18.000', '19.000', '22.000', '24.000',
    '30.000', '36.000', '48.000', '54.000', '56.000', '60.000', '80.000', '120.000'
  ]
};

function configPadraoTenant(subtitulo) {
  return {
    usaEspecificacoesAr: true,
    equipamentoTipos: ['Split', 'Janela', 'Ar condicionado de teto', 'Chiller', 'VRF'],
    visitaTipos: [
      'Instalacao', 'Manutencao preventiva', 'Manutencao corretiva',
      'Higienizacao', 'Vistoria', 'Recarga de gas'
    ],
    especificacoesArOpcoes: ESPECIFICACOES_AR_OPCOES,
    brand: { subtitulo: subtitulo || 'Climatizacao e ar condicionado' }
  };
}

async function tenantIdDisponivel(id) {
  const tenants = await lerJson('tenants.json');
  if (tenants.some((t) => t.id === id)) return false;
  if (await tenantDocExiste(id)) return false;
  return true;
}

async function criarTenantCompleto(payload) {
  const {
    nome,
    id: idInformado,
    brandSubtitulo,
    responsavel,
    telefoneComercial,
    emailComercial,
    cnpj,
    adminNome,
    adminEmail,
    adminSenha
  } = payload;

  let id = idInformado ? slugifyTenantId(idInformado) : slugifyTenantId(nome);
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) {
    const err = new Error('ID invalido. Use letras minusculas, numeros e hifens (2 a 40 caracteres).');
    err.status = 400;
    throw err;
  }
  if (!(await tenantIdDisponivel(id))) {
    const err = new Error('Ja existe uma empresa com este ID. Escolha outro identificador.');
    err.status = 409;
    throw err;
  }
  if (await emailJaCadastrado(adminEmail)) {
    const err = new Error('Ja existe um usuario com o e-mail do admin informado.');
    err.status = 409;
    throw err;
  }

  const tenants = await lerJson('tenants.json');
  const novoTenant = {
    id,
    nome: String(nome).trim(),
    ativo: true,
    contratoDesde: new Date().toISOString().slice(0, 10),
    responsavel: String(responsavel).trim(),
    telefoneComercial: String(telefoneComercial).trim(),
    emailComercial: String(emailComercial).trim().toLowerCase()
  };
  if (cnpj && String(cnpj).trim()) novoTenant.cnpj = String(cnpj).trim();

  tenants.push(novoTenant);
  await escreverJson('tenants.json', tenants);

  const config = configPadraoTenant(payload.brandSubtitulo || brandSubtitulo);
  await escreverJson(path.join(id, 'config.json'), config);
  await escreverJson(path.join(id, 'clientes.json'), []);
  await escreverJson(path.join(id, 'equipamentos.json'), []);
  await escreverJson(path.join(id, 'visitas.json'), []);

  const admin = {
    uid: gerarId('adm'),
    nome: String(adminNome).trim(),
    email: String(adminEmail).trim().toLowerCase(),
    senha: await hashSenha(String(adminSenha)),
    role: 'admin',
    status: 'ativo',
    ativo: true,
    criadoEm: agoraISO()
  };
  await escreverJson(path.join(id, 'usuarios.json'), [admin]);

  await sendContaCriadaPeloAdminEmail(admin.email, admin.nome, admin.email, String(adminSenha));

  return { tenant: novoTenant, admin: omitirSenhaUsuario({ ...admin, tenantId: id }) };
}

// --------------------------------------------------------------------------
// Rota /env (variaveis publicas do Firebase - usado na 2a etapa)
// --------------------------------------------------------------------------
app.get('/env', (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    baseUrl: SITE_URL
  });
});

// ==========================================================================
// API REST (persistencia via Firestore)
// ==========================================================================

// ----- TENANTS ------------------------------------------------------------
app.get('/api/tenants', async (_req, res) => {
  try {
    const tenants = await lerJson('tenants.json');
    res.json(tenants.filter((t) => t.ativo !== false));
  } catch (err) {
    console.error('[GET /api/tenants]', err);
    res.status(500).json({ error: 'Erro ao ler tenants.' });
  }
});

app.get('/api/tenants/:id', async (req, res) => {
  try {
    const tenants = await lerJson('tenants.json');
    const meta = tenants.find((t) => t.id === req.params.id);
    if (!meta) return res.status(404).json({ error: 'Empresa nao encontrada.' });
    const config = await lerTenantJson(req.params.id, 'config.json');
    res.json({ ...meta, ...config });
  } catch (err) {
    console.error('[GET /api/tenants/:id]', err);
    res.status(500).json({ error: 'Erro ao ler tenant.' });
  }
});

// ----- AUTH ---------------------------------------------------------------
// Login simples por email + senha - retorna o usuario sem o campo senha
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body || {};
    if (!email || !senha) {
      return res.status(400).json({ error: 'Email e senha sao obrigatorios.' });
    }

    const adminResult = await buscarAdminLogin(email, senha);
    if (adminResult) {
      const { usuario } = adminResult;
      if (!usuario.ativo || usuario.role !== 'super_admin') {
        return res.status(403).json({ error: 'Conta desativada. Contate o administrador.' });
      }
      return responderAutenticado(res, usuario, null);
    }

    const resultado = await buscarUsuarioLogin(email, senha);
    if (!resultado) {
      return res.status(401).json({ error: 'Credenciais invalidas.' });
    }

    const { usuario, tenantId, pendente } = resultado;
    if (pendente || !usuario.ativo) {
      if (usuario.status === 'pendente') {
        return res.status(403).json({
          error: 'Cadastro nao ativado',
          codigo: 'CADASTRO_NAO_ATIVADO',
          detalhe: 'Seu cadastro foi recebido, mas ainda aguarda liberacao pelo administrador da sua empresa. Verifique seu e-mail ou aguarde a ativacao.'
        });
      }
      return res.status(403).json({ error: 'Usuario desativado. Contate o administrador.' });
    }
    if (!tenantId || !usuario.role) {
      return res.status(403).json({
        error: 'Cadastro nao ativado',
        codigo: 'CADASTRO_NAO_ATIVADO',
        detalhe: 'Sua conta ainda nao foi vinculada a uma empresa. Aguarde a liberacao pelo administrador.'
      });
    }

    return responderAutenticado(res, usuario, tenantId);
  } catch (err) {
    console.error('[POST /api/auth/login]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/google', async (req, res) => {
  if (!googleOAuthHabilitado()) {
    return res.status(403).json({ error: 'Login com Google desativado.' });
  }
  try {
    const tok = await validarTokenGoogle(req.body?.idToken);
    if (tok.erro) return res.status(tok.erro).json({ error: tok.msg });

    const resultado = await loginGoogleComCadastroAuto(tok.ok);
    if (resultado.erro) {
      const body = { error: resultado.msg };
      if (resultado.codigo) body.codigo = resultado.codigo;
      if (resultado.detalhe) body.detalhe = resultado.detalhe;
      if (resultado.emailEnviado != null) body.emailEnviado = resultado.emailEnviado;
      if (resultado.cadastroCriado) body.cadastroCriado = true;
      return res.status(resultado.erro).json(body);
    }

    const u = resultado.ok;
    return responderAutenticado(res, { uid: u.uid, nome: u.nome, email: u.email, role: u.role, ativo: u.ativo }, u.tenantId);
  } catch (err) {
    console.error('[POST /api/auth/google]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

app.post('/api/auth/google/cadastro', async (req, res) => {
  if (!googleOAuthHabilitado()) {
    return res.status(403).json({ error: 'Cadastro com Google desativado.' });
  }
  try {
    const tok = await validarTokenGoogle(req.body?.idToken);
    if (tok.erro) return res.status(tok.erro).json({ error: tok.msg });

    const email = tok.ok.email;
    const nome = String(tok.ok.name || '').trim() || email.split('@')[0];

    const resultado = await criarCadastroPendente({
      nome,
      email,
      senhaHash: null,
      authGoogle: true
    });
    if (resultado.erro) {
      const body = { error: resultado.msg };
      if (resultado.codigo) body.codigo = resultado.codigo;
      if (resultado.detalhe) body.detalhe = resultado.detalhe;
      return res.status(resultado.erro).json(body);
    }

    res.status(201).json(resultado.ok);
  } catch (err) {
    console.error('[POST /api/auth/google/cadastro]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// Cadastro publico — usuario fica pendente ate aprovacao do gestor Frigestor
app.post('/api/auth/cadastro', async (req, res) => {
  if (!cadastroPublicoHabilitado()) {
    return res.status(403).json({ error: 'Cadastro publico desativado.' });
  }
  try {
    const { nome, email, senha } = req.body || {};
    if (!nome || !email || !senha) {
      return res.status(400).json({ error: 'Nome, e-mail e senha sao obrigatorios.' });
    }
    if (String(nome).trim().length < 2) {
      return res.status(400).json({ error: 'Informe seu nome completo.' });
    }
    if (String(senha).length < 6) {
      return res.status(400).json({ error: 'A senha deve ter no minimo 6 caracteres.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ error: 'E-mail invalido.' });
    }

    const resultado = await criarCadastroPendente({
      nome: String(nome).trim(),
      email: String(email).trim(),
      senhaHash: await hashSenha(String(senha)),
      authGoogle: false
    });
    if (resultado.erro) {
      const body = { error: resultado.msg };
      if (resultado.codigo) body.codigo = resultado.codigo;
      if (resultado.detalhe) body.detalhe = resultado.detalhe;
      return res.status(resultado.erro).json(body);
    }

    res.status(201).json(resultado.ok);
  } catch (err) {
    console.error('[POST /api/auth/cadastro]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

const MSG_RECUPERACAO_GENERICO =
  'Se o e-mail estiver cadastrado, enviaremos um codigo de verificacao de 6 digitos.';

app.post('/api/auth/esqueci-senha', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ error: 'Informe um e-mail valido.' });
    }

    const loc = await localizarUsuarioAtivoPorEmail(email);
    if (loc) {
      const codigo = await criarSolicitacao(lerJson, escreverJson, email);
      const emailResult = await sendPasswordResetCodeEmail(
        loc.usuario.email,
        loc.usuario.nome,
        codigo
      );
      if (!emailResult.ok) {
        console.warn('[esqueci-senha] Falha SMTP para', loc.usuario.email, emailResult.motivo);
        return res.status(503).json({
          error: 'Nao foi possivel enviar o e-mail agora. Tente novamente em alguns minutos.'
        });
      }
    }

    res.json({ ok: true, mensagem: MSG_RECUPERACAO_GENERICO });
  } catch (err) {
    console.error('[POST /api/auth/esqueci-senha]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

app.post('/api/auth/verificar-codigo', async (req, res) => {
  try {
    const { email, codigo } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ error: 'Informe um e-mail valido.' });
    }
    if (!codigo) {
      return res.status(400).json({ error: 'Informe o codigo de 6 digitos.' });
    }

    const loc = await localizarUsuarioAtivoPorEmail(email);
    if (!loc) {
      return res.status(400).json({ error: 'Codigo expirado ou invalido. Solicite um novo codigo.' });
    }

    const resetToken = await verificarCodigo(lerJson, escreverJson, email, codigo);
    res.json({ ok: true, resetToken });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[POST /api/auth/verificar-codigo]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

app.post('/api/auth/redefinir-senha', async (req, res) => {
  try {
    const { email, resetToken, senha, senhaConfirmacao } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ error: 'Informe um e-mail valido.' });
    }
    if (!resetToken) {
      return res.status(400).json({ error: 'Sessao de redefinicao invalida. Volte e valide o codigo novamente.' });
    }
    if (!senha || !senhaConfirmacao) {
      return res.status(400).json({ error: 'Informe e confirme a nova senha.' });
    }
    if (String(senha).length < 6) {
      return res.status(400).json({ error: 'A senha deve ter no minimo 6 caracteres.' });
    }
    if (String(senha) !== String(senhaConfirmacao)) {
      return res.status(400).json({ error: 'As senhas nao conferem.' });
    }

    const registro = await buscarResetPorToken(lerJson, email, resetToken);
    if (!registro) {
      return res.status(400).json({ error: 'Sessao de redefinicao expirada. Comece novamente.' });
    }

    const loc = await localizarUsuarioAtivoPorEmail(email);
    if (!loc) {
      return res.status(400).json({ error: 'Conta nao encontrada ou inativa.' });
    }

    const novaSenhaHash = await hashSenha(String(senha));
    const ok = await atualizarSenhaPorEmail(email, novaSenhaHash);
    if (!ok) {
      return res.status(400).json({ error: 'Nao foi possivel atualizar a senha.' });
    }

    await consumirReset(lerJson, escreverJson, email, resetToken);

    res.json({
      ok: true,
      mensagem: 'Senha alterada com sucesso. Voce ja pode entrar com a nova senha.'
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[POST /api/auth/redefinir-senha]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ----- USUARIOS -----------------------------------------------------------
app.get('/api/usuarios', authenticate, requireTenantMember, async (req, res) => {
  try {
    const tenantId = tenantIdAutenticado(req);
    const usuarios = await lerTenantJson(tenantId, 'usuarios.json');
    res.json(usuarios.map(({ senha, ...u }) => ({ ...u, tenantId })));
  } catch (err) {
    console.error('[GET /api/usuarios]', err);
    res.status(500).json({ error: 'Erro ao ler usuarios.' });
  }
});

app.post('/api/usuarios', authenticate, requireTenantAdmin, async (req, res) => {
  try {
    const { nome, email, senha, role } = req.body || {};
    if (!nome || !email || !senha) {
      return res.status(400).json({ error: 'Nome, email e senha sao obrigatorios.' });
    }
    const tenantId = tenantIdAutenticado(req);
    if (await emailJaCadastrado(email)) {
      return res.status(409).json({ error: 'Ja existe um usuario com esse email.' });
    }
    const usuarios = await lerTenantJson(tenantId, 'usuarios.json');
    const novo = {
      uid: gerarId('tec'),
      nome,
      email,
      senha: await hashSenha(String(senha)),
      role: role === 'admin' ? 'admin' : 'tecnico',
      status: 'ativo',
      ativo: true,
      criadoEm: agoraISO()
    };
    usuarios.push(novo);
    await escreverTenantJson(tenantId, 'usuarios.json', usuarios);
    await sendContaCriadaPeloAdminEmail(novo.email, novo.nome, novo.email, String(senha));
    const { senha: _omit, ...sem } = novo;
    res.status(201).json({ ...sem, tenantId });
  } catch (err) {
    console.error('[POST /api/usuarios]', err);
    res.status(500).json({ error: 'Erro ao criar usuario.' });
  }
});

app.patch('/api/usuarios/:uid', authenticate, requireTenantMember, async (req, res) => {
  try {
    const { uid } = req.params;
    const tenantId = tenantIdAutenticado(req);
    const local = await localizarUsuario(uid, tenantId);
    if (!local || local.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Usuario nao encontrado.' });
    }

    const isAdmin = req.auth.role === 'admin';
    const isSelf = req.auth.uid === uid;
    if (!isAdmin && !isSelf) return forbidden(res);

    const body = req.body || {};
    const camposPrivilegiados = ['role', 'ativo', 'status'];
    for (const c of camposPrivilegiados) {
      if (c in body && !isAdmin) {
        return forbidden(res, 'Apenas administradores podem alterar este campo.');
      }
    }
    if ('role' in body && isSelf) {
      return forbidden(res, 'Nao e permitido alterar o proprio papel.');
    }
    if ('senha' in body && !isAdmin && !isSelf) {
      return forbidden(res);
    }
    if (!isAdmin && isSelf) {
      const extras = Object.keys(body).filter((k) => !['nome', 'email', 'senha'].includes(k));
      if (extras.length) {
        return forbidden(res, 'Voce so pode alterar nome, e-mail ou senha.');
      }
    }

    const { usuarios, idx } = local;
    const estavaInativo = usuarios[idx].ativo === false;
    const camposPermitidos = ['nome', 'email', 'ativo', 'senha', 'role', 'status'];
    for (const c of camposPermitidos) {
      if (c in body) {
        usuarios[idx][c] = c === 'senha'
          ? await hashSenhaSeNecessario(body[c])
          : body[c];
      }
    }
    await escreverTenantJson(tenantId, 'usuarios.json', usuarios);

    const ativadoAgora = estavaInativo && usuarios[idx].ativo === true;
    if (ativadoAgora) {
      await sendActivationEmail(usuarios[idx].email, usuarios[idx].nome);
    }

    const { senha: _omit, ...sem } = usuarios[idx];
    res.json({ ...sem, tenantId });
  } catch (err) {
    console.error('[PATCH /api/usuarios/:uid]', err);
    res.status(500).json({ error: 'Erro ao atualizar usuario.' });
  }
});

// ----- CLIENTES (empresas atendidas pelo tenant) --------------------------
app.get('/api/clientes', authenticate, requireTenantMember, async (req, res) => {
  try {
    const tenantId = tenantIdAutenticado(req);
    const clientes = await lerClientesTenant(tenantId);
    const incluirInativos = req.query.incluirInativos === '1' || req.query.incluirInativos === 'true';
    res.json(incluirInativos ? clientes : clientes.filter((c) => c.ativo !== false));
  } catch (err) {
    console.error('[GET /api/clientes]', err);
    res.status(500).json({ error: 'Erro ao listar clientes.' });
  }
});

app.get('/api/clientes/todos', authenticate, requireTenantMember, async (req, res) => {
  try {
    const tenantId = tenantIdAutenticado(req);
    res.json(await lerClientesTenant(tenantId));
  } catch (err) {
    console.error('[GET /api/clientes/todos]', err);
    res.status(500).json({ error: 'Erro ao listar clientes.' });
  }
});

app.post('/api/clientes', authenticate, requireTenantAdmin, async (req, res) => {
  try {
    const tenantId = tenantIdAutenticado(req);
    const errVal = validarPayloadCliente(req.body || {});
    if (errVal) return res.status(400).json({ error: errVal });
    const dados = normalizarClienteDados(req.body || {});
    if (!dados.nome || dados.nome.length < 2) {
      return res.status(400).json({ error: 'Informe o nome do cliente (minimo 2 caracteres).' });
    }
    if (!dados.endereco || dados.endereco.length < 5) {
      return res.status(400).json({ error: 'Informe o endereco do cliente.' });
    }
    const clientes = await lerClientesTenant(tenantId);
    if (clientes.some((c) => c.nome.toLowerCase() === dados.nome.toLowerCase())) {
      return res.status(409).json({ error: 'Ja existe um cliente com este nome.' });
    }
    const novo = {
      id: gerarId('cli'),
      nome: dados.nome,
      endereco: dados.endereco,
      logradouro: dados.logradouro,
      numero: dados.numero,
      bairro: dados.bairro,
      cidade: dados.cidade,
      cep: dados.cep,
      documento: dados.documento,
      cnpj: dados.cnpj,
      contatos: dados.contatos,
      responsaveis: dados.responsaveis,
      areas: dados.areas,
      observacoes: dados.observacoes,
      ativo: true,
      criadoEm: agoraISO()
    };
    clientes.push(novo);
    await escreverJson(path.join(tenantId, 'clientes.json'), clientes);
    res.status(201).json(novo);
  } catch (err) {
    console.error('[POST /api/clientes]', err);
    res.status(500).json({ error: 'Erro ao cadastrar cliente.' });
  }
});

app.patch('/api/clientes/:id', authenticate, requireTenantAdmin, async (req, res) => {
  try {
    const tenantId = tenantIdAutenticado(req);
    const clientes = await lerClientesTenant(tenantId);
    const idx = clientes.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Cliente nao encontrado.' });
    const body = req.body || {};
    const campos = Object.keys(body);
    if (campos.length === 1 && campos[0] === 'ativo') {
      clientes[idx].ativo = !!body.ativo;
      clientes[idx].atualizadoEm = agoraISO();
      await escreverJson(path.join(tenantId, 'clientes.json'), clientes);
      return res.json(clientes[idx]);
    }
    const errVal = validarPayloadCliente(body, clientes[idx]);
    if (errVal) return res.status(400).json({ error: errVal });
    const dados = normalizarClienteDados(body, clientes[idx]);
    if (dados.nome.length < 2) return res.status(400).json({ error: 'Nome invalido.' });
    if (dados.endereco.length < 5) return res.status(400).json({ error: 'Endereco invalido.' });
    if (clientes.some((c, i) => i !== idx && c.nome.toLowerCase() === dados.nome.toLowerCase())) {
      return res.status(409).json({ error: 'Ja existe um cliente com este nome.' });
    }
    clientes[idx].nome = dados.nome;
    clientes[idx].endereco = dados.endereco;
    clientes[idx].logradouro = dados.logradouro;
    clientes[idx].numero = dados.numero;
    clientes[idx].bairro = dados.bairro;
    clientes[idx].cidade = dados.cidade;
    clientes[idx].cep = dados.cep;
    clientes[idx].documento = dados.documento;
    clientes[idx].cnpj = dados.cnpj;
    clientes[idx].contatos = dados.contatos;
    clientes[idx].responsaveis = dados.responsaveis;
    clientes[idx].areas = dados.areas;
    clientes[idx].observacoes = dados.observacoes;
    if ('ativo' in req.body) clientes[idx].ativo = !!req.body.ativo;
    clientes[idx].atualizadoEm = agoraISO();
    await escreverJson(path.join(tenantId, 'clientes.json'), clientes);
    res.json(clientes[idx]);
  } catch (err) {
    console.error('[PATCH /api/clientes/:id]', err);
    res.status(500).json({ error: 'Erro ao atualizar cliente.' });
  }
});

// ----- EQUIPAMENTOS -------------------------------------------------------
app.get('/api/equipamentos', authenticate, requireTenantMember, async (req, res) => {
  try {
    const tenantId = tenantIdAutenticado(req);
    const equipamentos = await lerTenantJson(tenantId, 'equipamentos.json');
    res.json(equipamentos);
  } catch (err) {
    console.error('[GET /api/equipamentos]', err);
    res.status(500).json({ error: 'Erro ao ler equipamentos.' });
  }
});

app.get('/api/equipamentos/:id', async (req, res) => {
  try {
    const local = await localizarEquipamento(req.params.id, tenantIdFromReq(req));
    if (!local) return res.status(404).json({ error: 'Equipamento nao encontrado.' });
    const tenants = await lerJson('tenants.json');
    const meta = tenants.find((t) => t.id === local.tenantId);
    let config = null;
    try { config = await lerConfigTenant(local.tenantId); } catch (_) { /* ok */ }
    const equip = local.equipamentos[local.idx];
    res.json({
      ...equip,
      tenantId: local.tenantId,
      tenantNome: meta?.nome || 'Empresa',
      tenantEmail: meta?.emailComercial || '',
      tenantTelefone: meta?.telefoneComercial || '',
      tenantSubtitulo: config?.brand?.subtitulo || 'Climatizacao e ar condicionado'
    });
  } catch (err) {
    console.error('[GET /api/equipamentos/:id]', err);
    res.status(500).json({ error: 'Erro ao ler equipamento.' });
  }
});

app.post('/api/equipamentos', authenticate, requireTenantAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const tenantId = tenantIdAutenticado(req);
    const obrigatorios = [
      'nomeModelo',
      'tipoEquipamento',
      'localizacaoSetor',
      'clienteEmpresa',
      'tecnicoResponsavelUid',
      'tecnicoResponsavelNome',
      'dataInstalacao'
    ];
    for (const campo of obrigatorios) {
      if (!body[campo]) return res.status(400).json({ error: `Campo obrigatorio ausente: ${campo}` });
    }
    const errCliente = await validarClienteEmpresa(tenantId, body.clienteEmpresa);
    if (errCliente) return res.status(400).json({ error: errCliente });
    const errSpec = await validarEspecificacoesAr(body, tenantId, true);
    if (errSpec) return res.status(400).json({ error: errSpec });

    const equipamentos = await lerTenantJson(tenantId, 'equipamentos.json');
    const novo = {
      id: gerarId('eq'),
      nomeModelo: body.nomeModelo,
      numeroSerie: body.numeroSerie ? String(body.numeroSerie).trim() : '',
      tipoEquipamento: body.tipoEquipamento,
      localizacaoSetor: body.localizacaoSetor,
      clienteEmpresa: body.clienteEmpresa,
      tecnicoResponsavelUid: body.tecnicoResponsavelUid,
      tecnicoResponsavelNome: body.tecnicoResponsavelNome,
      dataInstalacao: new Date(body.dataInstalacao).toISOString(),
      ...extrairEspecificacoesAr(body),
      criadoEm: agoraISO(),
      atualizadoEm: agoraISO()
    };
    equipamentos.push(novo);
    await escreverTenantJson(tenantId, 'equipamentos.json', equipamentos);
    res.status(201).json(novo);
  } catch (err) {
    console.error('[POST /api/equipamentos]', err);
    res.status(500).json({ error: 'Erro ao criar equipamento.' });
  }
});

app.patch('/api/equipamentos/:id', authenticate, requireTenantAdmin, async (req, res) => {
  try {
    const tenantId = tenantIdAutenticado(req);
    const local = await localizarEquipamento(req.params.id, tenantId);
    if (!local || local.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Equipamento nao encontrado.' });
    }

    const { equipamentos, idx } = local;
    const merged = { ...equipamentos[idx], ...req.body };
    const usaSpec = await tenantUsaEspecificacoesAr(tenantId);
    const errSpec = await validarEspecificacoesAr(merged, tenantId, usaSpec);
    if (errSpec) return res.status(400).json({ error: errSpec });
    if ('clienteEmpresa' in req.body) {
      const errCliente = await validarClienteEmpresa(tenantId, req.body.clienteEmpresa);
      if (errCliente) return res.status(400).json({ error: errCliente });
    }
    const editaveis = [
      'nomeModelo',
      'numeroSerie',
      'tipoEquipamento',
      'localizacaoSetor',
      'clienteEmpresa',
      'tecnicoResponsavelUid',
      'tecnicoResponsavelNome',
      ...ESPEC_AR_CAMPOS
    ];
    for (const c of editaveis) {
      if (c in req.body) equipamentos[idx][c] = req.body[c];
    }
    equipamentos[idx].atualizadoEm = agoraISO();

    await escreverTenantJson(tenantId, 'equipamentos.json', equipamentos);
    res.json(equipamentos[idx]);
  } catch (err) {
    console.error('[PATCH /api/equipamentos/:id]', err);
    res.status(500).json({ error: 'Erro ao atualizar equipamento.' });
  }
});

app.delete('/api/equipamentos/:id', authenticate, requireTenantAdmin, async (req, res) => {
  try {
    const tenantId = tenantIdAutenticado(req);
    const local = await localizarEquipamento(req.params.id, tenantId);
    if (!local || local.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Equipamento nao encontrado.' });
    }

    const { equipamentos, idx } = local;
    equipamentos.splice(idx, 1);
    await escreverTenantJson(tenantId, 'equipamentos.json', equipamentos);

    const visitas = await lerTenantJson(tenantId, 'visitas.json');
    const filtradas = visitas.filter((v) => v.equipamentoId !== req.params.id);
    await escreverTenantJson(tenantId, 'visitas.json', filtradas);

    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/equipamentos/:id]', err);
    res.status(500).json({ error: 'Erro ao excluir equipamento.' });
  }
});

// ----- VISITAS ------------------------------------------------------------
app.get('/api/visitas', async (req, res) => {
  try {
    const { equipamentoId } = req.query;

    if (equipamentoId) {
      const local = await localizarEquipamento(String(equipamentoId));
      if (!local) return res.json([]);
      const lista = await listarVisitasTenant(local.tenantId, String(equipamentoId));
      return res.json(lista);
    }

    const raw = extrairToken(req);
    if (!raw) return res.status(401).json({ error: 'Nao autenticado.' });
    let payload;
    try {
      payload = verifyToken(raw);
    } catch (_) {
      return res.status(401).json({ error: 'Sessao expirada ou invalida.' });
    }
    if (payload.tenantId) {
      const lista = await listarVisitasTenant(payload.tenantId);
      return res.json(lista);
    }

    return res.status(401).json({ error: 'Nao autenticado.' });
  } catch (err) {
    console.error('[GET /api/visitas]', err);
    res.status(500).json({ error: 'Erro ao ler visitas.' });
  }
});

app.post('/api/visitas', authenticate, requireTenantMember, async (req, res) => {
  try {
    const body = req.body || {};
    const obrigatorios = ['equipamentoId', 'tecnicoUid', 'tecnicoNome', 'tipoServico'];
    for (const c of obrigatorios) {
      if (!body[c]) return res.status(400).json({ error: `Campo obrigatorio ausente: ${c}` });
    }

    const authTenantId = tenantIdAutenticado(req);
    const local = await localizarEquipamento(body.equipamentoId, authTenantId);
    if (!local || local.tenantId !== authTenantId) {
      return res.status(404).json({ error: 'Equipamento nao encontrado.' });
    }

    const { tenantId, equipamentos, idx: eqIdx } = local;
    const visitas = await lerTenantJson(tenantId, 'visitas.json');
    const nova = {
      id: gerarId('vis'),
      equipamentoId: body.equipamentoId,
      tecnicoUid: body.tecnicoUid,
      tecnicoNome: body.tecnicoNome,
      dataVisita: body.dataVisita ? new Date(body.dataVisita).toISOString() : agoraISO(),
      tipoServico: body.tipoServico,
      descricaoServico: body.descricaoServico ? String(body.descricaoServico).trim() : '',
      defeitosEncontrados: body.defeitosEncontrados || '',
      pecasTrocadas: body.pecasTrocadas || '',
      observacoes: body.observacoes ? String(body.observacoes).trim() : '',
      criadoEm: agoraISO()
    };
    visitas.push(nova);
    await escreverTenantJson(tenantId, 'visitas.json', visitas);

    equipamentos[eqIdx].atualizadoEm = agoraISO();
    await escreverTenantJson(tenantId, 'equipamentos.json', equipamentos);

    res.status(201).json(nova);
  } catch (err) {
    console.error('[POST /api/visitas]', err);
    res.status(500).json({ error: 'Erro ao criar visita.' });
  }
});

// ----- PLATAFORMA (admin supremo) -----------------------------------------
app.get('/api/plataforma/tenants', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    res.json(await lerTodosTenantsComStats());
  } catch (err) {
    console.error('[GET /api/plataforma/tenants]', err);
    res.status(500).json({ error: 'Erro ao listar tenants.' });
  }
});

app.post('/api/plataforma/tenants', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const {
      nome, id, brandSubtitulo,
      responsavel, telefoneComercial, emailComercial, cnpj,
      adminNome, adminEmail, adminSenha
    } = body;

    if (!nome) {
      return res.status(400).json({ error: 'Informe o nome da empresa.' });
    }
    if (!responsavel || !telefoneComercial || !emailComercial) {
      return res.status(400).json({ error: 'Responsavel, telefone comercial e e-mail comercial sao obrigatorios.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(emailComercial))) {
      return res.status(400).json({ error: 'E-mail comercial invalido.' });
    }
    if (!adminNome || !adminEmail || !adminSenha) {
      return res.status(400).json({ error: 'Informe nome, e-mail e senha inicial do admin da empresa.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(adminEmail))) {
      return res.status(400).json({ error: 'E-mail do admin invalido.' });
    }
    if (String(adminSenha).length < 4) {
      return res.status(400).json({ error: 'A senha do admin deve ter no minimo 4 caracteres.' });
    }

    const resultado = await criarTenantCompleto(body);
    res.status(201).json(resultado);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[POST /api/plataforma/tenants]', err);
    res.status(500).json({ error: 'Erro ao criar empresa.' });
  }
});

app.patch('/api/plataforma/tenants/:id', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const tenants = await lerJson('tenants.json');
    const idx = tenants.findIndex((t) => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Tenant nao encontrado.' });

    const campos = [
      'nome', 'ativo', 'contratoDesde',
      'responsavel', 'telefoneComercial', 'emailComercial', 'cnpj'
    ];
    for (const c of campos) {
      if (c in req.body) tenants[idx][c] = req.body[c];
    }
    await escreverJson('tenants.json', tenants);
    res.json(tenants[idx]);
  } catch (err) {
    console.error('[PATCH /api/plataforma/tenants/:id]', err);
    res.status(500).json({ error: 'Erro ao atualizar tenant.' });
  }
});

app.get('/api/plataforma/tenants/:tenantId/usuarios', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const tenants = await lerJson('tenants.json');
    if (!tenants.some((t) => t.id === tenantId)) {
      return res.status(404).json({ error: 'Tenant nao encontrado.' });
    }
    const usuarios = await lerJson(path.join(tenantId, 'usuarios.json'));
    res.json(usuarios.map((u) => ({ ...omitirSenhaUsuario(u), tenantId })));
  } catch (err) {
    console.error('[GET /api/plataforma/tenants/:tenantId/usuarios]', err);
    res.status(500).json({ error: 'Erro ao ler usuarios do tenant.' });
  }
});

app.post('/api/plataforma/tenants/:tenantId/usuarios', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { nome, email, senha, role } = req.body || {};
    if (!nome || !email || !senha) {
      return res.status(400).json({ error: 'Nome, email e senha sao obrigatorios.' });
    }
    const tenants = await lerJson('tenants.json');
    if (!tenants.some((t) => t.id === tenantId)) {
      return res.status(404).json({ error: 'Tenant nao encontrado.' });
    }
    if (await emailJaCadastrado(email)) {
      return res.status(409).json({ error: 'Ja existe um usuario com esse email.' });
    }
    const usuarios = await lerJson(path.join(tenantId, 'usuarios.json'));
    const novo = {
      uid: gerarId('usr'),
      nome: String(nome).trim(),
      email: String(email).trim(),
      senha: await hashSenha(String(senha)),
      role: role === 'admin' ? 'admin' : 'tecnico',
      status: 'ativo',
      ativo: true,
      criadoEm: agoraISO()
    };
    usuarios.push(novo);
    await escreverJson(path.join(tenantId, 'usuarios.json'), usuarios);
    await sendContaCriadaPeloAdminEmail(novo.email, novo.nome, novo.email, String(senha));
    res.status(201).json({ ...omitirSenhaUsuario(novo), tenantId });
  } catch (err) {
    console.error('[POST /api/plataforma/tenants/:tenantId/usuarios]', err);
    res.status(500).json({ error: 'Erro ao criar usuario.' });
  }
});

app.patch('/api/plataforma/tenants/:tenantId/usuarios/:uid', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const { tenantId, uid } = req.params;
    const usuarios = await lerJson(path.join(tenantId, 'usuarios.json'));
    const idx = usuarios.findIndex((u) => u.uid === uid);
    if (idx === -1) return res.status(404).json({ error: 'Usuario nao encontrado.' });

    const estavaInativo = usuarios[idx].ativo === false;
    const campos = ['nome', 'email', 'role', 'ativo', 'status'];
    for (const c of campos) {
      if (c in req.body) usuarios[idx][c] = req.body[c];
    }
    await escreverJson(path.join(tenantId, 'usuarios.json'), usuarios);

    const ativadoAgora = estavaInativo && usuarios[idx].ativo === true;
    if (ativadoAgora) {
      await sendActivationEmail(usuarios[idx].email, usuarios[idx].nome);
    }

    res.json({ ...omitirSenhaUsuario(usuarios[idx]), tenantId });
  } catch (err) {
    console.error('[PATCH /api/plataforma/tenants/:tenantId/usuarios/:uid]', err);
    res.status(500).json({ error: 'Erro ao atualizar usuario.' });
  }
});

app.delete('/api/plataforma/tenants/:tenantId/usuarios/:uid', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const { tenantId, uid } = req.params;
    const usuarios = await lerJson(path.join(tenantId, 'usuarios.json'));
    const idx = usuarios.findIndex((u) => u.uid === uid);
    if (idx === -1) return res.status(404).json({ error: 'Usuario nao encontrado.' });
    usuarios.splice(idx, 1);
    await escreverJson(path.join(tenantId, 'usuarios.json'), usuarios);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/plataforma/tenants/:tenantId/usuarios/:uid]', err);
    res.status(500).json({ error: 'Erro ao excluir usuario.' });
  }
});

app.get('/api/plataforma/equipamentos', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    res.json(await listarEquipamentosPlataforma());
  } catch (err) {
    console.error('[GET /api/plataforma/equipamentos]', err);
    res.status(500).json({ error: 'Erro ao listar equipamentos.' });
  }
});

app.get('/api/plataforma/visitas', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    res.json(await listarVisitasPlataforma());
  } catch (err) {
    console.error('[GET /api/plataforma/visitas]', err);
    res.status(500).json({ error: 'Erro ao listar visitas.' });
  }
});

/** Substitui todas as visitas de um tenant (importacao / correcao em lote). */
app.put('/api/plataforma/tenants/:tenantId/visitas', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const visitas = req.body;
    if (!Array.isArray(visitas)) {
      return res.status(400).json({ error: 'Corpo deve ser um array de visitas.' });
    }
    const tenants = await lerJson('tenants.json');
    if (!tenants.some((t) => t.id === tenantId)) {
      return res.status(404).json({ error: 'Tenant nao encontrado.' });
    }
    for (const v of visitas) {
      if (!v.equipamentoId || !v.tipoServico) {
        return res.status(400).json({ error: 'Visita invalida: equipamentoId e tipoServico obrigatorios.' });
      }
    }
    await escreverJson(path.join(tenantId, 'visitas.json'), visitas);
    res.json({ ok: true, tenantId, total: visitas.length });
  } catch (err) {
    console.error('[PUT /api/plataforma/tenants/:tenantId/visitas]', err);
    res.status(500).json({ error: 'Erro ao gravar visitas.' });
  }
});

app.get('/api/plataforma/cadastros-pendentes', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const pendentes = await lerJson('plataforma/cadastros-pendentes.json');
    res.json(pendentes);
  } catch (err) {
    console.error('[GET /api/plataforma/cadastros-pendentes]', err);
    res.status(500).json({ error: 'Erro ao ler cadastros pendentes.' });
  }
});

app.patch('/api/plataforma/cadastros-pendentes/:uid', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const { acao, tenantId, role } = req.body || {};
    const pendentes = await lerJson('plataforma/cadastros-pendentes.json');
    const idx = pendentes.findIndex((u) => u.uid === uid);
    if (idx === -1) return res.status(404).json({ error: 'Cadastro nao encontrado.' });

    if (acao === 'rejeitar') {
      pendentes.splice(idx, 1);
      await escreverJson('plataforma/cadastros-pendentes.json', pendentes);
      return res.json({ ok: true, mensagem: 'Cadastro rejeitado.' });
    }

    if (acao !== 'aprovar' || !tenantId) {
      return res.status(400).json({ error: 'Informe acao=aprovar e tenantId.' });
    }
    const tenants = await lerJson('tenants.json');
    if (!tenants.some((t) => t.id === tenantId)) {
      return res.status(400).json({ error: 'Tenant invalido.' });
    }

    const pendente = pendentes.splice(idx, 1)[0];
    await escreverJson('plataforma/cadastros-pendentes.json', pendentes);

    const usuarios = await lerJson(path.join(tenantId, 'usuarios.json'));
    const novo = {
      uid: pendente.uid,
      nome: pendente.nome,
      email: pendente.email,
      senha: pendente.senha ?? null,
      authGoogle: pendente.authGoogle === true,
      role: role === 'admin' ? 'admin' : 'tecnico',
      status: 'ativo',
      ativo: true,
      criadoEm: pendente.criadoEm || agoraISO()
    };
    usuarios.push(novo);
    await escreverJson(path.join(tenantId, 'usuarios.json'), usuarios);

    await sendActivationEmail(novo.email, novo.nome, { authGoogle: novo.authGoogle });

    res.json({ ok: true, usuario: omitirSenhaUsuario({ ...novo, tenantId }) });
  } catch (err) {
    console.error('[PATCH /api/plataforma/cadastros-pendentes/:uid]', err);
    res.status(500).json({ error: 'Erro ao processar cadastro.' });
  }
});

// --------------------------------------------------------------------------
// Fallback 404 para chamadas /api/*
// --------------------------------------------------------------------------
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint nao encontrado.' });
});

// Paginas internas — exigem cookie JWT (nao servidas estaticamente sem auth)
const ROOT = __dirname;
app.get('/pages/admin.html', requirePageRoles(['super_admin']), servirPaginaInterna('admin.html'));
app.get('/pages/admin-tenant.html', requirePageRoles(['admin']), servirPaginaInterna('admin-tenant.html'));
app.get('/pages/campo.html', requirePageRoles(['admin', 'tecnico']), servirPaginaInterna('campo.html'));

// Arquivos estaticos — local e fallback no serverless da Vercel
app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});
app.use('/pages', express.static(path.join(ROOT, 'pages'), { extensions: ['html'] }));
app.use('/assets', express.static(path.join(ROOT, 'assets')));
app.use(express.static(ROOT, { extensions: ['html'], index: false }));

// --------------------------------------------------------------------------
// Sobe o servidor (local) ou exporta app (Vercel)
// --------------------------------------------------------------------------
module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Frigestor | Gestao de Equipamentos`);
    console.log(`  Banco de dados: Cloud Firestore`);
    console.log(`  Servidor rodando em: http://localhost:${PORT}\n`);
  });
}

// TODO: Firestore Security Rules (etapa 2 - quando migrar para Firebase)
//
// match /databases/{database}/documents {
//   match /usuarios/{uid} {
//     allow read: if request.auth != null;
//     allow write: if request.auth.token.role == 'admin';
//   }
//
//   match /equipamentos/{equipId} {
//     allow read: if true; // leitura publica para a pagina equipamento.html
//     allow create: if request.auth != null && (
//       request.auth.token.role == 'admin' ||
//       request.resource.data.tecnicoResponsavelUid == request.auth.uid
//     );
//     allow update: if request.auth != null && (
//       request.auth.token.role == 'admin' ||
//       resource.data.tecnicoResponsavelUid == request.auth.uid
//     ) && request.resource.data.dataInstalacao == resource.data.dataInstalacao;
//     allow delete: if request.auth.token.role == 'admin';
//
//     match /visitas/{visitaId} {
//       allow read: if true;
//       allow create: if request.auth != null
//         && request.resource.data.tecnicoUid == request.auth.uid;
//       allow update, delete: if request.auth.token.role == 'admin';
//     }
//   }
// }
