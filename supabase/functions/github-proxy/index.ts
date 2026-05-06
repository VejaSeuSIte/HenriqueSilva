// VejaSeuSIte github-proxy (hardened)
// Auth: JWT Supabase. Operação GitHub via PAT secret.
// Hardening: whitelist de paths, payload size limit, branch whitelist, CORS restrito,
// rate limiting (in-memory), erros sanitizados, audit log.
// Deploy: supabase functions deploy github-proxy --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_PAT = Deno.env.get("GITHUB_PAT")!;

const ALLOWED_ORIGINS = new Set([
  "https://vejaseusite.github.io",
]);

// Caminhos permitidos (prefixos). Tudo fora disso → 403.
// Para multi-cliente, isso é genérico o suficiente (qualquer site VejaSeuSIte
// usa essas estruturas).
// Atenção: blog/_layouts/ NÃO está aqui de propósito. Templates Jinja são parte
// da plataforma VejaSeuSIte; cliente não edita (XSS em todos os posts gerados).
const ALLOWED_PREFIXES = [
  "assets/",
  "blog/_posts/",
  "blog/images/",
];

const ALLOWED_BRANCHES = new Set(["main", "master"]);

const MAX_CONTENT_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_BODY_BYTES = 35 * 1024 * 1024;    // 35 MB JSON envelope (base64 expande ~33%)

// Rate limiter persistente via Postgres (RPC bump_rate_limit). 60 reqs/minuto/user.
const RATE_LIMIT_MAX_PER_MINUTE = 60;

function corsFor(origin: string | null) {
  const ok = origin && ALLOWED_ORIGINS.has(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "null",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function originAllowed(origin: string | null): boolean {
  // Sem Origin (curl, server-side, alguns user-agents): permite (compat).
  // Com Origin: deve estar na whitelist.
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

interface ActionBody {
  action: "getFile" | "putFile" | "putBinary" | "deleteFile" | "listDir" | "whoami";
  path?: string;
  content?: string;
  sha?: string;
  message?: string;
  branch?: string;
}

function jsonResp(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
function errResp(status: number, message: string, cors: Record<string, string>) {
  return jsonResp({ error: message }, status, cors);
}

function normalizePath(raw: string): { ok: true; path: string } | { ok: false; reason: string } {
  if (typeof raw !== "string") return { ok: false, reason: "path must be a string" };
  let p = raw;
  // Rejeita caracteres de query/fragmento/escape
  if (/[?#&;\\]/.test(p)) return { ok: false, reason: "invalid characters in path" };
  // Decode percent-encoded e re-checa
  try { p = decodeURIComponent(p); } catch { return { ok: false, reason: "invalid percent-encoding" }; }
  // Remove TODAS as barras iniciais (não só uma)
  p = p.replace(/^\/+/, "");
  // Rejeita .. em qualquer segmento
  const segments = p.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    return { ok: false, reason: "path traversal detected" };
  }
  // Vazio
  if (!p) return { ok: false, reason: "empty path" };
  // Comprimento sane
  if (p.length > 512) return { ok: false, reason: "path too long" };
  return { ok: true, path: p };
}

function pathAllowed(p: string): boolean {
  return ALLOWED_PREFIXES.some((pref) => p.startsWith(pref));
}

async function rateLimit(supaSrv: ReturnType<typeof createClient>, userId: string): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  try {
    const { data, error } = await supaSrv.rpc("bump_rate_limit", {
      p_user_id: userId,
      p_max_per_minute: RATE_LIMIT_MAX_PER_MINUTE,
    });
    if (error) { console.error("rate limit rpc:", error); return { ok: true }; } // fail-open
    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.allowed === false) return { ok: false, retryAfter: 60 };
    return { ok: true };
  } catch (e) {
    console.error("rate limit exception:", e);
    return { ok: true }; // fail-open em caso de erro
  }
}

// Fire-and-forget mas com timeout pra não vazar conexão.
// EdgeRuntime.waitUntil mantém a Promise viva após response, sem bloquear.
function logAudit(supaSrv: ReturnType<typeof createClient>, payload: {
  user_id: string;
  client_id: string | null;
  action: string;
  path?: string;
  status_code: number;
  message?: string;
}) {
  const promise = (async () => {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5000);
      try {
        await supaSrv.from("audit_logs").insert(payload as Record<string, unknown>).abortSignal(ac.signal);
      } finally { clearTimeout(t); }
    } catch (e) {
      console.error("audit log failed:", e);
    }
  })();
  // Deno Deploy: garante que a Promise não é abortada quando response retorna.
  try { (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(promise); } catch (_) {}
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const cors = corsFor(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return errResp(405, "method not allowed", cors);
  // Hard-block: Origin presente mas não permitido → 403 (curl OK pq não envia Origin)
  if (!originAllowed(origin)) return errResp(403, "origin not allowed", cors);

  // Limite de tamanho do body (Content-Length pode mentir; é só primeira barreira)
  const cl = parseInt(req.headers.get("content-length") || "0", 10);
  if (cl > MAX_BODY_BYTES) return errResp(413, "payload too large", cors);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return errResp(401, "missing auth", cors);

    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userRes, error: authErr } = await supa.auth.getUser();
    if (authErr || !userRes?.user) return errResp(401, "invalid token", cors);
    const user = userRes.user;

    const supaSrv = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Rate limit (persistente via Postgres)
    const rl = await rateLimit(supaSrv, user.id);
    if (!rl.ok) {
      return new Response(JSON.stringify({ error: "rate limit exceeded" }), {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json", "Retry-After": String(rl.retryAfter) },
      });
    }

    const { data: client, error: clientErr } = await supaSrv
      .from("clients")
      .select("*")
      .eq("owner_user_id", user.id)
      .maybeSingle();
    if (clientErr) return errResp(500, "client lookup failed", cors);
    if (!client) return errResp(403, "no client linked to this user", cors);

    let body: ActionBody;
    try { body = await req.json(); }
    catch { return errResp(400, "invalid json body", cors); }

    const action = body.action;
    const branch = body.branch || "main";

    if (!ALLOWED_BRANCHES.has(branch)) {
      return errResp(400, "branch not allowed", cors);
    }

    if (action === "whoami") {
      logAudit(supaSrv, { user_id: user.id, client_id: client.id as string, action, status_code: 200 });
      return jsonResp({
        user: { id: user.id, email: user.email },
        client: { slug: client.slug, repo: `${client.repo_owner}/${client.repo_name}`, display_name: client.display_name },
      }, 200, cors);
    }

    // Ações com path
    const norm = normalizePath(body.path || "");
    if (!norm.ok) return errResp(400, norm.reason, cors);
    if (!pathAllowed(norm.path)) {
      logAudit(supaSrv, { user_id: user.id, client_id: client.id as string, action, path: norm.path, status_code: 403, message: "path not in allowlist" });
      return errResp(403, "path not allowed", cors);
    }

    // Para puts, valida tamanho do conteúdo
    if (action === "putFile" || action === "putBinary") {
      if (typeof body.content !== "string") return errResp(400, "content required", cors);
      if (body.content.length > MAX_CONTENT_BYTES) return errResp(413, "content too large", cors);
      // Validação base64 pra putBinary
      if (action === "putBinary" && !/^[A-Za-z0-9+/=\r\n]+$/.test(body.content)) {
        return errResp(400, "invalid base64 content", cors);
      }
    }

    const repo = `${client.repo_owner}/${client.repo_name}`;
    const ghHeaders = {
      Authorization: `Bearer ${GITHUB_PAT}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "vejaseusite-github-proxy",
    };
    const ghPath = norm.path.split("/").map(encodeURIComponent).join("/");

    if (action === "getFile") {
      const r = await fetch(
        `https://api.github.com/repos/${repo}/contents/${ghPath}?ref=${branch}`,
        { headers: ghHeaders }
      );
      if (r.status === 404) {
        logAudit(supaSrv, { user_id: user.id, client_id: client.id as string, action, path: norm.path, status_code: 404 });
        return jsonResp({ found: false }, 200, cors);
      }
      if (!r.ok) {
        const text = await r.text();
        console.error(`github get failed [${r.status}]:`, text);
        logAudit(supaSrv, { user_id: user.id, client_id: client.id as string, action, path: norm.path, status_code: r.status, message: "github error" });
        return errResp(r.status, "upstream error", cors);
      }
      const data = await r.json();
      logAudit(supaSrv, { user_id: user.id, client_id: client.id as string, action, path: norm.path, status_code: 200 });
      return jsonResp({
        found: true,
        sha: data.sha,
        content: data.content,
        encoding: data.encoding,
        path: data.path,
        size: data.size,
      }, 200, cors);
    }

    if (action === "listDir") {
      const r = await fetch(
        `https://api.github.com/repos/${repo}/contents/${ghPath}?ref=${branch}`,
        { headers: ghHeaders }
      );
      if (r.status === 404) return jsonResp([], 200, cors);
      if (!r.ok) {
        console.error(`github list failed [${r.status}]:`, await r.text());
        return errResp(r.status, "upstream error", cors);
      }
      const data = await r.json();
      const slim = Array.isArray(data)
        ? data.map((it: { name: string; path: string; sha: string; size: number; type: string }) => ({
            name: it.name, path: it.path, sha: it.sha, size: it.size, type: it.type,
          }))
        : data;
      logAudit(supaSrv, { user_id: user.id, client_id: client.id as string, action, path: norm.path, status_code: 200 });
      return jsonResp(slim, 200, cors);
    }

    if (action === "putFile" || action === "putBinary") {
      let b64 = body.content!;
      if (action === "putFile") {
        // utf-8 → base64
        b64 = btoa(unescape(encodeURIComponent(body.content!)));
      }
      const reqBody: Record<string, string> = {
        message: typeof body.message === "string" ? body.message.slice(0, 200) : `update ${norm.path}`,
        content: b64,
        branch,
      };
      if (typeof body.sha === "string" && /^[a-f0-9]{40}$/i.test(body.sha)) {
        reqBody.sha = body.sha;
      } else if (body.sha) {
        return errResp(400, "invalid sha format", cors);
      }
      const r = await fetch(
        `https://api.github.com/repos/${repo}/contents/${ghPath}`,
        { method: "PUT", headers: ghHeaders, body: JSON.stringify(reqBody) }
      );
      if (!r.ok) {
        const text = await r.text();
        console.error(`github put failed [${r.status}]:`, text);
        logAudit(supaSrv, { user_id: user.id, client_id: client.id as string, action, path: norm.path, status_code: r.status, message: "github error" });
        // 409: conflito de sha — deixar passar mensagem específica pro front pegar
        if (r.status === 409) return errResp(409, "conflict (file changed elsewhere)", cors);
        if (r.status === 422) return errResp(422, "invalid request to github", cors);
        return errResp(r.status, "upstream error", cors);
      }
      const data = await r.json();
      logAudit(supaSrv, { user_id: user.id, client_id: client.id as string, action, path: norm.path, status_code: 200 });
      return jsonResp(data, 200, cors);
    }

    if (action === "deleteFile") {
      if (!body.sha || !/^[a-f0-9]{40}$/i.test(body.sha)) {
        return errResp(400, "valid sha required for delete", cors);
      }
      const r = await fetch(
        `https://api.github.com/repos/${repo}/contents/${ghPath}`,
        {
          method: "DELETE",
          headers: ghHeaders,
          body: JSON.stringify({
            message: typeof body.message === "string" ? body.message.slice(0, 200) : `delete ${norm.path}`,
            sha: body.sha,
            branch,
          }),
        }
      );
      if (!r.ok) {
        console.error(`github delete failed [${r.status}]:`, await r.text());
        logAudit(supaSrv, { user_id: user.id, client_id: client.id as string, action, path: norm.path, status_code: r.status });
        return errResp(r.status, "upstream error", cors);
      }
      logAudit(supaSrv, { user_id: user.id, client_id: client.id as string, action, path: norm.path, status_code: 200 });
      return jsonResp(await r.json(), 200, cors);
    }

    return errResp(400, "unknown action", cors);
  } catch (e) {
    console.error("unhandled error:", e);
    return errResp(500, "internal error", cors);
  }
});
