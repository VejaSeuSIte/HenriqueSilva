# Supabase backend — VejaSeuSIte CMS

Centraliza autenticação e proxy GitHub para os painéis `/admin/` dos sites VejaSeuSIte.

- **Project ref:** `zrpirpdspltxdyniqogq`
- **URL:** `https://zrpirpdspltxdyniqogq.supabase.co`

## O que já está pronto

- ✅ Schema SQL (`migrations/00_init.sql`)
- ✅ Edge Function (`functions/github-proxy/index.ts`)
- ✅ User criado: `cliente@henriquesilva.app` · UUID `72eb001b-12b7-420c-aba1-07efeded0a72`

## Passos para colocar no ar (Gabriel roda 1 vez)

### 1. Aplicar o schema SQL

Abre [SQL Editor do projeto](https://supabase.com/dashboard/project/zrpirpdspltxdyniqogq/sql/new), cola o conteúdo de `migrations/00_init.sql` e executa.

### 2. Deploy da Edge Function + secrets + cliente

Roda o `deploy.bat`:

```bat
cd C:\Users\gabri\HenriqueSilva\supabase
deploy.bat
```

O script faz, em sequência:
- `npx supabase login` (abre navegador na primeira vez)
- `npx supabase functions deploy github-proxy --no-verify-jwt`
- Pergunta o PAT GitHub e configura como secret `GITHUB_PAT`
- Insere a row do Henrique na tabela `clients` via REST

Para o **PAT**, pode usar o token classic da conta `VejaSeuSIte`:
```bash
gh auth switch --user VejaSeuSIte
gh auth token
```

### 3. Testar login

Acessa `https://vejaseusite.github.io/HenriqueSilva/admin/` e digita a senha definida durante o cadastro do user (passo de Auth Admin no Supabase Dashboard).

> **Importante:** antes de entregar pro cliente, troque a senha provisória via [Authentication › Users](https://supabase.com/dashboard/project/zrpirpdspltxdyniqogq/auth/users) → user `cliente@henriquesilva.app` → "Reset password" e gere uma nova. Não reuse a senha que esteve em chat/repo durante desenvolvimento.

## Troubleshooting

- **"PGRST205 — table not found"** → SQL não foi aplicado ainda. Volte ao passo 1.
- **"403 — no client linked to this user"** → Falta a row em `clients`. Roda `setup-client.bat`.
- **"github put failed: 404 not found"** → PAT não tem acesso ao repo. Use PAT da conta `VejaSeuSIte` ou crie fine-grained com `Contents: write` em `HenriqueSilva`.

## Adicionar novo cliente VejaSeuSIte

1. Auth Admin: cria user com email artificial (`cliente@<slug>.app`) + senha + `email_confirm: true`
2. Anota o UUID
3. Insere row em `clients`: slug, repo_owner, repo_name, display_name, owner_user_id
4. Adiciona `auth_email`, `supabase_url`, `supabase_anon_key` em `<repo>/assets/site-config.json`

## Como o admin chama (referência técnica)

```js
const { data: { session } } = await supa.auth.signInWithPassword({ email, password });
const res = await fetch(`${SUPABASE_URL}/functions/v1/github-proxy`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${session.access_token}`,
    "apikey": SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ action: "getFile", path: "assets/site-content.json" }),
});
```

Ações suportadas: `whoami`, `getFile`, `putFile`, `putBinary`, `deleteFile`, `listDir`.
