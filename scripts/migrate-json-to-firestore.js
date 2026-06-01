/**
 * Envia todos os JSONs de /data para o Cloud Firestore.
 *
 * Pre-requisitos:
 *   1. Firestore criado no Firebase Console
 *   2. Conta de servico (JSON) em FIREBASE_SERVICE_ACCOUNT
 *   3. FIREBASE_PROJECT_ID no .env
 *
 * Uso:
 *   npm run migrate:firestore
 *   npm run migrate:firestore:dry
 */

require('dotenv').config();

process.env.DATA_BACKEND = 'firestore';

const path = require('path');
const fs = require('fs').promises;
const { escreverJson, usarFirestore } = require('../lib/data-store');

const DATA_DIR = path.join(__dirname, '..', 'data');

async function lerArquivo(rel) {
  const raw = await fs.readFile(path.join(DATA_DIR, rel), 'utf-8');
  return JSON.parse(raw);
}

async function lerOpcional(rel, fallback = []) {
  try {
    return await lerArquivo(rel);
  } catch (_) {
    return fallback;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!usarFirestore()) {
    console.error('\nConfigure FIREBASE_PROJECT_ID e FIREBASE_SERVICE_ACCOUNT no .env\n');
    process.exit(1);
  }

  console.log(dryRun ? '\n=== DRY RUN ===\n' : '\n=== Migracao JSON -> Firestore ===\n');

  const tenants = await lerArquivo('tenants.json');
  console.log(`Tenants: ${tenants.length}`);

  if (!dryRun) {
    await escreverJson('tenants.json', tenants);
  } else {
    console.log('[dry-run] tenants.json');
  }

  for (const tenant of tenants) {
    const tid = tenant.id;
    const config = await lerOpcional(path.join(tid, 'config.json'), {});
    const clientes = await lerOpcional(path.join(tid, 'clientes.json'));
    const equipamentos = await lerOpcional(path.join(tid, 'equipamentos.json'));
    const visitas = await lerOpcional(path.join(tid, 'visitas.json'));
    const usuarios = await lerOpcional(path.join(tid, 'usuarios.json'));

    console.log(`  ${tid}: ${clientes.length} cli, ${equipamentos.length} eq, ${visitas.length} vis, ${usuarios.length} usr`);

    if (dryRun) continue;

    await escreverJson(path.join(tid, 'config.json'), config);
    await escreverJson(path.join(tid, 'clientes.json'), clientes);
    await escreverJson(path.join(tid, 'equipamentos.json'), equipamentos);
    await escreverJson(path.join(tid, 'visitas.json'), visitas);
    await escreverJson(path.join(tid, 'usuarios.json'), usuarios);
  }

  const platUsuarios = await lerOpcional('plataforma/usuarios.json');
  const pendentes = await lerOpcional('plataforma/cadastros-pendentes.json');
  const recuperacao = await lerOpcional('plataforma/recuperacao-senha.json');

  console.log(`Plataforma: ${platUsuarios.length} admin, ${pendentes.length} pend., ${recuperacao.length} pwd`);

  if (!dryRun) {
    await escreverJson('plataforma/usuarios.json', platUsuarios);
    await escreverJson('plataforma/cadastros-pendentes.json', pendentes);
    await escreverJson('plataforma/recuperacao-senha.json', recuperacao);
  }

  console.log(dryRun ? '\nDry-run concluido.\n' : '\nMigracao concluida. Veja Firestore no console Firebase.\n');
}

main().catch((err) => {
  console.error('\nErro:', err.message);
  process.exit(1);
});
