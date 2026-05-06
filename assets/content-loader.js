/* content-loader.js — atualiza textos/imagens da home a partir de assets/site-content.json
   Editado pelo painel /admin/. Cliente vê alterações imediatas após salvar. */
(async function () {
  const RAW_BASE = (function () {
    const m = location.pathname.match(/^(.*?)(?:\/(?:index\.html)?)?$/);
    return m ? (m[1].endsWith('/') ? m[1] : m[1] + '/') : '/';
  })();
  const BASE = RAW_BASE.includes('/HenriqueSilva') ? '/HenriqueSilva/' : RAW_BASE;
  const URL_JSON = BASE + 'assets/site-content.json?v=' + Date.now();

  let cfg;
  try {
    const r = await fetch(URL_JSON, { cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    cfg = await r.json();
  } catch (e) {
    console.warn('[content-loader] não carregou site-content.json:', e);
    // Sinaliza pro admin/ferramentas saberem que houve falha. Não polui o site público.
    document.documentElement.setAttribute('data-content-loader-error', e.message || 'load failed');
    return;
  }

  const $ = (s, ctx = document) => ctx.querySelector(s);
  const $$ = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));
  const setHTML = (sel, html) => { const el = typeof sel === 'string' ? $(sel) : sel; if (el && html != null) el.innerHTML = html; };
  const setText = (sel, txt) => { const el = typeof sel === 'string' ? $(sel) : sel; if (el && txt != null) el.textContent = txt; };
  const setAttr = (sel, attr, val) => { const el = typeof sel === 'string' ? $(sel) : sel; if (el && val != null) el.setAttribute(attr, val); };

  // Substitui apenas o texto de um <a>/<button>, preservando filhos (ex: SVGs)
  const setBtnText = (el, text) => {
    if (!el || text == null) return;
    let replaced = false;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3 && node.textContent.trim()) { node.textContent = text; replaced = true; break; }
    }
    if (!replaced) {
      const span = document.createElement('span');
      span.textContent = text;
      el.appendChild(span);
    }
  };

  // ========== HERO ==========
  if (cfg.hero) {
    setHTML('.hero-tagline-quote', cfg.hero.tagline_quote);
    const ctaPrim = $('.hero-cta-primary');
    if (ctaPrim) setBtnText(ctaPrim, cfg.hero.cta_primary_label);
    if (cfg.hero.video_src) {
      const vid = $('.hero-video');
      if (vid) {
        const sources = vid.querySelectorAll('source');
        if (sources.length) sources[0].setAttribute('src', BASE + cfg.hero.video_src.replace(/^\//, ''));
        else vid.setAttribute('src', BASE + cfg.hero.video_src.replace(/^\//, ''));
        if (cfg.hero.poster_src) vid.setAttribute('poster', BASE + cfg.hero.poster_src.replace(/^\//, ''));
        try { vid.load(); } catch (_) {}
      }
    }
    if (cfg.hero.seal_src) {
      const seal = $('.hero-seal');
      if (seal) seal.setAttribute('src', BASE + cfg.hero.seal_src.replace(/^\//, ''));
      const navSeal = $('.brand-seal');
      if (navSeal) navSeal.setAttribute('src', BASE + cfg.hero.seal_src.replace(/^\//, ''));
    }
  }

  // ========== OFFICE ==========
  if (cfg.office) {
    const officeText = $('.office-text');
    if (officeText) {
      const eyebrow = officeText.querySelector('.shead-eye span');
      if (eyebrow) setText(eyebrow, cfg.office.eyebrow);
      const h2 = officeText.querySelector('h2');
      if (h2) setHTML(h2, cfg.office.h2);
      const ps = officeText.querySelectorAll(':scope > p');
      (cfg.office.paragraphs || []).forEach((html, i) => { if (ps[i]) setHTML(ps[i], html); });
    }
    const pillars = $$('.pillar');
    (cfg.office.pillars || []).forEach((p, i) => {
      const pillar = pillars[i];
      if (!pillar) return;
      const t = pillar.querySelector('.pillar-title');
      const x = pillar.querySelector('.pillar-text');
      if (t) setText(t, p.num);
      if (x) setText(x, p.label);
    });
    if (cfg.office.photo_src) {
      const ph = $('.office-photo-img');
      if (ph) ph.setAttribute('src', BASE + cfg.office.photo_src.replace(/^\//, ''));
    }
    if (cfg.office.photo_stamp) setHTML('.office-photo-stamp', cfg.office.photo_stamp);
  }

  // ========== AREAS ==========
  if (cfg.areas && Array.isArray(cfg.areas.items)) {
    // areas seção header
    const areasSection = document.querySelector('#areas, .areas, section[data-section="areas"]');
    cfg.areas.items.forEach((it) => {
      const slug = (it.slug || '').replace(/\/+$/, '');
      const card = document.querySelector(`.area-card[data-link="${slug}/"]`);
      if (!card) return;
      if (it.image) {
        card.setAttribute('data-bg', it.image);
        // Se já existe um overlay com bg-image inline, atualiza
        card.style.backgroundImage = `url('${BASE + it.image.replace(/^\//, '')}')`;
      }
      const h3 = card.querySelector('h3');
      if (h3) setHTML(h3, it.h3);
      const p = card.querySelector('p');
      if (p) setText(p, it.description);
      // tags se houver — escapa via textContent pra não permitir HTML injection
      const tagsContainer = card.querySelector('.area-tags');
      if (tagsContainer && Array.isArray(it.tags)) {
        tagsContainer.textContent = '';
        it.tags.forEach((t) => {
          const span = document.createElement('span');
          span.className = 'area-tag';
          span.textContent = String(t);
          tagsContainer.appendChild(span);
        });
      }
      if (it.href) card.setAttribute('data-link', it.href);
    });
  }

  // ========== REVIEWS ==========
  if (cfg.reviews) {
    setText('.reviews-banner-num', cfg.reviews.rating_num);
    setText('.reviews-banner-stars', cfg.reviews.rating_stars);
    setHTML('.reviews-banner-meta', cfg.reviews.meta_html);
    const items = cfg.reviews.items || [];
    let cards = $$('.review-card');
    // Se JSON tem MAIS reviews que DOM tem cards, clona o último pra criar os faltantes
    if (cards.length > 0 && items.length > cards.length) {
      const container = cards[0].parentElement;
      const template = cards[cards.length - 1];
      while (cards.length < items.length) {
        const clone = template.cloneNode(true);
        container.appendChild(clone);
        cards = $$('.review-card', container);
      }
    }
    items.forEach((rev, i) => {
      const card = cards[i];
      if (!card) return;
      const name = card.querySelector('.review-name, h4');
      const date = card.querySelector('.review-date');
      const stars = card.querySelector('.review-stars');
      const quote = card.querySelector('.review-quote, blockquote');
      if (name) setText(name, rev.name);
      if (date) setText(date, rev.date);
      if (stars) setText(stars, rev.stars);
      if (quote) setText(quote, rev.quote);
    });
    // Se JSON tem MENOS reviews, esconde os cards extras
    cards.forEach((card, i) => { card.style.display = i < items.length ? '' : 'none'; });
    const cta = $('.reviews-cta a, .reviews-cta-link');
    if (cta) {
      setBtnText(cta, cfg.reviews.cta_label);
      if (cfg.reviews.cta_href) cta.setAttribute('href', cfg.reviews.cta_href);
    }
  }

  // ========== ABOUT ==========
  if (cfg.about) {
    const aboutText = $('.about-text');
    if (aboutText) {
      const eyebrow = aboutText.querySelector('.shead-eye span');
      if (eyebrow) setText(eyebrow, cfg.about.eyebrow);
      const h2 = aboutText.querySelector('h2');
      if (h2) setHTML(h2, cfg.about.h2);
      const lead = aboutText.querySelector('.lead');
      if (lead) setText(lead, cfg.about.lead);
      const ps = aboutText.querySelectorAll(':scope > p:not(.lead)');
      (cfg.about.paragraphs || []).forEach((html, i) => { if (ps[i]) setHTML(ps[i], html); });
    }
    const creds = $$('.credential');
    (cfg.about.credentials || []).forEach((c, i) => {
      const credEl = creds[i];
      if (!credEl) return;
      const num = credEl.querySelector('.credential-num');
      const lab = credEl.querySelector('.credential-label');
      if (num) setHTML(num, c.num.includes('+') || c.num.match(/^\d/) ? `<em>${c.num}</em>` : c.num);
      if (lab) setText(lab, c.label);
    });
    if (cfg.about.portrait_src) {
      const ph = $('.portrait-photo');
      if (ph) ph.setAttribute('src', BASE + cfg.about.portrait_src.replace(/^\//, ''));
    }
    if (cfg.about.portrait_plaque) setText('.portrait-plaque', cfg.about.portrait_plaque);
  }

  // ========== LATEST (blog cards são gerados via posts.json — só mexemos no header) ==========
  if (cfg.latest) {
    const sec = document.querySelector('#artigos, section[data-section="latest"]');
    if (sec) {
      const eyebrow = sec.querySelector('.shead-eye span');
      const h2 = sec.querySelector('h2');
      const sub = sec.querySelector('.shead-sub');
      const cta = sec.querySelector('.latest-cta a, .ghost-btn-dark');
      if (eyebrow) setText(eyebrow, cfg.latest.eyebrow);
      if (h2) setHTML(h2, cfg.latest.h2);
      if (sub) setHTML(sub, cfg.latest.sub);
      if (cta) setBtnText(cta, cfg.latest.cta_label);
    }
  }

  // ========== FAQ ==========
  if (cfg.faq) {
    const sec = document.querySelector('#faq, section[data-section="faq"]');
    if (sec) {
      const eyebrow = sec.querySelector('.shead-eye span');
      const h2 = sec.querySelector('h2');
      const sub = sec.querySelector('.shead-sub');
      const search = sec.querySelector('input[type="search"], #faq-q');
      if (eyebrow) setText(eyebrow, cfg.faq.eyebrow);
      if (h2) setHTML(h2, cfg.faq.h2);
      if (sub) setHTML(sub, cfg.faq.sub);
      if (search && cfg.faq.search_placeholder) search.setAttribute('placeholder', cfg.faq.search_placeholder);
      const items = sec.querySelectorAll('.q, details, .faq-item');
      (cfg.faq.items || []).forEach((it, i) => {
        const item = items[i];
        if (!item) return;
        const q = item.querySelector('summary, .faq-q, h3');
        const a = item.querySelector('.faq-a, p, .a');
        if (q) setText(q, it.q);
        if (a) setHTML(a, it.a);
      });
    }
  }

  // ========== CONTACT CTA ==========
  if (cfg.contact_cta) {
    const head = document.querySelector('.contact-cta-head');
    if (head) {
      const h2 = head.querySelector('h2');
      const p = head.querySelector('p');
      if (h2) setHTML(h2, cfg.contact_cta.h2);
      if (p) setText(p, cfg.contact_cta.sub);
    }
    if (cfg.contact_cta.form) {
      const f = cfg.contact_cta.form;
      const labels = $$('.contact-cta label');
      if (labels[0] && f.name_label) setText(labels[0], f.name_label);
      if (labels[1] && f.phone_label) setText(labels[1], f.phone_label);
      if (labels[2] && f.message_label) setText(labels[2], f.message_label);
      const submit = $('.contact-cta-submit, .contact-cta button[type="submit"]');
      if (submit && f.submit_label) setBtnText(submit, f.submit_label);
      const dis = $('.contact-cta-disclaimer');
      if (dis && f.disclaimer) setText(dis, f.disclaimer);
    }
    if (cfg.contact_cta.bg_src) {
      const bg = $('.contact-cta-bg');
      if (bg) {
        if (bg.tagName === 'IMG') bg.setAttribute('src', BASE + cfg.contact_cta.bg_src.replace(/^\//, ''));
        else bg.style.backgroundImage = `url('${BASE + cfg.contact_cta.bg_src.replace(/^\//, '')}')`;
      }
    }
  }

  // ========== FOOTER ==========
  if (cfg.footer) {
    setText('.footer-tag', cfg.footer.tag);
    if (cfg.footer.copyright) setText('.footer-bottom-left', cfg.footer.copyright);
    if (cfg.footer.site_credit_label) {
      const c = $('.footer-bottom-right a');
      if (c) {
        setText(c, cfg.footer.site_credit_label);
        if (cfg.footer.site_credit_href) c.setAttribute('href', cfg.footer.site_credit_href);
      }
    }
  }

  // ========== WhatsApp FAB ==========
  if (cfg.wa_fab) {
    setText('.wa-fab-label', cfg.wa_fab.label);
  }
})();
