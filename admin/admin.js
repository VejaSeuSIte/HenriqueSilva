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
  const isUpload = action === 'putBinary' || (action === 'putFile' && opts.content && opts.content.length > 100_000);
  const timeoutMs = isUpload ? 90_000 : 30_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/github-proxy`, {
      method: 'POST',
      signal: ac.signal,
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
      const err = new Error(data.error || `Erro ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Tempo esgotado — verifique sua conexão e tente de novo.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
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

// previewUrl: usa raw.githubusercontent.com (sem cache do Pages CDN, mostra imagens
// recém-uploadadas imediatamente). Path pode ser tipo "blog/images/foo.jpg" ou
// "/HenriqueSilva/blog/images/foo.jpg" — normaliza nos dois casos.
function previewUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith('data:')) return path;
  let p = path.replace(/^\//, '').replace(/^HenriqueSilva\//, '');
  return `https://raw.githubusercontent.com/VejaSeuSIte/HenriqueSilva/main/${p}?t=${Date.now()}`;
}
// pasteUrl: caminho que vai pro markdown / HTML do site (sob /HenriqueSilva/)
function pasteUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  let p = path.replace(/^\//, '').replace(/^HenriqueSilva\//, '');
  return `/HenriqueSilva/${p}`;
}

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
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  const icon = kind === 'success'
    ? '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  const span = document.createElement('span');
  span.textContent = String(message ?? '');
  el.innerHTML = icon;
  el.appendChild(span);
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; }, 2400);
  setTimeout(() => el.remove(), 2800);
}

/* ===================== RICH TEXT EDITOR (WYSIWYG sem HTML cru) ===================== */
// Registro global pra coletar valores na hora de salvar
const richInstances = new Map();
function clearRichInstances() { richInstances.clear(); }

// Sanitiza o HTML produzido pelo contenteditable: só deixa <strong>, <em>, <a>, <br>.
// Bloqueia explicitamente javascript:, data:, vbscript:, file:, blob: em href.
function sanitizeRichHtml(html, opts = {}) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  function safeHref(raw) {
    const original = String(raw || '').trim();
    if (!original) return '';
    // Pra checar protocolo, decodifica em camadas até estabilizar (defesa contra
    // obfuscação multi-encoded). Mas mantém a string original pra renderizar
    // (preserva %20 e outros encodings legítimos).
    let probe = original;
    for (let i = 0; i < 3; i++) {
      try {
        const dec = decodeURIComponent(probe.replace(/%(?![0-9a-f]{2})/gi, '%25'));
        if (dec === probe) break;
        probe = dec;
      } catch (_) { break; }
    }
    const stripped = probe.replace(/[\s\x00-\x1f]/g, '').toLowerCase();
    if (/^(javascript|data|vbscript|file|blob):/.test(stripped)) return '';
    let href = original;
    if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(stripped)) {
      href = 'https://' + original.replace(/^\/+/, '');
    }
    return href.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function walk(node) {
    if (node.nodeType === 3) return escHtml(node.textContent).replace(/\u00a0/g, '&nbsp;');
    if (node.nodeType !== 1) return '';
    const tag = node.nodeName.toLowerCase();
    let inner = '';
    for (const c of node.childNodes) inner += walk(c);
    if (!inner.trim() && tag !== 'br') return inner;
    if (tag === 'b' || tag === 'strong') return `<strong>${inner}</strong>`;
    if (tag === 'i' || tag === 'em') return `<em>${inner}</em>`;
    if (tag === 'br') return opts.singleLine ? ' ' : '<br/>';
    if (tag === 'a') {
      const href = safeHref(node.getAttribute('href'));
      if (!href) return inner; // link inválido vira só texto
      const isExternal = /^https?:/i.test(href);
      const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${href}"${target}>${inner}</a>`;
    }
    if (tag === 'p' || tag === 'div') return inner + (opts.singleLine ? '' : '<br/>');
    return inner;
  }
  let out = walk(div);
  out = out.replace(/(<br\/>)+$/g, '');
  return out;
}

function makeRichEditor(targetEl, key, initialHtml, opts = {}) {
  const singleLine = !!opts.singleLine;
  const placeholder = opts.placeholder || '';
  targetEl.classList.add('rich-editor-shell');
  targetEl.innerHTML = `
    <div class="rich-editor">
      <div class="rich-toolbar">
        <button type="button" data-cmd="bold" title="Negrito (Ctrl+B)"><b>B</b></button>
        <button type="button" data-cmd="italic" title="Itálico (Ctrl+I)"><i>I</i></button>
        ${opts.allowLink === false ? '' : '<button type="button" data-cmd="link" title="Inserir link">🔗</button>'}
        ${opts.allowLink === false ? '' : '<button type="button" data-cmd="unlink" title="Remover link">⌀</button>'}
        <span class="sep"></span>
        <button type="button" data-cmd="clear" title="Remover formatação">A</button>
      </div>
      <div class="rich-area${singleLine ? ' single' : ''}" contenteditable="true" data-placeholder="${escAttr(placeholder)}"></div>
    </div>
  `;
  const area = targetEl.querySelector('.rich-area');
  // Sanitiza no LOAD também — se um valor malicioso chegou no JSON via outro
  // caminho, não vamos renderizar HTML cru no contenteditable.
  area.innerHTML = sanitizeRichHtml(initialHtml || '', { singleLine });

  // Single-line: previne Enter
  if (singleLine) {
    area.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); } });
  }

  // Toolbar handlers
  targetEl.querySelectorAll('.rich-toolbar button').forEach(b => {
    b.addEventListener('mousedown', (e) => { e.preventDefault(); }); // não perde seleção
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const cmd = b.dataset.cmd;
      area.focus();
      if (cmd === 'bold' || cmd === 'italic') {
        document.execCommand(cmd, false, null);
      } else if (cmd === 'link') {
        const sel = window.getSelection();
        const selectedText = sel ? sel.toString() : '';
        if (!selectedText) { toast('Selecione o texto que vira link primeiro', 'error'); return; }
        const url = prompt('Cole o endereço (URL):');
        if (url) document.execCommand('createLink', false, url);
      } else if (cmd === 'unlink') {
        document.execCommand('unlink', false, null);
      } else if (cmd === 'clear') {
        document.execCommand('removeFormat', false, null);
      }
      updateToolbarState();
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // Atalhos teclado
  area.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); document.execCommand('bold'); area.dispatchEvent(new Event('input', { bubbles: true })); }
      if (k === 'i') { e.preventDefault(); document.execCommand('italic'); area.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  });

  // Estado da toolbar (B/I active quando cursor está em texto formatado)
  function updateToolbarState() {
    try {
      targetEl.querySelector('[data-cmd="bold"]').classList.toggle('active', document.queryCommandState('bold'));
      targetEl.querySelector('[data-cmd="italic"]').classList.toggle('active', document.queryCommandState('italic'));
    } catch (_) {}
  }
  area.addEventListener('keyup', updateToolbarState);
  area.addEventListener('mouseup', updateToolbarState);

  // Cole texto sem formatação herdada
  area.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  const inst = {
    getHtml() { return sanitizeRichHtml(area.innerHTML, { singleLine }); },
    setHtml(h) { area.innerHTML = sanitizeRichHtml(h || '', { singleLine }); },
    focus() { area.focus(); },
    el: area,
  };
  if (key) richInstances.set(key, inst);
  return inst;
}

// Inicializa todos os .js-rich num container (idempotente — não re-inicializa)
function initRichEditors(root = document) {
  root.querySelectorAll('.js-rich:not([data-rich-init])').forEach(el => {
    const key = el.dataset.richKey;
    const html = el.dataset.richHtml || '';
    const single = el.dataset.richSingle === 'true';
    const placeholder = el.dataset.richPlaceholder || '';
    el.removeAttribute('data-rich-html');
    el.dataset.richInit = '1';
    makeRichEditor(el, key, html, { singleLine: single, placeholder });
  });
}

// Lê o HTML de um .js-rich pelo elemento (qualquer container/key)
function getRichHtml(el) {
  if (!el) return '';
  const k = el.dataset.richKey;
  const r = richInstances.get(k);
  return r ? r.getHtml() : '';
}

/* ===================== SAVE BAR + DIRTY STATE ===================== */
const dirty = { isDirty: false, count: 0, onSave: null, autoKey: null, isSaving: false };

// Debounce helper — pra auto-save não escrever no localStorage a cada keystroke.
// Tem .flush() pra forçar execução imediata (usado em beforeunload).
function debounce(fn, ms = 800) {
  let t = null;
  let pendingArgs = null;
  function debounced(...args) {
    pendingArgs = args;
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(this, pendingArgs); pendingArgs = null; }, ms);
  }
  debounced.flush = function () {
    if (t) { clearTimeout(t); t = null; if (pendingArgs) fn.apply(null, pendingArgs); pendingArgs = null; }
  };
  return debounced;
}

// Confirm modal-based (substitui window.confirm sincrono por modal acessível)
function confirmModal({ title = 'Confirmar', msg = '', confirmLabel = 'Confirmar', confirmKind = 'btn-primary', cancelLabel = 'Cancelar' } = {}) {
  return new Promise((resolve) => {
    showModal({
      icon: 'warn', title, msg,
      actions: [
        { label: confirmLabel, kind: confirmKind, onClick: () => resolve(true) },
        { label: cancelLabel, kind: 'btn-secondary', onClick: () => resolve(false) },
      ]
    });
  });
}

function setDirty(isDirty, count = 0) {
  dirty.isDirty = isDirty;
  dirty.count = count;
  const bar = document.getElementById('savebar');
  if (!bar) return;
  if (isDirty) {
    bar.classList.add('show');
    const status = bar.querySelector('.savebar-status');
    status.classList.remove('saving','saved');
    bar.querySelector('.savebar-msg').textContent = count > 0 ? `${count} alterações não salvas` : 'Você tem alterações não salvas';
  } else {
    bar.classList.remove('show');
  }
}

function setSaving(state) {
  dirty.isSaving = state === 'saving';
  const bar = document.getElementById('savebar');
  if (!bar) return;
  const status = bar.querySelector('.savebar-status');
  status.classList.remove('saving','saved');
  const saveBtn = bar.querySelector('#savebarSave');
  if (state === 'saving') {
    bar.classList.add('show');
    status.classList.add('saving');
    bar.querySelector('.savebar-msg').textContent = 'Salvando…';
    if (saveBtn) saveBtn.disabled = true;
  } else if (state === 'saved') {
    status.classList.add('saved');
    bar.querySelector('.savebar-msg').textContent = 'Tudo salvo';
    if (saveBtn) saveBtn.disabled = false;
    setTimeout(() => { if (!dirty.isDirty) bar.classList.remove('show'); }, 2000);
  }
}

function mountSaveBar(onSave, viewUrl) {
  // Remove se existir
  document.getElementById('savebar')?.remove();
  const bar = document.createElement('div');
  bar.id = 'savebar';
  bar.className = 'savebar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Barra de salvamento');
  bar.innerHTML = `
    <div class="savebar-status" aria-live="polite">
      <span class="dot" aria-hidden="true"></span>
      <span class="savebar-msg">Você tem alterações não salvas</span>
      <span class="hint">· Ctrl+S para salvar</span>
    </div>
    <div class="savebar-actions">
      ${viewUrl ? `<a href="${viewUrl}" target="_blank" class="btn btn-ghost">Ver no site ↗</a>` : ''}
      <button class="btn btn-secondary" id="savebarDiscard">Descartar</button>
      <button class="btn btn-primary" id="savebarSave">Salvar</button>
    </div>
  `;
  document.body.appendChild(bar);
  dirty.onSave = onSave;
  bar.querySelector('#savebarSave').addEventListener('click', () => {
    if (dirty.isSaving) return; // guard contra duplo-clique
    onSave();
  });
  bar.querySelector('#savebarDiscard').addEventListener('click', async () => {
    const ok = await confirmModal({
      title: 'Descartar alterações?',
      msg: 'Tudo que você editou desde o último Salvar vai ser perdido.',
      confirmLabel: 'Sim, descartar', confirmKind: 'btn-danger',
    });
    if (!ok) return;
    if (dirty.autoKey) try { localStorage.removeItem(dirty.autoKey); } catch(_) {}
    location.reload();
  });
}

function unmountSaveBar() {
  document.getElementById('savebar')?.remove();
  dirty.isDirty = false; dirty.count = 0; dirty.onSave = null; dirty.autoKey = null;
}

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    if (dirty.onSave && !dirty.isSaving) { e.preventDefault(); dirty.onSave(); }
  }
});
window.addEventListener('beforeunload', (e) => {
  // Force-flush do auto-save: localStorage é síncrono, então funciona em unload.
  try {
    if (typeof window.__hsa_flushDraft === 'function') window.__hsa_flushDraft();
  } catch (_) {}
  if (dirty.isDirty) { e.preventDefault(); e.returnValue = ''; }
});

/* ===================== MODAL ===================== */

// Mantém referência do listener atual pra poder remover no closeModal.
let _modalKeyListener = null;
function _closeAnyModal() {
  document.querySelector('.modal-bg')?.remove();
  if (_modalKeyListener) {
    document.removeEventListener('keydown', _modalKeyListener);
    _modalKeyListener = null;
  }
}
function showModal({ icon = 'success', title, msg, actions = [] }) {
  const prevFocus = document.activeElement;
  _closeAnyModal(); // limpa qualquer modal anterior + listener antigo
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.setAttribute('role', 'dialog');
  bg.setAttribute('aria-modal', 'true');
  bg.setAttribute('aria-labelledby', 'modalTitle');
  const iconSvg = icon === 'success'
    ? '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'
    : icon === 'warn'
    ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
    : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  bg.innerHTML = `
    <div class="modal-box">
      <div class="modal-icon ${icon}">${iconSvg}</div>
      <div class="modal-title" id="modalTitle">${escHtml(title)}</div>
      ${msg ? `<div class="modal-msg">${msg}</div>` : ''}
      <div class="modal-actions"></div>
    </div>
  `;
  const acts = bg.querySelector('.modal-actions');
  actions.forEach((a, i) => {
    if (a.href) {
      const link = document.createElement('a');
      link.href = a.href; link.target = a.target || '_self';
      link.className = `btn ${a.kind || (i === 0 ? 'btn-primary' : 'btn-secondary')}`;
      link.textContent = a.label;
      link.addEventListener('click', () => bg.remove());
      acts.appendChild(link);
    } else {
      const btn = document.createElement('button');
      btn.className = `btn ${a.kind || (i === 0 ? 'btn-primary' : 'btn-secondary')}`;
      btn.textContent = a.label;
      btn.addEventListener('click', () => { if (a.onClick) a.onClick(); bg.remove(); });
      acts.appendChild(btn);
    }
  });
  bg.addEventListener('click', (e) => { if (e.target === bg) closeModal(); });
  function closeModal() {
    bg.remove();
    if (_modalKeyListener === onKey) {
      document.removeEventListener('keydown', onKey);
      _modalKeyListener = null;
    }
    if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (_) {}
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key === 'Tab') {
      const f = bg.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  _modalKeyListener = onKey;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  // Foca o primeiro botão "primary" disponível
  const firstBtn = bg.querySelector('.btn-primary, .btn');
  if (firstBtn) firstBtn.focus();
}

/* ===================== QUICK TOUR ===================== */
const TOUR_STEPS = [
  {
    icon: 'home',
    title: 'Home',
    text: 'A página inicial é dividida em <strong>11 seções</strong> (topo, sobre, áreas, avaliações, etc.). Use as abas à esquerda pra navegar entre elas. Cada campo tem uma dica explicando pra que serve.',
  },
  {
    icon: 'pages',
    title: 'Páginas de áreas',
    text: 'As 12 páginas dedicadas (Trabalhista, INSS, Família…) também são editáveis: cada uma tem título, texto introdutório, lista de bullets e perguntas frequentes. Cliente cai direto nelas pelo Google.',
  },
  {
    icon: 'posts',
    title: 'Blog (artigos)',
    text: 'Escreva artigos sobre seus casos. Use uma linguagem simples — quem está te encontrando ainda não é cliente. Cada artigo bem escrito é uma porta de entrada pelo Google.',
  },
  {
    icon: 'image',
    title: 'Imagens',
    text: 'Pra subir foto, <strong>arraste o arquivo</strong> direto pra qualquer campo de imagem ou pra galeria. Funciona em qualquer lugar do painel. Aparece na hora.',
  },
  {
    icon: 'pen',
    title: 'Negrito e itálico',
    text: 'Em qualquer texto, <strong>selecione a palavra</strong> e clique no botão <b>B</b> (negrito) ou <i>I</i> (itálico). Funciona igual o Word. Atalhos: <strong>Ctrl+B</strong> / <strong>Ctrl+I</strong>.',
  },
  {
    icon: 'save',
    title: 'Salvar',
    text: 'Quando você editar algo, aparece uma <strong>barra dourada no rodapé</strong> dizendo "alterações não salvas". Clica em <strong>Salvar</strong> (ou Ctrl+S) e pronto. Em ~30 segundos a alteração está no ar.',
  },
];

function showQuickTour() {
  let step = 0;
  function render() {
    const s = TOUR_STEPS[step];
    document.querySelector('.modal-bg')?.remove();
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal-box" style="max-width:520px">
        <div class="modal-icon" style="background:var(--gold-faint);color:var(--gold-light)">${I[s.icon] || I.help}</div>
        <div style="text-align:center;font-family:'Inter Tight',sans-serif;font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:var(--gold);font-weight:500;margin-bottom:8px">Passo ${step+1} de ${TOUR_STEPS.length}</div>
        <div class="modal-title">${escHtml(s.title)}</div>
        <div class="modal-msg">${s.text}</div>
        <div class="modal-actions">
          ${step > 0 ? '<button class="btn btn-secondary" id="tourPrev">← Anterior</button>' : ''}
          ${step < TOUR_STEPS.length - 1 ? '<button class="btn btn-primary" id="tourNext">Próximo →</button>' : '<button class="btn btn-primary" id="tourDone">Entendi, vamos lá!</button>'}
        </div>
        <div style="display:flex;gap:6px;justify-content:center;margin-top:18px">
          ${TOUR_STEPS.map((_, i) => `<span style="width:${i===step?'24px':'8px'};height:6px;border-radius:3px;background:${i===step?'var(--gold)':'var(--gold-soft)'};transition:all .25s"></span>`).join('')}
        </div>
      </div>
    `;
    bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
    document.body.appendChild(bg);
    bg.querySelector('#tourPrev')?.addEventListener('click', () => { step--; render(); });
    bg.querySelector('#tourNext')?.addEventListener('click', () => { step++; render(); });
    bg.querySelector('#tourDone')?.addEventListener('click', () => {
      try { localStorage.setItem('hsa_tour_seen', '1'); } catch(_) {}
      bg.remove();
      $('#tourBanner')?.remove();
    });
  }
  render();
}

/* ===================== ICONS ===================== */
const I = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></svg>',
  pages: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  posts: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  cog: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2"/></svg>',
  star: '<svg viewBox="0 0 24 24"><polygon points="12 2 15 8.5 22 9.5 17 14.5 18 22 12 18.5 6 22 7 14.5 2 9.5 9 8.5 12 2"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><line x1="4" y1="22" x2="4" y2="15"/><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  contact: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  hero: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><polyline points="21 15 17 11 3 21"/></svg>',
  list: '<svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  burger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
  building: '<svg viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20"/><line x1="9" y1="6" x2="9" y2="6"/><line x1="15" y1="6" x2="15" y2="6"/><line x1="9" y1="10" x2="9" y2="10"/><line x1="15" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="15" y2="14"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
};

function mdSafeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^(javascript|data|vbscript|file|blob):/i.test(s.replace(/\s/g, ''))) return '';
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function mdInline(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      const safe = mdSafeUrl(src); return safe ? `<img src="${safe}" alt="${alt}"/>` : alt;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, href) => {
      const safe = mdSafeUrl(href); return safe ? `<a href="${safe}">${txt}</a>` : txt;
    })
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
  const item = (key, label, icon, href = `#/${key}`) =>
    `<a href="${href}" class="${active===key?'active':''}">${icon}<span>${label}</span></a>`;
  return `
    <div class="topbar" id="topbar">
      <div class="topbar-brand">
        <img src="/HenriqueSilva/assets/seal-hsa.png" alt="HSA" />
        <div class="topbar-brand-text">Henrique Silva<small>Advocacia · Admin</small></div>
      </div>
      <div class="topbar-nav">
        ${item('dashboard', 'Painel', I.cog, '#/dashboard')}
        ${item('site', 'Home', I.home, '#/site')}
        ${item('landings', 'Páginas', I.pages, '#/landings')}
        ${item('posts', 'Blog', I.posts, '#/posts')}
        ${item('imagens', 'Imagens', I.image, '#/imagens')}
        ${item('config', 'Configurações', I.cog, '#/config')}
        <a href="/HenriqueSilva/" target="_blank" rel="noopener">${I.ext}<span>Ver site</span></a>
      </div>
      <div class="topbar-actions">
        <button class="btn btn-ghost" id="btnHelp" title="Ver guia rápido" style="padding:8px 12px;color:var(--gold-light)">${I.help}</button>
        <span class="topbar-user">Online</span>
        <button class="topbar-logout" id="btnLogout">Sair</button>
        <button class="burger" id="btnBurger" aria-label="Menu">${I.burger}</button>
      </div>
    </div>
  `;
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest && e.target.closest('button');
  if (!t) return;
  if (t.id === 'btnLogout') {
    const ok = await confirmModal({
      title: 'Sair do painel?',
      msg: dirty.isDirty ? 'Atenção: você tem alterações não salvas que serão perdidas.' : '',
      confirmLabel: 'Sim, sair', confirmKind: dirty.isDirty ? 'btn-danger' : 'btn-primary',
    });
    if (!ok) return;
    await supa.auth.signOut();
    currentSession = null;
    location.hash = '#/login';
  }
  if (t.id === 'btnBurger') {
    document.getElementById('topbar')?.classList.toggle('menu-open');
  }
  if (t.id === 'btnHelp') {
    showQuickTour();
  }
});
// Fecha menu ao navegar
window.addEventListener('hashchange', () => {
  document.getElementById('topbar')?.classList.remove('menu-open');
});

/* ===================== DASHBOARD ===================== */

async function renderDashboard(app) {
  unmountSaveBar();
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  })();
  const tourSeen = localStorage.getItem('hsa_tour_seen') === '1';
  app.innerHTML = renderTopbar('dashboard') + `
    <div class="container">
      <div class="h1">${greeting}, <em>Dr. Henrique</em>.</div>
      <div class="h-sub">O que você gostaria de fazer hoje?</div>
      ${!tourSeen ? `
      <div class="card" id="tourBanner" style="margin-bottom:24px;display:flex;align-items:center;gap:18px;background:linear-gradient(135deg, rgba(212,175,55,.08), rgba(20,20,20,.95));border-color:var(--gold-soft)">
        <div style="width:48px;height:48px;border-radius:50%;background:var(--gold-faint);color:var(--gold);display:flex;align-items:center;justify-content:center;flex-shrink:0">${I.help}</div>
        <div style="flex:1">
          <div style="font-family:'Fraunces',serif;font-size:18px;color:var(--off-white);font-weight:400;margin-bottom:4px">Primeira vez por aqui?</div>
          <div style="font-family:'Fraunces',serif;font-style:italic;font-size:13.5px;color:var(--gray-300)">Veja um guia rápido de 30 segundos sobre como editar seu site.</div>
        </div>
        <button class="btn btn-primary" id="btnTour">Ver guia</button>
        <button class="btn btn-ghost" id="btnTourDismiss" title="Não mostrar mais" style="padding:8px 12px">×</button>
      </div>` : ''}
      <div class="dash-grid">
        <a class="dash-card" href="#/site">
          <div class="dash-icon">${I.home}</div>
          <div class="dash-num"><em>Home</em></div>
          <div class="dash-label">Página inicial</div>
          <div class="dash-sublabel">Texto, fotos, depoimentos</div>
        </a>
        <a class="dash-card" href="#/landings">
          <div class="dash-icon">${I.pages}</div>
          <div class="dash-num">12</div>
          <div class="dash-label">Páginas de áreas</div>
          <div class="dash-sublabel">Trabalhista, INSS, Família…</div>
        </a>
        <a class="dash-card" href="#/posts">
          <div class="dash-icon">${I.posts}</div>
          <div class="dash-num" id="dashTotal"><span class="skeleton" style="width:50px;height:32px;display:inline-block"></span></div>
          <div class="dash-label">Artigos do blog</div>
          <div class="dash-sublabel">Escreva sobre seus casos</div>
        </a>
        <a class="dash-card" href="#/imagens">
          <div class="dash-icon">${I.image}</div>
          <div class="dash-num" id="dashImages"><span class="skeleton" style="width:50px;height:32px;display:inline-block"></span></div>
          <div class="dash-label">Imagens enviadas</div>
          <div class="dash-sublabel">Fotos do escritório, capas</div>
        </a>
      </div>
      <div class="dash-sections">
        <div class="card">
          <h3 class="dash-section-title">Últimos artigos</h3>
          <div id="dashRecent">
            <div class="skeleton skel-row"></div>
            <div class="skeleton skel-row"></div>
            <div class="skeleton skel-row"></div>
          </div>
        </div>
        <div class="card">
          <h3 class="dash-section-title">Atalhos rápidos</h3>
          <div class="dash-shortcuts">
            <a class="btn btn-secondary" href="#/new">${I.plus} Escrever novo artigo</a>
            <a class="btn btn-secondary" href="#/site">${I.home} Editar Home</a>
            <a class="btn btn-secondary" href="#/imagens">${I.upload} Subir foto</a>
            <a class="btn btn-secondary" href="/HenriqueSilva/" target="_blank">${I.ext} Ver site público</a>
          </div>
        </div>
      </div>
    </div>
  `;
  // Carregar dados
  // Tour
  $('#btnTour')?.addEventListener('click', showQuickTour);
  $('#btnTourDismiss')?.addEventListener('click', () => {
    try { localStorage.setItem('hsa_tour_seen', '1'); } catch(_) {}
    $('#tourBanner')?.remove();
  });

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
      $('#dashRecent').innerHTML = `
        <div class="empty" style="padding:40px 20px">
          <div class="empty-icon">${I.posts}</div>
          <h3>Nenhum artigo ainda</h3>
          <p>Compartilhe seu conhecimento jurídico com seus futuros clientes.</p>
          <a href="#/new" class="btn btn-primary">${I.plus} Escrever primeiro artigo</a>
        </div>`;
    } else {
      $('#dashRecent').innerHTML = samplePosts.map(p => `
        <div class="dash-recent-row">
          <span class="when">${fmtDate(p.date||'')}</span>
          <span class="title">${escHtml(p.title||'')}</span>
          <a href="#/edit/${encodeURIComponent(p.fileBase)}">Editar</a>
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
      <div class="h-sub">Tudo o que aparece na página inicial do site — textos, fotos, depoimentos, perguntas frequentes. As alterações aparecem em segundos.</div>
      <div id="siteContainer">
        <div class="skeleton skel-card" style="height:480px"></div>
      </div>
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
      id: 'hero', title: 'Topo da página', icon: I.hero,
      hint: 'A primeira coisa que o visitante vê quando entra no site. Tem que dar vontade de continuar.',
      fields: [
        { key: 'tagline_quote', label: 'Frase principal', type: 'textarea', html: true,
          hint: 'Aparece em destaque, em itálico claro, sobre o vídeo. Use 1-2 linhas curtas. Selecione palavras pra deixar em negrito ou itálico dourado.' },
        { key: 'cta_primary_label', label: 'Texto do botão WhatsApp',
          hint: 'O botão dourado grande no topo. Curto e direto. Exemplo: "Análise Gratuita pelo WhatsApp".' },
        { key: 'video_src', label: 'Vídeo de fundo', type: 'image', accept: 'video/*',
          hint: 'Vídeo curto (5-15 segundos) que toca em loop atrás do texto. MP4 até 5 MB roda bem. Pode arrastar o arquivo aqui.' },
        { key: 'poster_src', label: 'Imagem que aparece antes do vídeo carregar', type: 'image',
          hint: 'Foto exibida nos primeiros segundos enquanto o vídeo carrega, e em conexões lentas. Use JPG bem leve.' },
        { key: 'seal_src', label: 'Selo / Logo do escritório', type: 'image',
          hint: 'Brasão dourado que aparece centralizado no topo. PNG com fundo transparente fica melhor.' },
      ],
    },
    {
      id: 'office', title: 'Sobre o Escritório', icon: I.building,
      hint: 'Apresentação institucional do escritório. Texto que ganha confiança do visitante.',
      fields: [
        { key: 'eyebrow', label: 'Texto pequeno acima do título',
          hint: 'Aparece em letras pequenas e maiúsculas, na cor dourada. Ex: "Sobre o escritório".' },
        { key: 'h2', label: 'Título da seção', type: 'text', html: true,
          hint: 'Título grande em serifa. Selecione uma palavra pra deixá-la em itálico dourado (botão I).' },
        { key: 'paragraphs', label: 'Parágrafos do texto', type: 'list', subtype: 'textarea', html: true,
          hint: '2 a 4 parágrafos curtos sobre o escritório. Selecione palavras-chave (anos de atuação, áreas, etc.) e deixe em negrito (B).' },
        { key: 'pillars', label: 'Três destaques numerados', type: 'pillars',
          hint: 'Linha com 3 destaques que aparecem em colunas. Cada um tem um número/título grande e uma descrição curta abaixo.' },
        { key: 'photo_src', label: 'Foto do escritório', type: 'image',
          hint: 'Foto da sala de espera, mesa de reunião ou fachada. Horizontal funciona melhor. Pode arrastar a foto aqui.' },
        { key: 'photo_stamp', label: 'Selo redondo dourado sobre a foto', type: 'text', html: true,
          hint: 'Texto bem curto (3-5 palavras) que aparece em um círculo dourado sobre a foto. Ex: "Atendo há mais de 14 anos".' },
      ],
    },
    {
      id: 'areas', title: 'Áreas de Atuação', icon: I.briefcase,
      hint: 'Os 10 cards de áreas do direito que você atua. Os 2 primeiros aparecem maiores (em destaque).',
      fields: [
        { key: 'eyebrow', label: 'Texto pequeno acima do título',
          hint: 'Pré-título da seção. Ex: "Áreas de Atuação".' },
        { key: 'h2', label: 'Título da seção', html: true,
          hint: 'Título grande sobre os cards. Pode usar negrito/itálico nas palavras importantes.' },
        { key: 'sub', label: 'Subtítulo',
          hint: 'Frase curta de explicação abaixo do título principal.' },
        { key: 'items', label: 'Os 10 cards das áreas', type: 'areas',
          hint: 'Cada card vira uma página dedicada (Trabalhista, Família, INSS, etc.). Os 2 primeiros são maiores. Pra editar o conteúdo da página completa, use o menu "Páginas".' },
      ],
    },
    {
      id: 'reviews', title: 'Avaliações Google', icon: I.star,
      hint: 'Depoimentos reais dos seus clientes. Aumenta MUITO a confiança de quem nunca te conheceu.',
      fields: [
        { key: 'rating_num', label: 'Nota geral',
          hint: 'A média das suas avaliações. Ex: "5,0" ou "4,9". Aparece grande no banner.' },
        { key: 'meta_html', label: 'Texto do banner', html: true,
          hint: 'Frase do banner ao lado da nota. Ex: "Excelente · com base em <b>16 avaliações</b> no Google".' },
        { key: 'items', label: 'Lista de avaliações', type: 'reviews',
          hint: 'Copie e cole as avaliações reais que você recebeu (do Google, Instagram, etc). Mantenha o texto original do cliente.' },
        { key: 'cta_label', label: 'Texto do botão "ver todas"',
          hint: 'Botão abaixo das avaliações. Ex: "Ver todas as avaliações no Google".' },
        { key: 'cta_href', label: 'Link do botão',
          hint: 'URL completa pra onde o botão leva. Geralmente o link do seu perfil no Google Maps.' },
      ],
    },
    {
      id: 'about', title: 'Quem Sou', icon: I.user,
      hint: 'Sua apresentação pessoal — onde o cliente vê você como pessoa, não só como escritório.',
      fields: [
        { key: 'eyebrow', label: 'Texto pequeno acima do título',
          hint: 'Pré-título da seção. Ex: "Quem Sou".' },
        { key: 'h2', label: 'Título com seu nome', html: true,
          hint: 'Inclua seu nome completo. Ex: "Dr. José Henrique da Silva, advogado".' },
        { key: 'lead', label: 'Citação em destaque', type: 'textarea',
          hint: 'Frase de impacto sobre sua filosofia ou abordagem. Aparece em letras maiores, em itálico. 1-2 linhas.' },
        { key: 'paragraphs', label: 'Sua bio (parágrafos)', type: 'list', subtype: 'textarea', html: true,
          hint: 'Conte sua história. OAB, anos de atuação, áreas, valores. Seja humano e direto. Selecione palavras importantes pra deixar em negrito.' },
        { key: 'credentials', label: 'Três credenciais em destaque', type: 'credentials',
          hint: 'Três números/sigilas que aparecem em colunas. Ex: "14+" / "Anos de Atuação". Use seus números reais.' },
        { key: 'portrait_src', label: 'Sua foto profissional', type: 'image',
          hint: 'Foto sua olhando pra câmera, fundo neutro. Vertical (retrato) funciona melhor que horizontal.' },
        { key: 'portrait_plaque', label: 'Plaqueta abaixo da foto',
          hint: 'Texto da plaqueta dourada sob a foto. Ex: "Dr. Henrique Silva · OAB/PE 31.742".' },
      ],
    },
    {
      id: 'latest', title: 'Últimos Artigos', icon: I.posts,
      hint: 'Cabeçalho da seção que mostra os 3 artigos mais recentes do seu blog.',
      fields: [
        { key: 'eyebrow', label: 'Texto pequeno acima do título',
          hint: 'Pré-título da seção. Ex: "Blog · Henrique Silva".' },
        { key: 'h2', label: 'Título da seção', html: true,
          hint: 'Ex: "Últimos artigos".' },
        { key: 'sub', label: 'Subtítulo',
          hint: 'Frase curta de explicação. Ex: "Direito Trabalhista, Previdenciário e mais — explicados de forma direta".' },
        { key: 'cta_label', label: 'Texto do botão "ver todos"',
          hint: 'Botão dourado abaixo dos 3 cards. Ex: "Ver todos os artigos".' },
      ],
    },
    {
      id: 'faq', title: 'Perguntas Frequentes', icon: I.help,
      hint: 'Lista das dúvidas mais comuns dos seus clientes. Reduz mensagens repetitivas no WhatsApp.',
      fields: [
        { key: 'eyebrow', label: 'Texto pequeno acima do título',
          hint: 'Pré-título da seção.' },
        { key: 'h2', label: 'Título da seção', html: true,
          hint: 'Ex: "As perguntas que sempre recebo".' },
        { key: 'sub', label: 'Subtítulo', html: true,
          hint: 'Frase de boas-vindas. Pode mencionar o WhatsApp pra dúvidas que não estão na lista.' },
        { key: 'search_placeholder', label: 'Texto dentro da caixa de busca',
          hint: 'Aparece em cinza dentro do campo de busca. Ex: "Procurar por palavra-chave...".' },
        { key: 'items', label: 'Perguntas e respostas', type: 'faq',
          hint: 'Suas perguntas reais. Quanto mais perguntas e respostas claras, melhor. Pode usar negrito e links nas respostas.' },
      ],
    },
    {
      id: 'contact_cta', title: 'Bloco de Contato', icon: I.contact,
      hint: 'Última seção da página, com formulário de contato. Última chance de converter o visitante.',
      fields: [
        { key: 'h2', label: 'Chamada principal', html: true,
          hint: 'Frase de impacto. Ex: "Receba a ligação de um especialista".' },
        { key: 'sub', label: 'Frase de apoio',
          hint: 'Linha explicativa abaixo da chamada. Ex: "Preencha o formulário que entraremos em contato".' },
        { key: 'form', label: 'Textos do formulário', type: 'contact_form',
          hint: 'Apenas os rótulos dos campos do formulário. Os dados do visitante caem direto no seu e-mail.' },
        { key: 'bg_src', label: 'Foto de fundo da seção', type: 'image',
          hint: 'Foto que serve de fundo (com escurecimento automático). Reunião, escritório, mesa com documentos funcionam bem.' },
      ],
    },
    {
      id: 'footer', title: 'Rodapé', icon: I.flag,
      hint: 'O rodapé aparece em todas as páginas do site (home, blog, áreas).',
      fields: [
        { key: 'tag', label: 'Descrição do escritório', type: 'textarea',
          hint: 'Resumo curto que aparece no rodapé. 1-2 linhas. Áreas principais e diferenciais.' },
        { key: 'address_lines', label: 'Endereço (uma linha por vez)', type: 'list', subtype: 'text',
          hint: 'Quebre o endereço em várias linhas curtas (condomínio, sala, rua, bairro, cidade/UF, CEP). Cliente pode parar a leitura em qualquer linha.' },
        { key: 'copyright', label: 'Copyright',
          hint: 'Texto pequeno no fim do rodapé. Atualize o ano todo dia 1º de janeiro.' },
      ],
    },
    {
      id: 'wa_fab', title: 'Botão flutuante WhatsApp', icon: I.contact,
      hint: 'O botão verde redondo que fica fixo no canto inferior direito de todas as páginas.',
      fields: [
        { key: 'label', label: 'Texto que aparece ao passar o mouse',
          hint: 'Aparece em uma plaquinha quando o visitante passa o mouse no botão. Ex: "Falar agora".' },
      ],
    },
  ];

  const hintHtml = (h) => h ? `<div class="field-help">${h}</div>` : '';
  const renderFieldHtml = (sectionId, field, value) => {
    const id = `f-${sectionId}-${field.key}`;
    if (field.type === 'image') {
      const isVideo = (field.accept || '').includes('video');
      const hasValue = value && value.trim();
      return `
        <div class="field">
          <label>${field.label}</label>
          <div class="img-picker" data-section="${sectionId}" data-key="${field.key}" data-isvideo="${isVideo}">
            ${hasValue && !isVideo ? `<img class="img-preview" src="${previewUrl(value)}" alt="" onerror="this.style.display='none'" />` : `<div class="img-picker-empty">${I.image}</div>`}
            <div class="img-picker-body">
              <input type="text" id="${id}" value="${escAttr(value)}" placeholder="${isVideo ? 'assets/hero-video.mp4' : 'assets/foto.jpg'}" />
              <div class="img-picker-actions">
                <button type="button" class="btn btn-secondary btn-pickimg" data-target="${id}" data-isvideo="${isVideo}">${I.upload} Enviar arquivo</button>
                <span class="drop-hint">…ou arraste pra cá</span>
              </div>
            </div>
          </div>
          ${hintHtml(field.hint)}
        </div>`;
    }
    if (field.html && (field.type === 'textarea' || field.type === 'text' || !field.type)) {
      // WYSIWYG (negrito/itálico via botões, sem HTML cru)
      const richKey = `site.${sectionId}.${field.key}`;
      const single = field.type === 'text';
      return `<div class="field"><label>${field.label}</label><div class="js-rich" data-rich-key="${richKey}" data-rich-html="${escAttr(value || '')}" data-rich-single="${single}"></div>${hintHtml(field.hint)}</div>`;
    }
    if (field.type === 'textarea') {
      return `<div class="field"><label>${field.label}</label><textarea id="${id}" rows="3">${escHtml(value || '')}</textarea>${hintHtml(field.hint)}</div>`;
    }
    if (field.type === 'list') {
      const items = Array.isArray(value) ? value : [];
      const useRich = field.html;
      const richKeyBase = `site.${sectionId}.${field.key}`;
      return `
        <div class="field" data-list-field="${sectionId}.${field.key}" data-rich-list="${useRich}" data-rich-base="${richKeyBase}">
          <label>${field.label}</label>
          ${hintHtml(field.hint)}
          <div class="list-items" data-key="${field.key}">
            ${items.map((v, i) => useRich
              ? `<div class="list-item" data-idx="${i}"><div class="js-rich" style="flex:1" data-rich-key="${richKeyBase}.${i}" data-rich-html="${escAttr(v)}"></div><button type="button" class="btn btn-danger btn-rmitem">×</button></div>`
              : `<div class="list-item" data-idx="${i}"><textarea rows="2" data-listval>${escHtml(v)}</textarea><button type="button" class="btn btn-danger btn-rmitem">×</button></div>`
            ).join('')}
          </div>
          <button type="button" class="btn btn-secondary btn-additem" data-section="${sectionId}" data-key="${field.key}" data-rich="${useRich}">${I.plus} Adicionar</button>
        </div>`;
    }
    if (field.type === 'pillars') {
      const items = Array.isArray(value) ? value : [];
      return `
        <div class="field" data-pillars="${sectionId}.${field.key}">
          <label>${field.label}</label>
          ${hintHtml(field.hint)}
          <div class="pillars-list">
            ${items.map((p, i) => `
              <div class="card-mini" data-idx="${i}">
                <div class="field-row">
                  <div class="field"><label>Título / número</label><input data-pkey="num" value="${escAttr(p.num)}" /><div class="field-help">Texto curto destacado. Ex: "14 anos" ou "10 áreas".</div></div>
                  <div class="field"><label>Descrição abaixo</label><input data-pkey="label" value="${escAttr(p.label)}" /><div class="field-help">Frase que explica o número. Ex: "Atuação multidisciplinar desde 2010".</div></div>
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
          ${hintHtml(field.hint)}
          <div class="credentials-list">
            ${items.map((p, i) => `
              <div class="card-mini" data-idx="${i}">
                <div class="field-row">
                  <div class="field"><label>Número / sigla</label><input data-pkey="num" value="${escAttr(p.num)}" /><div class="field-help">Texto destacado em dourado. Ex: "14+", "10", "PE".</div></div>
                  <div class="field"><label>Rótulo abaixo</label><input data-pkey="label" value="${escAttr(p.label)}" /><div class="field-help">Explicação curta. Ex: "Anos de Atuação", "Áreas do Direito", "OAB 31.742".</div></div>
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
          ${hintHtml(field.hint)}
          <div class="areas-list">
            ${items.map((a, i) => `
              <details class="card-mini" data-idx="${i}" ${i < 2 ? 'open' : ''}>
                <summary><strong>${escHtml(a.label || a.slug)}</strong> ${a.featured ? '<span style="color:var(--gold);font-size:10px;letter-spacing:.18em">DESTAQUE</span>' : ''}</summary>
                <div class="field"><label>Nome curto da área</label><input data-akey="label" value="${escAttr(a.label)}" /><div class="field-help">Aparece como rótulo do card. Ex: "Trabalhista".</div></div>
                <div class="field"><label>Título do card</label><div class="js-rich" data-rich-key="site.areas.${i}.h3" data-rich-html="${escAttr(a.h3)}" data-rich-single="true"></div><div class="field-help">Título maior dentro do card. Pode usar itálico em uma palavra.</div></div>
                <div class="field"><label>Descrição</label><textarea data-akey="description" rows="2">${escHtml(a.description)}</textarea><div class="field-help">Frase de 1-2 linhas explicando o que você atende nessa área.</div></div>
                <div class="field"><label>Imagem do card</label>
                  <div class="img-picker">
                    ${a.image ? `<img class="img-preview" src="${previewUrl(a.image)}" alt="" onerror="this.style.display='none'" />` : `<div class="img-picker-empty">${I.image}</div>`}
                    <div class="img-picker-body">
                      <input type="text" data-akey="image" value="${escAttr(a.image)}" />
                      <div class="img-picker-actions">
                        <button type="button" class="btn btn-secondary btn-pickimg-area" data-idx="${i}">${I.upload} Trocar</button>
                        <span class="drop-hint">…ou arraste</span>
                      </div>
                    </div>
                  </div>
                  <div class="field-help">Foto temática da área (escura/séria funciona bem). Aparece como fundo do card.</div>
                </div>
                ${a.featured ? `<div class="field"><label>Tags (separadas por vírgula)</label><input data-akey="tags" value="${escAttr((a.tags||[]).join(', '))}" /><div class="field-help">Aparecem só nos 2 cards em destaque, como pequenas etiquetas. Ex: "Execuções, Rescisões, Horas extras".</div></div>` : ''}
                <input type="hidden" data-akey="slug" value="${escAttr(a.slug)}" />
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
          ${hintHtml(field.hint)}
          <div class="reviews-list">
            ${items.map((r, i) => `
              <details class="card-mini" data-idx="${i}">
                <summary><strong>${escHtml(r.name)}</strong> · ${escHtml(r.stars)}</summary>
                <div class="field-row">
                  <div class="field"><label>Nome do cliente</label><input data-rkey="name" value="${escAttr(r.name)}" /><div class="field-help">Nome como aparece no Google ou rede social.</div></div>
                  <div class="field"><label>Data / origem</label><input data-rkey="date" value="${escAttr(r.date)}" /><div class="field-help">Ex: "há 1 mês · Google".</div></div>
                </div>
                <div class="field"><label>Estrelas</label><input data-rkey="stars" value="${escAttr(r.stars)}" /><div class="field-help">Cole 5 estrelas pretas: ★★★★★. Pra notas menores, troque algumas por ☆.</div></div>
                <div class="field"><label>Texto da avaliação</label><textarea data-rkey="quote" rows="2">${escHtml(r.quote)}</textarea><div class="field-help">Texto do cliente. Mantenha exatamente como ele escreveu.</div></div>
                <button type="button" class="btn btn-danger btn-rmrev" data-idx="${i}">Remover avaliação</button>
              </details>
            `).join('')}
          </div>
          <button type="button" class="btn btn-secondary btn-addrev">${I.plus} Adicionar avaliação</button>
        </div>`;
    }
    if (field.type === 'faq') {
      const items = Array.isArray(value) ? value : [];
      return `
        <div class="field" data-faq="${sectionId}.${field.key}">
          <label>${field.label}</label>
          ${hintHtml(field.hint)}
          <div class="faq-list">
            ${items.map((q, i) => `
              <details class="card-mini" data-idx="${i}">
                <summary><strong>${escHtml((q.q||'').slice(0, 60))}</strong></summary>
                <div class="field"><label>Pergunta</label><input data-qkey="q" value="${escAttr(q.q)}" /><div class="field-help">Pergunta exata como o cliente faria. Ex: "Quanto custa contratar?"</div></div>
                <div class="field"><label>Resposta</label><div class="js-rich" data-rich-key="site.faq.${i}.a" data-rich-html="${escAttr(q.a)}"></div><div class="field-help">Resposta clara e direta. Selecione palavras-chave pra deixar em negrito.</div></div>
                <button type="button" class="btn btn-danger btn-rmfaq" data-idx="${i}">Remover</button>
              </details>
            `).join('')}
          </div>
          <button type="button" class="btn btn-secondary btn-addfaq">${I.plus} Adicionar pergunta</button>
        </div>`;
    }
    if (field.type === 'contact_form') {
      const v = value || {};
      return `
        <div class="field" data-form="${sectionId}.${field.key}">
          <label>${field.label}</label>
          ${hintHtml(field.hint)}
          <div class="card-mini">
            <div class="field-row">
              <div class="field"><label>Rótulo do campo "Nome"</label><input data-fkey="name_label" value="${escAttr(v.name_label)}" /></div>
              <div class="field"><label>Rótulo do campo "Telefone"</label><input data-fkey="phone_label" value="${escAttr(v.phone_label)}" /></div>
            </div>
            <div class="field"><label>Rótulo do campo "Mensagem"</label><input data-fkey="message_label" value="${escAttr(v.message_label)}" /></div>
            <div class="field"><label>Texto do botão "Enviar"</label><input data-fkey="submit_label" value="${escAttr(v.submit_label)}" /></div>
            <div class="field"><label>Aviso pequeno abaixo do botão</label><textarea data-fkey="disclaimer" rows="2">${escHtml(v.disclaimer)}</textarea><div class="field-help">Linha discreta que aparece sob o botão. Ex: "Resposta em até 2h úteis".</div></div>
          </div>
        </div>`;
    }
    return `<div class="field"><label>${field.label}</label><input id="${id}" value="${escAttr(value)}" />${hintHtml(field.hint)}</div>`;
  };

  // Tabs (esquerda) + content (direita)
  const tabsHtml = sections.map((sec, i) => `
    <button data-tab="${sec.id}" class="${i === 0 ? 'active' : ''}">
      <span class="tab-icon">${sec.icon}</span>
      <span>${sec.title}</span>
    </button>
  `).join('');
  const panelsHtml = sections.map((sec, i) => `
    <div class="card editor-section" data-section="${sec.id}" style="${i === 0 ? '' : 'display:none'}">
      <h3 style="font-family:'Fraunces',serif;font-size:24px;color:var(--off-white);font-weight:300;margin:0 0 4px;letter-spacing:-.012em">${sec.title}</h3>
      <p style="font-family:'Fraunces',serif;font-style:italic;font-size:14px;color:var(--gray-500);margin:0 0 24px">${sec.hint || ''}</p>
      ${sec.fields.map(f => renderFieldHtml(sec.id, f, (cfg[sec.id]||{})[f.key])).join('')}
    </div>
  `).join('');

  clearRichInstances();
  $('#siteContainer').innerHTML = `
    <div class="tabs-shell">
      <div class="tabs-list" id="siteTabs">${tabsHtml}</div>
      <div class="tabs-content" id="siteTabsContent">${panelsHtml}</div>
    </div>
    <input type="file" id="picker-file" accept="image/*,video/*" style="display:none" />
  `;
  initRichEditors($('#siteTabsContent'));

  // Switch tabs
  $('#siteTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    $$('#siteTabs button').forEach(b => b.classList.toggle('active', b === btn));
    const id = btn.dataset.tab;
    $$('#siteTabsContent .editor-section').forEach(p => p.style.display = p.dataset.section === id ? '' : 'none');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Coleta o cfg novo a partir do DOM
  function collectCfg() {
    const newCfg = JSON.parse(JSON.stringify(cfg));
    sections.forEach(sec => {
      newCfg[sec.id] = newCfg[sec.id] || {};
      const root = document.querySelector(`.editor-section[data-section="${sec.id}"]`);
      if (!root) return;
      sec.fields.forEach(f => {
        const id = `f-${sec.id}-${f.key}`;
        if (f.type === 'list') {
          const list = root.querySelector(`.list-items[data-key="${f.key}"]`);
          if (!list) return;
          const arr = Array.from(list.children).map(li => {
            const rich = li.querySelector('.js-rich');
            if (rich) return getRichHtml(rich);
            const ta = li.querySelector('[data-listval]');
            return ta ? ta.value : '';
          });
          newCfg[sec.id][f.key] = arr.filter(s => s.trim());
        } else if (f.type === 'pillars' || f.type === 'credentials') {
          const arr = $$(`[data-${f.type}="${sec.id}.${f.key}"] .card-mini`, root).map(card => {
            const o = {};
            card.querySelectorAll('[data-pkey]').forEach(inp => { o[inp.dataset.pkey] = inp.value; });
            return o;
          });
          newCfg[sec.id][f.key] = arr;
        } else if (f.type === 'areas') {
          const arr = $$(`[data-areas="${sec.id}.${f.key}"] details.card-mini`, root).map(card => {
            const o = {};
            card.querySelectorAll('[data-akey]').forEach(inp => {
              if (inp.dataset.akey === 'tags') o.tags = inp.value.split(',').map(t => t.trim()).filter(Boolean);
              else o[inp.dataset.akey] = inp.value;
            });
            const h3Rich = card.querySelector('.js-rich');
            if (h3Rich) o.h3 = getRichHtml(h3Rich);
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
          const arr = $$(`[data-reviews="${sec.id}.${f.key}"] details.card-mini`, root).map(card => {
            const o = {};
            card.querySelectorAll('[data-rkey]').forEach(inp => { o[inp.dataset.rkey] = inp.value; });
            return o;
          });
          newCfg[sec.id][f.key] = arr;
        } else if (f.type === 'faq') {
          const arr = $$(`[data-faq="${sec.id}.${f.key}"] details.card-mini`, root).map(card => {
            const o = {};
            card.querySelectorAll('[data-qkey]').forEach(inp => { o[inp.dataset.qkey] = inp.value; });
            const aRich = card.querySelector('.js-rich');
            if (aRich) o.a = getRichHtml(aRich);
            return o;
          });
          newCfg[sec.id][f.key] = arr;
        } else if (f.type === 'contact_form') {
          const o = {};
          $$(`[data-form="${sec.id}.${f.key}"] [data-fkey]`, root).forEach(inp => { o[inp.dataset.fkey] = inp.value; });
          newCfg[sec.id][f.key] = o;
        } else if (f.html && (f.type === 'textarea' || f.type === 'text' || !f.type)) {
          const richEl = root.querySelector(`.js-rich[data-rich-key="site.${sec.id}.${f.key}"]`);
          if (richEl) newCfg[sec.id][f.key] = getRichHtml(richEl);
        } else {
          const el = document.getElementById(id);
          if (el) newCfg[sec.id][f.key] = el.value;
        }
      });
    });
    return newCfg;
  }

  // === Add/remove handlers
  $('#siteTabsContent').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.classList.contains('btn-additem')) {
      const fieldEl = t.closest('[data-list-field]');
      const isRich = fieldEl && fieldEl.dataset.richList === 'true';
      const list = fieldEl.querySelector('.list-items');
      const item = document.createElement('div');
      item.className = 'list-item';
      const idx = list.children.length;
      if (isRich) {
        const base = fieldEl.dataset.richBase;
        item.innerHTML = `<div class="js-rich" style="flex:1" data-rich-key="${base}.add${Date.now()}-${idx}" data-rich-html=""></div><button type="button" class="btn btn-danger btn-rmitem">×</button>`;
      } else {
        item.innerHTML = `<textarea rows="2" data-listval></textarea><button type="button" class="btn btn-danger btn-rmitem">×</button>`;
      }
      list.appendChild(item);
      initRichEditors(item);
      markDirty();
    }
    if (t.classList.contains('btn-rmitem')) { t.parentElement.remove(); markDirty(); }
    if (t.classList.contains('btn-rmrev') || t.classList.contains('btn-rmfaq')) { t.closest('details').remove(); markDirty(); }
    if (t.classList.contains('btn-addrev')) {
      const list = t.parentElement.querySelector('.reviews-list');
      const d = document.createElement('details');
      d.className = 'card-mini'; d.open = true;
      d.innerHTML = `<summary><strong>Nova avaliação</strong></summary>
        <div class="field-row"><div class="field"><label>Nome</label><input data-rkey="name" /></div><div class="field"><label>Data/origem</label><input data-rkey="date" value="há 1 dia · Google" /></div></div>
        <div class="field"><label>Estrelas</label><input data-rkey="stars" value="★★★★★" /></div>
        <div class="field"><label>Texto da avaliação</label><textarea data-rkey="quote" rows="2"></textarea></div>
        <button type="button" class="btn btn-danger btn-rmrev">Remover avaliação</button>`;
      list.appendChild(d);
      markDirty();
    }
    if (t.classList.contains('btn-addfaq')) {
      const list = t.parentElement.querySelector('.faq-list');
      const d = document.createElement('details');
      d.className = 'card-mini'; d.open = true;
      const newKey = `site.faq.add${Date.now()}-${list.children.length}.a`;
      d.innerHTML = `<summary><strong>Nova pergunta</strong></summary>
        <div class="field"><label>Pergunta</label><input data-qkey="q" /></div>
        <div class="field"><label>Resposta</label><div class="js-rich" data-rich-key="${newKey}" data-rich-html=""></div></div>
        <button type="button" class="btn btn-danger btn-rmfaq">Remover</button>`;
      list.appendChild(d);
      initRichEditors(d);
      markDirty();
    }
  });

  // === Image upload (botão Trocar OU drag-drop)
  let pickerTarget = null;
  async function uploadFileToInput(file, targetInput, isVideo = false) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast('Arquivo muito grande (>25MB)', 'error'); return; }
    try {
      toast('Enviando…');
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      const b64 = btoa(bin);
      const ext = file.name.split('.').pop().toLowerCase();
      const safeName = slugify(file.name.replace(/\.[^.]+$/, '')) + '-' + Date.now().toString(36) + '.' + ext;
      const folder = isVideo || file.type.startsWith('video/') ? REPO_PATHS.SITE_ASSETS : REPO_PATHS.SITE_ASSETS;
      const path = `${folder}/${safeName}`;
      await putBinaryFile(path, b64, `Upload: ${safeName}`);
      targetInput.value = path;
      const picker = targetInput.closest('.img-picker');
      if (picker) {
        const empty = picker.querySelector('.img-picker-empty');
        if (empty) {
          const img = document.createElement('img');
          img.className = 'img-preview';
          img.src = previewUrl(path);
          empty.replaceWith(img);
        } else {
          const prev = picker.querySelector('.img-preview');
          if (prev) prev.src = previewUrl(path);
        }
      }
      toast('Imagem enviada ✓');
      markDirty();
    } catch (err) { toast(err.message, 'error'); }
  }

  $('#siteTabsContent').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.classList.contains('btn-pickimg')) {
      const inp = document.getElementById(t.dataset.target);
      pickerTarget = { input: inp, isVideo: t.dataset.isvideo === 'true' };
      const fp = $('#picker-file');
      fp.accept = pickerTarget.isVideo ? 'video/*' : 'image/*';
      fp.click();
    }
  });
  $('#picker-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !pickerTarget) return;
    await uploadFileToInput(file, pickerTarget.input, pickerTarget.isVideo);
    pickerTarget = null;
  });

  // === Drag-and-drop em img-pickers
  $('#siteTabsContent').addEventListener('dragenter', (e) => {
    const picker = e.target.closest('.img-picker');
    if (picker) { e.preventDefault(); picker.classList.add('dragging'); }
  });
  $('#siteTabsContent').addEventListener('dragover', (e) => {
    const picker = e.target.closest('.img-picker');
    if (picker) { e.preventDefault(); }
  });
  $('#siteTabsContent').addEventListener('dragleave', (e) => {
    const picker = e.target.closest('.img-picker');
    if (picker && !picker.contains(e.relatedTarget)) picker.classList.remove('dragging');
  });
  $('#siteTabsContent').addEventListener('drop', async (e) => {
    const picker = e.target.closest('.img-picker');
    if (!picker) return;
    e.preventDefault();
    picker.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    const inp = picker.querySelector('input[type="text"]');
    const isVideo = picker.dataset.isvideo === 'true' || (file && file.type.startsWith('video/'));
    if (file && inp) await uploadFileToInput(file, inp, isVideo);
  });

  // === Dirty tracking
  const saveDraft = debounce(() => {
    if (!dirty.autoKey) return;
    try { localStorage.setItem(dirty.autoKey, JSON.stringify(collectCfg())); }
    catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        toast('Armazenamento local cheio — limpe rascunhos antigos', 'error');
      }
    }
  }, 600);
  window.__hsa_flushDraft = saveDraft.flush;
  function markDirty() { setDirty(true); saveDraft(); }
  // Apenas 'input' (change é redundante em browsers modernos pra inputs/textareas)
  $('#siteTabsContent').addEventListener('input', markDirty);

  // === Save
  async function doSave() {
    const newCfg = collectCfg();
    setSaving('saving');
    try {
      await putJsonFile(REPO_PATHS.SITE_CONTENT, newCfg, sha, 'admin: atualizar Home');
      try { localStorage.removeItem(dirty.autoKey); } catch(_) {}
      setDirty(false);
      setSaving('saved');
      showModal({
        icon: 'success',
        title: 'Salvo com sucesso',
        msg: 'Suas alterações já estão no ar. Pode abrir o site público pra conferir.',
        actions: [
          { label: 'Ver no site', href: '/HenriqueSilva/', target: '_blank', kind: 'btn-primary' },
          { label: 'Continuar editando', kind: 'btn-secondary' },
        ]
      });
    } catch (e) {
      setSaving('saved'); setDirty(true);
      if (e.status === 409) {
        showModal({
          icon: 'warn',
          title: 'Conflito de edição',
          msg: 'Outra aba (ou outra pessoa) editou e salvou a Home antes de você. Pra não sobrescrever, recarregue e refaça suas alterações.',
          actions: [
            { label: 'Recarregar', kind: 'btn-primary', onClick: () => location.reload() },
            { label: 'Continuar editando', kind: 'btn-secondary' },
          ]
        });
      } else {
        toast(e.message, 'error');
      }
    }
  }

  // === Auto-save local + restore
  dirty.autoKey = `hsa_draft_site_${currentSession?.user?.id || 'anon'}`;
  try {
    const draft = localStorage.getItem(dirty.autoKey);
    if (draft) {
      const draftCfg = JSON.parse(draft);
      if (JSON.stringify(draftCfg) !== JSON.stringify(cfg)) {
        showModal({
          icon: 'warn', title: 'Rascunho recuperado',
          msg: 'Você tinha alterações não salvas. Deseja recuperá-las?',
          actions: [
            { label: 'Recuperar rascunho', kind: 'btn-primary', onClick: () => {
              Object.assign(cfg, draftCfg);
              renderSiteEditor(app);
            }},
            { label: 'Descartar', kind: 'btn-secondary', onClick: () => {
              try { localStorage.removeItem(dirty.autoKey); } catch(_) {}
            }},
          ]
        });
      }
    }
  } catch(_) {}

  mountSaveBar(doSave, '/HenriqueSilva/');
}

/* ===================== LANDINGS LIST ===================== */

async function renderLandings(app) {
  unmountSaveBar();
  app.innerHTML = renderTopbar('landings') + `
    <div class="container">
      <div class="h1">Páginas <em>de áreas</em></div>
      <div class="h-sub">12 páginas dedicadas: 10 áreas do direito + Sobre + Contato. Cada uma tem seu próprio título, texto, depoimentos e FAQ.</div>
      <div id="landingsContainer">
        <div class="landing-grid">
          ${Array(12).fill(0).map(() => '<div class="skeleton skel-card"></div>').join('')}
        </div>
      </div>
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
  $('#landingsContainer').innerHTML = `<div class="landing-grid">${cards}</div>`;
}

/* ===================== LANDING EDITOR ===================== */

async function renderLandingEditor(app, slug) {
  if (!LANDING_SLUGS.includes(slug)) { location.hash = '#/landings'; return; }
  app.innerHTML = renderTopbar('landings') + `
    <div class="container">
      <div class="h1">Editar <em>${LANDING_LABELS[slug]}</em></div>
      <div class="h-sub">Página /${slug}/ · todos os textos são editáveis. Após salvar, o site é regenerado automaticamente em ~30 segundos.</div>
      <div id="landingContainer"><div class="skeleton skel-card" style="height:480px"></div></div>
    </div>
  `;
  let file;
  try { file = await getJsonFile(REPO_PATHS.LANDINGS_CONTENT); }
  catch (e) { $('#landingContainer').innerHTML = `<p style="color:var(--danger)">${e.message}</p>`; return; }
  const all = file.content;
  const sha = file.sha;
  const l = all[slug] || {};

  const tabs = [
    { id: 'topo', label: 'Topo + SEO', icon: I.hero },
    { id: 'intro', label: 'Introdução', icon: I.list },
    { id: 'bullets', label: 'Bullets', icon: I.briefcase },
    { id: 'faq', label: 'Perguntas', icon: I.help },
  ];

  clearRichInstances();
  $('#landingContainer').innerHTML = `
    <div class="tabs-shell">
      <div class="tabs-list" id="lTabs">
        ${tabs.map((t, i) => `<button data-tab="${t.id}" class="${i===0?'active':''}"><span class="tab-icon">${t.icon}</span><span>${t.label}</span></button>`).join('')}
      </div>
      <div class="tabs-content" id="lTabsContent">

        <div class="card editor-section" data-section="topo">
          <h3 style="font-family:'Fraunces',serif;font-size:24px;color:var(--off-white);font-weight:300;margin:0 0 4px">Topo da página + SEO</h3>
          <p style="font-family:'Fraunces',serif;font-style:italic;font-size:14px;color:var(--gray-500);margin:0 0 24px">O que aparece em destaque + textos que o Google lê</p>
          <div class="field"><label>Título da aba <span class="pill">SEO</span></label><input id="l-page_title" value="${escAttr(l.page_title)}" /><div class="field-help">Aparece na aba do navegador e como título no Google. Inclua a área e a cidade pra ajudar a aparecer em buscas. Ex: "Advogado Trabalhista em Cabo de Santo Agostinho — Henrique Silva".</div></div>
          <div class="field"><label>Descrição para Google <span class="pill">SEO</span></label><textarea id="l-page_description" rows="2">${escHtml(l.page_description||'')}</textarea><div class="field-help">Resumo de até 160 caracteres que aparece embaixo do título nos resultados do Google. Tem que dar vontade de clicar.</div></div>
          <div class="field-row">
            <div class="field"><label>Texto pequeno acima do título</label><input id="l-eyebrow" value="${escAttr(l.eyebrow)}" /><div class="field-help">Letrinha em maiúsculas dourada acima do título. Ex: "Direito Trabalhista".</div></div>
            <div class="field"><label>Texto do botão WhatsApp</label><input id="l-cta_text" value="${escAttr(l.cta_text)}" /><div class="field-help">Texto do botão dourado grande. Curto e direto. Ex: "Análise gratuita pelo WhatsApp".</div></div>
          </div>
          <div class="field"><label>Título grande da página</label><div class="js-rich" data-rich-key="land.h1" data-rich-html="${escAttr(l.h1)}" data-rich-single="true"></div><div class="field-help">Frase principal que aparece em letras grandes. Selecione uma palavra e clique em I pra destacar em itálico dourado.</div></div>
          <div class="field"><label>Subtítulo</label><textarea id="l-subtitle" rows="2">${escHtml(l.subtitle||'')}</textarea><div class="field-help">Frase explicativa abaixo do título. 1-2 linhas explicando o que você atende nessa área.</div></div>
          <div class="field"><label>Mensagem que abre no WhatsApp</label><input id="l-wa_text" value="${escAttr(l.wa_text)}" /><div class="field-help">Quando o cliente clicar no botão, o WhatsApp abre com essa mensagem já digitada. Ex: "Olá, Dr. Henrique. Tenho uma dúvida trabalhista".</div></div>
        </div>

        <div class="card editor-section" data-section="intro" style="display:none">
          <h3 style="font-family:'Fraunces',serif;font-size:24px;color:var(--off-white);font-weight:300;margin:0 0 4px">Introdução</h3>
          <p style="font-family:'Fraunces',serif;font-style:italic;font-size:14px;color:var(--gray-500);margin:0 0 24px">O texto explicativo da área. Aparece logo abaixo do hero.</p>
          <div class="field"><label>Título da introdução</label><div class="js-rich" data-rich-key="land.intro_h2" data-rich-html="${escAttr(l.intro?.h2 || '')}" data-rich-single="true"></div><div class="field-help">Frase de impacto que abre o texto explicativo. Selecione uma palavra pra destacar em itálico dourado.</div></div>
          <div class="field"><label>Parágrafos do texto</label><div class="field-help" style="margin-top:0;margin-bottom:10px">Quebre o texto em 2-4 parágrafos curtos. Cada parágrafo é um bloco separado. Selecione palavras-chave e clique em B pra deixar em negrito.</div>
            <div class="list-items" id="introParagraphs">
              ${(l.intro?.paragraphs||[]).map((p,i)=>`<div class="list-item" data-idx="${i}"><div class="js-rich" style="flex:1" data-rich-key="land.intro.${i}" data-rich-html="${escAttr(p)}"></div><button type="button" class="btn btn-danger btn-rmitem">×</button></div>`).join('')}
            </div>
            <button type="button" class="btn btn-secondary btn-additem-intro">${I.plus} Adicionar parágrafo</button>
          </div>
        </div>

        <div class="card editor-section" data-section="bullets" style="display:none">
          <h3 style="font-family:'Fraunces',serif;font-size:24px;color:var(--off-white);font-weight:300;margin:0 0 4px">Bullets — Em que ajudamos</h3>
          <p style="font-family:'Fraunces',serif;font-style:italic;font-size:14px;color:var(--gray-500);margin:0 0 24px">Lista de serviços ou tipos de caso que você atende nessa área.</p>
          <div class="field-row">
            <div class="field"><label>Texto pequeno acima do título</label><input id="l-bullets_eye" value="${escAttr(l.bullets_eye)}" /><div class="field-help">Pré-título da lista. Ex: "Em que ajudamos".</div></div>
            <div class="field"><label>Título da lista</label><div class="js-rich" data-rich-key="land.bullets_h2" data-rich-html="${escAttr(l.bullets_h2)}" data-rich-single="true"></div><div class="field-help">Frase que apresenta a lista. Selecione palavras pra destacar.</div></div>
          </div>
          <div class="field-help" style="margin-bottom:14px">Cada item da lista vira um card numerado. Clique em "Adicionar tópico" pra criar mais.</div>
          <div class="bullets-list" id="bulletsList">
            ${(l.bullets||[]).map((b,i)=>`
              <details class="card-mini" data-idx="${i}">
                <summary><strong>${escHtml(b.title)}</strong></summary>
                <div class="field"><label>Nome do tópico</label><input data-bkey="title" value="${escAttr(b.title)}" /><div class="field-help">Título curto e direto. Ex: "Verbas rescisórias".</div></div>
                <div class="field"><label>Descrição</label><div class="js-rich" data-rich-key="land.bullets.${i}.text" data-rich-html="${escAttr(b.text)}"></div><div class="field-help">1-2 frases explicando o que você faz nesse tópico. Pode usar negrito.</div></div>
                <button type="button" class="btn btn-danger btn-rmbullet">Remover</button>
              </details>
            `).join('')}
          </div>
          <button type="button" class="btn btn-secondary btn-addbullet">${I.plus} Adicionar tópico</button>
        </div>

        <div class="card editor-section" data-section="faq" style="display:none">
          <h3 style="font-family:'Fraunces',serif;font-size:24px;color:var(--off-white);font-weight:300;margin:0 0 4px">Perguntas Frequentes</h3>
          <p style="font-family:'Fraunces',serif;font-style:italic;font-size:14px;color:var(--gray-500);margin:0 0 24px">Dúvidas comuns dos clientes nessa área. Quanto mais perguntas reais, melhor o SEO e mais o cliente confia.</p>
          <div class="faq-list" id="faqList">
            ${(l.faq||[]).map((q,i)=>`
              <details class="card-mini" data-idx="${i}">
                <summary><strong>${escHtml(q.q)}</strong></summary>
                <div class="field"><label>Pergunta</label><input data-qkey="q" value="${escAttr(q.q)}" /><div class="field-help">Pergunta exata como o cliente faria. Termine com "?".</div></div>
                <div class="field"><label>Resposta</label><div class="js-rich" data-rich-key="land.faq.${i}.a" data-rich-html="${escAttr(q.a)}"></div><div class="field-help">Resposta clara e completa. Pode usar negrito em palavras-chave (prazo, valor, lei) e adicionar links.</div></div>
                <button type="button" class="btn btn-danger btn-rmqq">Remover</button>
              </details>
            `).join('')}
          </div>
          <button type="button" class="btn btn-secondary btn-addqq">${I.plus} Adicionar pergunta</button>
        </div>

      </div>
    </div>
  `;
  initRichEditors($('#lTabsContent'));

  $('#lTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    $$('#lTabs button').forEach(b => b.classList.toggle('active', b === btn));
    const id = btn.dataset.tab;
    $$('#lTabsContent .editor-section').forEach(p => p.style.display = p.dataset.section === id ? '' : 'none');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const saveDraft = debounce(() => {
    if (!dirty.autoKey) return;
    try { localStorage.setItem(dirty.autoKey, JSON.stringify(collectL())); }
    catch (e) {
      if (e && e.name === 'QuotaExceededError') toast('Armazenamento local cheio', 'error');
    }
  }, 600);
  window.__hsa_flushDraft = saveDraft.flush;
  function markDirty() { setDirty(true); saveDraft(); }
  $('#lTabsContent').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.classList.contains('btn-additem-intro')) {
      const list = $('#introParagraphs');
      const i = list.children.length;
      const it = document.createElement('div');
      it.className = 'list-item';
      it.innerHTML = `<div class="js-rich" style="flex:1" data-rich-key="land.intro.add${Date.now()}-${i}" data-rich-html=""></div><button type="button" class="btn btn-danger btn-rmitem">×</button>`;
      list.appendChild(it);
      initRichEditors(it);
      markDirty();
    }
    if (t.classList.contains('btn-rmitem')) { t.parentElement.remove(); markDirty(); }
    if (t.classList.contains('btn-addbullet')) {
      const list = $('#bulletsList');
      const i = list.children.length;
      const d = document.createElement('details');
      d.className = 'card-mini'; d.open = true;
      d.innerHTML = `<summary><strong>Novo tópico</strong></summary>
        <div class="field"><label>Título</label><input data-bkey="title" /></div>
        <div class="field"><label>Descrição</label><div class="js-rich" data-rich-key="land.bullets.add${Date.now()}-${i}.text" data-rich-html=""></div></div>
        <button type="button" class="btn btn-danger btn-rmbullet">Remover</button>`;
      list.appendChild(d);
      initRichEditors(d);
      markDirty();
    }
    if (t.classList.contains('btn-rmbullet')) { t.closest('details').remove(); markDirty(); }
    if (t.classList.contains('btn-addqq')) {
      const list = $('#faqList');
      const i = list.children.length;
      const d = document.createElement('details');
      d.className = 'card-mini'; d.open = true;
      d.innerHTML = `<summary><strong>Nova pergunta</strong></summary>
        <div class="field"><label>Pergunta</label><input data-qkey="q" /></div>
        <div class="field"><label>Resposta</label><div class="js-rich" data-rich-key="land.faq.add${Date.now()}-${i}.a" data-rich-html=""></div></div>
        <button type="button" class="btn btn-danger btn-rmqq">Remover</button>`;
      list.appendChild(d);
      initRichEditors(d);
      markDirty();
    }
    if (t.classList.contains('btn-rmqq')) { t.closest('details').remove(); markDirty(); }
  });
  $('#lTabsContent').addEventListener('input', markDirty);

  function collectL() {
    // Começa com cópia do estado atual (preserva campos que NÃO estão na DOM
    // — ex: tabs não-renderizadas se houver bug). Sobrescreve só o que coleta.
    const newL = JSON.parse(JSON.stringify(l));

    // Helper: só sobrescreve se o elemento existe (defensa contra DOM corrompida).
    const ifEl = (sel, fn) => { const e = $(sel); if (e) fn(e); };

    ifEl('#l-page_title', e => newL.page_title = e.value);
    ifEl('#l-page_description', e => newL.page_description = e.value);
    ifEl('#l-eyebrow', e => newL.eyebrow = e.value);
    ifEl('#l-cta_text', e => newL.cta_text = e.value);
    ifEl('#l-subtitle', e => newL.subtitle = e.value);
    ifEl('#l-wa_text', e => newL.wa_text = e.value);
    ifEl('#l-bullets_eye', e => newL.bullets_eye = e.value);

    const h1Rich = $('.js-rich[data-rich-key="land.h1"]');
    if (h1Rich) newL.h1 = getRichHtml(h1Rich);
    const introH2Rich = $('.js-rich[data-rich-key="land.intro_h2"]');
    newL.intro = newL.intro || {};
    if (introH2Rich) newL.intro.h2 = getRichHtml(introH2Rich);
    const bH2Rich = $('.js-rich[data-rich-key="land.bullets_h2"]');
    if (bH2Rich) newL.bullets_h2 = getRichHtml(bH2Rich);

    // Sub-listas: só atualiza se a UI delas foi renderizada (presença do container).
    if ($('#introParagraphs')) {
      newL.intro.paragraphs = $$('#introParagraphs > .list-item').map(li => {
        const r = li.querySelector('.js-rich');
        return r ? getRichHtml(r) : '';
      }).filter(s => s.trim());
    }
    if ($('#bulletsList')) {
      newL.bullets = $$('#bulletsList details.card-mini').map(card => {
        const o = {};
        card.querySelectorAll('[data-bkey]').forEach(inp => o[inp.dataset.bkey] = inp.value);
        const tRich = card.querySelector('.js-rich');
        if (tRich) o.text = getRichHtml(tRich);
        return o;
      }).filter(b => b.title || b.text);
    }
    if ($('#faqList')) {
      newL.faq = $$('#faqList details.card-mini').map(card => {
        const o = {};
        card.querySelectorAll('[data-qkey]').forEach(inp => o[inp.dataset.qkey] = inp.value);
        const aRich = card.querySelector('.js-rich');
        if (aRich) o.a = getRichHtml(aRich);
        return o;
      }).filter(q => q.q || q.a);
    }
    return newL;
  }

  async function doSave() {
    setSaving('saving');
    // Re-fetch ANTES de salvar pra detectar conflito cedo (landings-content.json
    // é compartilhado entre as 12 páginas — se alguém editou outra landing, faz merge).
    let freshAll, freshSha;
    try {
      const fresh = await getJsonFile(REPO_PATHS.LANDINGS_CONTENT);
      freshAll = fresh.content; freshSha = fresh.sha;
    } catch (e) { setSaving('saved'); toast(e.message, 'error'); return; }

    const newL = collectL();
    // Mergear: usa 'all' como base mas pega edições recentes de OUTRAS landings de freshAll.
    const merged = { ...freshAll, [slug]: newL };
    try {
      await putJsonFile(REPO_PATHS.LANDINGS_CONTENT, merged, freshSha, `admin: atualizar /${slug}/`);
      try { localStorage.removeItem(dirty.autoKey); } catch(_) {}
      setDirty(false);
      setSaving('saved');
      showModal({
        icon: 'success',
        title: 'Página salva',
        msg: 'O site está sendo regenerado. Em cerca de 30 segundos a alteração estará no ar.',
        actions: [
          { label: 'Ver no site', href: `/HenriqueSilva/${slug}/`, target: '_blank', kind: 'btn-primary' },
          { label: 'Voltar para lista', kind: 'btn-secondary', onClick: () => { location.hash = '#/landings'; } },
        ]
      });
    } catch (e) {
      setSaving('saved'); setDirty(true);
      if (e.status === 409) {
        showModal({
          icon: 'warn', title: 'Conflito de edição',
          msg: 'Alguém salvou esta página enquanto você editava. Recarregue e refaça suas alterações.',
          actions: [
            { label: 'Recarregar', kind: 'btn-primary', onClick: () => location.reload() },
            { label: 'Continuar editando', kind: 'btn-secondary' },
          ]
        });
      } else {
        toast(e.message, 'error');
      }
    }
  }

  // Auto-save draft local
  dirty.autoKey = `hsa_draft_landing_${currentSession?.user?.id || 'anon'}_${slug}`;
  try {
    const draft = localStorage.getItem(dirty.autoKey);
    if (draft) {
      const draftL = JSON.parse(draft);
      if (JSON.stringify(draftL) !== JSON.stringify(l)) {
        showModal({
          icon: 'warn', title: 'Rascunho recuperado',
          msg: 'Você tinha alterações não salvas nesta página. Deseja recuperá-las?',
          actions: [
            { label: 'Recuperar', kind: 'btn-primary', onClick: () => {
              all[slug] = draftL;
              renderLandingEditor(app, slug);
            }},
            { label: 'Descartar', kind: 'btn-secondary', onClick: () => {
              try { localStorage.removeItem(dirty.autoKey); } catch(_) {}
            }},
          ]
        });
      }
    }
  } catch(_) {}

  mountSaveBar(doSave, `/HenriqueSilva/${slug}/`);
}

/* ===================== POSTS LIST ===================== */

async function renderPosts(app) {
  unmountSaveBar();
  app.innerHTML = renderTopbar('posts') + `
    <div class="container">
      <div class="h1">Artigos <em>do blog</em></div>
      <div class="h-sub">Compartilhe seu conhecimento jurídico. Cada artigo aparece no blog do site e ajuda no Google.</div>
      <div class="posts-toolbar">
        <input class="posts-search" id="postsSearch" placeholder="Buscar por título…" />
        <a href="#/new" class="btn btn-primary">${I.plus} Escrever novo</a>
      </div>
      <div id="postsContainer">
        <div class="posts-grid">
          <div class="skeleton skel-row"></div>
          <div class="skeleton skel-row"></div>
          <div class="skeleton skel-row"></div>
          <div class="skeleton skel-row"></div>
        </div>
      </div>
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
        $('#postsContainer').innerHTML = `
          <div class="empty">
            <div class="empty-icon">${I.posts}</div>
            <h3>${filter ? 'Nada encontrado' : 'Nenhum artigo ainda'}</h3>
            <p>${filter ? 'Tente buscar por outro termo.' : 'Compartilhe seu conhecimento jurídico com seus futuros clientes — eles te encontram pelo Google.'}</p>
            ${!filter ? `<a href="#/new" class="btn btn-primary">${I.plus} Escrever primeiro artigo</a>` : ''}
          </div>`;
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
        const ok = await confirmModal({
          title: 'Excluir artigo?',
          msg: `<strong>${escHtml(btn.dataset.name)}</strong> será removido. Recuperável via histórico do GitHub.`,
          confirmLabel: 'Sim, excluir', confirmKind: 'btn-danger',
        });
        if (!ok) return;
        try {
          await deleteFile(btn.dataset.del, btn.dataset.sha, `Delete: ${btn.dataset.name}`);
          toast('Artigo excluído');
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
      <div class="h1">${fileBase ? 'Editar artigo' : 'Novo <em>artigo</em>'}</div>
      <div class="h-sub">${fileBase ? 'Modifique e salve. O artigo é regenerado em ~30 segundos.' : 'Compartilhe seu conhecimento jurídico. Use uma linguagem que seu cliente entenda.'}</div>
      <div class="card">
        <div class="field"><label>Título do artigo</label><input id="f-title" value="${escAttr(meta.title)}" placeholder="Ex: Como provar horas extras na Justiça do Trabalho" /><div class="field-help">Aparece grande no topo do artigo e nos resultados do Google. Use uma pergunta ou afirmação que seu cliente faria.</div></div>
        <div class="field-row">
          <div class="field"><label>Endereço da página <span class="pill">URL</span></label><input id="f-slug" value="${escAttr(meta.slug)}" /><div class="field-help">Deixe em branco que é gerado automaticamente a partir do título. Aparece na URL: /blog/<i>endereço</i>/.</div></div>
          <div class="field"><label>Categoria</label><select id="f-category">${Object.entries(CATEGORIES).map(([k,v]) => `<option value="${k}" ${meta.category===k?'selected':''}>${v}</option>`).join('')}</select><div class="field-help">Em qual área do direito esse artigo se encaixa. Ajuda o cliente filtrar no blog.</div></div>
        </div>
        <div class="field"><label>Resumo curto</label><textarea id="f-excerpt" rows="2" placeholder="Frase que aparece nos cards e nos resultados de busca (1-2 linhas).">${escHtml(meta.excerpt||'')}</textarea><div class="field-help">Aparece nos cards do blog, no Google e nas redes sociais quando alguém compartilha. Mantenha em 1-2 linhas que dão vontade de clicar.</div></div>
        <div class="field-row">
          <div class="field"><label>Tags <span class="pill">opcional</span></label><input id="f-tags" value="${escAttr((meta.tags||[]).join(', '))}" placeholder="horas-extras, prova, CLT" /><div class="field-help">Palavras-chave separadas por vírgula. Ajudam a encontrar artigos relacionados. Use 3-5 tags.</div></div>
          <div class="field"><label>Imagem de capa</label>
            <div class="img-picker" id="coverPicker" data-isvideo="false">
              ${meta.cover ? `<img class="img-preview" src="${previewUrl(meta.cover)}" alt="" onerror="this.style.display='none'" />` : `<div class="img-picker-empty">${I.image}</div>`}
              <div class="img-picker-body">
                <input type="text" id="f-cover" value="${escAttr(meta.cover)}" placeholder="/HenriqueSilva/blog/images/capa.jpg" />
                <div class="img-picker-actions">
                  <button type="button" class="btn btn-secondary btn-pickcover">${I.upload} Enviar</button>
                  <span class="drop-hint">…ou arraste pra cá</span>
                </div>
              </div>
            </div>
            <div class="field-help">Foto que aparece no card do blog e em compartilhamentos. Horizontal funciona melhor (1200×630 ideal).</div>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label>Data de publicação</label><input type="date" id="f-date" value="${meta.date||todayIso()}" /><div class="field-help">Quando o artigo foi escrito. Usado pra ordenar do mais recente.</div></div>
          <div class="field"><label>Última atualização</label><input type="date" id="f-updated" value="${meta.updated||todayIso()}" /><div class="field-help">Atualize ao revisar/corrigir o artigo. Mostra ao Google que o conteúdo é atual.</div></div>
        </div>
      </div>
      <div class="card" style="margin-top:18px">
        <label style="display:block;font-family:'Inter Tight',sans-serif;font-size:10.5px;letter-spacing:.28em;text-transform:uppercase;color:var(--gold);font-weight:500;margin-bottom:6px">Conteúdo do artigo</label>
        <p style="font-family:'Fraunces',serif;font-style:italic;font-size:13.5px;color:var(--gray-500);margin:0 0 14px;line-height:1.5">Escreva à esquerda — o site aparece formatado à direita. Atalhos: <b>Ctrl+B</b> negrito · <b>Ctrl+I</b> itálico. Pode arrastar imagens direto pro texto.</p>
        <div class="editor-toolbar">
          <button type="button" class="editor-tool" data-md="**" title="Negrito (Ctrl+B)"><b>B</b></button>
          <button type="button" class="editor-tool" data-md="*" title="Itálico (Ctrl+I)"><i>I</i></button>
          <span class="editor-tool-sep"></span>
          <button type="button" class="editor-tool" data-prefix="## " title="Subtítulo">H2</button>
          <button type="button" class="editor-tool" data-prefix="### " title="Sub-subtítulo">H3</button>
          <span class="editor-tool-sep"></span>
          <button type="button" class="editor-tool" data-prefix="- " title="Lista">• Lista</button>
          <button type="button" class="editor-tool" data-prefix="1. " title="Lista numerada">1. Lista</button>
          <button type="button" class="editor-tool" data-prefix="> " title="Citação">" Citação</button>
          <span class="editor-tool-sep"></span>
          <button type="button" class="editor-tool" id="tool-link" title="Link">Link</button>
          <button type="button" class="editor-tool" id="tool-image" title="Imagem">Imagem</button>
          <button type="button" class="editor-tool" data-md="\`" title="Código">‹/›</button>
          <button type="button" class="editor-tool" data-prefix="---" title="Linha divisória">— Linha</button>
        </div>
        <div class="editor-grid">
          <textarea id="f-body" class="editor-textarea" placeholder="Escreva aqui — pode arrastar imagens direto pro texto.">${escHtml(body)}</textarea>
          <div id="preview" class="editor-preview"></div>
        </div>
      </div>
      ${fileBase ? `<div class="card" style="margin-top:18px"><button class="btn btn-danger" id="btnDelete">Excluir este artigo</button></div>` : ''}
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
  $$('.editor-tool[data-md]').forEach(b => b.addEventListener('click', () => { wrapSelection(ta, b.dataset.md); markDirty(); }));
  $$('.editor-tool[data-prefix]').forEach(b => b.addEventListener('click', () => { prefixLines(ta, b.dataset.prefix); markDirty(); }));
  $('#tool-link').addEventListener('click', () => {
    const url = prompt('URL:');
    if (!url) return;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || 'texto do link';
    insertAtCursor(ta, `[${sel}](${url})`); markDirty();
  });

  async function uploadFile(file, target) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast('Arquivo muito grande (>25MB)', 'error'); return; }
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      const b64 = btoa(bin);
      const ext = file.name.split('.').pop().toLowerCase();
      const safeName = slugify(file.name.replace(/\.[^.]+$/, '')) + '-' + Date.now().toString(36) + '.' + ext;
      const path = `${REPO_PATHS.IMAGES}/${safeName}`;
      toast('Enviando…');
      await putBinaryFile(path, b64, `Upload: ${safeName}`);
      const url = pasteUrl(path);
      if (target === 'cover'){
        $('#f-cover').value = url;
        const picker = $('#coverPicker');
        const empty = picker.querySelector('.img-picker-empty');
        if (empty) {
          const img = document.createElement('img');
          img.className = 'img-preview'; img.src = previewUrl(path);
          empty.replaceWith(img);
        } else {
          const prev = picker.querySelector('.img-preview');
          if (prev) prev.src = previewUrl(path);
        }
        toast('Capa definida ✓');
      } else {
        insertAtCursor(ta, `![${file.name.replace(/\.[^.]+$/, '')}](${url})`); updatePreview();
        toast('Imagem inserida ✓');
      }
      markDirty();
    } catch(err){ toast(err.message, 'error'); }
  }

  $('#tool-image').addEventListener('click', () => { $('#fileInput').dataset.target = 'inline'; $('#fileInput').click(); });
  document.querySelectorAll('.btn-pickcover').forEach(b => b.addEventListener('click', () => { $('#fileInput').dataset.target = 'cover'; $('#fileInput').click(); }));
  $('#fileInput').addEventListener('change', async e => {
    const file = e.target.files[0]; const target = e.target.dataset.target || 'inline';
    e.target.dataset.target = ''; e.target.value = '';
    await uploadFile(file, target);
  });

  // Drag-and-drop em coverPicker e textarea (artigo)
  const cover = $('#coverPicker');
  ['dragenter','dragover'].forEach(ev => cover.addEventListener(ev, e => { e.preventDefault(); cover.classList.add('dragging'); }));
  ['dragleave','drop'].forEach(ev => cover.addEventListener(ev, e => { e.preventDefault(); cover.classList.remove('dragging'); }));
  cover.addEventListener('drop', async e => { const f = e.dataTransfer.files[0]; await uploadFile(f, 'cover'); });

  ta.addEventListener('dragover', e => e.preventDefault());
  ta.addEventListener('drop', async e => {
    const f = e.dataTransfer.files[0];
    if (!f || !f.type.startsWith('image/')) return;
    e.preventDefault();
    await uploadFile(f, 'inline');
  });

  const saveDraft = debounce(() => {
    if (!dirty.autoKey) return;
    try {
      localStorage.setItem(dirty.autoKey, JSON.stringify({
        title: $('#f-title').value, slug: $('#f-slug').value, excerpt: $('#f-excerpt').value,
        category: $('#f-category').value, tags: $('#f-tags').value, cover: $('#f-cover').value,
        date: $('#f-date').value, updated: $('#f-updated').value, body: ta.value,
      }));
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') toast('Armazenamento local cheio', 'error');
    }
  }, 600);
  window.__hsa_flushDraft = saveDraft.flush;
  function markDirty() { setDirty(true); saveDraft(); }
  ['input','change'].forEach(ev => app.addEventListener(ev, markDirty));

  async function doSave() {
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
    if (!m.slug){ toast('Endereço inválido', 'error'); return; }
    const filename = fileBase ? `${fileBase}.md` : `${m.date}-${m.slug}.md`;
    const fullPath = `${REPO_PATHS.POSTS}/${filename}`;
    const content = buildFrontMatter(m) + ta.value + '\n';
    setSaving('saving');
    try {
      await putTextFile(fullPath, content, sha, fileBase ? `Update: ${m.title}` : `Publish: ${m.title}`);
      try { localStorage.removeItem(dirty.autoKey); } catch(_) {}
      setDirty(false);
      setSaving('saved');
      showModal({
        icon: 'success',
        title: fileBase ? 'Artigo atualizado' : 'Artigo publicado',
        msg: 'Em cerca de 30 segundos o artigo estará no ar.',
        actions: [
          { label: 'Ver no site', href: `/HenriqueSilva/blog/${m.slug}/`, target: '_blank', kind: 'btn-primary' },
          { label: 'Voltar pra lista', kind: 'btn-secondary', onClick: () => { location.hash = '#/posts'; } },
        ]
      });
    } catch(err) {
      setSaving('saved'); setDirty(true);
      if (err.status === 409) {
        showModal({
          icon: 'warn', title: 'Conflito de edição',
          msg: 'Alguém editou este artigo. Recarregue pra evitar sobrescrever as alterações.',
          actions: [
            { label: 'Recarregar', kind: 'btn-primary', onClick: () => location.reload() },
            { label: 'Continuar', kind: 'btn-secondary' },
          ]
        });
      } else {
        toast(err.message, 'error');
      }
    }
  }
  if (fileBase){
    $('#btnDelete').addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Excluir artigo?',
        msg: `<strong>${escHtml(meta.title || '(sem título)')}</strong> será removido. Você pode recuperar via histórico do GitHub se precisar.`,
        confirmLabel: 'Sim, excluir', confirmKind: 'btn-danger',
      });
      if (!ok) return;
      try {
        await deleteFile(`${REPO_PATHS.POSTS}/${fileBase}.md`, sha, `Delete: ${meta.title}`);
        toast('Artigo excluído');
        unmountSaveBar();
        location.hash = '#/posts';
      } catch(err){ toast(err.message, 'error'); }
    });
  }

  // Auto-save draft local
  dirty.autoKey = `hsa_draft_post_${currentSession?.user?.id || 'anon'}_${fileBase || 'new'}`;
  try {
    const draft = localStorage.getItem(dirty.autoKey);
    if (draft) {
      const d = JSON.parse(draft);
      const currentBody = body, currentTitle = meta.title;
      if ((d.body || '') !== currentBody || (d.title || '') !== currentTitle) {
        showModal({
          icon: 'warn', title: 'Rascunho recuperado',
          msg: 'Você tinha alterações não salvas neste artigo. Deseja recuperá-las?',
          actions: [
            { label: 'Recuperar', kind: 'btn-primary', onClick: () => {
              $('#f-title').value = d.title; $('#f-slug').value = d.slug; $('#f-excerpt').value = d.excerpt;
              $('#f-category').value = d.category; $('#f-tags').value = d.tags; $('#f-cover').value = d.cover;
              $('#f-date').value = d.date; $('#f-updated').value = d.updated; ta.value = d.body;
              updatePreview(); setDirty(true);
            }},
            { label: 'Descartar', kind: 'btn-secondary', onClick: () => { try { localStorage.removeItem(dirty.autoKey); } catch(_) {} } },
          ]
        });
      }
    }
  } catch(_) {}

  mountSaveBar(doSave, fileBase ? `/HenriqueSilva/blog/${meta.slug}/` : null);
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
  unmountSaveBar();
  app.innerHTML = renderTopbar('imagens') + `
    <div class="container">
      <div class="h1">Imagens <em>do site</em></div>
      <div class="h-sub">Suas fotos disponíveis. Arraste arquivos pra qualquer lugar dessa página pra enviar.</div>
      <div class="posts-toolbar">
        <input class="posts-search" id="galSearch" placeholder="Buscar por nome…" />
        <button class="btn btn-primary" id="btnUpload">${I.upload} Enviar imagem</button>
      </div>
      <div id="galContainer">
        <div class="gal-grid">
          ${Array(8).fill(0).map(() => '<div class="skeleton skel-card" style="height:180px"></div>').join('')}
        </div>
      </div>
      <input type="file" id="galFile" accept="image/*" multiple style="display:none" />
    </div>
  `;
  async function uploadFiles(files) {
    if (!files || !files.length) return;
    let count = 0;
    for (const file of files){
      if (file.size > 25 * 1024 * 1024) { toast(`${file.name}: arquivo > 25MB`, 'error'); continue; }
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = ''; const chunk = 0x8000;
        for (let i=0;i<bytes.length;i+=chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        const b64 = btoa(bin);
        const ext = file.name.split('.').pop().toLowerCase();
        const safeName = slugify(file.name.replace(/\.[^.]+$/, '')) + '-' + Date.now().toString(36) + '.' + ext;
        const path = `${REPO_PATHS.IMAGES}/${safeName}`;
        toast(`Enviando ${file.name}…`);
        await putBinaryFile(path, b64, `Upload: ${safeName}`);
        count++;
      } catch(err){ toast(err.message, 'error'); }
    }
    if (count) toast(`${count} ${count===1?'imagem enviada':'imagens enviadas'} ✓`);
    renderGallery(app);
  }
  $('#btnUpload').addEventListener('click', () => $('#galFile').click());
  $('#galFile').addEventListener('change', e => { uploadFiles(Array.from(e.target.files || [])); e.target.value = ''; });

  // Drag-drop em qualquer lugar da galeria
  ['dragenter','dragover'].forEach(ev => app.addEventListener(ev, e => {
    if (e.dataTransfer && Array.from(e.dataTransfer.items || []).some(i => i.kind === 'file')) {
      e.preventDefault(); document.body.classList.add('dragging-file');
    }
  }));
  ['dragleave','dragend','drop'].forEach(ev => app.addEventListener(ev, e => {
    if (e.type === 'dragleave' && e.relatedTarget) return;
    document.body.classList.remove('dragging-file');
  }));
  app.addEventListener('drop', async e => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    await uploadFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
  });

  try {
    const imgs = ((await listDir(REPO_PATHS.IMAGES)) || []).filter(x => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(x.name));
    if (!imgs.length){
      $('#galContainer').innerHTML = `
        <div class="empty">
          <div class="empty-icon">${I.image}</div>
          <h3>Nenhuma imagem ainda</h3>
          <p>Arraste fotos pra cá ou clique no botão acima. JPG, PNG, WebP até 25MB.</p>
          <button class="btn btn-primary" onclick="document.getElementById('galFile').click()">${I.upload} Enviar primeira imagem</button>
        </div>`;
      return;
    }
    const renderList = (filter='') => {
      const filtered = filter ? imgs.filter(i => i.name.toLowerCase().includes(filter.toLowerCase())) : imgs;
      $('#galContainer').innerHTML = `<div class="gal-grid">` + filtered.map(img => {
        const thumb = previewUrl(img.path);
        return `<div class="gal-item">
          <div class="gal-thumb" data-thumb="${escAttr(thumb)}" style="background-image:url('${escAttr(thumb)}')"></div>
          <div class="gal-name" title="${escAttr(img.name)}">${escHtml(img.name)}</div>
          <div class="gal-actions">
            <button class="copy-url" data-paste="${escAttr(pasteUrl(img.path))}" title="Copiar URL para colar em post">URL</button>
            <button class="del" data-path="${escAttr(img.path)}" data-sha="${escAttr(img.sha)}" title="Excluir">✕</button>
          </div>
        </div>`;
      }).join('') + `</div>`;
      $$('.gal-thumb[data-thumb]').forEach(t => t.addEventListener('click', () => window.open(t.dataset.thumb, '_blank', 'noopener,noreferrer')));
      $$('.copy-url[data-paste]').forEach(b => b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(b.dataset.paste); b.textContent = '✓ COPIADO'; setTimeout(() => b.textContent = 'URL', 1500); }
        catch(_) { toast('Não foi possível copiar', 'error'); }
      }));
      $$('.del[data-path]').forEach(b => b.addEventListener('click', async () => {
        const ok = await confirmModal({
          title: 'Excluir imagem?',
          msg: `<strong>${escHtml(b.dataset.path.split('/').pop())}</strong> — se estiver em uso em algum post ou página, vai aparecer quebrada.`,
          confirmLabel: 'Sim, excluir', confirmKind: 'btn-danger',
        });
        if (!ok) return;
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
  unmountSaveBar();
  app.innerHTML = renderTopbar('config') + `
    <div class="container">
      <div class="h1">Configurações <em>gerais</em></div>
      <div class="h-sub">Telefone, e-mail, endereço, redes sociais e códigos de analytics. As alterações aparecem em todas as páginas do site.</div>
      <div id="cfgContainer"><div class="skeleton skel-card" style="height:480px"></div></div>
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
      <h3 style="font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin-bottom:6px">Contato</h3>
      <p style="font-family:'Fraunces',serif;font-style:italic;font-size:13.5px;color:var(--gray-500);margin-bottom:18px">Aparece no rodapé, no botão de WhatsApp e nas páginas de contato.</p>
      <div class="field-row">
        <div class="field"><label>Telefone (formatado)</label><input id="cfg-phone" value="${escAttr(cfg.phone)}" placeholder="(81) 9 8713-4878" /><div class="field-help">Como aparece visualmente nas páginas. Use parênteses, espaços e hífens.</div></div>
        <div class="field"><label>Telefone (só números, com DDI)</label><input id="cfg-phone_intl" value="${escAttr(cfg.phone_intl)}" placeholder="5581987134878" /><div class="field-help">Usado nos links de WhatsApp. Deve começar com 55 (Brasil) e não ter espaços nem caracteres.</div></div>
      </div>
      <div class="field"><label>E-mail principal</label><input id="cfg-email" value="${escAttr(cfg.email)}" placeholder="contato@exemplo.com" /><div class="field-help">Onde os e-mails dos visitantes do site vão chegar.</div></div>
      <div class="field"><label>Horário de atendimento</label><input id="cfg-schedule" value="${escAttr(cfg.schedule)}" placeholder="Seg–Sex · 08h–12h e 14h–19h" /><div class="field-help">Aparece no rodapé. Use barras ou pontos pra separar os blocos.</div></div>
    </div>
    <div class="card" style="margin-top:18px">
      <h3 style="font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin-bottom:6px">Endereço do escritório</h3>
      <p style="font-family:'Fraunces',serif;font-style:italic;font-size:13.5px;color:var(--gray-500);margin-bottom:18px">Aparece no rodapé e na página de contato. Cada campo separado pra ficar bonito ao formatar.</p>
      <div class="field-row">
        <div class="field"><label>Nome (condomínio / edifício)</label><input id="cfg-addr-name" value="${escAttr(cfg.address?.name)}" placeholder="Cond. Novo Mundo Empresarial" /></div>
        <div class="field"><label>Rua e número</label><input id="cfg-addr-street" value="${escAttr(cfg.address?.street)}" placeholder="Av. A, 4165" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Complemento (sala, torre)</label><input id="cfg-addr-complement" value="${escAttr(cfg.address?.complement)}" placeholder="Torre 05, Sala 318" /></div>
        <div class="field"><label>Bairro</label><input id="cfg-addr-neighborhood" value="${escAttr(cfg.address?.neighborhood)}" placeholder="Reserva do Paiva" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Cidade</label><input id="cfg-addr-city" value="${escAttr(cfg.address?.city)}" placeholder="Cabo de Santo Agostinho" /></div>
        <div class="field"><label>UF</label><input id="cfg-addr-state" value="${escAttr(cfg.address?.state)}" placeholder="PE" /><div class="field-help">2 letras do estado.</div></div>
      </div>
      <div class="field"><label>CEP</label><input id="cfg-addr-cep" value="${escAttr(cfg.address?.cep)}" placeholder="54522-005" /></div>
    </div>
    <div class="card" style="margin-top:18px">
      <h3 style="font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin-bottom:6px">Redes sociais</h3>
      <p style="font-family:'Fraunces',serif;font-style:italic;font-size:13.5px;color:var(--gray-500);margin-bottom:18px">Cole o link COMPLETO de cada perfil (começando com https://). Deixe em branco as redes que você não usa.</p>
      <div class="field"><label>Instagram</label><input id="cfg-soc-instagram" value="${escAttr(cfg.social?.instagram)}" placeholder="https://www.instagram.com/seuperfil/" /></div>
      <div class="field"><label>Facebook</label><input id="cfg-soc-facebook" value="${escAttr(cfg.social?.facebook)}" placeholder="https://www.facebook.com/SuaPagina" /></div>
      <div class="field"><label>LinkedIn</label><input id="cfg-soc-linkedin" value="${escAttr(cfg.social?.linkedin)}" placeholder="https://www.linkedin.com/in/seu-perfil/" /></div>
      <div class="field"><label>YouTube</label><input id="cfg-soc-youtube" value="${escAttr(cfg.social?.youtube)}" placeholder="https://www.youtube.com/@seucanal" /></div>
      <div class="field"><label>TikTok</label><input id="cfg-soc-tiktok" value="${escAttr(cfg.social?.tiktok)}" placeholder="https://www.tiktok.com/@seuperfil" /></div>
    </div>
    <div class="card" style="margin-top:18px">
      <h3 style="font-family:'Fraunces',serif;font-size:22px;color:var(--off-white);font-weight:300;margin-bottom:6px">Estatísticas <span class="pill" style="font-size:10px">opcional</span></h3>
      <p style="font-family:'Fraunces',serif;font-style:italic;font-size:13.5px;color:var(--gray-500);margin-bottom:18px">Códigos pra ver <strong>quantas pessoas visitam</strong> o site, <strong>de onde vêm</strong> e <strong>o que clicam</strong>. Pode pular se ainda não tem — dá pra adicionar depois.</p>
      <div class="field"><label>Microsoft Clarity</label><input id="cfg-clarity" value="${escAttr(cfg.clarity_id)}" placeholder="abc1234567" /><div class="field-help">Mostra heatmaps (onde clicam) e gravações de visitantes anônimos. <strong>Grátis e ilimitado</strong>. Cole só o ID curto que aparece em <a href="https://clarity.microsoft.com" target="_blank">clarity.microsoft.com</a>.</div></div>
      <div class="field"><label>Plausible</label><input id="cfg-plausible" value="${escAttr(cfg.plausible_domain)}" placeholder="seusite.com.br" /><div class="field-help">Estatísticas simples e sem cookies. Pago (~$9/mês). Cole só o domínio do seu site (sem https).</div></div>
      <div class="field"><label>Google Analytics 4</label><input id="cfg-ga4" value="${escAttr(cfg.ga4_id)}" placeholder="G-XXXXXXXXXX" /><div class="field-help">Estatísticas do Google. Grátis. Cole o código que começa com "G-".</div></div>
    </div>
  `;
  function markDirty() { setDirty(true); }
  $('#cfgContainer').addEventListener('input', markDirty);
  async function doSaveCfg() {
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
    setSaving('saving');
    try {
      await putJsonFile(REPO_PATHS.SITE_CONFIG, newCfg, sha, 'admin: atualizar configurações');
      setDirty(false); setSaving('saved');
      showModal({
        icon: 'success', title: 'Configurações salvas',
        msg: 'Telefone, e-mail e demais informações foram atualizados em todo o site.',
        actions: [
          { label: 'Ver no site', href: '/HenriqueSilva/', target: '_blank', kind: 'btn-primary' },
          { label: 'Continuar', kind: 'btn-secondary' },
        ]
      });
    } catch(err){ setSaving('saved'); setDirty(true); toast(err.message, 'error'); }
  }
  mountSaveBar(doSaveCfg, '/HenriqueSilva/');
}
