// content.js [JSONMODE]
(() => {
  if (window.__AI_TRANSLATOR_VI_LOADED__) return;
  window.__AI_TRANSLATOR_VI_LOADED__ = true;

  const EXCLUDE_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT','SELECT','CODE','PRE','KBD','SAMP','CANVAS','SVG','MATH','IFRAME','OBJECT','EMBED','VIDEO','AUDIO']);
  const translatedNodes = new WeakSet();
  const originalText = new WeakMap();
  const nodeId = new WeakMap();
  let idSeq = 1;
  let enabled = false;
  let pendingScan = null;

  // Toast
  let toastEl = null;
  function showToast(msg, type='info', lingerMs=2000){
    try{
      if (!toastEl){
        toastEl = document.createElement('div');
        toastEl.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:16px;transform:translateX(-50%);padding:10px 14px;border-radius:10px;background:#111;color:#fff;box-shadow:0 4px 24px rgba(0,0,0,.25);font:13px/1.4 system-ui,sans-serif;max-width:70vw;word-break:break-word';
        document.documentElement.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.style.background = type==='error' ? '#b3261e' : (type==='ok' ? '#0a7c2d' : '#111');
      toastEl.style.display = 'block';
      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => { toastEl && (toastEl.style.display='none'); }, lingerMs);
    }catch(e){}
  }

  function isVisible(el){ if (!el || !(el instanceof Element)) return false; const s = getComputedStyle(el); return !(s.display==='none'||s.visibility==='hidden'||s.opacity==='0'); }
  function shouldSkip(node){
    if (!node) return true;
    const p = node.parentElement;
    if (!p) return true;
    if (EXCLUDE_TAGS.has(p.tagName)) return true;
    if (!isVisible(p)) return true;
    if (p.closest('[contenteditable=\"true\"],[role=\"textbox\"],input,textarea')) return true;
    if (translatedNodes.has(node)) return true;
    const t = node.nodeValue;
    if (!t || !/\S/.test(t)) return true;
    if (t.trim().length <= 1) return true;
    return false;
  }

  function collect(root){
    const items = [];
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = walker.nextNode())){
      if (shouldSkip(n)) continue;
      let id = nodeId.get(n);
      if (!id){ id = String(idSeq++); nodeId.set(n,id); originalText.set(n, n.nodeValue); }
      items.push({ id, text: n.nodeValue });
    }
    return items;
  }

  function walkAndCollect(){
    let items = collect(document.body);
    document.querySelectorAll('*').forEach(el => { if (el.shadowRoot) items = items.concat(collect(el.shadowRoot)); });
    return items;
  }

  function applyTranslations(pairs){
    const byId = new Map(pairs.map(x => [String(x.id), x.vi]));
    nodeId.forEach((id, node) => {
      if (translatedNodes.has(node)) return;
      const vi = byId.get(String(id));
      if (typeof vi === 'string' && vi.length){ try { node.nodeValue = vi; translatedNodes.add(node); } catch {} }
    });
  }

  async function translateNow(){
    if (!enabled) return;
    const items = walkAndCollect();
    if (!items.length) { showToast('Không thấy nội dung để dịch.', 'info'); return; }
    showToast('Đang dịch trang...', 'info', 60000);
    try{
      const res = await chrome.runtime.sendMessage({ type: 'TRANSLATE_TEXTS', items });
      if (!res?.ok) throw new Error(res?.error || 'UNKNOWN');
      applyTranslations(res.result);
      showToast('Đã dịch xong.', 'ok');
    }catch(e){
      showToast('Lỗi dịch: ' + (e && e.message ? e.message : e), 'error', 8000);
      console.warn('[AI Translator] translate error:', e);
    }
  }

  function schedule(){ if (!enabled) return; if (pendingScan) return; pendingScan = setTimeout(()=>{ pendingScan=null; translateNow(); }, 400); }

  function enable(){ if (enabled) return; enabled = true; translateNow(); }
  function disable(){
    enabled = false;
    nodeId.forEach((id, node) => { const orig = originalText.get(node); if (typeof orig === 'string'){ try { node.nodeValue = orig; } catch {} } });
    translatedNodes.clear();
    showToast('Đã khôi phục nội dung gốc.', 'ok');
  }

  const mo = new MutationObserver(muts => {
    if (!enabled) return;
    for (const m of muts){
      if (m.type === 'childList' && m.addedNodes?.length) schedule();
      else if (m.type === 'characterData'){
        const n = m.target; if (translatedNodes.has(n)){ originalText.set(n, n.nodeValue); translatedNodes.delete(n); } schedule();
      }
    }
  });
  mo.observe(document.documentElement, { childList:true, characterData:true, subtree:true });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'PING_CS'){ sendResponse({ ok:true }); return; }
    if (msg?.type === 'TRANSLATE_TOGGLE'){ if (msg.on) enable(); else disable(); sendResponse({ ok:true, enabled }); return; }
  });
})();
