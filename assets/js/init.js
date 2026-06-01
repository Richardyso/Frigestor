/**
 * init.js
 * --------------------------------------------------------------------------
 * Script de bootstrap das paginas internas:
 *   - Dispara window.initApp() (carrega /env e prepara o "Firebase")
 *   - Preenche o ano corrente em qualquer elemento com id="ano"
 *
 * Deve ser carregado APOS firebase-config.js e ANTES do JS da pagina.
 */
(function () {
  'use strict';

  if (window.frigestorReady) {
    window.frigestorReady.then(() => {
      if (window.APP_SHELL) window.APP_SHELL.boot();
    });
  }

  const ano = document.getElementById('ano');
  if (ano) ano.textContent = new Date().getFullYear();
})();
