async function getCurrentTab(){ const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }
function setStatus(t, cls='hint'){ const el=document.getElementById('status'); el.textContent=t; el.className=cls; }

function storageGet(area, keys){
  return new Promise(resolve => {
    try {
      chrome.storage[area].get(keys, (res) => {
        if (chrome.runtime?.lastError) {
          resolve({});
        } else {
          resolve(res || {});
        }
      });
    } catch (_) {
      resolve({});
    }
  });
}

async function getStoredConfig(){
  const syncData = await storageGet('sync', ['GEMINI_API_KEY','GEMINI_MODEL']);
  let key = syncData?.GEMINI_API_KEY;
  let model = syncData?.GEMINI_MODEL;
  if (!key || !model){
    const localData = await storageGet('local', ['GEMINI_API_KEY','GEMINI_MODEL']);
    if (!key && localData?.GEMINI_API_KEY) key = localData.GEMINI_API_KEY;
    if (!model && localData?.GEMINI_MODEL) model = localData.GEMINI_MODEL;
  }
  if (typeof key === 'string') key = key.trim();
  if (typeof model === 'string') model = model.trim();
  return { key, model };
}

function isBlocked(url){
  try{ const u = new URL(url); const s = u.protocol; return /^(chrome|edge|about|view-source):/i.test(s) || s==='chrome-extension:'; }
  catch{ return true; }
}
async function injectCS(tabId){
  try{ await chrome.scripting.executeScript({ target: { tabId, allFrames:true }, files: ['content.js'] }); return true; }
  catch{ setStatus('Không nạp được content script.', 'hint warn'); return false; }
}
async function waitCS(tabId, ms=4000){
  const t0=Date.now(); while(Date.now()-t0<ms){ try{ const r=await chrome.tabs.sendMessage(tabId,{type:'PING_CS'}); if(r&&r.ok) return true; }catch{} await new Promise(r=>setTimeout(r,150)); } return false;
}

async function doToggle(on){
  const tab = await getCurrentTab();
  if (!tab?.id) return;
  if (isBlocked(tab.url)){ setStatus('Trang này bị Chrome chặn sửa DOM.', 'hint warn'); return; }
  if (on){
    const { key } = await getStoredConfig();
    if (!key){
      setStatus('Chưa có API key. Vào Options để thiết lập trước khi dịch.', 'hint warn');
      return;
    }
  }
  try{ const bg=await chrome.runtime.sendMessage({type:'PING_BG'}); if(!bg?.ok) { setStatus('Service worker không phản hồi.', 'hint warn'); return; } }catch{ setStatus('Service worker không phản hồi.', 'hint warn'); return; }
  if (!(await injectCS(tab.id))) return;
  if (!(await waitCS(tab.id))) { setStatus('Content script không sẵn sàng.', 'hint warn'); return; }
  try{
    const res = await chrome.tabs.sendMessage(tab.id, { type:'TRANSLATE_TOGGLE', on });
    if(!res?.ok && res?.ok !== undefined) throw new Error('no response');
    setStatus(on?'Đã gửi lệnh dịch. Xem thông báo trên trang.':'Đã gửi lệnh khôi phục.','hint ok');
    return;
  } catch (primaryError){
    try{
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'ISOLATED',
        func: (flag) => {
          if (typeof window !== 'undefined' && typeof window.__AI_TRANSLATOR_VI_TOGGLE__ === 'function') {
            return window.__AI_TRANSLATOR_VI_TOGGLE__(flag);
          }
          throw new Error('toggle_not_available');
        },
        args: [on]
      });
      if (result?.ok){
        setStatus(on?'Đã gửi lệnh dịch (dùng dự phòng).':'Đã khôi phục (dùng dự phòng).','hint ok');
        return;
      }
      throw new Error(result?.error || 'toggle_failed');
    }catch(fallbackError){
      console.warn('Toggle failed', primaryError, fallbackError);
      setStatus('Không thể gửi lệnh đến trang.','hint warn');
    }
  }
}

document.getElementById('openOptions').addEventListener('click',()=>chrome.runtime.openOptionsPage());

document.getElementById('btnTranslate').addEventListener('click',()=>doToggle(true));
document.getElementById('btnRestore').addEventListener('click',()=>doToggle(false));
