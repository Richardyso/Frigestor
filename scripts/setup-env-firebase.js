/**
 * Copia a conta de servico para FIREBASE_SERVICE_ACCOUNT_BASE64 no .env
 * Uso: node scripts/setup-env-firebase.js [caminho-do-json]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const envPath = path.join(ROOT, '.env');

const candidatos = [
  process.argv[2],
  'firebase-service-account.json',
  'frigestor-acb4a-firebase-adminsdk-fbsvc-78c34e39a2.json'
].filter(Boolean);

let saPath = null;
for (const c of candidatos) {
  const abs = path.isAbsolute(c) ? c : path.join(ROOT, c);
  if (fs.existsSync(abs)) {
    saPath = abs;
    break;
  }
}

if (!saPath) {
  console.error('Arquivo da conta de servico nao encontrado.');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
const b64 = Buffer.from(JSON.stringify(sa)).toString('base64');

let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

const linhas = [
  `FIREBASE_PROJECT_ID=${sa.project_id || 'frigestor-acb4a'}`,
  `FIREBASE_SERVICE_ACCOUNT_BASE64=${b64}`
];

for (const linha of linhas) {
  const key = linha.split('=')[0];
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(env)) env = env.replace(re, linha);
  else env += (env.endsWith('\n') ? '' : '\n') + linha + '\n';
}

env = env.replace(/^DATA_BACKEND=.*\n/m, '');
env = env.replace(/^FIREBASE_SERVICE_ACCOUNT=.*\n/m, '');
env = env.replace(/^FIREBASE_SERVICE_ACCOUNT_JSON=.*\n/m, '');

fs.writeFileSync(envPath, env.trimEnd() + '\n', 'utf-8');
console.log(`[ok] .env atualizado com FIREBASE_SERVICE_ACCOUNT_BASE64 (de ${path.basename(saPath)})`);
