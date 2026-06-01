/**
 * firebase-auth-client.js — Google OAuth via Firebase Auth (browser)
 */

(function () {
  'use strict';

  let auth = null;
  let initPromise = null;

  function envConfigurado() {
    const e = window.ENV || {};
    return Boolean(
      e.apiKey
      && e.apiKey !== 'your_api_key'
      && e.authDomain
      && e.projectId
    );
  }

  function initFirebaseAuthClient() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
      if (typeof firebase === 'undefined') {
        throw new Error('SDK Firebase Auth nao carregado.');
      }
      await window.initApp();
      if (!envConfigurado()) {
        throw new Error(
          'Configure FIREBASE_API_KEY e demais chaves Web no .env (Console Firebase > Seus apps > Web).'
        );
      }
      const e = window.ENV;
      if (!firebase.apps.length) {
        firebase.initializeApp({
          apiKey: e.apiKey,
          authDomain: e.authDomain,
          projectId: e.projectId,
          storageBucket: e.storageBucket,
          messagingSenderId: e.messagingSenderId,
          appId: e.appId
        });
      }
      auth = firebase.auth();
      return auth;
    })();

    return initPromise;
  }

  async function signInWithGooglePopup() {
    await initFirebaseAuthClient();
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await auth.signInWithPopup(provider);
    if (!result?.user) throw new Error('Login Google cancelado.');
    return result.user.getIdToken();
  }

  window.FIREBASE_AUTH_CLIENT = {
    isConfigured: envConfigurado,
    init: initFirebaseAuthClient,
    signInWithGooglePopup
  };
})();
