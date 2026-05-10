/* HSA Analytics injector — lê site-config.json e ativa Clarity / Plausible / GA4 se configurados.
   Também carrega tracker.js (analytics próprio: referrer, scroll, tempo, cliques). */
(function(){
  var basePath = (location.pathname.indexOf('/HenriqueSilva/') === 0 ? '/HenriqueSilva/' : '/');
  // Tracker próprio — independe de qualquer ID configurado.
  if (location.pathname.indexOf('/admin') === -1) {
    var tk = document.createElement('script');
    tk.src = basePath + 'assets/tracker.js';
    tk.defer = true;
    document.head.appendChild(tk);
  }
  var configUrl = basePath + 'assets/site-config.json';
  fetch(configUrl, {cache: 'no-cache'}).then(function(r){ return r.ok ? r.json() : {}; }).then(function(cfg){
    if (!cfg) return;
    // Microsoft Clarity
    if (cfg.clarity_id){
      (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        var y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", cfg.clarity_id);
    }
    // Plausible
    if (cfg.plausible_domain){
      var pl = document.createElement('script');
      pl.defer = true;
      pl.setAttribute('data-domain', cfg.plausible_domain);
      pl.src = 'https://plausible.io/js/script.js';
      document.head.appendChild(pl);
    }
    // GA4
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
})();
