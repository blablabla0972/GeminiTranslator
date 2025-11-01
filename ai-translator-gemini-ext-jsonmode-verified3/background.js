// background.js [JSONMODE]
const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_BATCH = 32;
const THROTTLE_MS = 900;
const MAX_RETRY = 5;

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function buildPrompt(batch){
  const header = [
    'Bạn là engine dịch. Dịch từng "text" sang tiếng Việt.',
    'Nếu KHÔNG bật JSON mode thì phải trả về DUY NHẤT mảng JSON hợp lệ.',
    'Mỗi item: {"id":"<id>","vi":"<bản dịch>"}',
    'Quy tắc: giữ nguyên URL/emoji/số/dấu câu/placeholder {name}, ${value}, %(x)s, <tag>, &amp;; không thêm/bớt; giữ tông giọng.'
  ].join('\n');
  const input = 'Input items (JSON):\n' + JSON.stringify(batch, null, 2);
  return header + '\n\n' + input;
}

function normalizePairs(x){
  function norm(it){
    if (!it || typeof it !== 'object') return null;
    const id = it.id ?? it.i ?? it.key ?? it.k;
    const vi = it.vi ?? it.text ?? it.translation ?? it.v ?? it.t;
    if (id == null || vi == null) return null;
    return { id: String(id), vi: String(vi) };
  }
  if (Array.isArray(x)){
    return x.map(norm).filter(Boolean);
  }
  if (x && typeof x === 'object'){
    // support { "1": "Xin chào", "2": "..." }
    return Object.keys(x).map(k => ({ id: String(k), vi: String(x[k]) }));
  }
  return [];
}

function tryParseJSON(s){
  if (typeof s !== 'string') return null;
  try { return JSON.parse(s); } catch(_){}
  let t = s.trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,'');
  try { return JSON.parse(t); } catch(_){}
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a>=0 && b>a) { try { return JSON.parse(t.slice(a,b+1)); } catch(_){} }
  return null;
}

function makeBody(batch, useJsonMode){
  const body = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(batch) }]}],
    generationConfig: { temperature: 0, maxOutputTokens: 8192 }
  };
  if (useJsonMode){
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, vi: { type: 'STRING' } },
        required: ['id','vi']
      }
    };
  }
  return body;
}

async function rawCall(apiKey, model, batch, useJsonMode){
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  const body = makeBody(batch, useJsonMode);
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const text = await res.text().catch(()=>'');
  let json = null; try { json = text ? JSON.parse(text) : null; } catch(_){}
  return { ok: res.ok, status: res.status, headers: res.headers, text, json };
}

function isSchemaUnsupported(r){
  const msg = (r.json?.error?.message || r.text || '').toLowerCase();
  return r.status === 400 && (msg.includes('responsemimetype') || msg.includes('responseschema') || msg.includes('schema') || msg.includes('unknown field'));
}

async function callWithRetry(apiKey, model, batch){
  let useJsonMode = true; // start with JSON mode
  for (let attempt=0; attempt<MAX_RETRY; attempt++){
    const r = await rawCall(apiKey, model, batch, useJsonMode);
    if (r.ok){
      // In JSON mode, the API usually returns JSON string in candidates.parts[0].text
      const text = r.json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const arr = tryParseJSON(text);
      if (Array.isArray(arr)) { const n = normalizePairs(arr); if (n.length) return n; }
      // If text empty but we are in JSON mode, try to parse direct 'text' in body just in case
      const arr2 = tryParseJSON(r.text);
      if (Array.isArray(arr2)) { const n2 = normalizePairs(arr2); if (n2.length) return n2; }
    } else {
      if (isSchemaUnsupported(r)){
        useJsonMode = false; // fallback to prompt-only mode
        await sleep(400);
        continue;
      }
      // invalid key: stop early
      const msg = (r.json?.error?.message || '').toLowerCase();
      if (r.status === 400 && (msg.includes('api key') || msg.includes('invalid') || msg.includes('expired'))) {
        throw new Error('API_KEY_INVALID: ' + (r.json?.error?.message || 'Invalid/expired'));
      }
      if (r.status === 401 || r.status === 403) throw new Error('AUTH_'+r.status+': ' + (r.json?.error?.message || 'Unauthorized/Forbidden'));
      if (r.status === 429 || r.status >= 500) { await sleep(800 * (attempt+1)); continue; }
      throw new Error('API_HTTP_'+r.status+':'+(r.text||'').slice(0,280));
    }
    // parse failed -> backoff && retry (may switch off JSON mode on next attempt)
    await sleep(500 * (attempt+1));
    if (attempt === 1) useJsonMode = false;
  }
  throw new Error('BAD_JSON_RESPONSE');
}

async function translateItems(items){
  const { GEMINI_API_KEY, GEMINI_MODEL } = await chrome.storage.sync.get(['GEMINI_API_KEY','GEMINI_MODEL']);
  if (!GEMINI_API_KEY) throw new Error('NO_API_KEY');
  const model = GEMINI_MODEL || DEFAULT_MODEL;

  const out = [];
  for (let i=0; i<items.length; i+=MAX_BATCH){
    const chunk = items.slice(i, i+MAX_BATCH);
    const piece = await callWithRetry(GEMINI_API_KEY, model, chunk);
    out.push(...piece);
    await sleep(THROTTLE_MS);
  }
  return out;
}

async function testApi(override){
  const st = await chrome.storage.sync.get(['GEMINI_API_KEY','GEMINI_MODEL']);
  const key = (override && override.key) || st.GEMINI_API_KEY;
  const model = (override && override.model) || st.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!key) return { ok:false, error:'NO_API_KEY' };
  const body = {
    contents: [{ role: 'user', parts: [{ text: 'Trả về JSON mảng: [{"id":"1","text":"Hello world"}] dịch sang tiếng Việt. Chỉ JSON.' }]}],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' }
  };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
  try{
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  }catch(e){ return { ok:false, error:String(e) }; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try{
      if (msg?.type === 'TRANSLATE_TEXTS'){ const result = await translateItems(msg.items||[]); sendResponse({ ok:true, result }); return; }
      if (msg?.type === 'PING_BG'){ sendResponse({ ok:true, time: Date.now() }); return; }
      if (msg?.type === 'TEST_API') { const r = await testApi({ key: msg.key, model: msg.model }); sendResponse(r); return; }
      sendResponse({ ok:false, error:'UNKNOWN_MESSAGE' });
    }catch(e){ sendResponse({ ok:false, error:String(e && e.message ? e.message : e) }); }
  })();
  return true;
});
