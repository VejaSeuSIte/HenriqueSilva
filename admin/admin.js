/* admin.js — Painel HSA via Supabase Auth + Edge Function github-proxy
   Cliente loga só com senha; email/config vêm de assets/site-config.json. */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const REPO_PATHS = {
  POSTS: 'blog/_posts',
  IMAGES: 'blog/images',
  SITE_ASSETS: 'assets',
  SITE_CONTENT: 'assets/site-content.json',
  LANDINGS_CONTENT: 'assets/landings-content.json',
  SITE_CONFIG: 'assets/site-config.json',
};

const CATEGORIES = {
  trabalhista: 'Trabalhista',
  previdenciario: 'Previdenciário',
  civel: 'Cível',
  familia: 'Família',
  consumidor: 'Consumidor',
  imobiliario: 'Imobiliário',
  tributario: 'Tributário',
  criminal: 'Criminal',
  empresarial: 'Empresarial',
  geral: 'Geral',
};

const LANDING_SLUGS = ['trabalhista','previdenciario','familia','empresarial','imobiliario','civel','consumidor','juizados','criminal','tributario','sobre','contato'];
const LANDING_LABELS = {
  trabalhista: 'Trabalhista', previdenciario: 'Previdenciário', familia: 'Família',
  empresarial: 'Empresarial', imobiliario: 'Imobiliário', civel: 'Cível',
  consumidor: 'Consumidor', juizados: 'Juizados', criminal: 'Criminal',
  tributario: 'Tributário', sobre: 'Sobre', contato: 'Contato',
};

let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';
let AUTH_EMAIL = '';
let supa = null;
let currentSession = null;

const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));

/* ===================== BOOTSTRAP ===================== */

async function bootstrap() {
  try {
    const r = await fetch('/HenriqueSilva/assets/site-config.json?v=' + Date.now(), { cache: 'no-store' });
    const cfg = await r.json();
    SUPABASE_URL = cfg.supabase_url || '';
    SUPABASE_ANON_KEY = cfg.supabase_anon_key || '';
    AUTH_EMAIL = cfg.auth_email || '';
  } catch (e) {
    document.body.innerHTML = `<div style="padding:60px;text-align:center;color:#d4af37;font-family:sans-serif">
      <h2>Configuração não encontrada</h2><p>Não foi possível carregar assets/site-config.json</p></div>`;
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !AUTH_EMAIL) {
    document.body.innerHTML = `<div style="padding:60px;text-align:center;color:#d4af37;font-family:sans-serif">
      <h2>Painel não configurado</h2><p>Faltam supabase_url / supabase_anon_key / auth_email em site-config.json</p></div>`;
    return;
  }
  supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'hsa_admin_supa' },
  });
  const { data: { session } } = await supa.auth.getSession();
  currentSession = session;
  window.addEventListener('hashchange', route);
  route();
}

bootstrap();

/* ===================== PROXY GITHUB ===================== */

async function callProxy(action, opts = {}) {
  if (!currentSession) throw new Error('Sessão expirada');
  const r = await fetch(`${SUPABASE_URL}/functions/v1/github-proxy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${currentSession.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...opts }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) { await supa.auth.signOut(); currentSession = null; location.hash = '#/login'; }
    throw new Error(data.error || `Erro ${r.status}`);
  }
  return data;
}

function decodeBase64Utf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

async function getTextFile(path) {
  const f = await callProxy('getFile', { path });
  if (!f.found) return null;
  return { sha: f.sha, content: decodeBase64Utf8(f.content) };
}

async function putTextFile(path, content, sha = null, message = null) {
  return callProxy('putFile', { path, content, sha, message: message || `Update ${path}` });
}

async function getJsonFile(path) {
  const f = await getTextFile(path);
  if (!f) return null;
  try { return { sha: f.sha, content: JSON.parse(f.content) }; }
  catch (e) { throw new Error(`JSON inválido em ${path}`); }
}

async function putJsonFile(path, json, sha = null, message = null) {
  return putTextFile(path, JSON.stringify(json, null, 2) + '\n', sha, message);
}

async function listDir(path) { return callProxy('listDir', { path }); }
async function deleteFile(path, sha, message = null) {
  return callProxy('deleteFile', { path, sha, message: message || `Delete ${path}` });
}
async function putBinaryFile(path, base64, message = null) {
  return callProxy('putBinary', { path, content: base64, message: message || `Upload ${path}` });
}

/* ===================== HELPERS ===================== */

function slugify(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fileBaseName(path) { return path.split('/').pop().replace(/\.md$/, ''); }
function fmtDate(iso) {
  const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  try { const [y,m,d] = iso.split('-').map(Number); return `${d} ${months[m-1]} ${y}`; }
  catch (e) { return iso; }
}
function escAttr(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function parseFrontMatter(text) {
  if (!text.startsWith('---')) return { meta: {}, body: text };
  const idx = text.indexOf('---', 3);
  if (idx < 0) return { meta: {}, body: text };
  const yaml = text.slice(3, idx).trim();
  const body = text.slice(idx + 3).replace(/^\s*\n/, '');
  const meta = {};
  yaml.split('\n').forEach(line => {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) return;
    let v = m[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    meta[m[1]] = v;
  });
  return { meta, body };
}
function buildFrontMatter(meta) {
  const lines = ['---'];
  ['title','slug','excerpt','category','tags','cover','date','updated'].forEach(k => {
    if (meta[k] === undefined || meta[k] === null) return;
    let v = meta[k];
    if (Array.isArray(v)) v = '[' + v.map(x => `${x}`).join(', ') + ']';
    else if (typeof v === 'string' && (v.includes(':') || v.includes('"') || v.includes("'"))) v = `"${v.replace(/"/g, '\\"')}"`;
    else if (typeof v === 'string' && k !== 'date' && k !== 'updated' && k !== 'slug' && k !== 'category') v = `"${v}"`;
    lines.push(`${k}: ${v}`);
  });
  lines.push('---', '');
  return lines.join('\n');
}

function toast(message, kind = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const icon = kind === 'success'
    ? '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  el.innerHTML = icon + '<span>' + message + '</span>';
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; }, 2400);
  setTimeout(() => el.remove(), 2800);
}

function mdInline(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1"/>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function mdRender(md) {
  if (!md) return '';
  const lines = md.split('\n');
  let out = '', inList = null, inCode = false, inQuote = false, codeBuf = '';
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.startsWith('```')) {
      if (inCode) { out += `<pre><code>${codeBuf.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</code></pre>`; codeBuf=''; inCode=false; }
      else inCode = true; continue;
    }
    if (inCode) { codeBuf += line + '\n'; continue; }
    if (inList && !line.match(/^\s*([-*]|\d+\.)\s/)) { out += `</${inList}>`; inList = null; }
    if (inQuote && !line.startsWith('>')) { out += '</blockquote>'; inQuote = false; }
    if (!line.trim()) continue;
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)/))) out += `<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`;
    else if (line.startsWith('> ')) { if (!inQuote) { out += '<blockquote>'; inQuote = true; } out += `<p>${mdInline(line.slice(2))}</p>`; }
    else if ((m = line.match(/^[-*]\s+(.*)/))) { if (inList !== 'ul') { if (inList) out += `</${inList}>`; out += '<ul>'; inList = 'ul'; } out += `<li>${mdInline(m[1])}</li>`; }
    else if ((m = line.match(/^\d+\.\s+(.*)/))) { if (inList !== 'ol') { if (inList) out += `</${inList}>`; out += '<ol>'; inList = 'ol'; } out += `<li>${mdInline(m[1])}</li>`; }
    else if (line.startsWith('---')) out += '<hr/>';
    else out += `<p>${mdInline(line)}</p>`;
  }
  if (inList) out += `</${inList}>`;
  if (inQuote) out += '</blockquote>';
  return out;
}

/* ===================== ROUTING ===================== */

async function route() {
  const hash = location.hash || '#/';
  const path = hash.replace(/^#/, '');
  const app = $('#app');
  if (!currentSession && path !== '/login') { location.hash = '#/login'; return; }
  if (currentSession && path === '/login') { location.hash = '#/'; return; }
  if (path === '/login') return renderLogin(app);
  if (path === '/' || path === '/dashboard') return renderDashboard(app);
  if (path === '/posts') return renderPosts(app);
  if (path === '/new') return renderEditor(app, null);
  if (path.startsWith('/edit/')) return renderEditor(app, decodeURIComponent(path.slice(6)));
  if (path === '/imagens') return renderGallery(app);
  if (path === '/site') return renderSiteEditor(app);
  if (path === '/landings') return renderLandings(app);
  if (path.startsWith('/landing/')) return renderLandingEditor(app, decodeURIComponent(path.slice(9)));
  if (path === '/config') return renderConfig(app);
  app.innerHTML = '<div class="container"><div class="empty"><h3>Página não encontrada</h3><a href="#/" class="btn btn-primary">Voltar</a></div></div>';
}

/* ===================== LOGIN ===================== */

function renderLogin(app) {
  app.innerHTML = `
    <div class="login-page">
      <div class="login-box">
        <div class="login-brand">
          <img src="/HenriqueSilva/assets/seal-hsa.png" alt="HSA" />
          <div class="login-brand-name">Henrique Silva<small>Advocacia · Admin</small></div>
        </div>
        <div class="login-title">Acesso ao painel</div>
        <div class="login-sub">Digite sua senha para entrar</div>
        <div id="loginErr"></div>
        <form id="loginForm">
          <div class="field">
            <label>Senha</label>
            <input type="password" id="pwd" autocomplete="current-password" required autofocus />
          </div>
          <button type="submit" class="btn btn-primary login-btn">Entrar</button>
        </form>
        <div class="login-help">
          <small style="color:var(--gray-500);font-size:11px">Esqueceu a senha? Fale com seu desenvolvedor.</small>
        </div>
      </div>
    </div>
  `;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwd = $('#pwd').value;
    const errEl = $('#loginErr');
    const btn = $('.login-btn');
    errEl.innerHTML = '';
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Entrando...';
    try {
      const { data, error } = await supa.auth.signInWithPassword({ email: AUTH_EMAIL, password: pwd });
      if (error) throw error;
      currentSession = data.session;
      toast('Bem-vindo!');
      location.hash = '#/';
    } catch (err) {
      errEl.innerHTML = `<div class="login-error">Senha incorreta</div>`;
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });
}

/* ===================== TOPBAR ===================== */

function renderTopbar(active) {
  return `
    <div class="topbar">
      <div class="topbar-brand">
        <img src="/HenriqueSilva/assets/seal-hsa.png" alt="HSA" />
        <div class="topbar-brand-text">Henrique Silva<small>Advocacia · Admin</small></div>
      </div>
      <div class="topbar-nav">
        <a href="#/dashboard" class="${active==='dashboard'?'active':''}">Painel</a>
        <a href="#/site" class="${active==='site'?'active':''}">Home</a>
        <a href="#/landings" class="${active==='landings'?'active':''}">Páginas</a>
        <a href="#/posts" class="${active==='posts'?'active':''}">Blog</a>
        <a href="#/new" class="${active==='new'?'active':''}">+ Novo</a>
        <a href="#/imagens" class="${active==='imagens'?'active':''}">Imagens</a>
        <a href="#/config" class="${active==='config'?'active':''}">Config</a>
        <a href="/HenriqueSilva/" target="_blank">Ver site ↗</a>
      </div>
      <div class="topbar-actions">
        <span class="topbar-user">Logado</span>
        <button class="topbar-logout" id="btnLogout">Sair</button>
      </div>
    </div>
  `;
}
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'btnLogout') {
    if (confirm('Sair?')) {
      await supa.auth.signOut();
      currentSession = null;
      location.hash = '#/login';
    }
  }
});

/* ===================== DASHBOARD ===================== */

async function renderDashboard(app) {
  app.innerHTML = renderTopbar('dashboard') + `
    <div class="container">
      <div class="h1">Painel <em>de controle</em></div>
      <div class="h-sub">Visão geral do site e do blog</div>
      <div class="dash-grid">
        <a class="dash-card" href="#/site">
          <div class="dash-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12 L12 3 L21 12"/><path d="M5 10 V20 H19 V10"/></svg></div>
          <div class="dash-num">Home</div>
          <div class="dash-label">Editar página inicial</div>
        </a>
        <a class="dash-card" href="#/landings">
          <div class="dash-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></div>
          <div class="dash-num">12</div>
          <div class="dash-label">Páginas de áreas</div>
        </a>
        <a class="dash-card" href="#/posts">
          <div class="dash-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
          <div class="dash-num" id="dashTotal">…</div>
          <div class="dash-label">Posts do blog</div>
        </a>
        <a class="dash-card" href="#/imagens">
          <div class="dash-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>
          <div class="dash-num" id="dashImages">…</div>
          <div class="dash-label">Imagens enviadas</div>
        </a>
      </div>
      <div class="dash-sections">
        <div class="card">
          <h3 class="dash-section-title">Últimos posts</h3>
          <div id="dashRecent">Carregando…</div>
        </div>
        <div class="card">
          <h3 class="dash-section-title">Atalhos</h3>
          <div class="dash-shortcuts">
            <a class="btn btn-secondary" href="#/site">Editar Home →</a>
            <a class="btn btn-secondary" href="#/landings">Editar Páginas →</a>
            <a class="btn btn-secondary" href="#/new">+ Novo post</a>
            <a class="btn btn-secondary" href="#/config">⚙ Configurações</a>
            <a class="btn btn-secondary" href="/HenriqueSilva/" target="_blank">Ver site ↗</a>
          </div>
        </div>
      </div>
      <style>
        .dash-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-bottom:32px}
        .dash-card{background:var(--black-2);border:1px solid rgba(212,175,55,.15);padding:28px 26px;display:flex;flex-direction:column;gap:14px;text-decoration:none;color:inherit;transition:all .35s}
        .dash-card:hover{border-color:var(--gold);transform:translateY(-3px);background:var(--black-3)}
        .dash-icon{width:38px;height:38px;color:var(--gold)}
        .dash-icon svg{width:32px;height:32px}
        .dash-num{font-family:'Fraunces',serif;font-size:36px;font-weight:300;color:var(--off-white);line-height:1;font-style:italic}
        .dash-label{font-family:'Inter Tight',sans-serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);font-weight:500}
        .dash-sections{display:grid;grid-template-columns:1.4fr 1fr;gap:18px;margin-top:24px}
        .dash-section-title{font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin-bottom:18px}
        .dash-shortcuts{display:flex;flex-direction:column;gap:10px;align-items:flex-start}
        .dash-shortcuts .btn{width:auto;justify-content:flex-start;padding:10px 16px;font-size:11px}
        .dash-recent-row{display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid rgba(212,175,55,.1)}
        .dash-recent-row:last-child{border-bottom:0}
        .dash-recent-row .when{color:var(--gray-500);font-size:11px;letter-spacing:.18em;text-transform:uppercase;flex-shrink:0}
        .dash-recent-row .title{flex:1;color:var(--off-white);font-family:'Fraunces',serif;font-size:16px}
        @media(max-width:980px){.dash-grid{grid-template-columns:repeat(2,1fr)}.dash-sections{grid-template-columns:1fr}}
        @media(max-width:480px){.dash-grid{grid-template-columns:1fr}}
      </style>
    </div>
  `;
  try {
    const items = await listDir(REPO_PATHS.POSTS);
    const mds = items.filter(x => x.name.endsWith('.md'));
    $('#dashTotal').textContent = mds.length;
    const recent = mds.slice(0, 5);
    const samplePosts = await Promise.all(recent.map(async x => {
      const f = await getTextFile(x.path);
      const { meta } = parseFrontMatter(f.content);
      return { title: meta.title, date: meta.date, slug: meta.slug, fileBase: fileBaseName(x.path) };
    }));
    samplePosts.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    if (!samplePosts.length) {
      $('#dashRecent').innerHTML = '<p style="color:var(--gray-300);font-style:italic">Nenhum post ainda. <a href="#/new" style="color:var(--gold-light)">Criar o primeiro</a>.</p>';
    } else {
      $('#dashRecent').innerHTML = samplePosts.map(p => `
        <div class="dash-recent-row">
          <span class="when">${fmtDate(p.date||'')}</span>
          <span class="title">${escHtml(p.title||'')}</span>
          <a href="#/edit/${encodeURIComponent(p.fileBase)}" style="color:var(--gold-light);font-size:11px;letter-spacing:.18em;text-transform:uppercase">Editar</a>
        </div>
      `).join('');
    }
  } catch (e) { $('#dashRecent').innerHTML = `<p style="color:var(--danger)">${e.message}</p>`; }
  try {
    const imgs = await listDir(REPO_PATHS.IMAGES);
    $('#dashImages').textContent = (imgs || []).filter(x => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(x.name)).length;
  } catch (e) { $('#dashImages').textContent = '0'; }
}

/* ===================== SITE EDITOR (HOME) ===================== */

async function renderSiteEditor(app) {
  app.innerHTML = renderTopbar('site') + `
    <div class="container">
      <div class="h1">Editar <em>Home</em></div>
      <div class="h-sub">Textos, fotos e seções da página inicial. As alterações aparecem ao recarregar o site.</div>
      <div id="siteContainer">Carregando…</div>
    </div>
  `;
  let file;
  try { file = await getJsonFile(REPO_PATHS.SITE_CONTENT); }
  catch (e) { $('#siteContainer').innerHTML = `<p style="color:var(--danger)">${e.message}</p>`; return; }
  if (!file) { $('#siteContainer').innerHTML = `<p style="color:var(--danger)">site-content.json não encontrado</p>`; return; }
  const cfg = file.content;
  const sha = file.sha;

  const sections = [
    {
      id: 'hero',
      title: 'Hero (topo da página)',
      fields: [
        { key: 'tagline_quote', label: 'Frase principal', type: 'textarea', html: true },
        { key: 'cta_primary_label', label: 'Texto do botão WhatsApp' },
        { key: 'video_src', label: 'Vídeo de fundo', type: 'image', accept: 'video/*' },
        { key: 'poster_src', label: 'Poster (imagem antes do vídeo carregar)', type: 'image' },
        { key: 'seal_src', label: 'Selo/Logo', type: 'image' },
      ],
    },
    {
      id: 'office',
      title: 'Sobre o Escritório',
      fields: [
        { key: 'eyebrow', label: 'Pré-título' },
        { key: 'h2', label: 'Título', type: 'text', html: true },
        { key: 'paragraphs', label: 'Parágrafos', type: 'list', subtype: 'textarea', html: true },
        { key: 'pillars', label: 'Pilares (3)', type: 'pillars' },
        { key: 'photo_src', label: 'Foto do escritório', type: 'image' },
        { key: 'photo_stamp', label: 'Selo redondo (texto curto)', type: 'text', html: true },
      ],
    },
    {
      id: 'areas',
      title: 'Áreas de Atuação (10 cards)',
      fields: [
        { key: 'eyebrow', label: 'Pré-título' },
        { key: 'h2', label: 'Título', html: true },
        { key: 'sub', label: 'Subtítulo' },
        { key: 'items', label: 'Cards', type: 'areas' },
      ],
    },
    {
      id: 'reviews',
      title: 'Avaliações Google',
      fields: [
        { key: 'rating_num', label: 'Nota (ex: 5,0)' },
        { key: 'meta_html', label: 'Texto do banner', html: true },
        { key: 'items', label: 'Avaliações', type: 'reviews' },
        { key: 'cta_label', label: 'Texto do botão "ver tudo"' },
        { key: 'cta_href', label: 'Link do botão' },
      ],
    },
    {
      id: 'about',
      title: 'Quem Sou (Dr. Henrique)',
      fields: [
        { key: 'eyebrow', label: 'Pré-título' },
        { key: 'h2', label: 'Título', html: true },
        { key: 'lead', label: 'Citação (lead)', type: 'textarea' },
        { key: 'paragraphs', label: 'Parágrafos', type: 'list', subtype: 'textarea', html: true },
        { key: 'credentials', label: 'Credenciais (3)', type: 'credentials' },
        { key: 'portrait_src', label: 'Foto do Dr. Henrique', type: 'image' },
        { key: 'portrait_plaque', label: 'Plaqueta (texto sob a foto)' },
      ],
    },
    {
      id: 'latest',
      title: 'Últimos artigos (header)',
      fields: [
        { key: 'eyebrow', label: 'Pré-título' },
        { key: 'h2', label: 'Título', html: true },
        { key: 'sub', label: 'Subtítulo' },
        { key: 'cta_label', label: 'Texto do botão "ver todos"' },
      ],
    },
    {
      id: 'faq',
      title: 'FAQ',
      fields: [
        { key: 'eyebrow', label: 'Pré-título' },
        { key: 'h2', label: 'Título', html: true },
        { key: 'sub', label: 'Subtítulo', html: true },
        { key: 'search_placeholder', label: 'Placeholder da busca' },
        { key: 'items', label: 'Perguntas', type: 'faq' },
      ],
    },
    {
      id: 'contact_cta',
      title: 'Contato (formulário)',
      fields: [
        { key: 'h2', label: 'Título', html: true },
        { key: 'sub', label: 'Subtítulo' },
        { key: 'form', label: 'Form (labels)', type: 'contact_form' },
        { key: 'bg_src', label: 'Foto de fundo', type: 'image' },
      ],
    },
    {
      id: 'footer',
      title: 'Rodapé',
      fields: [
        { key: 'tag', label: 'Descrição (texto principal)', type: 'textarea' },
        { key: 'address_lines', label: 'Linhas do endereço', type: 'list', subtype: 'text' },
        { key: 'copyright', label: 'Copyright' },
      ],
    },
    {
      id: 'wa_fab',
      title: 'Botão WhatsApp flutuante',
      fields: [
        { key: 'label', label: 'Texto que aparece no hover' },
      ],
    },
  ];

  const renderFieldHtml = (sectionId, field, value) => {
    const id = `f-${sectionId}-${field.key}`;
    if (field.type === 'image') {
      const isVideo = (field.accept || '').includes('video');
      return `
        <div class="field">
          <label>${field.label}</label>
          <div class="img-picker" data-section="${sectionId}" data-key="${field.key}">
            ${isVideo ? '' : `<img class="img-preview" src="/HenriqueSilva/${value || ''}" alt="" onerror="this.style.display='none'" />`}
            <input type="text" id="${id}" value="${escAttr(value)}" placeholder="${isVideo ? 'assets/hero-video.mp4' : 'assets/foto.jpg'}" />
            <button type="button" class="btn btn-secondary btn-pickimg" data-target="${id}" data-section="${sectionId}" data-isvideo="${isVideo}">Trocar</button>
          </div>
        </div>`;
    }
    if (field.type === 'textarea' || (field.type === 'text' && field.html)) {
      return `<div class="field"><label>${field.label}</label><textarea id="${id}" rows="3">${escHtml(value || '')}</textarea>${field.html ? '<div class="field-help">Aceita HTML simples: &lt;em&gt;, &lt;strong&gt;, &lt;br/&gt;, &lt;a href=""&gt;</div>' : ''}</div>`;
    }
    if (field.type === 'list') {
      const items = Array.isArray(value) ? value : [];
      return `
        <div class="field" data-list-field="${sectionId}.${field.key}">
          <label>${field.label}</label>
          <div class="list-items" data-key="${field.key}">
            ${items.map((v, i) => `
              <div class="list-item" data-idx="${i}">
                <textarea rows="2" data-listval>${escHtml(v)}</textarea>
                <button type="button" class="btn btn-danger btn-rmitem">×</button>
              </div>
            `).join('')}
          </div>
          <button type="button" class="btn btn-secondary btn-additem" data-section="${sectionId}" data-key="${field.key}">+ Adicionar</button>
        </div>`;
    }
    if (field.type === 'pillars') {
      const items = Array.isArray(value) ? value : [];
      return `
        <div class="field" data-pillars="${sectionId}.${field.key}">
          <label>${field.label}</label>
          <div class="pillars-list">
            ${items.map((p, i) => `
              <div class="card-mini" data-idx="${i}">
                <div class="field-row">
                  <div class="field"><label>Número/título</label><input data-pkey="num" value="${escAttr(p.num)}" /></div>
                  <div class="field"><label>Descrição</label><input data-pkey="label" value="${escAttr(p.label)}" /></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>`;
    }
    if (field.type === 'credentials') {
      const items = Array.isArray(value) ? value : [];
      return `
        <div class="field" data-credentials="${sectionId}.${field.key}">
          <label>${field.label}</label>
          <div class="credentials-list">
            ${items.map((p, i) => `
              <div class="card-mini" data-idx="${i}">
                <div class="field-row">
                  <div class="field"><label>Número</label><input data-pkey="num" value="${escAttr(p.num)}" /></div>
                  <div class="field"><label>Rótulo</label><input data-pkey="label" value="${escAttr(p.label)}" /></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>`;
    }
    if (field.type === 'areas') {
      const items = Array.isArray(value) ? value : [];
      return `
        <div class="field" data-areas="${sectionId}.${field.key}">
          <label>${field.label}</label>
          <div class="areas-list">
            ${items.map((a, i) => `
              <details class="card-mini" data-idx="${i}" ${i < 2 ? 'open' : ''}>
                <summary><strong>${escHtml(a.label || a.slug)}</strong> ${a.featured ? '<span style="color:var(--gold);font-size:10px">DESTAQUE</span>' : ''}</summary>
                <div class="field"><label>Slug (link)</label><input data-akey="slug" value="${escAttr(a.slug)}" readonly style="opacity:.6" /></div>
                <div class="field"><label>Rótulo curto</label><input data-akey="label" value="${escAttr(a.label)}" /></div>
                <div class="field"><label>Título do card (HTML, com &lt;em&gt;)</label><input data-akey="h3" value="${escAttr(a.h3)}" /></div>
                <div class="field"><label>Descrição</label><textarea data-akey="description" rows="2">${escHtml(a.description)}</textarea></div>
                <div class="field"><label>Imagem</label>
                  <div class="img-picker">
                    <img class="img-preview" src="/HenriqueSilva/${a.image || ''}" alt="" onerror="this.style.display='none'" />
                    <input type="text" data-akey="image" value="${escAttr(a.image)}" />
                    <button type="button" class="btn btn-secondary btn-pickimg-area" data-idx="${i}">Trocar</button>
                  </div>
                </div>
                ${a.featured ? `<div class="field"><label>Tags (separadas por vírgula)</label><input data-akey="tags" value="${escAttr((a.tags||[]).join(', '))}" /></div>` : ''}
              </details>
            `).join('')}
          </div>
        </div>`;
    }
    if (field.type === 'reviews') {
      const items = Array.isArray(value) ? value : [];
      return `
        <div class="field" data-reviews="${sectionId}.${field.key}">
          <label>${field.label}</label>
          <div class="reviews-list">
            ${items.map((r, i) => `
              <details class="card-mini" data-idx="${i}">
                <summary><strong>${escHtml(r.name)}</strong> · ${escHtml(r.stars)}</summary>
                <div class="field-row">
                  <div class="field"><label>Nome</label><input data-rkey="name" value="${escAttr(r.name)}" /></div>
                  <div class="field"><label>Data/origem</label><input data-rkey="date" value="${escAttr(r.date)}" /></div>
                </div>
                <div class="field"><label>Estrelas</label><input data-rkey="stars" value="${escAttr(r.stars)}" /></div>
                <div class="field"><label>Avaliação</label><textarea data-rkey="quote" rows="2">${escHtml(r.quote)}</textarea></div>
                <button type="button" class="btn btn-danger btn-rmrev" data-idx="${i}">Remover avaliação</button>
              </details>
            `).join('')}
          </div>
          <button type="button" class="btn btn-secondary btn-addrev">+ Adicionar avaliação</button>
        </div>`;
    }
    if (field.type === 'faq') {
      const items = Array.isArray(value) ? value : [];
      return `
        <div class="field" data-faq="${sectionId}.${field.key}">
          <label>${field.label}</label>
          <div class="faq-list">
            ${items.map((q, i) => `
              <details class="card-mini" data-idx="${i}">
                <summary><strong>${escHtml((q.q||'').slice(0, 60))}</strong></summary>
                <div class="field"><label>Pergunta</label><input data-qkey="q" value="${escAttr(q.q)}" /></div>
                <div class="field"><label>Resposta (HTML)</label><textarea data-qkey="a" rows="3">${escHtml(q.a)}</textarea></div>
                <button type="button" class="btn btn-danger btn-rmfaq" data-idx="${i}">Remover</button>
              </details>
            `).join('')}
          </div>
          <button type="button" class="btn btn-secondary btn-addfaq">+ Adicionar pergunta</button>
        </div>`;
    }
    if (field.type === 'contact_form') {
      const v = value || {};
      return `
        <div class="field" data-form="${sectionId}.${field.key}">
          <label>${field.label}</label>
          <div class="card-mini">
            <div class="field-row">
              <div class="field"><label>Label "Nome"</label><input data-fkey="name_label" value="${escAttr(v.name_label)}" /></div>
              <div class="field"><label>Label "Telefone"</label><input data-fkey="phone_label" value="${escAttr(v.phone_label)}" /></div>
            </div>
            <div class="field"><label>Label "Mensagem"</label><input data-fkey="message_label" value="${escAttr(v.message_label)}" /></div>
            <div class="field"><label>Texto do botão Enviar</label><input data-fkey="submit_label" value="${escAttr(v.submit_label)}" /></div>
            <div class="field"><label>Disclaimer</label><textarea data-fkey="disclaimer" rows="2">${escHtml(v.disclaimer)}</textarea></div>
          </div>
        </div>`;
    }
    return `<div class="field"><label>${field.label}</label><input id="${id}" value="${escAttr(value)}" /></div>`;
  };

  const html = sections.map(sec => `
    <details class="card editor-section" data-section="${sec.id}" open>
      <summary><h3 style="font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin:0;display:inline">${sec.title}</h3></summary>
      <div class="section-body" style="margin-top:18px">
        ${sec.fields.map(f => renderFieldHtml(sec.id, f, (cfg[sec.id]||{})[f.key])).join('')}
      </div>
    </details>
  `).join('');

  $('#siteContainer').innerHTML = `
    ${html}
    <div class="card" style="margin-top:18px;display:flex;gap:14px;justify-content:flex-end;align-items:center">
      <a href="#/dashboard" class="btn btn-secondary">← Voltar</a>
      <button class="btn btn-primary" id="btnSiteSave">Salvar tudo</button>
    </div>
    <input type="file" id="picker-file" accept="image/*,video/*" style="display:none" />
    <style>
      .editor-section summary{cursor:pointer;list-style:none;padding:18px 0}
      .editor-section summary::-webkit-details-marker{display:none}
      .editor-section summary::before{content:"▸";display:inline-block;color:var(--gold);margin-right:12px;transition:transform .25s}
      .editor-section[open] summary::before{transform:rotate(90deg)}
      .img-picker{display:flex;gap:10px;align-items:center}
      .img-picker .img-preview{width:60px;height:60px;object-fit:cover;border:1px solid rgba(212,175,55,.2);background:#000;flex-shrink:0}
      .img-picker input{flex:1}
      .card-mini{background:rgba(20,20,20,.5);border:1px solid rgba(212,175,55,.1);padding:14px;margin-bottom:12px;border-radius:0}
      .card-mini summary{cursor:pointer;color:var(--off-white);padding:6px 0;font-size:13px}
      .card-mini summary::-webkit-details-marker{display:none}
      .list-item{display:flex;gap:8px;align-items:flex-start;margin-bottom:10px}
      .list-item textarea{flex:1}
      .btn-rmitem{padding:6px 12px;font-size:14px}
    </style>
  `;

  // === LIST add/remove
  $('#siteContainer').addEventListener('click', (e) => {
    const t = e.target;
    if (t.classList.contains('btn-additem')) {
      const list = t.parentElement.querySelector('.list-items');
      const idx = list.children.length;
      const item = document.createElement('div');
      item.className = 'list-item'; item.dataset.idx = idx;
      item.innerHTML = `<textarea rows="2" data-listval></textarea><button type="button" class="btn btn-danger btn-rmitem">×</button>`;
      list.appendChild(item);
    }
    if (t.classList.contains('btn-rmitem')) t.parentElement.remove();
    if (t.classList.contains('btn-rmrev')) t.closest('details').remove();
    if (t.classList.contains('btn-rmfaq')) t.closest('details').remove();
    if (t.classList.contains('btn-addrev')) {
      const list = t.parentElement.querySelector('.reviews-list');
      const i = list.children.length;
      const d = document.createElement('details');
      d.className = 'card-mini'; d.dataset.idx = i; d.open = true;
      d.innerHTML = `<summary><strong>Nova avaliação</strong></summary>
        <div class="field-row"><div class="field"><label>Nome</label><input data-rkey="name" /></div><div class="field"><label>Data/origem</label><input data-rkey="date" value="há 1 dia · Google" /></div></div>
        <div class="field"><label>Estrelas</label><input data-rkey="stars" value="★★★★★" /></div>
        <div class="field"><label>Avaliação</label><textarea data-rkey="quote" rows="2"></textarea></div>
        <button type="button" class="btn btn-danger btn-rmrev">Remover avaliação</button>`;
      list.appendChild(d);
    }
    if (t.classList.contains('btn-addfaq')) {
      const list = t.parentElement.querySelector('.faq-list');
      const i = list.children.length;
      const d = document.createElement('details');
      d.className = 'card-mini'; d.dataset.idx = i; d.open = true;
      d.innerHTML = `<summary><strong>Nova pergunta</strong></summary>
        <div class="field"><label>Pergunta</label><input data-qkey="q" /></div>
        <div class="field"><label>Resposta (HTML)</label><textarea data-qkey="a" rows="3"></textarea></div>
        <button type="button" class="btn btn-danger btn-rmfaq">Remover</button>`;
      list.appendChild(d);
    }
  });

  // === Image picker (faz upload e cola URL)
  let pickerTarget = null; // {section, key, idx?, akey?}
  $('#siteContainer').addEventListener('click', (e) => {
    const t = e.target;
    if (t.classList.contains('btn-pickimg')) {
      pickerTarget = { kind: 'simple', selector: '#' + t.dataset.target };
      const fp = $('#picker-file');
      fp.accept = t.dataset.isvideo === 'true' ? 'video/*' : 'image/*';
      fp.click();
    }
    if (t.classList.contains('btn-pickimg-area')) {
      const det = t.closest('details');
      const input = det.querySelector('input[data-akey="image"]');
      pickerTarget = { kind: 'area', input };
      $('#picker-file').accept = 'image/*';
      $('#picker-file').click();
    }
  });
  $('#picker-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !pickerTarget) return;
    try {
      toast('Enviando arquivo…');
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      const ext = file.name.split('.').pop().toLowerCase();
      const safeName = slugify(file.name.replace(/\.[^.]+$/, '')) + '-' + Date.now().toString(36) + '.' + ext;
      const isAreaImage = pickerTarget.kind === 'area';
      const isVideo = file.type.startsWith('video/');
      const folder = isVideo ? REPO_PATHS.SITE_ASSETS : (isAreaImage ? REPO_PATHS.SITE_ASSETS : REPO_PATHS.IMAGES);
      const path = `${folder}/${safeName}`;
      await putBinaryFile(path, b64, `Upload: ${safeName}`);
      const url = path; // relativo ao repo, content-loader monta com /HenriqueSilva/
      if (pickerTarget.kind === 'simple') {
        const inp = document.querySelector(pickerTarget.selector);
        if (inp) inp.value = url;
        const prev = inp && inp.parentElement.querySelector('.img-preview');
        if (prev) { prev.src = '/HenriqueSilva/' + url; prev.style.display = ''; }
      }
      if (pickerTarget.kind === 'area') {
        pickerTarget.input.value = url;
        const prev = pickerTarget.input.parentElement.querySelector('.img-preview');
        if (prev) { prev.src = '/HenriqueSilva/' + url; prev.style.display = ''; }
      }
      toast('Imagem enviada ✓');
    } catch (err) { toast(err.message, 'error'); }
    pickerTarget = null;
  });

  // === Save tudo
  $('#btnSiteSave').addEventListener('click', async () => {
    const newCfg = JSON.parse(JSON.stringify(cfg)); // clone
    sections.forEach(sec => {
      newCfg[sec.id] = newCfg[sec.id] || {};
      sec.fields.forEach(f => {
        const id = `f-${sec.id}-${f.key}`;
        if (f.type === 'list') {
          const arr = $$(`details.editor-section[data-section="${sec.id}"] .list-items[data-key="${f.key}"] [data-listval]`).map(t => t.value);
          newCfg[sec.id][f.key] = arr.filter(s => s.trim());
        } else if (f.type === 'pillars' || f.type === 'credentials') {
          const arr = $$(`details.editor-section[data-section="${sec.id}"] [data-${f.type}="${sec.id}.${f.key}"] .card-mini`).map(card => {
            const o = {};
            card.querySelectorAll('[data-pkey]').forEach(inp => { o[inp.dataset.pkey] = inp.value; });
            return o;
          });
          newCfg[sec.id][f.key] = arr;
        } else if (f.type === 'areas') {
          const arr = $$(`details.editor-section[data-section="${sec.id}"] [data-areas="${sec.id}.${f.key}"] details.card-mini`).map(card => {
            const o = {};
            card.querySelectorAll('[data-akey]').forEach(inp => {
              if (inp.dataset.akey === 'tags') o.tags = inp.value.split(',').map(t => t.trim()).filter(Boolean);
              else o[inp.dataset.akey] = inp.value;
            });
            // preserva campos existentes (featured, slug, href)
            const existing = (cfg[sec.id]?.items || []).find(x => x.slug === o.slug);
            if (existing) {
              o.featured = existing.featured;
              o.href = existing.href;
              if (!o.tags && existing.tags) o.tags = existing.tags;
            }
            return o;
          });
          newCfg[sec.id][f.key] = arr;
        } else if (f.type === 'reviews') {
          const arr = $$(`details.editor-section[data-section="${sec.id}"] [data-reviews="${sec.id}.${f.key}"] details.card-mini`).map(card => {
            const o = {};
            card.querySelectorAll('[data-rkey]').forEach(inp => { o[inp.dataset.rkey] = inp.value; });
            return o;
          });
          newCfg[sec.id][f.key] = arr;
        } else if (f.type === 'faq') {
          const arr = $$(`details.editor-section[data-section="${sec.id}"] [data-faq="${sec.id}.${f.key}"] details.card-mini`).map(card => {
            const o = {};
            card.querySelectorAll('[data-qkey]').forEach(inp => { o[inp.dataset.qkey] = inp.value; });
            return o;
          });
          newCfg[sec.id][f.key] = arr;
        } else if (f.type === 'contact_form') {
          const o = {};
          $$(`details.editor-section[data-section="${sec.id}"] [data-form="${sec.id}.${f.key}"] [data-fkey]`).forEach(inp => {
            o[inp.dataset.fkey] = inp.value;
          });
          newCfg[sec.id][f.key] = o;
        } else {
          const el = document.getElementById(id);
          if (el) newCfg[sec.id][f.key] = el.value;
        }
      });
    });

    const btn = $('#btnSiteSave');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      await putJsonFile(REPO_PATHS.SITE_CONTENT, newCfg, sha, 'admin: atualizar conteúdo da home');
      toast('Salvo! Recarregue o site para ver ✓');
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = 'Salvar tudo';
    }
  });
}

/* ===================== LANDINGS LIST ===================== */

async function renderLandings(app) {
  app.innerHTML = renderTopbar('landings') + `
    <div class="container">
      <div class="h1">Páginas <em>de áreas</em></div>
      <div class="h-sub">12 páginas dedicadas: 10 áreas + Sobre + Contato. Edite título, textos, FAQ e mais de cada uma.</div>
      <div id="landingsContainer">Carregando…</div>
    </div>
  `;
  let file;
  try { file = await getJsonFile(REPO_PATHS.LANDINGS_CONTENT); }
  catch (e) { $('#landingsContainer').innerHTML = `<p style="color:var(--danger)">${e.message}</p>`; return; }
  const ld = file.content;
  const cards = LANDING_SLUGS.map(slug => {
    const l = ld[slug] || {};
    return `
      <a href="#/landing/${slug}" class="landing-card">
        <div class="landing-card-eyebrow">${escHtml(l.eyebrow || slug)}</div>
        <div class="landing-card-h1">${l.h1 || LANDING_LABELS[slug]}</div>
        <div class="landing-card-sub">${escHtml((l.subtitle || '').slice(0, 110))}…</div>
        <div class="landing-card-meta">${(l.bullets || []).length} pontos · ${(l.faq || []).length} perguntas</div>
      </a>
    `;
  }).join('');
  $('#landingsContainer').innerHTML = `
    <div class="landing-grid">${cards}</div>
    <style>
      .landing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
      .landing-card{background:var(--black-2);border:1px solid rgba(212,175,55,.15);padding:24px;text-decoration:none;color:inherit;transition:all .35s}
      .landing-card:hover{border-color:var(--gold);transform:translateY(-3px);background:var(--black-3)}
      .landing-card-eyebrow{font-family:'Inter Tight',sans-serif;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);font-weight:500;margin-bottom:14px}
      .landing-card-h1{font-family:'Fraunces',serif;font-size:22px;font-weight:300;color:var(--off-white);line-height:1.2;margin-bottom:10px}
      .landing-card-h1 em{font-style:italic;color:var(--gold-light)}
      .landing-card-sub{color:var(--gray-300);font-size:13px;line-height:1.55;font-weight:300;font-style:italic;margin-bottom:14px}
      .landing-card-meta{font-family:'Inter Tight',sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--gray-500)}
      @media(max-width:980px){.landing-grid{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:560px){.landing-grid{grid-template-columns:1fr}}
    </style>
  `;
}

/* ===================== LANDING EDITOR ===================== */

async function renderLandingEditor(app, slug) {
  if (!LANDING_SLUGS.includes(slug)) { location.hash = '#/landings'; return; }
  app.innerHTML = renderTopbar('landings') + `
    <div class="container">
      <div class="h1">Editar <em>${LANDING_LABELS[slug]}</em></div>
      <div class="h-sub">Página /${slug}/ · todos os textos abaixo são editáveis. Ao salvar, é necessário rodar o build (ou aguardar a Action) para ver no site.</div>
      <div id="landingContainer">Carregando…</div>
    </div>
  `;
  let file;
  try { file = await getJsonFile(REPO_PATHS.LANDINGS_CONTENT); }
  catch (e) { $('#landingContainer').innerHTML = `<p style="color:var(--danger)">${e.message}</p>`; return; }
  const all = file.content;
  const sha = file.sha;
  const l = all[slug] || {};

  $('#landingContainer').innerHTML = `
    <div class="card">
      <h3 style="font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin-bottom:18px">SEO e topo</h3>
      <div class="field"><label>Title (aba do navegador, Google)</label><input id="l-page_title" value="${escAttr(l.page_title)}" /></div>
      <div class="field"><label>Meta description</label><textarea id="l-page_description" rows="2">${escHtml(l.page_description||'')}</textarea></div>
      <div class="field-row">
        <div class="field"><label>Pré-título (eyebrow)</label><input id="l-eyebrow" value="${escAttr(l.eyebrow)}" /></div>
        <div class="field"><label>Texto do botão WhatsApp</label><input id="l-cta_text" value="${escAttr(l.cta_text)}" /></div>
      </div>
      <div class="field"><label>H1 (título grande do hero, com &lt;em&gt;)</label><input id="l-h1" value="${escAttr(l.h1)}" /></div>
      <div class="field"><label>Subtítulo (parágrafo do hero)</label><textarea id="l-subtitle" rows="2">${escHtml(l.subtitle||'')}</textarea></div>
      <div class="field"><label>Texto pré-preenchido WhatsApp</label><input id="l-wa_text" value="${escAttr(l.wa_text)}" /></div>
    </div>

    <div class="card" style="margin-top:18px">
      <h3 style="font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin-bottom:18px">Introdução</h3>
      <div class="field"><label>H2 (com &lt;em&gt;)</label><input id="l-intro_h2" value="${escAttr(l.intro?.h2)}" /></div>
      <div class="field"><label>Parágrafos</label>
        <div class="list-items" id="introParagraphs">
          ${(l.intro?.paragraphs||[]).map((p,i)=>`<div class="list-item" data-idx="${i}"><textarea rows="3" data-listval>${escHtml(p)}</textarea><button type="button" class="btn btn-danger btn-rmitem">×</button></div>`).join('')}
        </div>
        <button type="button" class="btn btn-secondary btn-additem-intro">+ Adicionar parágrafo</button>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <h3 style="font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin-bottom:18px">Bullets (em que atuamos)</h3>
      <div class="field-row">
        <div class="field"><label>Eyebrow</label><input id="l-bullets_eye" value="${escAttr(l.bullets_eye)}" /></div>
        <div class="field"><label>H2 (com &lt;em&gt;)</label><input id="l-bullets_h2" value="${escAttr(l.bullets_h2)}" /></div>
      </div>
      <div class="bullets-list" id="bulletsList">
        ${(l.bullets||[]).map((b,i)=>`
          <details class="card-mini" data-idx="${i}">
            <summary><strong>${escHtml(b.title)}</strong></summary>
            <div class="field"><label>Título</label><input data-bkey="title" value="${escAttr(b.title)}" /></div>
            <div class="field"><label>Texto (HTML)</label><textarea data-bkey="text" rows="2">${escHtml(b.text)}</textarea></div>
            <button type="button" class="btn btn-danger btn-rmbullet">Remover</button>
          </details>
        `).join('')}
      </div>
      <button type="button" class="btn btn-secondary btn-addbullet">+ Adicionar bullet</button>
    </div>

    <div class="card" style="margin-top:18px">
      <h3 style="font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin-bottom:18px">FAQ</h3>
      <div class="faq-list" id="faqList">
        ${(l.faq||[]).map((q,i)=>`
          <details class="card-mini" data-idx="${i}">
            <summary><strong>${escHtml(q.q)}</strong></summary>
            <div class="field"><label>Pergunta</label><input data-qkey="q" value="${escAttr(q.q)}" /></div>
            <div class="field"><label>Resposta (HTML)</label><textarea data-qkey="a" rows="3">${escHtml(q.a)}</textarea></div>
            <button type="button" class="btn btn-danger btn-rmqq">Remover</button>
          </details>
        `).join('')}
      </div>
      <button type="button" class="btn btn-secondary btn-addqq">+ Adicionar pergunta</button>
    </div>

    <div class="card" style="margin-top:18px;display:flex;gap:14px;justify-content:flex-end;align-items:center">
      <a href="#/landings" class="btn btn-secondary">← Voltar</a>
      <button class="btn btn-primary" id="btnLSave">Salvar página</button>
    </div>

    <style>
      .card-mini{background:rgba(20,20,20,.5);border:1px solid rgba(212,175,55,.1);padding:14px;margin-bottom:12px}
      .card-mini summary{cursor:pointer;color:var(--off-white);padding:6px 0;font-size:13px}
      .list-items{margin-bottom:10px}
      .list-item{display:flex;gap:8px;align-items:flex-start;margin-bottom:10px}
      .list-item textarea{flex:1}
      .btn-rmitem{padding:6px 12px;font-size:14px}
    </style>
  `;

  $('#landingContainer').addEventListener('click', (e) => {
    const t = e.target;
    if (t.classList.contains('btn-additem-intro')) {
      const list = $('#introParagraphs');
      const i = list.children.length;
      const it = document.createElement('div');
      it.className = 'list-item'; it.dataset.idx = i;
      it.innerHTML = `<textarea rows="3" data-listval></textarea><button type="button" class="btn btn-danger btn-rmitem">×</button>`;
      list.appendChild(it);
    }
    if (t.classList.contains('btn-rmitem')) t.parentElement.remove();
    if (t.classList.contains('btn-addbullet')) {
      const list = $('#bulletsList');
      const d = document.createElement('details');
      d.className = 'card-mini'; d.dataset.idx = list.children.length; d.open = true;
      d.innerHTML = `<summary><strong>Novo bullet</strong></summary>
        <div class="field"><label>Título</label><input data-bkey="title" /></div>
        <div class="field"><label>Texto (HTML)</label><textarea data-bkey="text" rows="2"></textarea></div>
        <button type="button" class="btn btn-danger btn-rmbullet">Remover</button>`;
      list.appendChild(d);
    }
    if (t.classList.contains('btn-rmbullet')) t.closest('details').remove();
    if (t.classList.contains('btn-addqq')) {
      const list = $('#faqList');
      const d = document.createElement('details');
      d.className = 'card-mini'; d.dataset.idx = list.children.length; d.open = true;
      d.innerHTML = `<summary><strong>Nova pergunta</strong></summary>
        <div class="field"><label>Pergunta</label><input data-qkey="q" /></div>
        <div class="field"><label>Resposta (HTML)</label><textarea data-qkey="a" rows="3"></textarea></div>
        <button type="button" class="btn btn-danger btn-rmqq">Remover</button>`;
      list.appendChild(d);
    }
    if (t.classList.contains('btn-rmqq')) t.closest('details').remove();
  });

  $('#btnLSave').addEventListener('click', async () => {
    const newL = JSON.parse(JSON.stringify(l));
    newL.page_title = $('#l-page_title').value;
    newL.page_description = $('#l-page_description').value;
    newL.eyebrow = $('#l-eyebrow').value;
    newL.cta_text = $('#l-cta_text').value;
    newL.h1 = $('#l-h1').value;
    newL.subtitle = $('#l-subtitle').value;
    newL.wa_text = $('#l-wa_text').value;
    newL.intro = newL.intro || {};
    newL.intro.h2 = $('#l-intro_h2').value;
    newL.intro.paragraphs = $$('#introParagraphs [data-listval]').map(t => t.value).filter(s => s.trim());
    newL.bullets_eye = $('#l-bullets_eye').value;
    newL.bullets_h2 = $('#l-bullets_h2').value;
    newL.bullets = $$('#bulletsList details.card-mini').map(card => {
      const o = {};
      card.querySelectorAll('[data-bkey]').forEach(inp => o[inp.dataset.bkey] = inp.value);
      return o;
    }).filter(b => b.title || b.text);
    newL.faq = $$('#faqList details.card-mini').map(card => {
      const o = {};
      card.querySelectorAll('[data-qkey]').forEach(inp => o[inp.dataset.qkey] = inp.value);
      return o;
    }).filter(q => q.q || q.a);

    const merged = { ...all, [slug]: newL };
    const btn = $('#btnLSave');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      await putJsonFile(REPO_PATHS.LANDINGS_CONTENT, merged, sha, `admin: atualizar landing ${slug}`);
      toast('Salvo! Build precisa rodar pra atualizar a página ✓');
      setTimeout(() => { location.hash = '#/landings'; }, 1800);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = 'Salvar página';
    }
  });
}

/* ===================== POSTS LIST ===================== */

async function renderPosts(app) {
  app.innerHTML = renderTopbar('posts') + `
    <div class="container">
      <div class="h1">Posts <em>do blog</em></div>
      <div class="h-sub">Artigos publicados · ordenados pelo mais recente</div>
      <div class="posts-toolbar">
        <input class="posts-search" id="postsSearch" placeholder="Buscar por título…" />
        <a href="#/new" class="btn btn-primary">+ Novo post</a>
      </div>
      <div id="postsContainer"><p style="color:var(--gray-300)">Carregando posts… <span class="spinner"></span></p></div>
    </div>
  `;
  try {
    const items = await listDir(REPO_PATHS.POSTS);
    const mds = (items || []).filter(x => x.name.endsWith('.md'));
    const posts = await Promise.all(mds.map(async x => {
      const f = await getTextFile(x.path);
      const { meta } = parseFrontMatter(f.content);
      return { ...meta, path: x.path, sha: f.sha, fileBase: fileBaseName(x.path) };
    }));
    posts.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    const renderList = (filter='') => {
      const filtered = filter ? posts.filter(p => (p.title||'').toLowerCase().includes(filter.toLowerCase())) : posts;
      if (!filtered.length) {
        $('#postsContainer').innerHTML = `<div class="empty"><h3>Nenhum post ainda</h3><p>Crie seu primeiro artigo</p><a href="#/new" class="btn btn-primary">+ Criar primeiro post</a></div>`;
        return;
      }
      $('#postsContainer').innerHTML = `<div class="posts-grid">` + filtered.map(p => `
        <article class="post-row">
          <div class="post-row-meta">
            <span>${CATEGORIES[p.category] || p.category || 'Geral'}</span>
            <span class="dot">·</span>
            <span class="date">${fmtDate(p.date || '')}</span>
          </div>
          <h3>${escHtml(p.title||'(sem título)')}</h3>
          <p>${escHtml(p.excerpt||'')}</p>
          <div class="post-row-actions">
            <a href="#/edit/${encodeURIComponent(p.fileBase)}" class="btn btn-secondary">Editar</a>
            <a href="/HenriqueSilva/blog/${p.slug || ''}/" target="_blank" class="btn btn-secondary">Ver ↗</a>
            <button class="btn btn-danger" data-del="${p.path}" data-sha="${p.sha}" data-name="${escAttr(p.title||'')}">Excluir</button>
          </div>
        </article>
      `).join('') + `</div>`;
      $$('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm(`Excluir "${btn.dataset.name}"?`)) return;
        try {
          await deleteFile(btn.dataset.del, btn.dataset.sha, `Delete: ${btn.dataset.name}`);
          toast('Post excluído');
          renderPosts(app);
        } catch (err) { toast(err.message, 'error'); }
      }));
    };
    renderList();
    $('#postsSearch').addEventListener('input', e => renderList(e.target.value));
  } catch (err) {
    $('#postsContainer').innerHTML = `<div class="empty"><h3>Erro</h3><p>${err.message}</p></div>`;
  }
}

/* ===================== POST EDITOR ===================== */

async function renderEditor(app, fileBase) {
  let sha = null;
  let meta = { title: '', slug: '', excerpt: '', category: 'trabalhista', tags: [], cover: '', date: todayIso(), updated: todayIso() };
  let body = '';
  if (fileBase) {
    try {
      const f = await getTextFile(`${REPO_PATHS.POSTS}/${fileBase}.md`);
      if (f) {
        sha = f.sha;
        const parsed = parseFrontMatter(f.content);
        meta = { ...meta, ...parsed.meta };
        if (typeof meta.tags === 'string') meta.tags = meta.tags.split(',').map(s=>s.trim()).filter(Boolean);
        if (!Array.isArray(meta.tags)) meta.tags = [];
        body = parsed.body;
      }
    } catch (err) { toast(err.message, 'error'); }
  }
  app.innerHTML = renderTopbar(fileBase ? 'posts' : 'new') + `
    <div class="container">
      <div class="h1">${fileBase ? 'Editar post' : 'Novo <em>post</em>'}</div>
      <div class="h-sub">${fileBase ? 'Modifique o conteúdo e salve' : 'Escreva um novo artigo'}</div>
      <div class="card">
        <div class="field"><label>Título</label><input id="f-title" value="${escAttr(meta.title)}" /></div>
        <div class="field-row">
          <div class="field"><label>Slug (URL)</label><input id="f-slug" value="${escAttr(meta.slug)}" /><div class="field-help">Deixa vazio pra gerar automático.</div></div>
          <div class="field"><label>Categoria</label><select id="f-category">${Object.entries(CATEGORIES).map(([k,v]) => `<option value="${k}" ${meta.category===k?'selected':''}>${v}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Resumo (excerpt)</label><textarea id="f-excerpt" rows="2">${escHtml(meta.excerpt||'')}</textarea></div>
        <div class="field-row">
          <div class="field"><label>Tags (separadas por vírgula)</label><input id="f-tags" value="${escAttr((meta.tags||[]).join(', '))}" /></div>
          <div class="field"><label>Imagem de capa</label><input id="f-cover" value="${escAttr(meta.cover)}" /><div class="field-help"><button type="button" id="uploadCover" class="btn btn-secondary" style="padding:6px 12px;font-size:9px">Enviar imagem…</button></div></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Data publicação</label><input type="date" id="f-date" value="${meta.date||todayIso()}" /></div>
          <div class="field"><label>Última atualização</label><input type="date" id="f-updated" value="${meta.updated||todayIso()}" /></div>
        </div>
      </div>
      <div class="card" style="margin-top:18px">
        <label style="display:block;font-family:'Inter Tight',sans-serif;font-size:10.5px;letter-spacing:.28em;text-transform:uppercase;color:var(--gold);font-weight:500;margin-bottom:14px">Conteúdo</label>
        <div class="editor-toolbar">
          <button type="button" class="editor-tool" data-md="**" title="Negrito"><b>B</b></button>
          <button type="button" class="editor-tool" data-md="*" title="Itálico"><i>I</i></button>
          <span class="editor-tool-sep"></span>
          <button type="button" class="editor-tool" data-prefix="## " title="H2">H2</button>
          <button type="button" class="editor-tool" data-prefix="### " title="H3">H3</button>
          <span class="editor-tool-sep"></span>
          <button type="button" class="editor-tool" data-prefix="- ">• Lista</button>
          <button type="button" class="editor-tool" data-prefix="1. ">1. Lista</button>
          <button type="button" class="editor-tool" data-prefix="> ">" Citação</button>
          <span class="editor-tool-sep"></span>
          <button type="button" class="editor-tool" id="tool-link">Link</button>
          <button type="button" class="editor-tool" id="tool-image">Imagem</button>
          <button type="button" class="editor-tool" data-md="\`">‹/›</button>
          <button type="button" class="editor-tool" data-prefix="---">— Linha</button>
        </div>
        <div class="editor-grid">
          <textarea id="f-body" class="editor-textarea">${escHtml(body)}</textarea>
          <div id="preview" class="editor-preview"></div>
        </div>
      </div>
      <div class="card" style="margin-top:18px;display:flex;gap:14px;justify-content:flex-end;align-items:center;flex-wrap:wrap">
        <a href="#/posts" class="btn btn-secondary">← Voltar</a>
        ${fileBase ? `<button class="btn btn-danger" id="btnDelete">Excluir</button>` : ''}
        <button class="btn btn-primary" id="btnSave">${fileBase ? 'Salvar alterações' : 'Publicar post'}</button>
      </div>
    </div>
    <input type="file" id="fileInput" accept="image/*" style="display:none" />
  `;
  const ta = $('#f-body');
  const preview = $('#preview');
  function updatePreview(){ preview.innerHTML = mdRender(ta.value); }
  ta.addEventListener('input', updatePreview);
  updatePreview();
  $('#f-title').addEventListener('input', e => {
    const slugIn = $('#f-slug');
    if (!slugIn.value || slugIn.dataset.auto === '1'){ slugIn.value = slugify(e.target.value); slugIn.dataset.auto = '1'; }
  });
  $('#f-slug').addEventListener('input', e => { e.target.dataset.auto = '0'; });
  $$('.editor-tool[data-md]').forEach(b => b.addEventListener('click', () => wrapSelection(ta, b.dataset.md)));
  $$('.editor-tool[data-prefix]').forEach(b => b.addEventListener('click', () => prefixLines(ta, b.dataset.prefix)));
  $('#tool-link').addEventListener('click', () => {
    const url = prompt('URL:');
    if (!url) return;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || 'texto do link';
    insertAtCursor(ta, `[${sel}](${url})`);
  });
  $('#tool-image').addEventListener('click', () => $('#fileInput').click());
  $('#uploadCover').addEventListener('click', () => { $('#fileInput').dataset.target = 'cover'; $('#fileInput').click(); });
  $('#fileInput').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    const target = e.target.dataset.target || 'inline';
    e.target.dataset.target = ''; e.target.value = '';
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = ''; for (let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      const ext = file.name.split('.').pop().toLowerCase();
      const safeName = slugify(file.name.replace(/\.[^.]+$/, '')) + '-' + Date.now().toString(36) + '.' + ext;
      const path = `${REPO_PATHS.IMAGES}/${safeName}`;
      toast('Enviando…');
      await putBinaryFile(path, b64, `Upload: ${safeName}`);
      const url = `/HenriqueSilva/${path}`;
      if (target === 'cover'){ $('#f-cover').value = url; toast('Capa definida ✓'); }
      else { insertAtCursor(ta, `![${file.name.replace(/\.[^.]+$/, '')}](${url})`); updatePreview(); toast('Imagem inserida ✓'); }
    } catch(err){ toast(err.message, 'error'); }
  });
  $('#btnSave').addEventListener('click', async () => {
    const m = {
      title: $('#f-title').value.trim(),
      slug: ($('#f-slug').value.trim() || slugify($('#f-title').value.trim())),
      excerpt: $('#f-excerpt').value.trim(),
      category: $('#f-category').value,
      tags: $('#f-tags').value.split(',').map(x => x.trim()).filter(Boolean),
      cover: $('#f-cover').value.trim(),
      date: $('#f-date').value || todayIso(),
      updated: todayIso(),
    };
    if (!m.title){ toast('Título obrigatório', 'error'); return; }
    if (!m.slug){ toast('Slug inválido', 'error'); return; }
    const filename = fileBase ? `${fileBase}.md` : `${m.date}-${m.slug}.md`;
    const fullPath = `${REPO_PATHS.POSTS}/${filename}`;
    const content = buildFrontMatter(m) + ta.value + '\n';
    try {
      $('#btnSave').disabled = true; $('#btnSave').innerHTML = '<span class="spinner"></span> Salvando…';
      await putTextFile(fullPath, content, sha, fileBase ? `Update: ${m.title}` : `Publish: ${m.title}`);
      toast(fileBase ? 'Post atualizado ✓' : 'Post publicado ✓');
      setTimeout(() => { location.hash = '#/posts'; }, 1200);
    } catch(err){ toast(err.message, 'error'); $('#btnSave').disabled = false; $('#btnSave').textContent = fileBase ? 'Salvar alterações' : 'Publicar post'; }
  });
  if (fileBase){
    $('#btnDelete').addEventListener('click', async () => {
      if (!confirm(`Excluir "${meta.title}"?`)) return;
      try {
        await deleteFile(`${REPO_PATHS.POSTS}/${fileBase}.md`, sha, `Delete: ${meta.title}`);
        toast('Post excluído');
        location.hash = '#/posts';
      } catch(err){ toast(err.message, 'error'); }
    });
  }
}

function insertAtCursor(ta, text) {
  const start = ta.selectionStart, end = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus(); ta.dispatchEvent(new Event('input'));
}
function wrapSelection(ta, wrapper) {
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.slice(start, end) || 'texto';
  ta.value = ta.value.slice(0, start) + wrapper + sel + wrapper + ta.value.slice(end);
  ta.selectionStart = start + wrapper.length;
  ta.selectionEnd = ta.selectionStart + sel.length;
  ta.focus(); ta.dispatchEvent(new Event('input'));
}
function prefixLines(ta, prefix) {
  const start = ta.selectionStart, end = ta.selectionEnd;
  const before = ta.value.slice(0, start);
  const sel = ta.value.slice(start, end) || 'texto';
  const after = ta.value.slice(end);
  const prefixed = sel.split('\n').map(l => prefix + l).join('\n');
  ta.value = before + prefixed + after;
  ta.selectionStart = start; ta.selectionEnd = start + prefixed.length;
  ta.focus(); ta.dispatchEvent(new Event('input'));
}

/* ===================== GALLERY ===================== */

async function renderGallery(app) {
  app.innerHTML = renderTopbar('imagens') + `
    <div class="container">
      <div class="h1">Galeria <em>de imagens</em></div>
      <div class="h-sub">Imagens disponíveis para os posts e cards do site</div>
      <div class="posts-toolbar">
        <input class="posts-search" id="galSearch" placeholder="Buscar por nome…" />
        <button class="btn btn-primary" id="btnUpload">+ Enviar imagem</button>
      </div>
      <div id="galContainer">Carregando…</div>
      <input type="file" id="galFile" accept="image/*" multiple style="display:none" />
      <style>
        .gal-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
        .gal-item{background:var(--black-2);border:1px solid rgba(212,175,55,.15);padding:8px;transition:all .3s;position:relative}
        .gal-item:hover{border-color:var(--gold)}
        .gal-thumb{width:100%;aspect-ratio:1;background:#080808 center/cover no-repeat;border:1px solid rgba(212,175,55,.1);cursor:pointer}
        .gal-name{font-family:'Inter Tight',sans-serif;font-size:11px;color:var(--gray-300);margin-top:8px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;font-weight:300}
        .gal-actions{display:flex;gap:6px;margin-top:8px}
        .gal-actions button{flex:1;padding:6px 8px;font-size:9px;letter-spacing:.16em;border:1px solid rgba(212,175,55,.3);background:transparent;color:var(--gold-light);text-transform:uppercase;font-weight:500;cursor:pointer;transition:all .25s}
        .gal-actions button:hover{background:rgba(212,175,55,.1)}
        .gal-actions .del:hover{background:var(--danger);border-color:var(--danger);color:#fff}
        @media(max-width:780px){.gal-grid{grid-template-columns:repeat(2,1fr)}}
      </style>
    </div>
  `;
  $('#btnUpload').addEventListener('click', () => $('#galFile').click());
  $('#galFile').addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    for (const file of files){
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = ''; for (let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
        const b64 = btoa(bin);
        const ext = file.name.split('.').pop().toLowerCase();
        const safeName = slugify(file.name.replace(/\.[^.]+$/, '')) + '-' + Date.now().toString(36) + '.' + ext;
        const path = `${REPO_PATHS.IMAGES}/${safeName}`;
        toast(`Enviando ${file.name}…`);
        await putBinaryFile(path, b64, `Upload: ${safeName}`);
      } catch(err){ toast(err.message, 'error'); }
    }
    toast('Upload concluído ✓');
    renderGallery(app);
  });
  try {
    const imgs = ((await listDir(REPO_PATHS.IMAGES)) || []).filter(x => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(x.name));
    if (!imgs.length){
      $('#galContainer').innerHTML = '<div class="empty"><h3>Nenhuma imagem ainda</h3><p>Use o botão acima para enviar a primeira</p></div>';
      return;
    }
    const renderList = (filter='') => {
      const filtered = filter ? imgs.filter(i => i.name.toLowerCase().includes(filter.toLowerCase())) : imgs;
      $('#galContainer').innerHTML = `<div class="gal-grid">` + filtered.map(img => {
        const url = `/HenriqueSilva/${img.path}`;
        return `<div class="gal-item">
          <div class="gal-thumb" style="background-image:url('${url}')" onclick="window.open('${url}', '_blank')"></div>
          <div class="gal-name" title="${escAttr(img.name)}">${escHtml(img.name)}</div>
          <div class="gal-actions">
            <button onclick="navigator.clipboard.writeText('${url}').then(()=>this.textContent='✓ COPIADO');" title="Copiar URL">URL</button>
            <button class="del" data-path="${img.path}" data-sha="${img.sha}" title="Excluir">✕</button>
          </div>
        </div>`;
      }).join('') + `</div>`;
      $$('.del[data-path]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Excluir essa imagem?')) return;
        try {
          await deleteFile(b.dataset.path, b.dataset.sha, `Delete: ${b.dataset.path.split('/').pop()}`);
          toast('Imagem excluída'); renderGallery(app);
        } catch(err){ toast(err.message, 'error'); }
      }));
    };
    renderList();
    $('#galSearch').addEventListener('input', e => renderList(e.target.value));
  } catch(err){
    $('#galContainer').innerHTML = `<p style="color:var(--danger)">${err.message}</p>`;
  }
}

/* ===================== CONFIG ===================== */

async function renderConfig(app) {
  app.innerHTML = renderTopbar('config') + `
    <div class="container">
      <div class="h1">Configurações <em>do site</em></div>
      <div class="h-sub">Contato, redes sociais, analytics. Reflete em todas as páginas.</div>
      <div id="cfgContainer">Carregando…</div>
    </div>
  `;
  let file;
  try { file = await getJsonFile(REPO_PATHS.SITE_CONFIG); }
  catch (err) { $('#cfgContainer').innerHTML = `<p style="color:var(--danger)">${err.message}</p>`; return; }
  if (!file) { $('#cfgContainer').innerHTML = `<p style="color:var(--danger)">site-config.json não encontrado</p>`; return; }
  const cfg = file.content;
  const sha = file.sha;
  $('#cfgContainer').innerHTML = `
    <div class="card">
      <h3 style="font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin-bottom:18px">Contato</h3>
      <div class="field-row">
        <div class="field"><label>Telefone formatado</label><input id="cfg-phone" value="${escAttr(cfg.phone)}" /></div>
        <div class="field"><label>Telefone (só dígitos, com DDI)</label><input id="cfg-phone_intl" value="${escAttr(cfg.phone_intl)}" /></div>
      </div>
      <div class="field"><label>E-mail</label><input id="cfg-email" value="${escAttr(cfg.email)}" /></div>
      <div class="field"><label>Horário</label><input id="cfg-schedule" value="${escAttr(cfg.schedule)}" /></div>
    </div>
    <div class="card" style="margin-top:18px">
      <h3 style="font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin-bottom:18px">Endereço</h3>
      <div class="field-row">
        <div class="field"><label>Nome</label><input id="cfg-addr-name" value="${escAttr(cfg.address?.name)}" /></div>
        <div class="field"><label>Rua</label><input id="cfg-addr-street" value="${escAttr(cfg.address?.street)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Complemento</label><input id="cfg-addr-complement" value="${escAttr(cfg.address?.complement)}" /></div>
        <div class="field"><label>Bairro</label><input id="cfg-addr-neighborhood" value="${escAttr(cfg.address?.neighborhood)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Cidade</label><input id="cfg-addr-city" value="${escAttr(cfg.address?.city)}" /></div>
        <div class="field"><label>UF</label><input id="cfg-addr-state" value="${escAttr(cfg.address?.state)}" /></div>
      </div>
      <div class="field"><label>CEP</label><input id="cfg-addr-cep" value="${escAttr(cfg.address?.cep)}" /></div>
    </div>
    <div class="card" style="margin-top:18px">
      <h3 style="font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin-bottom:18px">Redes sociais</h3>
      <div class="field"><label>Instagram</label><input id="cfg-soc-instagram" value="${escAttr(cfg.social?.instagram)}" /></div>
      <div class="field"><label>Facebook</label><input id="cfg-soc-facebook" value="${escAttr(cfg.social?.facebook)}" /></div>
      <div class="field"><label>LinkedIn</label><input id="cfg-soc-linkedin" value="${escAttr(cfg.social?.linkedin)}" /></div>
      <div class="field"><label>YouTube</label><input id="cfg-soc-youtube" value="${escAttr(cfg.social?.youtube)}" /></div>
      <div class="field"><label>TikTok</label><input id="cfg-soc-tiktok" value="${escAttr(cfg.social?.tiktok)}" /></div>
    </div>
    <div class="card" style="margin-top:18px">
      <h3 style="font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin-bottom:18px">Analytics</h3>
      <div class="field"><label>Microsoft Clarity ID</label><input id="cfg-clarity" value="${escAttr(cfg.clarity_id)}" placeholder="abc1234567" /></div>
      <div class="field"><label>Plausible Domain</label><input id="cfg-plausible" value="${escAttr(cfg.plausible_domain)}" placeholder="henriquesilvaadv.com.br" /></div>
      <div class="field"><label>Google Analytics 4 ID</label><input id="cfg-ga4" value="${escAttr(cfg.ga4_id)}" placeholder="G-XXXXXXXXXX" /></div>
    </div>
    <div class="card" style="margin-top:18px;display:flex;gap:14px;justify-content:flex-end">
      <a href="#/dashboard" class="btn btn-secondary">← Voltar</a>
      <button class="btn btn-primary" id="cfgSave">Salvar</button>
    </div>
  `;
  $('#cfgSave').addEventListener('click', async () => {
    const newCfg = {
      ...cfg,
      clarity_id: $('#cfg-clarity').value.trim(),
      plausible_domain: $('#cfg-plausible').value.trim(),
      ga4_id: $('#cfg-ga4').value.trim(),
      phone: $('#cfg-phone').value.trim(),
      phone_intl: $('#cfg-phone_intl').value.trim(),
      email: $('#cfg-email').value.trim(),
      schedule: $('#cfg-schedule').value.trim(),
      address: {
        name: $('#cfg-addr-name').value.trim(),
        street: $('#cfg-addr-street').value.trim(),
        complement: $('#cfg-addr-complement').value.trim(),
        neighborhood: $('#cfg-addr-neighborhood').value.trim(),
        city: $('#cfg-addr-city').value.trim(),
        state: $('#cfg-addr-state').value.trim(),
        cep: $('#cfg-addr-cep').value.trim(),
      },
      social: {
        instagram: $('#cfg-soc-instagram').value.trim(),
        facebook: $('#cfg-soc-facebook').value.trim(),
        linkedin: $('#cfg-soc-linkedin').value.trim(),
        youtube: $('#cfg-soc-youtube').value.trim(),
        tiktok: $('#cfg-soc-tiktok').value.trim(),
      },
    };
    try {
      $('#cfgSave').disabled = true; $('#cfgSave').innerHTML = '<span class="spinner"></span> Salvando…';
      await putJsonFile(REPO_PATHS.SITE_CONFIG, newCfg, sha, 'admin: atualizar site-config');
      toast('Configurações salvas ✓');
      setTimeout(() => { location.hash = '#/dashboard'; }, 1200);
    } catch(err){ toast(err.message, 'error'); $('#cfgSave').disabled = false; $('#cfgSave').textContent = 'Salvar'; }
  });
}
