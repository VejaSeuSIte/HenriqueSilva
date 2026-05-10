/* HSA Tracker — analytics próprio (referrer, scroll, tempo, cliques).
   Envia eventos pro RPC public.ingest_analytics no Supabase central VejaSeuSIte.
   Carregado por analytics.js, então roda em todas as páginas (home, landings, blog).

   Privacidade: não captura IP do visitante na tabela. UA fica curto e truncado.
   visitor_id em localStorage e session_id em sessionStorage; usuário pode limpar quando quiser.
*/
(function () {
  // --- Não trackeia o painel de admin (poluiria as métricas com o cliente)
  if (location.pathname.indexOf('/admin') !== -1) return;
  // --- Respeita Do Not Track
  try { if (navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes') return; } catch (_) {}

  var SLUG = 'henriquesilva';
  var basePath = location.pathname.indexOf('/HenriqueSilva/') === 0 ? '/HenriqueSilva/' : '/';

  fetch(basePath + 'assets/site-config.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || !cfg.supabase_url || !cfg.supabase_anon_key) return;
      try { init(cfg); } catch (e) { /* silencia falhas */ }
    })
    .catch(function () { });

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function safeStorageGet(storage, key) {
    try { return storage.getItem(key); } catch (_) { return null; }
  }
  function safeStorageSet(storage, key, val) {
    try { storage.setItem(key, val); } catch (_) {}
  }

  function init(cfg) {
    var ENDPOINT = cfg.supabase_url.replace(/\/+$/, '') + '/rest/v1/rpc/ingest_analytics';
    var ANON = cfg.supabase_anon_key;

    var visitorId = safeStorageGet(localStorage, 'hsa_vid');
    if (!visitorId || !/^[0-9a-f-]{20,}$/i.test(visitorId)) {
      visitorId = uuid();
      safeStorageSet(localStorage, 'hsa_vid', visitorId);
    }
    var sessionId = safeStorageGet(sessionStorage, 'hsa_sid');
    if (!sessionId || !/^[0-9a-f-]{20,}$/i.test(sessionId)) {
      sessionId = uuid();
      safeStorageSet(sessionStorage, 'hsa_sid', sessionId);
    }
    var pageId = uuid();

    var pageStart = Date.now();
    var lastVisible = pageStart;
    var activeMs = 0;
    var maxScroll = 0;
    var scrollSeen = {};
    var unloadSent = false;

    // Buffer + flush
    var queue = [];
    var flushTimer = null;
    function enqueue(ev, opts) {
      ev.session_id = sessionId;
      ev.visitor_id = visitorId;
      ev.path = location.pathname || '/';
      if (ev.kind !== 'pageview' && ev.kind !== 'pageend') ev.page_id = pageId;
      else if (ev.kind === 'pageview' || ev.kind === 'pageend') ev.page_id = pageId;
      queue.push(ev);
      if (opts && opts.flushNow) flush(true);
      else scheduleFlush();
    }
    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(function () { flushTimer = null; flush(false); }, 1500);
    }
    function flush(isUnload) {
      if (!queue.length) return;
      var batch = queue.splice(0, 50);
      var body = JSON.stringify({ p_slug: SLUG, p_events: batch });
      // POST com keepalive funciona em modernos browsers durante unload.
      try {
        if (isUnload && navigator.sendBeacon) {
          // Beacon não suporta headers; usamos apikey via query string.
          var url = ENDPOINT + '?apikey=' + encodeURIComponent(ANON);
          var blob = new Blob([body], { type: 'application/json' });
          if (navigator.sendBeacon(url, blob)) return;
        }
        fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'apikey': ANON,
            'Authorization': 'Bearer ' + ANON,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: body,
          keepalive: true,
          mode: 'cors',
          credentials: 'omit',
        }).catch(function () {});
      } catch (_) {}
    }

    // ----- Pageview inicial
    var url;
    try { url = new URL(location.href); } catch (_) { url = null; }
    var refer = document.referrer || '';
    var refHost = '';
    if (refer) {
      try {
        var ru = new URL(refer);
        refHost = ru.host;
        if (refHost === location.host) { refer = ''; refHost = ''; }
      } catch (_) {}
    }
    var sp = url && url.searchParams;
    enqueue({
      kind: 'pageview',
      title: (document.title || '').slice(0, 300),
      referrer: refer || null,
      referrer_host: refHost || null,
      utm_source: sp && sp.get('utm_source') || null,
      utm_medium: sp && sp.get('utm_medium') || null,
      utm_campaign: sp && sp.get('utm_campaign') || null,
      utm_term: sp && sp.get('utm_term') || null,
      utm_content: sp && sp.get('utm_content') || null,
      screen_w: screen.width || 0,
      screen_h: screen.height || 0,
      viewport_w: window.innerWidth || 0,
      viewport_h: window.innerHeight || 0,
      lang: (navigator.language || '').slice(0, 16),
      tz: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { return ''; } })().slice(0, 64),
    }, { flushNow: true });

    // ----- Scroll depth (marcos 25/50/75/90)
    var SCROLL_MILESTONES = [25, 50, 75, 90];
    function onScrollRaw() {
      var doc = document.documentElement;
      var winH = window.innerHeight || doc.clientHeight || 0;
      var docH = Math.max(doc.scrollHeight || 0, document.body ? document.body.scrollHeight : 0);
      if (docH <= winH || winH <= 0) return;
      var pct = Math.min(100, Math.round(((window.scrollY || window.pageYOffset || 0) + winH) / docH * 100));
      if (pct > maxScroll) maxScroll = pct;
      for (var i = 0; i < SCROLL_MILESTONES.length; i++) {
        var m = SCROLL_MILESTONES[i];
        if (pct >= m && !scrollSeen[m]) {
          scrollSeen[m] = true;
          enqueue({ kind: 'scroll', scroll_pct: m });
        }
      }
    }
    var scrollTimer = null;
    window.addEventListener('scroll', function () {
      if (scrollTimer) return;
      scrollTimer = setTimeout(function () { scrollTimer = null; onScrollRaw(); }, 250);
    }, { passive: true });

    // ----- Cliques (delegado, links + botões)
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest && e.target.closest('a, button, [role="button"]');
      if (!el) return;
      var info = { kind: 'click' };
      var text = (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      info.click_text = text || null;
      if (el.tagName === 'A') {
        var href = el.getAttribute('href') || '';
        info.click_href = href ? href.slice(0, 500) : null;
        try {
          var u = new URL(href, location.href);
          if (u.protocol === 'tel:') info.click_kind = 'tel';
          else if (u.protocol === 'mailto:') info.click_kind = 'email';
          else if (/wa\.me|whatsapp/i.test(u.host + u.pathname)) info.click_kind = 'whatsapp';
          else if (u.host && u.host !== location.host) info.click_kind = 'outbound';
          else info.click_kind = 'internal';
        } catch (_) {
          info.click_kind = 'link';
        }
      } else {
        info.click_kind = 'button';
      }
      enqueue(info);
    }, true);

    // ----- Tempo ativo (somente quando aba visível)
    document.addEventListener('visibilitychange', function () {
      var now = Date.now();
      if (document.visibilityState === 'hidden') {
        activeMs += now - lastVisible;
        // Manda parcial caso o usuário não volte
        sendPageEnd();
      } else {
        lastVisible = now;
        unloadSent = false; // se voltou, permite mandar de novo no próximo unload
      }
    });

    // Heartbeat: atualiza activeMs sem mandar nada (só flush no unload)
    setInterval(function () {
      if (document.visibilityState !== 'hidden') {
        var now = Date.now();
        activeMs += now - lastVisible;
        lastVisible = now;
      }
    }, 15000);

    // ----- Unload final
    function sendPageEnd() {
      if (unloadSent) { flush(true); return; }
      unloadSent = true;
      var now = Date.now();
      if (document.visibilityState !== 'hidden') {
        activeMs += now - lastVisible;
        lastVisible = now;
      }
      enqueue({
        kind: 'pageend',
        active_ms: Math.min(activeMs, 7200000),
        total_ms: Math.min(now - pageStart, 7200000),
        max_scroll_pct: maxScroll,
      }, { flushNow: true });
      flush(true);
    }
    window.addEventListener('pagehide', sendPageEnd);
    window.addEventListener('beforeunload', sendPageEnd);
  }
})();
