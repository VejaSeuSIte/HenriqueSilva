/* HSA Admin — gerencia posts via GitHub API REST com PAT do usuário */

const REPO = 'VejaSeuSIte/HenriqueSilva';
const POSTS_PATH = 'blog/_posts';
const IMAGES_PATH = 'blog/images';
const BRANCH = 'main';
const STORAGE_KEY = 'hsa_admin_pat';

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

/* ===================== HELPERS ===================== */

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const html = (strings, ...values) => {
  let out = '';
  strings.forEach((s, i) => { out += s + (values[i] !== undefined ? values[i] : ''); });
  return out;
};

function getPAT(){ return localStorage.getItem(STORAGE_KEY); }
function setPAT(token){ localStorage.setItem(STORAGE_KEY, token); }
function clearPAT(){ localStorage.removeItem(STORAGE_KEY); }

async function apiFetch(path, options={}){
  const pat = getPAT();
  if (!pat) throw new Error('Sem token. Faça login.');
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    clearPAT();
    location.hash = '#/login';
    throw new Error('Token inválido — faça login novamente');
  }
  return res;
}

async function getFile(path){
  const res = await apiFetch(`/repos/${REPO}/contents/${path}?ref=${BRANCH}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Erro ao ler arquivo');
  const data = await res.json();
  // base64 decode (handles utf-8)
  const bin = atob(data.content);
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  const text = new TextDecoder('utf-8').decode(bytes);
  return { sha: data.sha, content: text, path };
}

async function listDir(path){
  const res = await apiFetch(`/repos/${REPO}/contents/${path}?ref=${BRANCH}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error('Erro ao listar diretório');
  return await res.json();
}

async function putFile(path, content, sha=null, message='Update'){
  // utf-8 -> base64
  const bytes = new TextEncoder().encode(content);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  const b64 = btoa(bin);
  const body = { message, content: b64, branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await apiFetch(`/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res.ok){
    const err = await res.json().catch(()=>({}));
    throw new Error(err.message || 'Erro ao salvar');
  }
  return await res.json();
}

async function putBinaryFile(path, base64Content, message='Upload'){
  const body = { message, content: base64Content, branch: BRANCH };
  const res = await apiFetch(`/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res.ok){
    const err = await res.json().catch(()=>({}));
    throw new Error(err.message || 'Erro ao fazer upload');
  }
  return await res.json();
}

async function deleteFile(path, sha, message='Delete'){
  const res = await apiFetch(`/repos/${REPO}/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch: BRANCH }),
  });
  if (!res.ok){
    const err = await res.json().catch(()=>({}));
    throw new Error(err.message || 'Erro ao deletar');
  }
}

function parseFrontMatter(text){
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
    if (v.startsWith('[') && v.endsWith(']')){
      v = v.slice(1,-1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (v.startsWith('"') && v.endsWith('"')){
      v = v.slice(1,-1);
    } else if (v.startsWith("'") && v.endsWith("'")){
      v = v.slice(1,-1);
    }
    meta[m[1]] = v;
  });
  return { meta, body };
}

function buildFrontMatter(meta){
  const lines = ['---'];
  ['title','slug','excerpt','category','tags','cover','date','updated'].forEach(k => {
    if (meta[k] === undefined || meta[k] === null) return;
    let v = meta[k];
    if (Array.isArray(v)){
      v = '[' + v.map(x => `${x}`).join(', ') + ']';
    } else if (typeof v === 'string' && (v.includes(':') || v.includes('"') || v.includes("'"))){
      v = `"${v.replace(/"/g, '\\"')}"`;
    } else if (typeof v === 'string' && k !== 'date' && k !== 'updated' && k !== 'slug' && k !== 'category'){
      v = `"${v}"`;
    }
    lines.push(`${k}: ${v}`);
  });
  lines.push('---', '');
  return lines.join('\n');
}

function slugify(s){
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function todayIso(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fileBaseName(path){
  return path.split('/').pop().replace(/\.md$/, '');
}

function fmtDate(iso){
  const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  try {
    const [y,m,d] = iso.split('-').map(Number);
    return `${d} ${months[m-1]} ${y}`;
  } catch(e){ return iso; }
}

/* ===================== TOAST ===================== */

function toast(message, kind='success'){
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

/* ===================== MARKDOWN PREVIEW (mini) ===================== */
/* Pequeno parser markdown para o preview ao vivo */

function mdInline(text){
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1"/>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function mdRender(md){
  if (!md) return '';
  const lines = md.split('\n');
  let out = '', inList = null, inCode = false, inQuote = false, codeBuf = '';
  for (let i=0; i<lines.length; i++){
    let line = lines[i];
    if (line.startsWith('```')){
      if (inCode){ out += `<pre><code>${codeBuf.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`; codeBuf=''; inCode=false; }
      else { inCode = true; }
      continue;
    }
    if (inCode){ codeBuf += line + '\n'; continue; }
    if (inList && !line.match(/^\s*([-*]|\d+\.)\s/)){ out += `</${inList}>`; inList = null; }
    if (inQuote && !line.startsWith('>')){ out += '</blockquote>'; inQuote = false; }
    if (!line.trim()){ continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)/))){
      out += `<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`;
    } else if (line.startsWith('> ')){
      if (!inQuote){ out += '<blockquote>'; inQuote = true; }
      out += `<p>${mdInline(line.slice(2))}</p>`;
    } else if ((m = line.match(/^[-*]\s+(.*)/))){
      if (inList !== 'ul'){ if (inList) out += `</${inList}>`; out += '<ul>'; inList = 'ul'; }
      out += `<li>${mdInline(m[1])}</li>`;
    } else if ((m = line.match(/^\d+\.\s+(.*)/))){
      if (inList !== 'ol'){ if (inList) out += `</${inList}>`; out += '<ol>'; inList = 'ol'; }
      out += `<li>${mdInline(m[1])}</li>`;
    } else if (line.startsWith('---')){
      out += '<hr/>';
    } else {
      out += `<p>${mdInline(line)}</p>`;
    }
  }
  if (inList) out += `</${inList}>`;
  if (inQuote) out += '</blockquote>';
  return out;
}

/* ===================== ROUTING ===================== */

async function route(){
  const hash = location.hash || '#/';
  const path = hash.replace(/^#/, '');
  const app = $('#app');

  if (!getPAT() && path !== '/login'){
    location.hash = '#/login';
    return;
  }
  if (getPAT() && path === '/login'){
    location.hash = '#/';
    return;
  }

  if (path === '/login') return renderLogin(app);
  if (path === '/' || path === '/posts') return renderPosts(app);
  if (path === '/new') return renderEditor(app, null);
  if (path.startsWith('/edit/')) return renderEditor(app, decodeURIComponent(path.slice(6)));

  app.innerHTML = '<div class="container"><div class="empty"><h3>Página não encontrada</h3><a href="#/" class="btn btn-primary">Voltar</a></div></div>';
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

/* ===================== LOGIN ===================== */

function renderLogin(app){
  app.innerHTML = `
    <div class="login-page">
      <div class="login-box">
        <div class="login-brand">
          <img src="/HenriqueSilva/assets/seal-hsa.png" alt="HSA" />
          <div class="login-brand-name">Henrique Silva<small>Advocacia · Admin</small></div>
        </div>
        <div class="login-title">Acesso ao painel</div>
        <div class="login-sub">Cole seu Personal Access Token do GitHub</div>
        <div id="loginErr"></div>
        <form id="loginForm">
          <div class="field">
            <label>Personal Access Token</label>
            <input type="password" id="pat" autocomplete="off" placeholder="github_pat_…" required />
            <div class="field-help">Token armazenado apenas no seu navegador (localStorage). Nunca enviado para servidores externos.</div>
          </div>
          <button type="submit" class="btn btn-primary login-btn">Entrar</button>
        </form>
        <div class="login-help">
          <strong>Como criar o token:</strong>
          <ol style="margin-top:10px;padding-left:22px">
            <li>Acesse <a href="https://github.com/settings/personal-access-tokens/new" target="_blank">github.com/settings/personal-access-tokens/new</a> (logado em <b style="color:var(--gold)">VejaSeuSIte</b>)</li>
            <li>Repository access: selecione apenas <b>HenriqueSilva</b></li>
            <li>Permissions → Repository → <b>Contents: Read and write</b></li>
            <li>Generate token → copie e cole acima</li>
          </ol>
        </div>
      </div>
    </div>
  `;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pat = $('#pat').value.trim();
    const errEl = $('#loginErr');
    errEl.innerHTML = '';
    setPAT(pat);
    try {
      const res = await apiFetch('/user');
      if (!res.ok) throw new Error('Token inválido');
      const user = await res.json();
      toast(`Olá, ${user.login}`);
      location.hash = '#/';
    } catch (err) {
      clearPAT();
      errEl.innerHTML = `<div class="login-error">${err.message}</div>`;
    }
  });
}

/* ===================== TOPBAR ===================== */

function renderTopbar(active){
  return `
    <div class="topbar">
      <div class="topbar-brand">
        <img src="/HenriqueSilva/assets/seal-hsa.png" alt="HSA" />
        <div class="topbar-brand-text">Henrique Silva<small>Advocacia · Admin</small></div>
      </div>
      <div class="topbar-nav">
        <a href="#/posts" class="${active==='posts'?'active':''}">Posts</a>
        <a href="#/new" class="${active==='new'?'active':''}">+ Novo</a>
        <a href="/HenriqueSilva/blog/" target="_blank">Ver blog ↗</a>
      </div>
      <div class="topbar-actions">
        <span class="topbar-user">Logado</span>
        <button class="topbar-logout" onclick="if(confirm('Sair?')){localStorage.removeItem('hsa_admin_pat');location.hash='#/login'}">Sair</button>
      </div>
    </div>
  `;
}

/* ===================== POSTS LIST ===================== */

async function renderPosts(app){
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
    const items = await listDir(POSTS_PATH);
    const mds = items.filter(x => x.name.endsWith('.md'));
    const posts = await Promise.all(mds.map(async x => {
      const f = await getFile(x.path);
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
          <h3>${(p.title||'(sem título)').replace(/<[^>]+>/g,'')}</h3>
          <p>${(p.excerpt||'').replace(/<[^>]+>/g,'')}</p>
          <div class="post-row-actions">
            <a href="#/edit/${encodeURIComponent(p.fileBase)}" class="btn btn-secondary">Editar</a>
            <a href="/HenriqueSilva/blog/${p.slug || ''}/" target="_blank" class="btn btn-secondary">Ver ↗</a>
            <button class="btn btn-danger" data-del="${p.path}" data-sha="${p.sha}" data-name="${(p.title||'').replace(/"/g,'')}">Excluir</button>
          </div>
        </article>
      `).join('') + `</div>`;
      $$('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm(`Excluir "${btn.dataset.name}"?`)) return;
        try {
          await deleteFile(btn.dataset.del, btn.dataset.sha, `Delete: ${btn.dataset.name}`);
          toast('Post excluído');
          renderPosts(app);
        } catch(err){ toast(err.message, 'error'); }
      }));
    };

    renderList();
    $('#postsSearch').addEventListener('input', e => renderList(e.target.value));

  } catch(err){
    $('#postsContainer').innerHTML = `<div class="empty"><h3>Erro</h3><p>${err.message}</p></div>`;
  }
}

/* ===================== EDITOR ===================== */

async function renderEditor(app, fileBase){
  let existing = null;
  let sha = null;
  let meta = {
    title: '',
    slug: '',
    excerpt: '',
    category: 'trabalhista',
    tags: [],
    cover: '',
    date: todayIso(),
    updated: todayIso(),
  };
  let body = '';

  if (fileBase){
    try {
      const f = await getFile(`${POSTS_PATH}/${fileBase}.md`);
      if (f){
        existing = f;
        sha = f.sha;
        const parsed = parseFrontMatter(f.content);
        meta = { ...meta, ...parsed.meta };
        if (typeof meta.tags === 'string') meta.tags = meta.tags.split(',').map(s=>s.trim()).filter(Boolean);
        if (!Array.isArray(meta.tags)) meta.tags = [];
        body = parsed.body;
      }
    } catch(err){ toast(err.message, 'error'); }
  }

  app.innerHTML = renderTopbar(fileBase ? 'posts' : 'new') + `
    <div class="container">
      <div class="h1">${fileBase ? 'Editar post' : 'Novo <em>post</em>'}</div>
      <div class="h-sub">${fileBase ? 'Modifique o conteúdo e salve' : 'Escreva um novo artigo'}</div>

      <div class="card">
        <div class="field">
          <label>Título</label>
          <input id="f-title" placeholder="Como provar horas extras na Justiça do Trabalho" value="${(meta.title||'').replace(/"/g,'&quot;')}" />
        </div>
        <div class="field-row">
          <div class="field">
            <label>Slug (URL)</label>
            <input id="f-slug" placeholder="auto-gerado do título" value="${meta.slug||''}" />
            <div class="field-help">Deixa vazio pra gerar automático.</div>
          </div>
          <div class="field">
            <label>Categoria</label>
            <select id="f-category">
              ${Object.entries(CATEGORIES).map(([k,v]) => `<option value="${k}" ${meta.category===k?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label>Resumo (excerpt)</label>
          <textarea id="f-excerpt" rows="2" placeholder="Frase de 1-2 linhas que aparece nos cards e meta description">${meta.excerpt||''}</textarea>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Tags (separadas por vírgula)</label>
            <input id="f-tags" placeholder="horas-extras, prova, CLT" value="${(meta.tags||[]).join(', ')}" />
          </div>
          <div class="field">
            <label>Imagem de capa</label>
            <input id="f-cover" placeholder="/HenriqueSilva/blog/images/foto.jpg" value="${meta.cover||''}" />
            <div class="field-help"><button type="button" id="uploadCover" class="btn btn-secondary" style="padding:6px 12px;font-size:9px">Enviar imagem…</button></div>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Data publicação</label>
            <input type="date" id="f-date" value="${meta.date||todayIso()}" />
          </div>
          <div class="field">
            <label>Última atualização</label>
            <input type="date" id="f-updated" value="${meta.updated||todayIso()}" />
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:18px">
        <label style="display:block;font-family:'Inter Tight',sans-serif;font-size:10.5px;letter-spacing:.28em;text-transform:uppercase;color:var(--gold);font-weight:500;margin-bottom:14px">Conteúdo</label>
        <div class="editor-toolbar">
          <button type="button" class="editor-tool" data-md="**" title="Negrito"><b>B</b></button>
          <button type="button" class="editor-tool" data-md="*" title="Itálico"><i>I</i></button>
          <span class="editor-tool-sep"></span>
          <button type="button" class="editor-tool" data-prefix="## " title="Título H2">H2</button>
          <button type="button" class="editor-tool" data-prefix="### " title="Título H3">H3</button>
          <span class="editor-tool-sep"></span>
          <button type="button" class="editor-tool" data-prefix="- " title="Lista com marcadores">• Lista</button>
          <button type="button" class="editor-tool" data-prefix="1. " title="Lista numerada">1. Lista</button>
          <button type="button" class="editor-tool" data-prefix="> " title="Citação">" Citação</button>
          <span class="editor-tool-sep"></span>
          <button type="button" class="editor-tool" id="tool-link" title="Link">
            <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </button>
          <button type="button" class="editor-tool" id="tool-image" title="Inserir imagem">
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </button>
          <span class="editor-tool-sep"></span>
          <button type="button" class="editor-tool" data-md="\`" title="Código inline">‹/›</button>
          <button type="button" class="editor-tool" data-prefix="---" title="Divisor">— Linha</button>
        </div>
        <div class="editor-grid">
          <textarea id="f-body" class="editor-textarea" placeholder="# Use markdown — preview ao vivo do lado direito">${body}</textarea>
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

  // Auto-slug
  $('#f-title').addEventListener('input', e => {
    const slugIn = $('#f-slug');
    if (!slugIn.value || slugIn.dataset.auto === '1'){
      slugIn.value = slugify(e.target.value);
      slugIn.dataset.auto = '1';
    }
  });
  $('#f-slug').addEventListener('input', e => { e.target.dataset.auto = '0'; });

  // Toolbar
  $$('.editor-tool[data-md]').forEach(b => b.addEventListener('click', () => wrapSelection(ta, b.dataset.md)));
  $$('.editor-tool[data-prefix]').forEach(b => b.addEventListener('click', () => prefixLines(ta, b.dataset.prefix)));
  $('#tool-link').addEventListener('click', () => {
    const url = prompt('URL do link:');
    if (!url) return;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || 'texto do link';
    insertAtCursor(ta, `[${sel}](${url})`);
  });
  $('#tool-image').addEventListener('click', () => $('#fileInput').click());
  $('#uploadCover').addEventListener('click', () => {
    $('#fileInput').dataset.target = 'cover';
    $('#fileInput').click();
  });
  $('#fileInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const target = e.target.dataset.target || 'inline';
    e.target.dataset.target = '';
    e.target.value = '';
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      const ext = file.name.split('.').pop().toLowerCase();
      const safeName = slugify(file.name.replace(/\.[^.]+$/, '')) + '-' + Date.now().toString(36) + '.' + ext;
      const path = `${IMAGES_PATH}/${safeName}`;
      toast('Enviando imagem…');
      await putBinaryFile(path, b64, `Upload imagem: ${safeName}`);
      const url = `/HenriqueSilva/${path}`;
      if (target === 'cover'){
        $('#f-cover').value = url;
        toast('Capa definida ✓');
      } else {
        insertAtCursor(ta, `![${file.name.replace(/\.[^.]+$/, '')}](${url})`);
        updatePreview();
        toast('Imagem inserida ✓');
      }
    } catch(err){ toast(err.message, 'error'); }
  });

  // Save
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
    const fullPath = `${POSTS_PATH}/${filename}`;
    const content = buildFrontMatter(m) + ta.value + '\n';

    try {
      $('#btnSave').disabled = true;
      $('#btnSave').innerHTML = '<span class="spinner"></span> Salvando…';
      await putFile(fullPath, content, sha, fileBase ? `Update: ${m.title}` : `Publish: ${m.title}`);
      toast(fileBase ? 'Post atualizado ✓' : 'Post publicado ✓');
      setTimeout(() => { location.hash = '#/posts'; }, 1200);
    } catch(err){
      toast(err.message, 'error');
      $('#btnSave').disabled = false;
      $('#btnSave').textContent = fileBase ? 'Salvar alterações' : 'Publicar post';
    }
  });

  if (fileBase){
    $('#btnDelete').addEventListener('click', async () => {
      if (!confirm(`Excluir "${meta.title}"?`)) return;
      try {
        await deleteFile(`${POSTS_PATH}/${fileBase}.md`, sha, `Delete: ${meta.title}`);
        toast('Post excluído');
        location.hash = '#/posts';
      } catch(err){ toast(err.message, 'error'); }
    });
  }
}

/* Selection helpers */
function insertAtCursor(ta, text){
  const start = ta.selectionStart, end = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}
function wrapSelection(ta, wrapper){
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.slice(start, end) || 'texto';
  ta.value = ta.value.slice(0, start) + wrapper + sel + wrapper + ta.value.slice(end);
  ta.selectionStart = start + wrapper.length;
  ta.selectionEnd = ta.selectionStart + sel.length;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}
function prefixLines(ta, prefix){
  const start = ta.selectionStart, end = ta.selectionEnd;
  const before = ta.value.slice(0, start);
  const sel = ta.value.slice(start, end) || 'texto';
  const after = ta.value.slice(end);
  const prefixed = sel.split('\n').map(l => prefix + l).join('\n');
  ta.value = before + prefixed + after;
  ta.selectionStart = start;
  ta.selectionEnd = start + prefixed.length;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}
