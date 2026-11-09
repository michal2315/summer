// Summer companion extension: right-click selected text → "שליחה לסאמר" → a draft summary on the server.
// Auth mirrors the web client: a token from /api/auth/dev-token, cached, re-fetched once on a 401.

importScripts('config.js');

const MENU_ID = 'send-to-summer';
const DEFAULTS = { serverUrl: SUMMER_URL, contentTypeId: '' };
const MAX_TITLE = 300;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: 'שליחה לסאמר', contexts: ['selection'] });
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  sendSelection(info, tab).catch((e) => notify('השליחה נכשלה', e.message || String(e)));
});

chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith('http')) chrome.tabs.create({ url: id });
  chrome.notifications.clear(id);
});

async function settings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...s, serverUrl: s.serverUrl.replace(/\/+$/, '') };
}

/** The page's own selection keeps line breaks; `info.selectionText` collapses them. */
async function selectedText(info, tab) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [info.frameId ?? 0] }, func: () => getSelection().toString() });
    if (res?.result?.trim()) return res.result;
  } catch {
    /* chrome:// pages, PDFs, the web store — fall back */
  }
  return info.selectionText || '';
}

async function sendSelection(info, tab) {
  const text = (await selectedText(info, tab)).trim();
  if (!text) throw new Error('לא נמצא טקסט מסומן');
  const { serverUrl, contentTypeId } = await settings();
  const url = info.frameUrl || info.pageUrl || tab?.url || '';
  const title = (tab?.title || text.split('\n')[0] || 'טיוטה מהתוסף').trim().slice(0, MAX_TITLE);

  const contentType = contentTypeId || (await firstContentType(serverUrl));
  // Only a sumaroon has a `link` field on the server, so the source goes into the draft's body.
  const payload = { title, contentHtml: toHtml(text, url), contentType, isDraft: true };
  const form = new FormData();
  form.append('summary', JSON.stringify(payload));
  const created = await api(serverUrl, '/api/summary', { method: 'POST', body: form });

  const editUrl = `${serverUrl}/summaries/${created._id}/edit`;
  notify('נשמרה טיוטה בסאמר', `"${title}" — לחצו כדי להמשיך לערוך`, editUrl);
}

async function firstContentType(serverUrl) {
  const types = await api(serverUrl, '/api/content-type');
  if (!types.length) throw new Error('אין סוגי תוכן בשרת');
  return types[0]._id;
}

async function api(serverUrl, path, init = {}, retried = false) {
  const token = await getToken(serverUrl);
  const res = await fetch(serverUrl + path, { ...init, headers: { ...init.headers, authorization: `bearer ${token}` } });
  if (res.status === 401 && !retried) {
    await chrome.storage.local.remove('token');
    return api(serverUrl, path, init, true);
  }
  if (!res.ok) throw new Error(`שגיאת שרת ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function getToken(serverUrl) {
  const { token, tokenServer } = await chrome.storage.local.get(['token', 'tokenServer']);
  if (token && tokenServer === serverUrl) return token;
  const res = await fetch(`${serverUrl}/api/auth/dev-token`);
  if (!res.ok) throw new Error(`ההתחברות לשרת ${serverUrl} נכשלה (${res.status})`);
  const fresh = (await res.json()).token;
  await chrome.storage.local.set({ token: fresh, tokenServer: serverUrl });
  return fresh;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function toHtml(text, url) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const source = /^https?:\/\//i.test(url) ? `<p>מקור: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>` : '';
  return paragraphs + source;
}

function notify(title, message, id = '') {
  chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon-128.png', title, message });
}
