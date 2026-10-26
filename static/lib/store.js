// Progress + settings for all pages, in one document.
// With server.py it lives on the server (GET/PUT api/state, shared by all devices); on a static host
// (GitHub Pages) each browser keeps its own copy in localStorage.
//
// Layout: the Million Cities app uses the top level (quiz, cards, bigger, mode, …) for historical reasons;
// every other quiz set keeps its progress in sets[<key>] = {quiz, cards, bigger, ui}.
// basemap + layers are shared by all pages.
const LS_KEY = 'million-cities-state';
export const store = { S: {}, rev: 0, local: false, onRemote: null };
let saveTimer = null, saving = false;

function readLocal() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }

export async function loadState() {
  try {
    if (location.hostname.endsWith('github.io')) throw new Error('static host');
    const r = await fetch('api/state');
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('no api');
    const d = await r.json();
    store.rev = d.rev;
    store.S = d.state || {};
  } catch {
    store.local = true;
    store.S = readLocal();
  }
  store.S.sets ||= {};
  return store.S;
}

// merge one progress block {quiz, cards, bigger} from another copy into ours
function mergeBlock(mine, other) {
  if (!other) return;
  mine.quiz ||= {}; mine.cards ||= {};
  for (const [k, q] of Object.entries(other.quiz || {})) {
    const m = mine.quiz[k];
    if (!m) { mine.quiz[k] = q; continue; }
    if ((q.reset || 0) > (m.reset || 0)) { mine.quiz[k] = q; continue; }
    if ((q.reset || 0) < (m.reset || 0)) continue;
    Object.assign(m.found, q.found);
    m.ms = Math.max(m.ms || 0, q.ms || 0);
    m.gaveUp = m.gaveUp || q.gaveUp;
  }
  for (const [id, c] of Object.entries(other.cards || {})) {
    if (!mine.cards[id] || (c.last || 0) > (mine.cards[id].last || 0)) mine.cards[id] = c;
  }
  if ((other.bigger?.n || 0) > (mine.bigger?.n || 0)) mine.bigger = other.bigger;
}
// union of found answers, newest card stats; settings stay ours
export function mergeState(other) {
  const S = store.S;
  mergeBlock(S, other);
  S.sets ||= {};
  for (const [k, b] of Object.entries(other.sets || {})) {
    if (!S.sets[k]) S.sets[k] = b;
    else mergeBlock(S.sets[k], b);
  }
}

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 700);
}
export async function flush() {
  saveTimer = null;
  if (store.local) { try { localStorage.setItem(LS_KEY, JSON.stringify(store.S)); } catch { } return; }
  if (saving) return save();
  saving = true;
  try {
    const put = () => fetch('api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev: store.rev, state: store.S }) });
    let r = await put();
    if (r.status === 409) {
      const cur = await r.json();
      mergeState(cur.state); store.rev = cur.rev;
      r = await put();
      store.onRemote?.();
    }
    if (r.ok) store.rev = (await r.json()).rev;
  } catch (e) { console.warn('save failed', e); }
  saving = false;
}
// when the tab comes back: pick up what other devices saved meanwhile
export function watchVisibility(beforeHide, afterShow) {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') { beforeHide?.(); if (saveTimer) { clearTimeout(saveTimer); flush(); } return; }
    if (!store.local) {
      try {
        const r = await fetch('api/state').then(r => r.json());
        if (r.rev !== store.rev) { mergeState(r.state); store.rev = r.rev; store.onRemote?.(); }
      } catch { }
    }
    afterShow?.();
  });
}
