/* ================================================================
   VejaSeuSIte — Biblioteca JS compartilhada
   Auto-inicializa em DOMContentLoaded. Procura data-attributes.
   ---
   data-reveal="up|down|left|right|scale|fade"  reveal on scroll
   data-delay="200"                              delay em ms
   data-stagger=".child"                         stagger filhos
   data-stagger-step="90"                        delay entre filhos
   data-split="words"                            splita texto em spans
   data-count="92" data-count-suffix="%"         counter animado
   data-count-duration="1800"
   data-magnetic data-mag-strength="0.35"        atrai cursor
   data-tilt data-tilt-max="6"                   3D tilt com mouse
   data-dust="12"                                cria N partículas no parent
   ---
   Também inicia: scroll progress bar, noise overlay fallback,
   live status dot (horário comercial), easter egg console.
   ================================================================ */
(function(){
  'use strict';
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ready(fn){
    if(document.readyState!=='loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  /* -------- SPLIT TEXT INTO WORD SPANS -------- */
  function splitText(root){
    root.querySelectorAll('[data-split="words"]').forEach(function(el){
      if(el.dataset.splitDone) return;
      el.dataset.splitDone = '1';
      el.classList.add('vs-split');
      var words = el.textContent.trim().split(/\s+/);
      el.innerHTML = words.map(function(w,i){
        return '<span class="vs-split-word" style="transition-delay:'+(i*55)+'ms">'+w+'</span>';
      }).join(' ');
    });
  }

  /* -------- REVEAL ON SCROLL -------- */
  function initReveal(){
    if(!('IntersectionObserver' in window)) {
      document.querySelectorAll('[data-reveal]').forEach(function(el){ el.setAttribute('data-in',''); });
      return;
    }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting) return;
        var el = e.target;
        var delay = parseInt(el.dataset.delay||'0',10);
        setTimeout(function(){
          el.setAttribute('data-in','');
          // stagger (prefixa :scope se selector começa com > pra ser válido em querySelectorAll)
          if(el.dataset.stagger){
            var step = parseInt(el.dataset.staggerStep||'90',10);
            var sel = el.dataset.stagger.trim();
            if(sel[0] === '>') sel = ':scope ' + sel;
            try {
              el.querySelectorAll(sel).forEach(function(c,i){
                setTimeout(function(){ c.setAttribute('data-in',''); }, i*step);
              });
            } catch(_){ /* selector inválido */ }
          }
        }, delay);
        io.unobserve(el);
      });
    }, {threshold:.12, rootMargin:'0px 0px -8% 0px'});
    document.querySelectorAll('[data-reveal]').forEach(function(el){ io.observe(el); });
  }

  /* -------- COUNT-UP NUMBERS -------- */
  function initCounters(){
    if(!('IntersectionObserver' in window)) return;
    var cio = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting) return;
        var el = e.target;
        var target = parseFloat(el.dataset.count);
        var suffix = el.dataset.countSuffix || '';
        var prefix = el.dataset.countPrefix || '';
        var duration = parseInt(el.dataset.countDuration||'1800',10);
        var decimals = parseInt(el.dataset.countDecimals||'0',10);
        var start = performance.now();
        function fmtBR(n, d){
          var parts = n.toFixed(d).split('.');
          parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
          return parts.length === 2 ? parts.join(',') : parts[0];
        }
        function step(now){
          var p = Math.min(1, (now-start)/duration);
          var eased = 1 - Math.pow(1-p, 3);
          var val = target * eased;
          el.textContent = prefix + fmtBR(val, decimals) + suffix;
          if(p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
        cio.unobserve(el);
      });
    }, {threshold:.3});
    document.querySelectorAll('[data-count]').forEach(function(el){ cio.observe(el); });
  }

  /* -------- MAGNETIC BUTTONS -------- */
  function initMagnetic(){
    if(REDUCE) return;
    document.querySelectorAll('[data-magnetic]').forEach(function(el){
      var strength = parseFloat(el.dataset.magStrength||'0.35');
      var rect;
      function onMove(e){
        if(!rect) rect = el.getBoundingClientRect();
        var mx = e.clientX - (rect.left + rect.width/2);
        var my = e.clientY - (rect.top + rect.height/2);
        el.style.transform = 'translate('+(mx*strength)+'px,'+(my*strength)+'px)';
      }
      function onEnter(){ rect = el.getBoundingClientRect(); }
      function onLeave(){ el.style.transform = ''; rect = null; }
      el.addEventListener('mousemove', onMove);
      el.addEventListener('mouseenter', onEnter);
      el.addEventListener('mouseleave', onLeave);
    });
  }

  /* -------- 3D TILT -------- */
  function initTilt(){
    if(REDUCE) return;
    document.querySelectorAll('[data-tilt]').forEach(function(el){
      var max = parseFloat(el.dataset.tiltMax||'6');
      var rect, raf;
      function apply(rx, ry){
        el.style.transform = 'perspective(900px) rotateX('+rx+'deg) rotateY('+ry+'deg)';
      }
      function onMove(e){
        if(!rect) rect = el.getBoundingClientRect();
        var mx = (e.clientX - rect.left) / rect.width;
        var my = (e.clientY - rect.top) / rect.height;
        var ry = (mx - .5) * max * 2;
        var rx = -(my - .5) * max * 2;
        if(raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function(){ apply(rx, ry); });
      }
      function onEnter(){ rect = el.getBoundingClientRect(); }
      function onLeave(){ el.style.transform = ''; rect = null; }
      el.addEventListener('mousemove', onMove);
      el.addEventListener('mouseenter', onEnter);
      el.addEventListener('mouseleave', onLeave);
    });
  }

  /* -------- DUST PARTICLES -------- */
  function initDust(){
    if(REDUCE) return;
    document.querySelectorAll('[data-dust]').forEach(function(host){
      if(host.querySelector('.vs-dust')) return;
      var n = parseInt(host.dataset.dust||'10',10);
      var layer = document.createElement('div');
      layer.className = 'vs-dust';
      for(var i=0;i<n;i++){
        var p = document.createElement('i');
        p.style.left = (Math.random()*100)+'%';
        p.style.setProperty('--d', (10+Math.random()*14).toFixed(1)+'s');
        p.style.setProperty('--ad', (Math.random()*-18).toFixed(1)+'s');
        p.style.setProperty('--dx', ((Math.random()-.5)*80).toFixed(0)+'px');
        p.style.width = p.style.height = (3 + Math.random()*5).toFixed(1)+'px';
        layer.appendChild(p);
      }
      host.appendChild(layer);
      if(getComputedStyle(host).position === 'static') host.style.position = 'relative';
    });
  }

  /* -------- SCROLL PROGRESS BAR -------- */
  function initScrollProgress(){
    if(!document.body.dataset.scrollProgress && !document.querySelector('[data-scroll-progress]')) return;
    var bar = document.createElement('div');
    bar.className = 'vs-scroll-progress';
    bar.setAttribute('aria-hidden','true');
    document.body.appendChild(bar);
    function update(){
      var doc = document.documentElement;
      var h = doc.scrollHeight - doc.clientHeight;
      var p = h ? window.scrollY / h : 0;
      bar.style.setProperty('--p', p.toFixed(3));
    }
    window.addEventListener('scroll', update, {passive:true});
    window.addEventListener('resize', update);
    update();
  }

  /* -------- CURSOR-FOLLOWING GRADIENT -------- */
  function initGradientFollow(){
    if(REDUCE) return;
    document.querySelectorAll('.vs-gradient-follow').forEach(function(el){
      el.addEventListener('mousemove', function(e){
        var r = el.getBoundingClientRect();
        el.style.setProperty('--mx', ((e.clientX-r.left)/r.width*100)+'%');
        el.style.setProperty('--my', ((e.clientY-r.top)/r.height*100)+'%');
      });
    });
  }

  /* -------- LIVE STATUS DOT (horário comercial) -------- */
  function initLiveStatus(){
    document.querySelectorAll('[data-live]').forEach(function(el){
      var now = new Date();
      var day = now.getDay(); // 0 dom, 6 sab
      var h = now.getHours();
      var online = day >=1 && day <=5 && h >=8 && h <20;
      el.classList.toggle('off', !online);
      var textEl = el.querySelector('[data-live-text]');
      if(textEl) textEl.textContent = online ? (el.dataset.liveOn || 'Online agora') : (el.dataset.liveOff || 'Resposta em até 2h úteis');
    });
  }

  /* -------- CONIC RING PROGRESS (scroll-driven) -------- */
  function initConicRings(){
    var rings = document.querySelectorAll('[data-ring]');
    if(!rings.length) return;
    var cio = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting) return;
        var el = e.target;
        var target = parseInt(el.dataset.ring||'100',10);
        var start = performance.now();
        var duration = 1200;
        function step(now){
          var p = Math.min(1, (now-start)/duration);
          el.style.setProperty('--p', (target*p)+'%');
          if(p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
        cio.unobserve(el);
      });
    }, {threshold:.4});
    rings.forEach(function(el){ cio.observe(el); });
  }

  /* -------- TIMELINE SCROLL PROGRESS -------- */
  function initTimelineProgress(){
    var nodes = document.querySelectorAll('[data-timeline-progress]');
    if(!nodes.length) return;
    function update(){
      nodes.forEach(function(el){
        var r = el.getBoundingClientRect();
        var vh = window.innerHeight;
        var p = 1 - Math.max(0, Math.min(1, (r.bottom - vh*.3) / (r.height + vh*.4)));
        el.style.setProperty('--tp', p.toFixed(3));
      });
    }
    window.addEventListener('scroll', update, {passive:true});
    window.addEventListener('resize', update);
    update();
  }

  /* -------- EASTER EGG CONSOLE -------- */
  function consoleSig(){
    try{
      var style1='color:#9b5a3e;font-weight:700;font-family:Playfair Display,serif;font-size:18px;padding:6px 0';
      var style2='color:#5c4e3f;font-size:12px;line-height:1.6';
      console.log('%cVejaSeuSIte','color:#9b5a3e;font-weight:800;font-size:22px;font-family:Playfair Display,serif;padding:8px 0');
      console.log('%cSites personalizados para profissionais liberais brasileiros.\n%cSe você chegou aqui, saiba: seu site também pode ser assim.\n\nFalar com Gabriel: https://wa.me/5581993858453\n', style1, style2);
    }catch(e){}
  }

  /* -------- AUTO-APPLY REVEAL EM SECTIONS (opt-in via body[data-auto-reveal]) -------- */
  function autoReveal(){
    var mode = document.body.dataset.autoReveal;
    if(!mode) return;
    var selector = mode === 'sections' ? 'section' :
                   mode === 'all' ? 'section, .shead, .card, article' :
                   mode;
    document.querySelectorAll(selector).forEach(function(el){
      if(!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal','up');
    });
  }

  /* -------- AUTO-MAGNETIC nos CTAs WhatsApp (opt-in) -------- */
  function autoMagnetic(){
    if(!document.body.dataset.autoMagnetic) return;
    document.querySelectorAll('a[href*="wa.me"]:not([data-magnetic])').forEach(function(a){
      // só nos CTAs grandes/visíveis — pular botões pequenos de nav ou footer
      var parent = a.closest('.foot, footer, nav');
      if(parent) return;
      a.setAttribute('data-magnetic','');
      a.setAttribute('data-mag-strength','0.25');
    });
  }

  /* -------- AUTO-COUNT nos números grandes (opt-in) -------- */
  function autoCount(){
    if(!document.body.dataset.autoCount) return;
    // nada automático por padrão — usuário marca manualmente com data-count
  }

  /* -------- INIT -------- */
  ready(function(){
    autoReveal();
    autoMagnetic();
    autoCount();
    splitText(document);
    initReveal();
    initCounters();
    initMagnetic();
    initTilt();
    initDust();
    initScrollProgress();
    initGradientFollow();
    initLiveStatus();
    initConicRings();
    initTimelineProgress();
    consoleSig();
  });

  // Expor para uso manual
  window.VejaSeuSIte = {
    reinit: function(){
      splitText(document);
      initReveal();
      initCounters();
      initMagnetic();
      initTilt();
    }
  };
})();
