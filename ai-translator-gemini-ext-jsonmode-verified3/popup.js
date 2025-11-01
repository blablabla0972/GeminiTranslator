async function getCurrentTab(){ const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }
function setStatus(t, cls='hint'){ const el=document.getElementById('status'); el.textContent=t; el.className=cls; }

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
  try{ const bg=await chrome.runtime.sendMessage({type:'PING_BG'}); if(!bg?.ok) { setStatus('Service worker không phản hồi.', 'hint warn'); return; } }catch{ setStatus('Service worker không phản hồi.', 'hint warn'); return; }
  if (!(await injectCS(tab.id))) return;
  if (!(await waitCS(tab.id))) { setStatus('Content script không sẵn sàng.', 'hint warn'); return; }
  try{ const res = await chrome.tabs.sendMessage(tab.id, { type:'TRANSLATE_TOGGLE', on }); if(!res?.ok) throw new Error('no response'); setStatus(on?'Đã gửi lệnh dịch. Xem thông báo trên trang.':'Đã gửi lệnh khôi phục.','hint ok'); } catch{ setStatus('Không thể gửi lệnh đến trang.','hint warn'); }
}

document.getElementById('openOptions').addEventListener('click',()=>chrome.runtime.openOptionsPage());

document.getElementById('btnTranslate').addEventListener('click',()=>doToggle(true));
document.getElementById('btnRestore').addEventListener('click',()=>doToggle(false));
