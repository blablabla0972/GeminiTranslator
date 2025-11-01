const keyEl = document.getElementById('apiKey');
const modelEl = document.getElementById('model');
const msgEl = document.getElementById('msg');
const pingResult = document.getElementById('pingResult');
const testInfo = document.getElementById('testInfo');
const testOutput = document.getElementById('testOutput');

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

function storageSet(area, values){
  return new Promise((resolve, reject) => {
    try {
      chrome.storage[area].set(values, () => {
        if (chrome.runtime?.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function load(){
  let data = await storageGet('sync', ['GEMINI_API_KEY','GEMINI_MODEL']);
  if (!data?.GEMINI_API_KEY || !data?.GEMINI_MODEL){
    const local = await storageGet('local', ['GEMINI_API_KEY','GEMINI_MODEL']);
    data = { ...local, ...data };
  }
  if (data?.GEMINI_API_KEY) keyEl.value = data.GEMINI_API_KEY;
  if (data?.GEMINI_MODEL) modelEl.value = data.GEMINI_MODEL;
}
load();

document.getElementById('saveBtn').addEventListener('click', async () => {
  const key = (document.getElementById('apiKey').value||'').trim();
  const model = (document.getElementById('model').value||'gemini-2.5-flash');
  let stored = false;
  try {
    await storageSet('sync', { GEMINI_API_KEY: key, GEMINI_MODEL: model });
    stored = true;
  } catch (_) {}
  try {
    await storageSet('local', { GEMINI_API_KEY: key, GEMINI_MODEL: model });
    stored = true;
  } catch (_) {}
  if (!stored){
    msgEl.textContent = 'Không thể lưu API key. Kiểm tra lại quyền Storage.';
    msgEl.className = 'hint warn';
    return;
  }
  msgEl.textContent = 'Đã lưu.'; msgEl.className = 'hint ok';
  setTimeout(verifyKey, 150);
});
document.getElementById('pingBtn').addEventListener('click', async () => {
  pingResult.textContent = 'Đang ping...';
  try{
    const res = await chrome.runtime.sendMessage({ type: 'PING_BG' });
    pingResult.textContent = res?.ok ? ('OK @ ' + new Date(res.time).toLocaleTimeString()) : 'Không phản hồi';
    pingResult.className = res?.ok ? 'hint ok' : 'hint warn';
  }catch{ pingResult.textContent = 'Không thể ping.'; pingResult.className = 'hint warn'; }
});

document.getElementById('testBtn').addEventListener('click', async () => {
  testInfo.textContent = 'Đang gọi...'; testOutput.textContent = '';
  try{
    const payload = {
      type: 'TEST_API',
      key: (keyEl.value || '').trim() || undefined,
      model: (modelEl.value || '').trim() || undefined
    };
    const r = await chrome.runtime.sendMessage(payload);
    if (r.ok) { testInfo.textContent = 'OK ('+(r.status||200)+')'; testInfo.className='hint ok'; testOutput.textContent = r.body; }
    else { testInfo.textContent = 'Lỗi: '+(r.error||r.status); testInfo.className='hint warn'; testOutput.textContent = r.body || r.error || ''; }
  }catch(e){ testInfo.textContent = 'Không thể gọi API.'; testInfo.className='hint warn'; testOutput.textContent = String(e); }
});


function looksLikeGoogleKey(k){ return /^AIza[0-9A-Za-z_\-]{20,}$/.test(k.trim()); }

async function verifyKey(){
  const k = (document.getElementById('apiKey').value || '').trim();
  const s = document.getElementById('verifyStatus');
  s.textContent = 'Đang kiểm tra...';
  s.className = 'hint';
  // Quick client-side sanity check
  if (!looksLikeGoogleKey(k)){
    s.textContent = 'Key có vẻ không đúng định dạng (nên bắt đầu bằng AIza...). Vẫn sẽ thử gọi API để chắc chắn.';
    s.className = 'hint warn';
  }
  try{
    const r = await chrome.runtime.sendMessage({ type: 'TEST_API', key: k, model: (modelEl.value || 'gemini-2.5-flash') });
    if (r && r.ok && (r.status===200 || r.status===204)){
      s.textContent = 'Hợp lệ ✓'; s.className = 'hint ok';
    } else {
      s.textContent = 'KHÔNG hợp lệ ✗ (' + (r && (r.status || r.error) || 'unknown') + ')'; s.className = 'hint warn';
      if (r && r.body) {
        try{
          const obj = JSON.parse(r.body);
          if (obj && obj.error && obj.error.message){ s.textContent += ' — ' + obj.error.message; }
        }catch(_){}
      }
    }
  }catch(e){
    s.textContent = 'Không thể gọi TEST_API: ' + String(e); s.className = 'hint warn';
  }
}

document.getElementById('verifyBtn').addEventListener('click', verifyKey);

// Also auto-verify after save
