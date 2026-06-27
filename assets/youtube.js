/* youtube.js — monta o carrossel de vídeos da home a partir de assets/youtube.json.
   O JSON é atualizado automaticamente pelo workflow .github/workflows/youtube.yml
   (cron de ~6h que lê o RSS do canal). Site estático: sem CORS, sem API key. */
(async function () {
  const track = document.getElementById('vidsTrack');
  if (!track) return;

  const BASE = (function () {
    const m = location.pathname.match(/^(.*?)(?:\/(?:index\.html)?)?$/);
    let b = m ? (m[1].endsWith('/') ? m[1] : m[1] + '/') : '/';
    return b.includes('/HenriqueSilva') ? '/HenriqueSilva/' : b;
  })();

  const section = document.getElementById('videos');
  const fmtDate = (iso) => {
    try {
      const d = new Date(iso);
      if (isNaN(d)) return '';
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    } catch (_) { return ''; }
  };

  let data;
  try {
    const r = await fetch(BASE + 'assets/youtube.json?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    data = await r.json();
  } catch (e) {
    console.warn('[youtube] não carregou youtube.json:', e);
    if (section) section.style.display = 'none'; // sem dados → esconde a seção, não deixa buraco
    return;
  }

  const videos = Array.isArray(data.videos) ? data.videos : [];
  if (!videos.length) { if (section) section.style.display = 'none'; return; }

  if (data.channel_url) {
    const link = document.getElementById('vidsChannelLink');
    if (link) link.setAttribute('href', data.channel_url);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  track.innerHTML = videos.map((v) => {
    const id = esc(v.id);
    const title = esc(v.title);
    const date = esc(fmtDate(v.published));
    const thumb = esc(v.thumb || ('https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'));
    return (
      '<article class="vids-card" role="listitem">' +
        '<div class="vids-thumb" data-id="' + id + '" role="button" tabindex="0" ' +
             'aria-label="Reproduzir: ' + title + '">' +
          '<img loading="lazy" src="' + thumb + '" alt="' + title + '">' +
          '<div class="vids-play"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></div>' +
        '</div>' +
        '<div class="vids-body">' +
          (date ? '<span class="vids-date">' + date + '</span>' : '') +
          '<h3 class="vids-title">' + title + '</h3>' +
        '</div>' +
      '</article>'
    );
  }).join('');

  // Play inline (lazy): troca a thumb por um iframe nocookie só ao clicar.
  function play(thumbEl) {
    const id = thumbEl.getAttribute('data-id');
    if (!id || thumbEl.querySelector('iframe')) return;
    const iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + id +
      '?autoplay=1&rel=0&modestbranding=1';
    iframe.title = thumbEl.getAttribute('aria-label') || 'Vídeo';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    thumbEl.innerHTML = '';
    thumbEl.appendChild(iframe);
  }

  track.addEventListener('click', (e) => {
    const t = e.target.closest('.vids-thumb');
    if (t) play(t);
  });
  track.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('vids-thumb')) {
      e.preventDefault();
      play(e.target);
    }
  });

  // Setas do carrossel
  const prev = section.querySelector('.vids-prev');
  const next = section.querySelector('.vids-next');
  const step = () => {
    const card = track.querySelector('.vids-card');
    return card ? card.getBoundingClientRect().width + 24 : 360;
  };
  const updateArrows = () => {
    if (!prev || !next) return;
    const max = track.scrollWidth - track.clientWidth - 2;
    prev.disabled = track.scrollLeft <= 2;
    next.disabled = track.scrollLeft >= max;
  };
  if (prev) prev.addEventListener('click', () => track.scrollBy({ left: -step() * 1.5, behavior: 'smooth' }));
  if (next) next.addEventListener('click', () => track.scrollBy({ left: step() * 1.5, behavior: 'smooth' }));
  track.addEventListener('scroll', updateArrows, { passive: true });
  setTimeout(updateArrows, 60);
})();
