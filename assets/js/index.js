/**
 * index.js
 * --------------------------------------------------------------------------
 * Pequenos scripts da landing page:
 *   - preenche o ano atual no rodape
 */

(function () {
  'use strict';
  const ano = document.getElementById('ano');
  if (ano) ano.textContent = new Date().getFullYear();
})();
