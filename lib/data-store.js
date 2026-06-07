/**
 * lib/data-store.js — persistencia em Cloud Firestore.
 *
 * Chaves logicas (ex.: tenants.json, {tenantId}/usuarios.json) mapeiam
 * para colecoes/documentos no Firestore.
 */

const { getFirestore } = require('./firebase-admin');

const BATCH_SIZE = 400;

function normalizarRel(nomeArquivo) {
  return String(nomeArquivo).replace(/\\/g, '/');
}

function idDoItem(item, fallback = 'doc') {
  return String(item.id || item.uid || `${fallback}-${Date.now()}`);
}

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

  throw new Error(`Caminho de dados nao mapeado: ${rel}`);
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

async function lerJson(rel) {
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
    if (!doc.exists) throw new Error('Empresa invalida.');
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

async function escreverJson(rel, dados) {
  const db = getFirestore();
  const parsed = parsePath(rel);

  if (parsed.kind === 'tenants-list') {
    if (!Array.isArray(dados)) throw new Error('Lista de tenants deve ser um array.');
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

async function tenantDocExiste(tenantId) {
  const doc = await getFirestore().collection('tenants').doc(tenantId).get();
  return doc.exists;
}

/** Remove tenant e todas as subcolecoes (usuarios, clientes, equipamentos, visitas) no Firestore. */
async function excluirSubcolecao(ref) {
  const db = getFirestore();
  let snap = await ref.limit(BATCH_SIZE).get();
  while (!snap.empty) {
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    snap = await ref.limit(BATCH_SIZE).get();
  }
}

async function excluirTenantCompleto(tenantId) {
  const db = getFirestore();
  const tenantRef = db.collection('tenants').doc(String(tenantId));
  const doc = await tenantRef.get();
  if (!doc.exists) return false;

  for (const sub of ['usuarios', 'clientes', 'equipamentos', 'visitas']) {
    await excluirSubcolecao(tenantRef.collection(sub));
  }
  await tenantRef.delete();
  return true;
}

module.exports = {
  lerJson,
  escreverJson,
  tenantDocExiste,
  excluirTenantCompleto
};
