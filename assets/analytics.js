/* HSA Analytics + Consentimento (LGPD)
   - Banner de cookies (opt-in): o rastreamento só é ativado após "Aceitar".
   - Injeta os links de Política de Privacidade e Termos de Uso no rodapé de todas as páginas.
   - Só carrega o tracker próprio (tracker.js) e Clarity/Plausible/GA4 com consentimento.
   - Respeita "Do Not Track": não rastreia e não exibe banner.
*/
(function(){
  var basePath = (location.pathname.indexOf('/HenriqueSilva/') === 0 ? '/HenriqueSilva/' : '/');
  var CONSENT_KEY = 'hsa-consent';            // 'granted' | 'denied'
  var isAdmin = location.pathname.indexOf('/admin') !== -1;
  var dnt = false;
  try { dnt = (navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes' || window.doNotTrack === '1'); } catch(_) {}

  function getConsent(){ try { return localStorage.getItem(CONSENT_KEY); } catch(e){ return null; } }
  function setConsent(v){ try { localStorage.setItem(CONSENT_KEY, v); } catch(e){} }

  // ───────────── Tracker próprio (sempre) ─────────────
  // Carregado para todos porque também resolve short-links (?l=slug). O ENVIO de
  // métricas dentro do tracker é gateado pelo consentimento (vê tracker.js).
  function loadTracker(){
    if (isAdmin) return;
    var tk = document.createElement('script');
    tk.src = basePath + 'assets/tracker.js';
    tk.defer = true;
    document.head.appendChild(tk);
  }

  // ───────────── Ferramentas de terceiros (só com consentimento) ─────────────
  function loadThirdParty(){
    if (isAdmin) return;
    fetch(basePath + 'assets/site-config.json', {cache:'no-cache'})
      .then(function(r){ return r.ok ? r.json() : {}; })
      .then(function(cfg){
        if (!cfg) return;
        if (cfg.clarity_id){
          (function(c,l,a,r,i,t,y){
            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
          })(window, document, "clarity", "script", cfg.clarity_id);
        }
        if (cfg.plausible_domain){
          var pl = document.createElement('script');
          pl.defer = true;
          pl.setAttribute('data-domain', cfg.plausible_domain);
          pl.src = 'https://plausible.io/js/script.js';
          document.head.appendChild(pl);
        }
        if (cfg.ga4_id){
          var ga = document.createElement('script');
          ga.async = true;
          ga.src = 'https://www.googletagmanager.com/gtag/js?id=' + cfg.ga4_id;
          document.head.appendChild(ga);
          window.dataLayer = window.dataLayer || [];
          function gtag(){ dataLayer.push(arguments); }
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', cfg.ga4_id, { anonymize_ip: true });
        }
      }).catch(function(){});
  }

  // ───────────── Links legais no rodapé (LGPD) ─────────────
  function injectFooterLinks(){
    var left = document.querySelector('.footer-bottom-left');
    if (!left || left.querySelector('.footer-legal')) return;
    var span = document.createElement('span');
    span.className = 'footer-legal';
    span.innerHTML =
      ' · <a href="' + basePath + 'privacidade/">Política de Privacidade</a>' +
      ' · <a href="' + basePath + 'termos/">Termos de Uso</a>';
    left.appendChild(span);
  }

  // ───────────── Banner de consentimento ─────────────
  function injectStyles(){
    if (document.getElementById('hsa-consent-css')) return;
    var css = document.createElement('style');
    css.id = 'hsa-consent-css';
    css.textContent =
      '.footer-legal a{color:inherit;text-decoration:none;border-bottom:1px solid rgba(212,175,55,.4);transition:color .25s}' +
      '.footer-legal a:hover{color:#e6c869}' +
      '.hsa-consent{position:fixed;left:0;right:0;bottom:0;z-index:80;background:rgba(13,11,6,.97);' +
        'border-top:1px solid rgba(212,175,55,.35);color:#e8e2d2;font-family:"Inter Tight",system-ui,sans-serif;' +
        'box-shadow:0 -14px 40px rgba(0,0,0,.45);padding:18px 22px;display:flex;gap:18px;align-items:center;' +
        'justify-content:center;flex-wrap:wrap}' +
      '.hsa-consent__text{font-size:13.5px;line-height:1.55;max-width:700px;margin:0;font-weight:300}' +
      '.hsa-consent__text a{color:#e6c869;text-decoration:underline}' +
      '.hsa-consent__actions{display:flex;gap:10px;flex-wrap:wrap}' +
      '.hsa-consent button{font-family:inherit;font-size:12px;letter-spacing:.06em;cursor:pointer;' +
        'padding:11px 22px;border-radius:2px;border:1px solid rgba(212,175,55,.5);transition:all .25s;min-height:44px}' +
      '.hsa-consent__accept{background:#d4af37;color:#0a0a0a;border-color:#d4af37;font-weight:600}' +
      '.hsa-consent__accept:hover{background:#e6c869;border-color:#e6c869}' +
      '.hsa-consent__reject{background:transparent;color:#cfc6b0}' +
      '.hsa-consent__reject:hover{border-color:#d4af37;color:#fff}' +
      '@media(max-width:600px){.hsa-consent{flex-direction:column;align-items:stretch;text-align:center;' +
        'padding:16px 16px max(16px,env(safe-area-inset-bottom))}.hsa-consent__actions{justify-content:center}' +
        '.hsa-consent button{flex:1}}';
    document.head.appendChild(css);
  }

  function showBanner(){
    if (document.querySelector('.hsa-consent')) return;
    injectStyles();
    var bar = document.createElement('div');
    bar.className = 'hsa-consent';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Aviso de cookies');
    bar.innerHTML =
      '<p class="hsa-consent__text">Utilizamos cookies e tecnologias semelhantes para entender como o site é ' +
      'utilizado e melhorar sua experiência. Você decide. Saiba mais na nossa ' +
      '<a href="' + basePath + 'privacidade/">Política de Privacidade</a>.</p>' +
      '<div class="hsa-consent__actions">' +
        '<button type="button" class="hsa-consent__reject">Recusar</button>' +
        '<button type="button" class="hsa-consent__accept">Aceitar</button>' +
      '</div>';
    document.body.appendChild(bar);
    bar.querySelector('.hsa-consent__accept').addEventListener('click', function(){
      setConsent('granted'); bar.remove(); loadThirdParty();
      try { window.dispatchEvent(new Event('hsa:consent')); } catch(_) {}
    });
    bar.querySelector('.hsa-consent__reject').addEventListener('click', function(){
      setConsent('denied'); bar.remove();
    });
  }

  // ───────────── Inicialização ─────────────
  function init(){
    injectFooterLinks();
    loadTracker();                            // sempre (short-links); analytics interno é gateado por consentimento
    if (dnt) return;                          // respeita Do Not Track: sem 3rd-party, sem banner
    var c = getConsent();
    if (c === 'granted') { loadThirdParty(); return; }
    if (c === 'denied')  { return; }          // já recusou: nada a fazer
    if (!isAdmin) showBanner();               // sem decisão ainda → pergunta
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
