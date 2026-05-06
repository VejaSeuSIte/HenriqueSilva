// VejaSeuSIte github-proxy
// Recebe ações autenticadas via JWT do Supabase, executa GitHub API com PAT secret
// Deploy: supabase functions deploy github-proxy --project-ref zrpirpdsplxdyniqogq
// Secrets necessárias: GITHUB_PAT (PAT classic ou fine-grained com Contents:write nos repos)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_PAT = Deno.env.get("GITHUB_PAT")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ActionBody {
  action: "getFile" | "putFile" | "putBinary" | "deleteFile" | "listDir" | "whoami";
  path?: string;
  content?: string;
  sha?: string;
  message?: string;
  branch?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const err = (status: number, message: string) => json({ error: message }, status);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return err(405, "method not allowed");

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return err(401, "missing auth");

    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userRes, error: authErr } = await supa.auth.getUser();
    if (authErr || !userRes?.user) return err(401, "invalid token");
    const user = userRes.user;

    const supaSrv = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: client, error: clientErr } = await supaSrv
      .from("clients")
      .select("*")
      .eq("owner_user_id", user.id)
      .single();
    if (clientErr || !client) return err(403, "no client linked to this user");

    const body: ActionBody = await req.json();
    const action = body.action;
    const branch = body.branch || "main";
    const repo = `${client.repo_owner}/${client.repo_name}`;

    if (action === "whoami") {
      return json({
        user: { id: user.id, email: user.email },
        client: { slug: client.slug, repo, display_name: client.display_name },
      });
    }

    const ghHeaders = {
      Authorization: `Bearer ${GITHUB_PAT}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "vejaseusite-github-proxy",
    };

    const path = (body.path || "").replace(/^\//, "");
    if (!path && action !== "whoami") return err(400, "path required");

    if (action === "getFile") {
      const r = await fetch(
        `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}?ref=${branch}`,
        { headers: ghHeaders }
      );
      if (r.status === 404) return json({ found: false });
      if (!r.ok) return err(r.status, `github get failed: ${await r.text()}`);
      const data = await r.json();
      return json({
        found: true,
        sha: data.sha,
        content: data.content,
        encoding: data.encoding,
        path: data.path,
        size: data.size,
      });
    }

    if (action === "listDir") {
      const r = await fetch(
        `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}?ref=${branch}`,
        { headers: ghHeaders }
      );
      if (r.status === 404) return json([]);
      if (!r.ok) return err(r.status, `github list failed: ${await r.text()}`);
      const data = await r.json();
      const slim = Array.isArray(data)
        ? data.map((it: { name: string; path: string; sha: string; size: number; type: string }) => ({
            name: it.name,
            path: it.path,
            sha: it.sha,
            size: it.size,
            type: it.type,
          }))
        : data;
      return json(slim);
    }

    if (action === "putFile" || action === "putBinary") {
      if (typeof body.content !== "string") return err(400, "content required");
      let b64 = body.content;
      if (action === "putFile") {
        b64 = btoa(unescape(encodeURIComponent(body.content)));
      }
      const reqBody: Record<string, string> = {
        message: body.message || `update ${path}`,
        content: b64,
        branch,
      };
      if (body.sha) reqBody.sha = body.sha;

      const r = await fetch(
        `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}`,
        { method: "PUT", headers: ghHeaders, body: JSON.stringify(reqBody) }
      );
      if (!r.ok) {
        const t = await r.text();
        return err(r.status, `github put failed: ${t}`);
      }
      return json(await r.json());
    }

    if (action === "deleteFile") {
      if (!body.sha) return err(400, "sha required for delete");
      const r = await fetch(
        `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}`,
        {
          method: "DELETE",
          headers: ghHeaders,
          body: JSON.stringify({
            message: body.message || `delete ${path}`,
            sha: body.sha,
            branch,
          }),
        }
      );
      if (!r.ok) return err(r.status, `github delete failed: ${await r.text()}`);
      return json(await r.json());
    }

    return err(400, "unknown action");
  } catch (e) {
    return err(500, e instanceof Error ? e.message : "unknown error");
  }
});
