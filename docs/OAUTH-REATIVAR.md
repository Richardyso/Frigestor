# Reativar Google OAuth (login e cadastro)

## Estado atual

- **UI:** botao "Continuar com Google" comentado em `pages/login.html` e `pages/cadastro.html`.
- **API:** mesmo com F12 ou Postman, as rotas recusam enquanto a variavel nao estiver ativa.
- **Cadastro publico por e-mail:** desligado por padrao (`ENABLE_PUBLIC_SIGNUP`).

## Reativar Google OAuth

1. **Vercel** → Project → Settings → Environment Variables  
   - `ENABLE_GOOGLE_OAUTH` = `true` (Production)
2. **Redeploy** do projeto.
3. Nos arquivos HTML, **descomente**:
   - O bloco entre `GOOGLE OAUTH` e `fim GOOGLE OAUTH` em `pages/login.html`
   - O mesmo em `pages/cadastro.html`
   - Os `<script>` do Firebase e `firebase-auth-client.js` no final de cada arquivo

## Reativar cadastro publico por e-mail (opcional)

1. Vercel: `ENABLE_PUBLIC_SIGNUP` = `true`
2. Redeploy

Sem essa flag, o formulario de cadastro pode aparecer, mas `POST /api/auth/cadastro` retorna **403**.

## Seguranca

Quem tentar chamar `/api/auth/google` ou `/api/auth/google/cadastro` sem a flag no servidor recebe **403**.  
Mesmo com OAuth ligado, novos cadastros Google continuam **pendentes** ate voce aprovar no painel Admin plataforma.
