/**
 * lib/firebase-admin.js — Firebase Admin (local + Vercel)
 *
 * Credenciais (prioridade):
 *   1. FIREBASE_SERVICE_ACCOUNT_JSON  — JSON minificado (Vercel / .env)
 *   2. FIREBASE_SERVICE_ACCOUNT_BASE64  — alternativa para colar no painel Vercel
 *   3. FIREBASE_SERVICE_ACCOUNT         — caminho de arquivo (dev local opcional)
 */

const path = require('path');
const fs = require('fs');

let app = null;

function carregarServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson && String(rawJson).trim()) {
    return JSON.parse(String(rawJson).trim());
  }

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64 && String(b64).trim()) {
    return JSON.parse(Buffer.from(String(b64).trim(), 'base64').toString('utf-8'));
  }

  const credPath = process.env.FIREBASE_SERVICE_ACCOUNT
    || process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (credPath) {
    const abs = path.isAbsolute(credPath) ? credPath : path.join(process.cwd(), credPath);
    if (fs.existsSync(abs)) {
      return JSON.parse(fs.readFileSync(abs, 'utf-8'));
    }
  }

  return null;
}

function initFirebaseAdmin() {
  if (app) return app;

  const admin = require('firebase-admin');
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (admin.apps.length) {
    app = admin.app();
    return app;
  }

  const serviceAccount = carregarServiceAccount();
  if (serviceAccount) {
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: projectId || serviceAccount.project_id
    });
    return app;
  }

  if (!projectId) {
    throw new Error(
      'Configure FIREBASE_PROJECT_ID e FIREBASE_SERVICE_ACCOUNT_JSON (ou BASE64) no .env'
    );
  }

  app = admin.initializeApp({ projectId });
  return app;
}

function getFirestore() {
  initFirebaseAdmin();
  return require('firebase-admin').firestore();
}

function firebaseConfigurado() {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    || process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
    || process.env.FIREBASE_SERVICE_ACCOUNT
    || process.env.GOOGLE_APPLICATION_CREDENTIALS
    || process.env.FIREBASE_PROJECT_ID
  );
}

function getAuthAdmin() {
  initFirebaseAdmin();
  return require('firebase-admin').auth();
}

async function verifyGoogleIdToken(idToken) {
  return getAuthAdmin().verifyIdToken(String(idToken));
}

module.exports = {
  initFirebaseAdmin,
  getFirestore,
  getAuthAdmin,
  verifyGoogleIdToken,
  firebaseConfigurado,
  carregarServiceAccount
};
