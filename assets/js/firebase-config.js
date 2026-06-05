/**
 * firebase-config.js
 * --------------------------------------------------------------------------
 * Camada de abstracao que conversa com a API REST servida pelo `server.js`
 * (persistencia em Cloud Firestore).
 *
 * ETAPA 2 (futura): substituir pela inicializacao real do Firebase
 *                   (firebase-app, firebase-auth, firebase-firestore via CDN)
 *                   mantendo o MESMO contrato exposto em `window.DB` e
 *                   `window.AUTH`, para que as paginas continuem funcionando.
 *
 * Como usar:
 *   <script src="/assets/js/firebase-config.js"></script>
 *   ... await window.initApp(); ...
 */

(function () {
  'use strict';

  const PRODUCTION_ORIGIN = 'https://frigestor.vercel.app';

  function isLocalHost(hostname) {
    return /^(localhost|127\.0\.0\.1)$/i.test(hostname || '');
  }

  function devLocalEnabled() {
    return /[?&]local=1(?:&|$)/.test(window.location.search)
      || localStorage.getItem('frigestor.devLocal') === '1';
  }

  function sanitizeBaseUrl(url) {
    const raw = String(url || '').trim().replace(/\/$/, '');
    if (!raw) return window.location.origin;
    try {
      if (isLocalHost(new URL(raw).hostname) && !isLocalHost(window.location.hostname)) {
        return window.location.origin;
      }
    } catch (_) {
      return window.location.origin;
    }
    return raw;
  }

  function resolveApiUrl(url) {
    if (/^https?:\/\//i.test(url)) return url;
    const path = url.startsWith('/') ? url : `/${url}`;
    return `${window.location.origin}${path}`;
  }

  // Evita abrir paginas internas em localhost sem servidor (links/e-mails antigos).
  if (isLocalHost(window.location.hostname) && !devLocalEnabled()) {
    fetch(resolveApiUrl('/env'), { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('env indisponivel');
      })
      .catch(() => {
        window.location.replace(
          PRODUCTION_ORIGIN + window.location.pathname + window.location.search + window.location.hash
        );
      });
  }

  // ------------------------------------------------------------------------
  // Estado global de ambiente
  // ------------------------------------------------------------------------
  window.ENV = window.ENV || {};

  // BASE_URL do site (QR Codes, links publicos). Nunca usa localhost em producao.
  window.BASE_URL = sanitizeBaseUrl(window.location.origin);

  const STORAGE_KEY = 'frigestor.sessao';

  function getSessao() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function setSessao(usuario) {
    if (usuario) localStorage.setItem(STORAGE_KEY, JSON.stringify(usuario));
    else {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('benantec.sessao');
    }
  }

  // ------------------------------------------------------------------------
  // Helper de fetch JSON (envia tenant da sessao quando existir)
  // ------------------------------------------------------------------------
  async function jsonFetch(url, options = {}) {
    const opts = { ...options };
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (!opts.skipTenant) {
      const u = getSessao();
      if (u && u.role === 'super_admin') {
        headers['X-Session-Role'] = u.role;
        headers['X-Session-Uid'] = u.uid;
      } else if (u && u.tenantId) {
        headers['X-Tenant-Id'] = u.tenantId;
      }
    }
    delete opts.skipTenant;
    const res = await fetch(resolveApiUrl(url), { ...opts, headers });
    let data = null;
    try { data = await res.json(); } catch (_) { /* corpo vazio */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Erro HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ------------------------------------------------------------------------
  // initApp() - le /env e prepara as variaveis publicas
  // ------------------------------------------------------------------------
  let initPromise = null;
  window.initApp = function initApp() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const env = await jsonFetch('/env');
        window.ENV = env || {};
        if (env && env.baseUrl) window.BASE_URL = sanitizeBaseUrl(env.baseUrl);
      } catch (err) {
        console.warn('[firebase-config] Falha ao carregar /env:', err.message);
      }
      return true;
    })();
    return initPromise;
  };

  window.frigestorReady = window.initApp();

  // ========================================================================
  // window.TENANT - configuracao da empresa (tenant) logada
  // ========================================================================
  window.TENANT = {
    atual: null,
    async carregar(tenantId) {
      if (!tenantId) {
        this.atual = null;
        return null;
      }
      try {
        this.atual = await jsonFetch(`/api/tenants/${encodeURIComponent(tenantId)}`, { skipTenant: true });
        return this.atual;
      } catch (err) {
        console.warn('[TENANT] Falha ao carregar tenant:', err.message);
        this.atual = null;
        return null;
      }
    },
    id() {
      const u = getSessao();
      return (u && u.tenantId) || null;
    }
  };

  // ========================================================================
  // window.AUTH - sessao do usuario logado (persistida em localStorage)
  // ========================================================================
  window.AUTH = {
    /** Retorna o usuario logado ({uid, tenantId, nome, email, role, ativo}) ou null. */
    usuarioAtual() { return getSessao(); },

    /** Faz login via /api/auth/login (tenant, tecnico ou admin supremo). */
    async login(email, senha) {
      const usuario = await jsonFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, senha }),
        skipTenant: true
      });
      setSessao(usuario);
      if (usuario.tenantId) await window.TENANT.carregar(usuario.tenantId);
      else window.TENANT.atual = null;
      return usuario;
    },

    /** Encerra a sessao local. */
    logout() {
      setSessao(null);
      window.TENANT.atual = null;
    },

    /** Cadastro publico — fica pendente ate aprovacao do gestor. */
    async cadastro(nome, email, senha) {
      return jsonFetch('/api/auth/cadastro', {
        method: 'POST',
        body: JSON.stringify({ nome, email, senha }),
        skipTenant: true
      });
    },

    /** Cadastro via Google — pendente ate aprovacao (mesmo fluxo do formulario). */
    async cadastroGoogle() {
      if (!window.FIREBASE_AUTH_CLIENT?.isConfigured?.()) {
        throw new Error(
          'Cadastro Google indisponivel. Configure FIREBASE_API_KEY no .env e ative Google no Firebase Authentication.'
        );
      }
      const idToken = await window.FIREBASE_AUTH_CLIENT.signInWithGooglePopup();
      return jsonFetch('/api/auth/google/cadastro', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
        skipTenant: true
      });
    },

    /** Solicita codigo de 6 digitos por e-mail. */
    async esqueciSenha(email) {
      return jsonFetch('/api/auth/esqueci-senha', {
        method: 'POST',
        body: JSON.stringify({ email }),
        skipTenant: true
      });
    },

    /** Valida codigo recebido por e-mail. */
    async verificarCodigoRecuperacao(email, codigo) {
      return jsonFetch('/api/auth/verificar-codigo', {
        method: 'POST',
        body: JSON.stringify({ email, codigo }),
        skipTenant: true
      });
    },

    /** Redefine senha apos codigo validado. */
    async redefinirSenha(email, resetToken, senha, senhaConfirmacao) {
      return jsonFetch('/api/auth/redefinir-senha', {
        method: 'POST',
        body: JSON.stringify({ email, resetToken, senha, senhaConfirmacao }),
        skipTenant: true
      });
    },

    /** Login com Google (Firebase Auth + token validado no servidor). */
    async loginGoogle() {
      if (!window.FIREBASE_AUTH_CLIENT?.isConfigured?.()) {
        throw new Error(
          'Login Google indisponivel. Configure FIREBASE_API_KEY no .env e ative Google no Firebase Authentication.'
        );
      }
      const idToken = await window.FIREBASE_AUTH_CLIENT.signInWithGooglePopup();
      const usuario = await jsonFetch('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
        skipTenant: true
      });
      setSessao(usuario);
      if (usuario.tenantId) await window.TENANT.carregar(usuario.tenantId);
      else window.TENANT.atual = null;
      return usuario;
    },

    /**
     * Re-sincroniza o usuario logado com os dados frescos do "banco".
     * Util quando o admin edita usuarios.json e quer ver as mudancas sem relogar.
     * Se o usuario nao existir mais ou estiver inativo, faz logout.
     */
    async resincronizar() {
      const u = getSessao();
      if (!u) return null;
      if (u.role === 'super_admin') return u;
      try {
        const todos = await jsonFetch('/api/usuarios');
        const atual = todos.find((x) => x.uid === u.uid);
        if (!atual || !atual.ativo) {
          setSessao(null);
          window.location.replace('/pages/login.html');
          return null;
        }
        setSessao(atual);
        await window.TENANT.carregar(atual.tenantId);
        return atual;
      } catch (_) {
        return u;
      }
    },

    /**
     * Protege uma pagina: se o usuario nao estiver logado ou nao tiver o role
     * exigido, redireciona para o login. Retorna o usuario quando autorizado.
     */
    requireRole(rolesPermitidas, opts = {}) {
      const exigeTenant = opts.exigeTenant !== false;
      const loginUrl = opts.loginUrl || '/pages/login.html';
      const u = getSessao();
      const lista = Array.isArray(rolesPermitidas) ? rolesPermitidas : [rolesPermitidas];
      const tenantOk = !exigeTenant || u?.tenantId;
      if (!u || !tenantOk || !lista.includes(u.role)) {
        window.location.replace(loginUrl);
        return null;
      }
      return u;
    }
  };

  /**
   * Logout global — usado pelos botoes "Sair" em campo.html, admin.html, etc.
   * Precisa estar em firebase-config.js (carregado em todas as paginas internas).
   */
  window.fazerLogout = function fazerLogout() {
    window.AUTH.logout();
    window.location.replace('/pages/login.html');
  };

  // Carrega tenant da sessao existente (paginas internas)
  (function bootTenantFromSessao() {
    const u = getSessao();
    if (u && u.tenantId) {
      window.TENANT.carregar(u.tenantId);
    }
  })();

  // ========================================================================
  // window.DB - operacoes "estilo Firestore" sobre a API local
  // ========================================================================
  window.DB = {
    // --- tenants ----------------------------------------------------------
    tenants: {
      listar() { return jsonFetch('/api/tenants', { skipTenant: true }); },
      buscar(id) { return jsonFetch(`/api/tenants/${encodeURIComponent(id)}`, { skipTenant: true }); }
    },

    // --- plataforma (admin supremo) ---------------------------------------
    plataforma: {
      tenants: {
        listar() { return jsonFetch('/api/plataforma/tenants'); },
        criar(payload) {
          return jsonFetch('/api/plataforma/tenants', {
            method: 'POST', body: JSON.stringify(payload)
          });
        },
        atualizar(id, payload) {
          return jsonFetch(`/api/plataforma/tenants/${encodeURIComponent(id)}`, {
            method: 'PATCH', body: JSON.stringify(payload)
          });
        }
      },
      usuarios: {
        listar(tenantId) {
          return jsonFetch(`/api/plataforma/tenants/${encodeURIComponent(tenantId)}/usuarios`);
        },
        criar(tenantId, payload) {
          return jsonFetch(`/api/plataforma/tenants/${encodeURIComponent(tenantId)}/usuarios`, {
            method: 'POST', body: JSON.stringify(payload)
          });
        },
        atualizar(tenantId, uid, payload) {
          return jsonFetch(`/api/plataforma/tenants/${encodeURIComponent(tenantId)}/usuarios/${encodeURIComponent(uid)}`, {
            method: 'PATCH', body: JSON.stringify(payload)
          });
        },
        excluir(tenantId, uid) {
          return jsonFetch(`/api/plataforma/tenants/${encodeURIComponent(tenantId)}/usuarios/${encodeURIComponent(uid)}`, {
            method: 'DELETE'
          });
        }
      },
      pendentes: {
        listar() { return jsonFetch('/api/plataforma/cadastros-pendentes'); },
        processar(uid, payload) {
          return jsonFetch(`/api/plataforma/cadastros-pendentes/${encodeURIComponent(uid)}`, {
            method: 'PATCH', body: JSON.stringify(payload)
          });
        }
      },
      equipamentos: {
        listar() { return jsonFetch('/api/plataforma/equipamentos'); }
      },
      visitas: {
        listar() { return jsonFetch('/api/plataforma/visitas'); }
      }
    },

    // --- usuarios ---------------------------------------------------------
    usuarios: {
      listar() { return jsonFetch('/api/usuarios'); },
      criar(payload) {
        return jsonFetch('/api/usuarios', { method: 'POST', body: JSON.stringify(payload) });
      },
      atualizar(uid, payload) {
        return jsonFetch(`/api/usuarios/${encodeURIComponent(uid)}`, {
          method: 'PATCH', body: JSON.stringify(payload)
        });
      }
    },

    // --- clientes (empresas atendidas) ------------------------------------
    clientes: {
      listar() { return jsonFetch('/api/clientes'); },
      listarTodos() { return jsonFetch('/api/clientes?incluirInativos=1'); },
      criar(payload) {
        return jsonFetch('/api/clientes', { method: 'POST', body: JSON.stringify(payload) });
      },
      atualizar(id, payload) {
        return jsonFetch(`/api/clientes/${encodeURIComponent(id)}`, {
          method: 'PATCH', body: JSON.stringify(payload)
        });
      }
    },

    // --- equipamentos -----------------------------------------------------
    equipamentos: {
      listar() { return jsonFetch('/api/equipamentos'); },
      buscar(id) { return jsonFetch(`/api/equipamentos/${encodeURIComponent(id)}`); },
      criar(payload) {
        return jsonFetch('/api/equipamentos', { method: 'POST', body: JSON.stringify(payload) });
      },
      atualizar(id, payload) {
        return jsonFetch(`/api/equipamentos/${encodeURIComponent(id)}`, {
          method: 'PATCH', body: JSON.stringify(payload)
        });
      },
      excluir(id) {
        return jsonFetch(`/api/equipamentos/${encodeURIComponent(id)}`, { method: 'DELETE' });
      }
    },

    // --- visitas ----------------------------------------------------------
    visitas: {
      listar(equipamentoId) {
        const qs = equipamentoId
          ? `?equipamentoId=${encodeURIComponent(equipamentoId)}`
          : '';
        return jsonFetch(`/api/visitas${qs}`);
      },
      criar(payload) {
        return jsonFetch('/api/visitas', { method: 'POST', body: JSON.stringify(payload) });
      },

      /**
       * Simula onSnapshot do Firestore via polling a cada `intervalo` ms.
       * Retorna uma funcao para encerrar a inscricao.
       * Etapa 2: substituir por onSnapshot do Firestore.
       */
      assinar(equipamentoId, callback, intervalo = 5000) {
        let cancelado = false;
        const tick = async () => {
          if (cancelado) return;
          try {
            const lista = await window.DB.visitas.listar(equipamentoId);
            if (!cancelado) callback(lista);
          } catch (err) {
            console.warn('[DB.visitas.assinar] erro:', err.message);
          }
        };
        tick();
        const t = setInterval(tick, intervalo);
        return () => { cancelado = true; clearInterval(t); };
      }
    }
  };

  // ------------------------------------------------------------------------
  // Helpers globais reutilizados pelas paginas
  // ------------------------------------------------------------------------
  window.UI = window.UI || {};

  /** Formata uma data ISO/timestamp para o padrao brasileiro. */
  window.UI.formatarData = function (iso, opts = {}) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    const { hora = true } = opts;
    return d.toLocaleString('pt-BR', hora
      ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  /** Toast simples (sem dependencias). */
  window.UI.toast = function (msg, tipo = 'info', ms = 3200) {
    const el = document.createElement('div');
    el.className = `toast toast--${tipo}`;
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    setTimeout(() => {
      el.classList.remove('is-visible');
      setTimeout(() => el.remove(), 240);
    }, ms);
  };

  /** Trava/destrava um botao mostrando spinner durante uma operacao async. */
  window.UI.botaoLoading = function (btn, textoLoading = 'Salvando...') {
    if (!btn) return () => {};
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${textoLoading}`;
    return () => {
      btn.disabled = false;
      btn.innerHTML = original;
    };
  };

  /** Escapa texto para uso seguro em innerHTML. */
  window.UI.escapeHtml = function (texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };
})();

// TODO: Firestore Security Rules
// Quando migrarmos para o Firebase, este arquivo passara a inicializar o SDK
// real (initializeApp + getAuth + getFirestore) e implementar window.AUTH e
// window.DB com chamadas reais. As regras de seguranca devem garantir:
//   - usuarios: leitura autenticada, escrita apenas para admin
//   - equipamentos: leitura publica, escrita autenticada com dataInstalacao imutavel
//   - visitas: leitura publica, escrita autenticada (tecnicoUid == auth.uid)
