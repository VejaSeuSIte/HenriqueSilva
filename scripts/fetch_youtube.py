#!/usr/bin/env python3
"""fetch_youtube.py — puxa os vídeos mais recentes do canal do YouTube via RSS
e grava em assets/youtube.json. Sem API key, sem cota, só biblioteca padrão.

Usado pelo workflow .github/workflows/youtube.yml (cron) e localmente:
    python scripts/fetch_youtube.py

O channel_id é lido de assets/site-config.json (campo "youtube_channel_id"),
com fallback pro canal do Henrique. O front (assets/youtube.js) lê o JSON
gerado e monta o carrossel — site estático, sem CORS, atualiza sozinho.
"""
import json
import os
import re
import sys
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, "assets", "site-config.json")
OUT_PATH = os.path.join(ROOT, "assets", "youtube.json")

# Canal Guia Trabalhista / Henrique Silva Advocacia (fallback)
DEFAULT_CHANNEL_ID = "UCf9ai0uyqOTTrWijGWvloQw"
MAX_VIDEOS = 9

# Vídeos cujo título contenha qualquer um destes termos (sem acento, case-insensitive)
# são descartados — mantém só conteúdo jurídico/trabalhista na home do escritório.
# Editável em assets/site-config.json → "youtube_blocklist" (substitui esta lista).
DEFAULT_BLOCKLIST = [
    "trump", "biden", "capitol", "fake news", "sonho americano",
    "imperio", "mentira e do odio", "eleicao", "eleicoes",
]

# Títulos que são só uma data (lives sem nome real) — ex.: "5 de fevereiro de 2025".
GENERIC_DATE_TITLE = re.compile(
    r"^\s*\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}\s*$", re.IGNORECASE
)


def _norm(s: str) -> str:
    """minúsculas + sem acento, pra casar blocklist de forma robusta."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower()


def is_relevant(title: str, blocklist) -> bool:
    if not title or GENERIC_DATE_TITLE.match(title):
        return False
    nt = _norm(title)
    return not any(_norm(term) in nt for term in blocklist if term)

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}


def read_config():
    """Retorna (channel_id, blocklist) lendo assets/site-config.json com fallback."""
    channel_id = DEFAULT_CHANNEL_ID
    blocklist = DEFAULT_BLOCKLIST
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        cid = (cfg.get("youtube_channel_id") or "").strip()
        if re.fullmatch(r"UC[0-9A-Za-z_-]{20,}", cid):
            channel_id = cid
        bl = cfg.get("youtube_blocklist")
        if isinstance(bl, list):
            blocklist = [str(t) for t in bl]
    except Exception as e:  # noqa: BLE001
        print(f"[fetch_youtube] site-config.json: {e}", file=sys.stderr)
    return channel_id, blocklist


def fetch_feed(channel_id: str) -> bytes:
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; HSA-site/1.0)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def parse_feed(raw: bytes):
    root = ET.fromstring(raw)
    channel_title = (root.findtext("atom:title", default="", namespaces=NS) or "").strip()
    videos = []
    for entry in root.findall("atom:entry", NS):
        vid = entry.findtext("yt:videoId", default="", namespaces=NS).strip()
        if not vid:
            continue
        title = (entry.findtext("atom:title", default="", namespaces=NS) or "").strip()
        published = (entry.findtext("atom:published", default="", namespaces=NS) or "").strip()
        videos.append({
            "id": vid,
            "title": title,
            "published": published,
            "url": f"https://www.youtube.com/watch?v={vid}",
            "thumb": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        })
    return channel_title, videos


def main() -> int:
    channel_id, blocklist = read_config()
    try:
        raw = fetch_feed(channel_id)
        channel_title, all_videos = parse_feed(raw)
    except Exception as e:  # noqa: BLE001
        print(f"[fetch_youtube] ERRO ao buscar feed: {e}", file=sys.stderr)
        # Não sobrescreve o JSON existente em caso de falha de rede.
        return 1

    # Filtra fora vídeos políticos/off-brand e títulos genéricos (só data),
    # deduplicando por título (reuploads com o mesmo nome aparecem só uma vez).
    videos = []
    seen_titles = set()
    for v in all_videos:
        if not is_relevant(v["title"], blocklist):
            continue
        key = _norm(v["title"])
        if key in seen_titles:
            continue
        seen_titles.add(key)
        videos.append(v)
        if len(videos) >= MAX_VIDEOS:
            break
    dropped = len(all_videos) - len(videos)
    print(f"[fetch_youtube] {len(all_videos)} no feed -> {len(videos)} relevantes ({dropped} descartados)")

    if not videos:
        print("[fetch_youtube] nenhum vídeo relevante — preserva JSON atual.", file=sys.stderr)
        return 1

    # Só reescreve se a lista de vídeos mudou de fato. O campo "updated" sozinho
    # não deve gerar commit a cada execução do cron (evita ruído e rebuild à toa).
    try:
        with open(OUT_PATH, "r", encoding="utf-8") as f:
            prev = json.load(f)
        if prev.get("channel_id") == channel_id and prev.get("videos") == videos:
            print("[fetch_youtube] sem mudança nos vídeos — JSON preservado.")
            return 0
    except FileNotFoundError:
        pass
    except Exception as e:  # noqa: BLE001
        print(f"[fetch_youtube] aviso ao comparar JSON atual: {e}", file=sys.stderr)

    payload = {
        "channel_id": channel_id,
        "channel_title": channel_title,
        "channel_url": f"https://www.youtube.com/channel/{channel_id}",
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "videos": videos,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"[fetch_youtube] {len(videos)} vídeos gravados em {OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
