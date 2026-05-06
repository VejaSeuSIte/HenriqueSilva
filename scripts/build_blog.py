"""
Build estatico do blog Henrique Silva Advocacia.
Le _posts/*.md, gera output com:
  - blog/index.html (listagem)
  - blog/<slug>/index.html (cada post)
  - blog/categoria/<cat>/index.html
  - blog/posts.json (metadata)
  - blog/rss.xml

Modos:
  python build_blog.py             -> gera em dist/ (Action / preview)
  python build_blog.py --inplace   -> gera direto em blog/ (commit no main)
"""
import os, re, json, shutil, datetime, html, argparse
from pathlib import Path
import yaml
import markdown
from jinja2 import Environment, FileSystemLoader, select_autoescape

try:
    import bleach
    BLEACH_OK = True
except ImportError:
    BLEACH_OK = False
    print('WARN: bleach nao instalado, posts NAO sao sanitizados (use pip install bleach)')

# Tags e atributos permitidos no body_html dos posts.
# <script>, <iframe>, <object>, on* attrs sao removidos.
ALLOWED_TAGS = [
    'p', 'br', 'hr', 'em', 'strong', 'b', 'i', 'u', 's', 'strike', 'del',
    'a', 'img', 'figure', 'figcaption',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'cite', 'q',
    'code', 'pre', 'kbd', 'samp', 'var',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'span', 'div', 'small', 'sub', 'sup',
]
ALLOWED_ATTRS = {
    '*': ['class', 'id'],
    'a': ['href', 'title', 'rel', 'target'],
    'img': ['src', 'alt', 'title', 'width', 'height', 'loading'],
    'th': ['scope', 'colspan', 'rowspan'],
    'td': ['colspan', 'rowspan'],
    'pre': ['class'],
    'code': ['class'],
}
ALLOWED_PROTOCOLS = ['http', 'https', 'mailto', 'tel']

def sanitize_html(html_str):
    if not BLEACH_OK or not html_str:
        return html_str
    return bleach.clean(
        html_str,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
        strip_comments=True,
    )

ROOT = Path(__file__).resolve().parent.parent
SRC_BLOG = ROOT / 'blog'
LAYOUTS = SRC_BLOG / '_layouts'
POSTS_DIR = SRC_BLOG / '_posts'
DIST = ROOT / 'dist'
SITE_URL = 'https://vejaseusite.github.io/HenriqueSilva'

CATEGORIES = {
    'trabalhista': 'Trabalhista',
    'previdenciario': 'Previdenciário',
    'civel': 'Cível',
    'familia': 'Família',
    'consumidor': 'Consumidor',
    'imobiliario': 'Imobiliário',
    'tributario': 'Tributário',
    'criminal': 'Criminal',
    'empresarial': 'Empresarial',
    'geral': 'Geral',
}

# ===========================================================
# CMS: dados editáveis vivem em assets/*.json
#   - assets/landings-content.json -> LANDINGS (12 paginas)
#   - assets/site-content.json     -> textos da home (consumido por content-loader.js)
# Editaveis pelo painel /admin/ via Supabase + Edge Function github-proxy.
# ===========================================================
LANDINGS_PATH = ROOT / 'assets' / 'landings-content.json'
LANDINGS = json.loads(LANDINGS_PATH.read_text(encoding='utf-8'))

def slugify(s):
    s = s.lower()
    s = re.sub(r'[áàâãä]', 'a', s)
    s = re.sub(r'[éèêë]', 'e', s)
    s = re.sub(r'[íìîï]', 'i', s)
    s = re.sub(r'[óòôõö]', 'o', s)
    s = re.sub(r'[úùûü]', 'u', s)
    s = re.sub(r'[ç]', 'c', s)
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s

def parse_post(path):
    text = path.read_text(encoding='utf-8')
    if not text.startswith('---'):
        raise ValueError(f'Post sem front-matter: {path}')
    _, fm, body = text.split('---', 2)
    meta = yaml.safe_load(fm)
    md = markdown.Markdown(extensions=['extra', 'codehilite', 'toc', 'tables', 'fenced_code', 'sane_lists', 'smarty', 'footnotes'])
    body_html = md.convert(body.strip())
    body_html = sanitize_html(body_html)
    word_count = len(re.findall(r'\w+', body))
    read_min = max(1, round(word_count / 220))
    slug = meta.get('slug') or slugify(meta['title'])
    cat = meta.get('category', 'geral')
    if cat not in CATEGORIES:
        cat = 'geral'
    if isinstance(meta.get('date'), datetime.date):
        date_iso = meta['date'].isoformat()
    elif isinstance(meta.get('date'), datetime.datetime):
        date_iso = meta['date'].date().isoformat()
    else:
        date_iso = str(meta.get('date', datetime.date.today().isoformat()))
    return {
        'slug': slug,
        'title': meta['title'],
        'excerpt': meta.get('excerpt', ''),
        'category': cat,
        'category_label': CATEGORIES[cat],
        'tags': meta.get('tags', []) or [],
        'cover': meta.get('cover', ''),
        'date': date_iso,
        'updated': str(meta.get('updated', date_iso)),
        'body_html': body_html,
        'read_min': read_min,
        'word_count': word_count,
        'url': f'/HenriqueSilva/blog/{slug}/',
        'absolute_url': f'{SITE_URL}/blog/{slug}/',
    }

def fmt_date_pt(iso):
    months = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
    try:
        d = datetime.date.fromisoformat(iso)
        return f'{d.day} de {months[d.month-1]} de {d.year}'
    except Exception:
        return iso

def build(inplace=False):
    if not POSTS_DIR.exists():
        print(f'WARN: {POSTS_DIR} nao existe; criando vazio')
        POSTS_DIR.mkdir(parents=True, exist_ok=True)

    posts = []
    for f in sorted(POSTS_DIR.glob('*.md')):
        try:
            posts.append(parse_post(f))
        except Exception as e:
            print(f'ERRO em {f.name}: {e}')
    posts.sort(key=lambda p: p['date'], reverse=True)

    # Setup output
    global DIST
    if inplace:
        DIST = ROOT
        # Limpa apenas arquivos gerados anteriormente em /blog/
        blog_out = DIST / 'blog'
        blog_out.mkdir(parents=True, exist_ok=True)
        for f in ['index.html', 'posts.json', 'rss.xml']:
            p = blog_out / f
            if p.exists(): p.unlink()
        if (blog_out / 'categoria').exists():
            shutil.rmtree(blog_out / 'categoria')
        # Remove subdirs de slug antigos (qualquer pasta com index.html, exceto _posts/_layouts/images)
        for sub in blog_out.iterdir():
            if sub.is_dir() and sub.name not in ('_posts', '_layouts', 'images') and (sub / 'index.html').exists():
                shutil.rmtree(sub)
    else:
        if DIST.exists():
            shutil.rmtree(DIST)
        DIST.mkdir(parents=True)
        # Copia o site principal
        for item in ['index.html', 'assets', 'admin', '.nojekyll', 'LICENSE', 'README.md']:
            src = ROOT / item
            if src.exists():
                if src.is_dir():
                    shutil.copytree(src, DIST / item)
                else:
                    shutil.copy2(src, DIST / item)
        # Copia imagens do blog
        blog_images = SRC_BLOG / 'images'
        if blog_images.exists():
            target = DIST / 'blog' / 'images'
            target.mkdir(parents=True, exist_ok=True)
            for img in blog_images.iterdir():
                if img.is_file():
                    shutil.copy2(img, target / img.name)

    # Jinja env
    env = Environment(
        loader=FileSystemLoader(str(LAYOUTS)),
        autoescape=select_autoescape(['html', 'xml']),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters['date_pt'] = fmt_date_pt

    # Render index do blog
    list_tpl = env.get_template('list.html')
    out = DIST / 'blog' / 'index.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(list_tpl.render(
        posts=posts,
        categories=CATEGORIES,
        page_title='Blog · Henrique Silva Advocacia',
        page_description='Artigos sobre Direito Trabalhista, Previdenciário, Empresarial e mais. Conteúdo prático escrito pelo Dr. José Henrique da Silva (OAB/PE 31.742).',
        canonical=f'{SITE_URL}/blog/',
        og_image=f'{SITE_URL}/assets/og-banner.jpg',
        site_url=SITE_URL,
    ), encoding='utf-8')
    print(f'Built blog/index.html with {len(posts)} posts')

    # Render cada post
    post_tpl = env.get_template('post.html')
    for i, post in enumerate(posts):
        prev_p = posts[i+1] if i+1 < len(posts) else None
        next_p = posts[i-1] if i > 0 else None
        related = [p for p in posts if p['slug'] != post['slug'] and p['category'] == post['category']][:3]
        if len(related) < 3:
            others = [p for p in posts if p['slug'] != post['slug'] and p not in related][:3-len(related)]
            related = related + others
        out = DIST / 'blog' / post['slug'] / 'index.html'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(post_tpl.render(
            post=post,
            prev=prev_p,
            next=next_p,
            related=related,
            page_title=f"{post['title']} · Henrique Silva Advocacia",
            page_description=post['excerpt'] or post['title'],
            canonical=post['absolute_url'],
            og_image=(SITE_URL + post['cover']) if post['cover'] else f'{SITE_URL}/assets/og-banner.jpg',
            site_url=SITE_URL,
        ), encoding='utf-8')
    print(f'Built {len(posts)} post pages')

    # Render por categoria
    if 'category.html' in os.listdir(LAYOUTS):
        cat_tpl = env.get_template('category.html')
        for cat_slug, cat_label in CATEGORIES.items():
            cat_posts = [p for p in posts if p['category'] == cat_slug]
            if not cat_posts:
                continue
            out = DIST / 'blog' / 'categoria' / cat_slug / 'index.html'
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(cat_tpl.render(
                posts=cat_posts,
                category_slug=cat_slug,
                category_label=cat_label,
                categories=CATEGORIES,
                page_title=f'{cat_label} · Blog · Henrique Silva Advocacia',
                page_description=f'Artigos sobre Direito {cat_label} no blog do Dr. José Henrique da Silva.',
                canonical=f'{SITE_URL}/blog/categoria/{cat_slug}/',
                og_image=f'{SITE_URL}/assets/og-banner.jpg',
                site_url=SITE_URL,
            ), encoding='utf-8')
        print(f'Built {len(CATEGORIES)} category pages')

    # JSON com metadata (consumido pelo admin e pela home)
    json_data = [{
        'slug': p['slug'],
        'title': p['title'],
        'excerpt': p['excerpt'],
        'category': p['category'],
        'category_label': p['category_label'],
        'tags': p['tags'],
        'cover': p['cover'],
        'date': p['date'],
        'read_min': p['read_min'],
        'url': p['url'],
    } for p in posts]
    out = DIST / 'blog' / 'posts.json'
    out.write_text(json.dumps(json_data, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Built posts.json')

    # RSS feed
    rss_items = []
    for p in posts[:20]:
        pub_dt = datetime.datetime.fromisoformat(p['date']).strftime('%a, %d %b %Y 09:00:00 -0300')
        rss_items.append(f'''  <item>
    <title>{html.escape(p['title'])}</title>
    <link>{p['absolute_url']}</link>
    <guid isPermaLink="true">{p['absolute_url']}</guid>
    <pubDate>{pub_dt}</pubDate>
    <category>{p['category_label']}</category>
    <description>{html.escape(p['excerpt'])}</description>
  </item>''')
    rss_xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Henrique Silva Advocacia · Blog</title>
  <link>{SITE_URL}/blog/</link>
  <description>Artigos sobre Direito Trabalhista, Previdenciário, Empresarial e mais. Dr. José Henrique da Silva, OAB/PE 31.742.</description>
  <language>pt-br</language>
{chr(10).join(rss_items)}
</channel>
</rss>
'''
    (DIST / 'blog' / 'rss.xml').write_text(rss_xml, encoding='utf-8')
    print('Built rss.xml')

    # ============= LANDINGS por especialidade ===============
    landing_tpl = env.get_template('landing.html')
    for slug, page_data in LANDINGS.items():
        related = []
        if page_data.get('related_category'):
            related = [p for p in posts if p['category'] == page_data['related_category']][:3]
        out = DIST / slug / 'index.html'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(landing_tpl.render(
            page=page_data,
            related_posts=related,
            page_title=page_data['page_title'],
            page_description=page_data['page_description'],
            canonical=f"{SITE_URL}/{slug}/",
            og_image=f"{SITE_URL}/assets/og-banner.jpg",
            site_url=SITE_URL,
        ), encoding='utf-8')
    print(f'Built {len(LANDINGS)} landing pages')

    # ============= SITEMAP.XML ===============
    today = datetime.date.today().isoformat()
    urls = []
    urls.append((f'{SITE_URL}/', '1.0', today))
    for slug in LANDINGS.keys():
        urls.append((f'{SITE_URL}/{slug}/', '0.9', today))
    urls.append((f'{SITE_URL}/blog/', '0.8', today))
    for cat_slug, cat_label in CATEGORIES.items():
        cat_posts = [p for p in posts if p['category'] == cat_slug]
        if cat_posts:
            urls.append((f'{SITE_URL}/blog/categoria/{cat_slug}/', '0.7', cat_posts[0]['date']))
    for p in posts:
        urls.append((p['absolute_url'], '0.6', p['updated']))
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    for url, prio, lastmod in urls:
        sitemap += f'  <url><loc>{url}</loc><lastmod>{lastmod}</lastmod><priority>{prio}</priority></url>\n'
    sitemap += '</urlset>\n'
    (DIST / 'sitemap.xml').write_text(sitemap, encoding='utf-8')
    print(f'Built sitemap.xml with {len(urls)} URLs')

    # ============= ROBOTS.TXT ===============
    robots = f'''User-agent: *
Allow: /
Disallow: /admin/
Disallow: /blog/_posts/
Disallow: /blog/_layouts/

Sitemap: {SITE_URL}/sitemap.xml
'''
    (DIST / 'robots.txt').write_text(robots, encoding='utf-8')
    print('Built robots.txt')

    print(f'\nDone. Output: {DIST}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--inplace', action='store_true', help='Escreve direto em blog/ na raiz (sem dist/)')
    args = parser.parse_args()
    build(inplace=args.inplace)
