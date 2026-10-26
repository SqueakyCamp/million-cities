// Phone layout: the panel is a bottom sheet over the full-size map. Drag the handle (it follows the finger),
// release to snap to small / medium / large; a tap on the handle cycles through them.
// The map never resizes, so dragging stays smooth; map padding follows the sheet (sheetPadding()).
import { $, isPhone } from './util.js';

const panel = () => $('#panel');
function snaps() {
  const H = $('main').getBoundingClientRect().height;
  return [Math.min(150, H * 0.3), Math.round(H * 0.46), Math.round(H * 0.88)];
}
function setH(h, animate) {
  const p = panel();
  p.classList.toggle('dragging', !animate);
  p.style.height = Math.round(h) + 'px';
  $('main').style.setProperty('--sheet', Math.round(h) + 'px');
}
// padding for flyTo/fitBounds so targets aren't hidden under the sheet
export function sheetPadding(base = 20) {
  if (!isPhone()) return { top: base, bottom: base, left: base, right: base };
  const h = panel().getBoundingClientRect().height;
  return { top: Math.min(base, 30), bottom: Math.min(h, $('main').getBoundingClientRect().height * 0.7) + 12, left: Math.min(base, 30), right: Math.min(base, 30) };
}
// make sure the sheet is at least medium height (e.g. when an info box opens)
export function expandSheet() {
  if (!isPhone()) return;
  const s = snaps(), h = panel().getBoundingClientRect().height;
  if (h < s[1] - 10) setH(s[1], true);
}
export function bindSheet() {
  const g = $('#grip');
  if (!g) return;
  let y0 = null, h0 = 0, moved = false, lastY = 0, lastT = 0, vel = 0;
  g.addEventListener('pointerdown', e => {
    if (!isPhone()) return;
    y0 = lastY = e.clientY; lastT = e.timeStamp; vel = 0; moved = false;
    h0 = panel().getBoundingClientRect().height;
    try { g.setPointerCapture(e.pointerId); } catch { }
    e.preventDefault();
  });
  g.addEventListener('pointermove', e => {
    if (y0 == null) return;
    const dy = e.clientY - y0;
    if (Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    const s = snaps();
    setH(Math.max(s[0] - 30, Math.min(s[2] + 20, h0 - dy)), false);
    const dt = e.timeStamp - lastT;
    if (dt > 0) vel = 0.7 * vel + 0.3 * (e.clientY - lastY) / dt; // px/ms, positive = down
    lastY = e.clientY; lastT = e.timeStamp;
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    const s = snaps(), h = panel().getBoundingClientRect().height;
    let target;
    if (!moved) { // tap: next size up, from the largest back to the smallest
      const i = s.reduce((bi, x, j) => Math.abs(x - h) < Math.abs(s[bi] - h) ? j : bi, 0);
      target = s[(i + 1) % s.length];
    } else {
      const proj = h - vel * 180; // a quick flick carries on
      target = s.reduce((a, b) => Math.abs(b - proj) < Math.abs(a - proj) ? b : a);
    }
    setH(target, true);
  };
  g.addEventListener('pointerup', end);
  g.addEventListener('pointercancel', end);
  addEventListener('resize', () => { if (!isPhone()) { panel().style.height = ''; } });
  if (isPhone()) setH(snaps()[1], true);
}
