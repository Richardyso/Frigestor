/**
 * lib/data-store.js
 * Camada de dados: JSON local (dev) ou Cloud Firestore (producao).
 *
 * DATA_BACKEND=firestore  -> le/grava na nuvem
 * DATA_BACKEND=json       -> le/grava em /data (padrao sem Firebase configurado)
 *
 * Se FIREBASE_SERVICE_ACCOUNT existir e DATA_BACKEND nao for "json", usa Firestore.
 */

const path = require('path');
const fs = require('fs').promises;
const { getFirestore, firebaseConfigurado } = require('./firebase-admin');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BATCH_SIZE = 400;

function usarFirestore() {
  const mode = String(process.env.DATA_BACKEND || '').toLowerCase();
  if (mode === 'json') return false;
  if (mode === 'firestore') return true;
  return firebaseConfigurado();
}

function normalizarRel(nomeArquivo) {
  return String(nomeArquivo).replace(/\\/g, '/');
}

function idDoItem(item, fallback = 'doc') {
  return String(item.id || item.uid || `${fallback}-${Date.now()}`);
}

/** Interpreta caminho relativo data/*.json */
function parsePath(rel) {
  const p = normalizarRel(rel);

  if (p === 'tenants.json') {
    return { kind: 'tenants-list' };
  }

  const platMatch = p.match(/^plataforma\/(usuarios|cadastros-pendentes|recuperacao-senha)\.json$/);
  if (platMatch) {
    return { kind: 'plataforma-array', collection: platMatch[1] };
  }

  const tenantMatch = p.match(/^([^/]+)\/(config|clientes|equipamentos|visitas|usuarios)\.json$/);
  if (tenantMatch) {
    const [, tenantId, arquivo] = tenantMatch;
    if (arquivo === 'config') return { kind: 'tenant-config', tenantId };
    return { kind: 'tenant-array', tenantId, sub: arquivo };
  }

  throw new Error(`Caminho de dados nao mapeado para Firestore: ${rel}`);
}

async function lerJsonArquivo(rel) {
  const caminho = path.join(DATA_DIR, rel);
  const conteudo = await fs.readFile(caminho, 'utf-8');
  return JSON.parse(conteudo);
}

async function escreverJsonArquivo(rel, dados) {
  const caminho = path.join(DATA_DIR, rel);
  await fs.mkdir(path.dirname(caminho), { recursive: true });
  await fs.writeFile(caminho, JSON.stringify(dados, null, 2), 'utf-8');
}

async function lerColecao(db, ref) {
  const snap = await ref.get();
  return snap.docs.map((d) => ({ ...d.data() }));
}

async function gravarColecao(db, ref, items, idFn) {
  const snap = await ref.get();
  const novosIds = new Set(items.map((item) => idFn(item)));

  let ops = [];
  const flush = async () => {
    if (!ops.length) return;
    const batch = db.batch();
    for (const op of ops) op(batch);
    await batch.commit();
    ops = [];
  };

  for (const doc of snap.docs) {
    if (!novosIds.has(doc.id)) {
      ops.push((batch) => batch.delete(doc.ref));
      if (ops.length >= BATCH_SIZE) await flush();
    }
  }

  for (const item of items) {
    const id = idFn(item);
    const docRef = ref.doc(id);
    ops.push((batch) => batch.set(docRef, item, { merge: true }));
    if (ops.length >= BATCH_SIZE) await flush();
  }

  await flush();
}

async function lerJsonFirestore(rel) {
  const db = getFirestore();
  const parsed = parsePath(rel);

  if (parsed.kind === 'tenants-list') {
    const snap = await db.collection('tenants').get();
    return snap.docs.map((d) => {
      const data = d.data();
      const { config, ...meta } = data;
      return { id: d.id, ...meta };
    });
  }

  if (parsed.kind === 'tenant-config') {
    const doc = await db.collection('tenants').doc(parsed.tenantId).get();
    if (!doc.exists) throw new Error('Tenant invalido.');
    return doc.data().config || {};
  }

  if (parsed.kind === 'tenant-array') {
    const snap = await db.collection('tenants').doc(parsed.tenantId).collection(parsed.sub).get();
    return snap.docs.map((d) => d.data());
  }

  if (parsed.kind === 'plataforma-array') {
    const snap = await db
      .collection('plataforma')
      .doc(parsed.collection)
      .collection('items')
      .get();
    return snap.docs.map((d) => d.data());
  }

  throw new Error(`Firestore: caminho nao suportado: ${rel}`);
}

async function escreverJsonFirestore(rel, dados) {
  const db = getFirestore();
  const parsed = parsePath(rel);

  if (parsed.kind === 'tenants-list') {
    if (!Array.isArray(dados)) throw new Error('tenants.json deve ser um array.');
    const snap = await db.collection('tenants').get();
    const novosIds = new Set(dados.map((t) => t.id));
    let batch = db.batch();
    let n = 0;

    for (const doc of snap.docs) {
      if (!novosIds.has(doc.id)) {
        batch.delete(doc.ref);
        n += 1;
        if (n >= BATCH_SIZE) { await batch.commit(); batch = db.batch(); n = 0; }
      }
    }

    for (const t of dados) {
      const { id, config, ...rest } = t;
      const ref = db.collection('tenants').doc(id);
      const existing = await ref.get();
      const configAtual = existing.exists ? (existing.data().config || {}) : {};
      batch.set(ref, { ...rest, id, config: config || configAtual, atualizadoEm: new Date().toISOString() }, { merge: true });
      n += 1;
      if (n >= BATCH_SIZE) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n) await batch.commit();
    return;
  }

  if (parsed.kind === 'tenant-config') {
    await db.collection('tenants').doc(parsed.tenantId).set(
      { config: dados, atualizadoEm: new Date().toISOString() },
      { merge: true }
    );
    return;
  }

  if (parsed.kind === 'tenant-array') {
    if (!Array.isArray(dados)) throw new Error(`${rel} deve ser um array.`);
    const ref = db.collection('tenants').doc(parsed.tenantId).collection(parsed.sub);
    await gravarColecao(db, ref, dados, idDoItem);
    return;
  }

  if (parsed.kind === 'plataforma-array') {
    if (!Array.isArray(dados)) throw new Error(`${rel} deve ser um array.`);
    const ref = db.collection('plataforma').doc(parsed.collection).collection('items');
    await gravarColecao(db, ref, dados, idDoItem);
    return;
  }

  throw new Error(`Firestore: caminho nao suportado: ${rel}`);
}

async function lerJson(nomeArquivo) {
  const rel = normalizarRel(nomeArquivo);
  if (usarFirestore()) {
    return lerJsonFirestore(rel);
  }
  return lerJsonArquivo(rel);
}

async function escreverJson(nomeArquivo, dados) {
  const rel = normalizarRel(nomeArquivo);
  if (usarFirestore()) {
    await escreverJsonFirestore(rel, dados);
    return;
  }
  await escreverJsonArquivo(rel, dados);
}

module.exports = {
  lerJson,
  escreverJson,
  usarFirestore,
  DATA_DIR
};
