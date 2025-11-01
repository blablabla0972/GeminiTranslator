
import os, re, json
from urllib.parse import urlparse
from typing import List, Tuple

import httpx
from bs4 import BeautifulSoup
from bs4.element import NavigableString
from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import PlainTextResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from tenacity import retry, wait_exponential, stop_after_attempt
import google.generativeai as genai

# ---- Config ----
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-2.5-pro")
MAX_BATCH = int(os.getenv("MAX_BATCH", "32"))  # gọn & an toàn
HTTP_TIMEOUT = httpx.Timeout(connect=15.0, read=60.0, write=30.0, pool=30.0)
HTTP_LIMITS = httpx.Limits(max_keepalive_connections=10, max_connections=20)

if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY is required. Set it in Render → Environment.")

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel(MODEL_NAME)

app = FastAPI(title="Gemini HTML Translator (Render)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SKIP_TAGS = {"script", "style", "code", "pre", "kbd", "samp", "noscript"}
ATTRS_TO_TRANSLATE = ["alt", "title", "aria-label"]

def is_valid_url(url: str) -> bool:
    try:
        p = urlparse(url)
        return p.scheme in ("http", "https") and bool(p.netloc)
    except Exception:
        return False

async def fetch_html(url: str) -> Tuple[str, str]:
    headers = {
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/127 Safari/537.36"),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
    }
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True,
                                 headers=headers, limits=HTTP_LIMITS) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.text, str(r.url)

def iter_text_nodes(soup: BeautifulSoup):
    for el in soup.find_all(text=True):
        if isinstance(el, NavigableString):
            parent = el.parent
            if parent and parent.name and parent.name.lower() not in SKIP_TAGS:
                if el.strip():
                    yield el

def chunk_list(items: List[str], size: int):
    return [items[i:i+size] for i in range(0, len(items), size)]

def make_prompt(texts: List[str], target_lang: str):
    return (
        "You are a professional translator. Translate EACH item to "
        f"{target_lang}.\nReturn ONLY a strict JSON array of translated strings, same order.\n"
        "No explanations. Keep URLs, HTML entities, placeholders intact.\n\n"
        f"INPUT:\n{json.dumps(texts, ensure_ascii=False)}"
    )

@retry(wait=wait_exponential(multiplier=1, min=1, max=8), stop=stop_after_attempt(3))
def translate_batch(texts: List[str], target_lang: str):
    prompt = make_prompt(texts, target_lang)
    resp = model.generate_content(prompt)
    raw = (resp.text or "").strip()
    raw = re.sub(r"^```(?:json)?|```$", "", raw).strip()
    data = json.loads(raw)
    if not isinstance(data, list) or len(data) != len(texts):
        raise ValueError("Model returned invalid length or format.")
    return [str(x) if x is not None else "" for x in data]

def add_base_tag(soup: BeautifulSoup, base_href: str):
    if not soup.head:
        if soup.html:
            soup.html.insert(0, soup.new_tag("head"))
    if soup.head and soup.head.find("base") is None:
        base = soup.new_tag("base", href=base_href)
        soup.head.insert(0, base)

def collect_attrs_for_translation(soup: BeautifulSoup):
    items = []
    for attr in ATTRS_TO_TRANSLATE:
        for el in soup.find_all(attrs={attr: True}):
            val = el.get(attr)
            if val and isinstance(val, str) and val.strip():
                items.append((el, attr, val))
    return items

@app.get("/", response_class=JSONResponse)
def root():
    return {
        "service": "Gemini HTML Translator",
        "status": "running",
        "usage": {
            "endpoint": "/translate",
            "example": "/translate?url=https://example.com&lang=vi"
        }
    }

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/translate", response_class=PlainTextResponse)
async def translate_endpoint(
    url: str = Query(..., description="URL cần dịch"),
    lang: str = Query("vi", description="Ngôn ngữ đích, ví dụ: vi, en, ja")
):
    if not is_valid_url(url):
        raise HTTPException(status_code=400, detail="URL không hợp lệ")

    html, final_url = await fetch_html(url)
    soup = BeautifulSoup(html, "html.parser")

    add_base_tag(soup, final_url)

    text_nodes = list(iter_text_nodes(soup))
    node_texts = [str(n) for n in text_nodes]
    attr_items = collect_attrs_for_translation(soup)
    attr_texts = [val for (_, _, val) in attr_items]

    all_texts = node_texts + attr_texts

    translated = []
    for batch in chunk_list(all_texts, MAX_BATCH):
        translated.extend(translate_batch(batch, lang))

    t_iter = iter(translated)
    for node in text_nodes:
        node.replace_with(next(t_iter))
    for el, attr, _ in attr_items:
        el[attr] = next(t_iter)

    return str(soup)

if __name__ == "__main__":
    import uvicorn
    PORT = int(os.getenv("PORT", "8000"))  # Render sẽ set $PORT khi chạy
    uvicorn.run(app, host="0.0.0.0", port=PORT)
