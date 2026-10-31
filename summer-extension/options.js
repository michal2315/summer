const DEFAULTS = { serverUrl: SUMMER_URL, contentTypeId: '' };
const $ = (id) => document.getElementById(id);

function show(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

const serverUrl = () => $('serverUrl').value.trim().replace(/\/+$/, '');

/** Servers other than localhost need a host permission, granted from this click. */
async function ensureAccess(url) {
  const origins = [`${new URL(url).origin}/*`];
  return (await chrome.permissions.contains({ origins })) || chrome.permissions.request({ origins });
}

async function loadContentTypes(url, selected) {
  const { token } = await (await fetch(`${url}/api/auth/dev-token`)).json();
  const res = await fetch(`${url}/api/content-type`, { headers: { authorization: `bearer ${token}` } });
  if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
  const types = await res.json();
  const select = $('contentType');
  select.length = 1;
  for (const t of types) select.add(new Option(t.displayName || t.name, t._id, false, t._id === selected));
  return types.length;
}

async function test() {
  try {
    const url = serverUrl();
    if (!(await ensureAccess(url))) return show('לא ניתנה הרשאת גישה לשרת', 'error');
    const n = await loadContentTypes(url, $('contentType').value);
    show(`מחובר ✓ (${n} סוגי תוכן)`, 'ok');
  } catch (e) {
    show(`החיבור נכשל: ${e.message}`, 'error');
  }
}

$('save').addEventListener('click', async () => {
  const url = serverUrl();
  try {
    new URL(url);
  } catch {
    return show('כתובת לא תקינה', 'error');
  }
  if (!(await ensureAccess(url))) return show('לא ניתנה הרשאת גישה לשרת', 'error');
  await chrome.storage.sync.set({ serverUrl: url, contentTypeId: $('contentType').value });
  await chrome.storage.local.remove('token');
  show('נשמר ✓', 'ok');
});

$('test').addEventListener('click', test);

chrome.storage.sync.get(DEFAULTS).then(async (s) => {
  $('serverUrl').value = s.serverUrl;
  try {
    await loadContentTypes(s.serverUrl.replace(/\/+$/, ''), s.contentTypeId);
  } catch {
    /* server not reachable yet — the user can test from the button */
  }
});
