// Small helpers shared by all pages.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Same key as tools/build_data.py:norm() and tools/sets/common.py:norm()
export function norm(s) {
  s = String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/đ/g, 'd').replace(/ł/g, 'l').replace(/ı/g, 'i').replace(/æ/g, 'ae').replace(/œ/g, 'oe');
  return s.replace(/[^a-z0-9]+/g, '');
}
export const fmtPop = p => p >= 1e7 ? (p / 1e6).toFixed(1) + ' M' : p >= 1e6 ? (p / 1e6).toFixed(2) + ' M' : p >= 1e4 ? Math.round(p / 1e3) + ' k' : p >= 1e3 ? (p / 1e3).toFixed(1) + ' k' : String(Math.round(p));
export const fmtInt = n => Math.round(n).toLocaleString('en-US');
export const flag = cc => cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1f1a5 + c.charCodeAt(0))) : '';
export const fmtTime = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
export const dark = matchMedia('(prefers-color-scheme: dark)').matches;
export const isPhone = () => matchMedia('(max-width: 760px)').matches;
export function haversine(a1, o1, a2, o2) {
  const R = 6371, r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
let toastTimer;
export function toast(t) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; $('main').append(el); }
  el.textContent = t; el.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

// Leitner-style practice boxes (0 = new/missed … 4 = solid), "known" = box >= 2.
export const BOXW = [10, 6, 2.5, 1, 0.4];
// Practice difficulty: the pool sorted from easiest (largest / best known) to hardest is cut into LEVELS bands.
// At level L new cards come from band L onward; easier cards come back only while they're not known yet.
export const LEVELS = 5;
export function levelStart(n, level) { return Math.floor(n * level / LEVELS); }
/**
 * Weighted pick of the next practice card.
 * sorted: pool from easiest to hardest; cardOf(x) -> card or undefined; recent: ids shown lately.
 */
export function pickCard(sorted, level, cardOf, recent, idOf = x => x.id) {
  const start = levelStart(sorted.length, level);
  // below the level: only cards that were seen and aren't solid yet (missed / shaky ones)
  const band = sorted.filter((x, i) => i >= start || (cardOf(x) && cardOf(x).box < 2));
  const pool = band.length ? band : sorted;
  const avoid = new Set(recent.slice(-Math.min(recent.length, Math.max(1, Math.floor(pool.length / 2)))));
  let cands = pool.filter(x => !avoid.has(idOf(x)));
  if (!cands.length) cands = pool;
  const seen = cands.filter(x => cardOf(x));
  const unseen = cands.filter(x => !cardOf(x)).slice(0, 8); // in difficulty order: the easiest new ones first
  const from = [...seen, ...unseen];
  const w = from.map(x => cardOf(x) ? BOXW[cardOf(x).box] : 5);
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < from.length; i++) { r -= w[i]; if (r <= 0) return from[i]; }
  return from[from.length - 1];
}
