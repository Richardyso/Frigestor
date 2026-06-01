/**
 * Converte senhas em texto puro dos JSONs para bcrypt.
 * Uso: node scripts/migrate-passwords.js
 */

require('dotenv').config();

const path = require('path');
const fs = require('fs').promises;
const { hashSenhaSeNecessario, isSenhaHasheada } = require('../lib/password');

const DATA_DIR = path.join(__dirname, '..', 'data');

async function migrarUsuarios(lista, label) {
  if (!Array.isArray(lista)) return { label, alterados: 0, total: 0 };
  let alterados = 0;
  for (const u of lista) {
    if (!u || typeof u.senha !== 'string') continue;
    if (isSenhaHasheada(u.senha)) continue;
    u.senha = await hashSenhaSeNecessario(u.senha);
    alterados += 1;
  }
  return { label, alterados, total: lista.length };
}

async function main() {
  const relPaths = [
    'plataforma/usuarios.json',
    'plataforma/cadastros-pendentes.json'
  ];

  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name === 'plataforma') continue;
    relPaths.push(path.join(ent.name, 'usuarios.json'));
  }

  let totalAlterados = 0;

  for (const rel of relPaths) {
    const caminho = path.join(DATA_DIR, rel);
    try {
      const raw = await fs.readFile(caminho, 'utf-8');
      const dados = JSON.parse(raw);
      const info = await migrarUsuarios(dados, rel);
      if (info.alterados > 0) {
        await fs.writeFile(caminho, JSON.stringify(dados, null, 2), 'utf-8');
        console.log(`[ok] ${rel}: ${info.alterados}/${info.total} senha(s) hasheada(s)`);
        totalAlterados += info.alterados;
      } else {
        console.log(`[--] ${rel}: nada a migrar`);
      }
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
  }

  console.log(`\nMigracao concluida. ${totalAlterados} senha(s) atualizada(s).`);
}

main().catch((err) => {
  console.error('[erro]', err);
  process.exit(1);
});
