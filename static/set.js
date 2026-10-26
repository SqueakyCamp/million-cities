// Generic quiz / practice / atlas for one quiz set (set.html?s=<key>): physical features, languages, Austrian Gemeinden …
// A set is data/sets/<key>.json (items + metadata, see tools/sets/build_*.py), <key>.geojson (shapes, property id)
// and <key>.facts.json ({id: [facts]}, loaded when the first info box opens).
import { $, $$, esc, norm, fmtPop, fmtInt, fmtTime, dark, isPhone, toast, pickCard, LEVELS, levelStart } from './lib/util.js';
import { bindSheet, expandSheet, sheetPadding } from './lib/sheet.js';
import { store, loadState, save, watchVisibility } from './lib/store.js';
import { maplibregl, COL, PAL, empty, DEFAULT_LAYERS, createMap, applyBaseLayers, layersPopover, bindLayers } from './lib/mapbase.js';

const KEY = new URLSearchParams(location.search).get('s') || 'physical';
const [D, GEO] = await Promise.all([
  fetch(`data/sets/${KEY}.json`).then(r => { if (!r.ok) throw new Error('unknown set'); return r.json(); }),
  fetch(`data/sets/${KEY}.geojson`).then(r => r.json()),
]).catch(e => { document.body.innerHTML = `<p style="padding:20px">This quiz doesn't exist. <a href="./">Back to all quizzes</a></p>`; throw e; });
const I = D.items, byId = new Map(I.map(it => [it.id, it]));
const itemOf = v => byId.get(String(v)) ?? byId.get(v);
const CAT = new Map((D.cats || []).map(c => [c.k, c]));
const REG = new Map((D.regs || []).map(r => [r.k, r]));
const PLACES = D.kind === 'places', LANGS = D.kind === 'languages';
const noun = n => n === 1 ? D.noun[0] : D.noun[1];
document.title = `${D.title} · Atlas Quiz`;
$('#setTitle').textContent = D.title;
$('#subtitle').textContent = D.sub;
$('#aboutTitle').textContent = D.title;
$('#aboutBody').innerHTML = D.about || '';
$('#whatLabel').textContent = D.catLabel || 'What';
$('#whereLabel').textContent = D.regLabel || 'Where';
$('#atlasSearch').placeholder = `Search ${D.noun[1]}…`;
if (!D.cats) $('#whatSel').parentElement.hidden = true;

// geometry per id (shapes can be several features, e.g. a language's core + secondary areas)
const SHAPES = new Map();
for (const f of GEO.features) {
  const id = String(f.properties.id);
  if (!SHAPES.has(id)) SHAPES.set(id, []);
  SHAPES.get(id).push(f);
}
// rough size, used to prefer the smallest shape when several are under the cursor
for (const it of I) it.size = it.bb ? (it.bb[2] - it.bb[0]) * (it.bb[3] - it.bb[1]) : 1e4;

// answers: name + aliases (+ without a leading "the")
const answers = {};
const addAns = (k, id) => { if (k) (answers[k] ||= []).includes(id) || answers[k].push(id); };
for (const it of I) for (const a of [it.name, ...(it.alias || [])]) { const k = norm(a); addAns(k, it.id); if (k.startsWith('the')) addAns(k.slice(3), it.id); }

// measure used for sorting, "Bigger?" and the list column
const measureOf = it => D.bigger || CAT.get(it.cat)?.m || Object.keys(it.m || {})[0];
const val = (it, m = measureOf(it)) => it.m?.[m];
function fmtVal(v, fmt) {
  if (v == null) return '';
  if (fmt === 'pop') return fmtPop(v);
  if (fmt === 'popM') return v >= 10 ? Math.round(v) + ' M' : v >= 1 ? v.toFixed(1) + ' M' : Math.round(v * 1000) + ' k';
  if (fmt === 'km2') return v >= 1e6 ? (v / 1e6).toFixed(1) + ' M km²' : fmtInt(v) + ' km²';
  if (fmt === 'km') return fmtInt(v) + ' km';
  if (fmt === 'm') return fmtInt(v) + ' m';
  if (fmt === 'area') return v >= 100 ? fmtInt(v) : v.toFixed(1);
  if (fmt === 'dens') return fmtInt(v);
  if (fmt === 'pct') return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  if (fmt === 'rank') return '#' + v;
  if (fmt === 'int') return fmtInt(v);
  return String(v);
}
const fmtMeasure = (it, m = measureOf(it)) => m && val(it, m) != null ? fmtVal(val(it, m), D.measures[m]?.fmt) : '';
const ICON = { ocean: '🌊', sea: '🌊', bay: '🌊', strait: '⛴️', river: '〰️', lake: '💧', waterfall: '💦', glacier: '🧊', continent: '🌍', range: '⛰️', peak: '🏔️', desert: '🏜️', plateau: '🗻', lowland: '🌾', peninsula: '🏖️', island: '🏝️', region: '📍' };
const leftCol = it => PLACES ? String(it.imp) : ICON[it.cat] || '';
const catLabel = it => CAT.get(it.cat)?.label || it.cat || '';
const ONE = { ocean: 'Ocean', sea: 'Sea', bay: 'Gulf or bay', strait: 'Strait', river: 'River', lake: 'Lake', waterfall: 'Waterfall', glacier: 'Glacier or ice sheet', continent: 'Continent', range: 'Mountain range', peak: 'Mountain', desert: 'Desert', plateau: 'Plateau or highland', lowland: 'Plain, basin or valley', peninsula: 'Peninsula or cape', island: 'Island', region: 'Region' };
const catOne = it => ONE[it.cat] || catLabel(it);
// short context under a name
function context(it) {
  if (PLACES) return `${esc(it.reg)} · ${fmtPop(it.m.pop)} · #${it.imp} in Austria`;
  if (LANGS) return `${esc(it.family)}${it.cat2 ? ' · ' + esc(it.cat2) : ''} · ${fmtPop(it.m.l1)} native speakers`;
  const where = it.cs?.length ? it.cs.slice(0, 3).join(', ') + (it.cs.length > 3 ? ' …' : '') : (REG.get(it.reg)?.label || '');
  const mv = fmtMeasure(it);
  return `${esc(catOne(it))} · ${esc(where)}${mv ? ' · ' + mv : ''}`;
}

// ------------------------------------------------------------------ state
// this set's progress: S.sets[KEY] = {quiz: {scope: {found, ms, gaveUp, reset}}, cards: {id: {box, ok, bad, last}}, bigger, ui}
const UI_DEFAULT = { mode: 'quiz', what: 'all', where: 'all', pracMode: 'name', level: {}, atlasSort: 'imp', hintDots: !PLACES, flyTo: false, hideNames: false };
let S, P, U;
function adopt() {
  S = store.S;
  S.basemap ||= 'terrain';
  S.layers = Object.assign({}, DEFAULT_LAYERS, { setOutlines: true }, S.layers);
  P = S.sets[KEY] ||= {};
  P.quiz ||= {}; P.cards ||= {}; P.bigger ||= { ok: 0, n: 0 };
  U = P.ui = Object.assign({}, UI_DEFAULT, P.ui);
}
await loadState();
adopt();
store.onRemote = () => { adopt(); renderAll(); };
$('#storageNote').textContent = store.local ? 'Your progress is saved in this browser only.' : 'Progress is saved on the server, so all your devices share it.';

// ------------------------------------------------------------------ scope ("what" × "where")
// what: all | g:<group> | c:<cat> | b:<branch>; where: all | <region>
function inWhat(it, w) {
  if (w === 'all') return true;
  if (w.startsWith('g:')) return CAT.get(it.cat)?.grp === w.slice(2);
  if (w.startsWith('c:')) return it.cat === w.slice(2);
  if (w.startsWith('b:')) return it.cat2 === w.slice(2);
  return true;
}
const inWhere = (it, w) => w === 'all' || it.reg === w;
const scopeItems = (what = U.what, where = U.where) => I.filter(it => inWhat(it, what) && inWhere(it, where));
const scopeKey = () => `${U.what}|${U.where}`;
function scopeLabel() {
  const w = U.what === 'all' ? `All ${D.noun[1]}` : $('#whatSel').selectedOptions[0]?.textContent.replace(/ \(\d+\)$/, '') || '';
  return U.where === 'all' ? w : `${w} · ${REG.get(U.where)?.label || U.where}`;
}
function fillScopes() {
  const n = f => I.filter(f).length;
  const opt = (k, label, c) => `<option value="${esc(k)}">${esc(label)} (${c})</option>`;
  let h = `<option value="all">All ${esc(D.noun[1])} (${I.length})</option>`;
  if (D.cats) {
    const groups = [...new Set(D.cats.map(c => c.grp).filter(Boolean))];
    if (groups.length > 1) h += `<optgroup label="Groups">${groups.map(g => opt('g:' + g, g === 'Water' ? 'All water' : g === 'Land' ? 'All land' : g, n(it => CAT.get(it.cat)?.grp === g))).join('')}</optgroup>`;
    h += `<optgroup label="${esc(D.catLabel || 'Type')}">${D.cats.map(c => opt('c:' + c.k, c.label, n(it => it.cat === c.k))).join('')}</optgroup>`;
    if (D.cat2Label) {
      const br = {};
      for (const it of I) if (it.cat2) br[it.cat2] = (br[it.cat2] || 0) + 1;
      const bl = Object.entries(br).filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]);
      if (bl.length) h += `<optgroup label="${esc(D.cat2Label)}">${bl.map(([k, c]) => opt('b:' + k, k, c)).join('')}</optgroup>`;
    }
  }
  $('#whatSel').innerHTML = h;
  $('#whereSel').innerHTML = `<option value="all">${PLACES ? 'All of Austria' : 'Whole world'}</option>` + (D.regs || []).map(r => opt(r.k, r.label, n(it => it.reg === r.k))).filter(x => !x.includes('(0)')).join('');
  $('#whatSel').value = U.what; $('#whereSel').value = U.where;
  if ($('#whatSel').value !== U.what) U.what = $('#whatSel').value = 'all';
  if ($('#whereSel').value !== U.where) U.where = $('#whereSel').value = 'all';
}
fillScopes();
$('#whatSel').onchange = e => { U.what = e.target.value; scopeChanged(); };
$('#whereSel').onchange = e => { U.where = e.target.value; scopeChanged(); };
function scopeChanged() {
  save(); selected = null; popup?.remove(); recent.length = 0;
  $('#qDetail').hidden = true; $('#detail').hidden = true;
  if (U.mode === 'quiz') renderQuiz(true); else if (U.mode === 'atlas') renderAtlas(true); else startPractice();
}

// ------------------------------------------------------------------ map
const lineTypes = ['LineString', 'MultiLineString'], polyTypes = ['Polygon', 'MultiPolygon'];
const isType = types => ['match', ['geometry-type'], types, true, false];
const map = createMap({
  sources: {
    shapes: { type: 'geojson', data: GEO, attribution: PLACES ? 'Statistik Austria' : 'Natural Earth' },
    anchors: { type: 'geojson', data: empty },
    mark: { type: 'geojson', data: empty },
  },
  middle: [
    { id: 'sh-fill', type: 'fill', source: 'shapes', filter: ['in', ['get', 'id'], ['literal', []]], paint: { 'fill-color': COL.atlas, 'fill-opacity': 0.25 } },
    { id: 'sh-line', type: 'line', source: 'shapes', filter: ['in', ['get', 'id'], ['literal', []]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': COL.atlas, 'line-width': 1 } },
    { id: 'sh-pt', type: 'circle', source: 'shapes', filter: ['in', ['get', 'id'], ['literal', []]], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4, 8, 7], 'circle-color': COL.atlas, 'circle-stroke-color': dark ? '#0e1a24' : '#fff', 'circle-stroke-width': 1.5 } },
  ],
  top: [
    { id: 'mark-line', type: 'line', source: 'mark', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': COL.target, 'line-width': 2, 'line-dasharray': [2, 2] } },
    { id: 'mark-pt', type: 'circle', source: 'mark', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': 'transparent', 'circle-stroke-color': COL.target, 'circle-stroke-width': 2 } },
    {
      id: 'dots', type: 'circle', source: 'anchors', filter: ['==', ['get', 'dot'], true], layout: { 'circle-sort-key': ['get', 'v'] }, paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['interpolate', ['linear'], ['sqrt', ['get', 'v']], 90, 2.5, 1430, 9], 10, ['interpolate', ['linear'], ['sqrt', ['get', 'v']], 90, 6, 1430, 22]],
        'circle-color': ['match', ['get', 'st'], 'found', COL.found, 'miss', COL.miss, 'hint', COL.hint, 'target', COL.target, 'sel', COL.target, COL.atlas],
        'circle-opacity': ['match', ['get', 'st'], 'hint', 0.55, 0.85],
        'circle-stroke-color': dark ? '#0e1a24' : '#ffffff', 'circle-stroke-width': ['match', ['get', 'st'], 'target', 3, 'sel', 2.5, 1],
      },
    },
    ...[['alabels', false], ['alabels-pt', true]].map(([id, pt]) => ({
      id, type: 'symbol', source: 'anchors', filter: ['all', ['to-boolean', ['get', 'label']], ['==', ['get', 'pt'], pt]], layout: {
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['interpolate', ['linear'], ['get', 'imp'], 1, 13, 300, 10.5], 6, ['interpolate', ['linear'], ['get', 'imp'], 1, 16, 300, 12]],
        // point features (towns, peaks) get the label beside them, areas and rivers in the middle
        'text-variable-anchor': pt ? ['left', 'right', 'top', 'bottom'] : ['center'],
        'text-radial-offset': pt ? 0.7 : 0, 'text-justify': 'auto', 'symbol-sort-key': ['get', 'imp'], 'text-max-width': 8, 'text-padding': 1,
      },
      paint: { 'text-color': ['match', ['get', 'st'], 'miss', COL.miss, PAL.text], 'text-halo-color': PAL.halo, 'text-halo-width': 1.6 },
    })),
  ],
});
if (D.bbox) map.fitBounds([[D.bbox[0], D.bbox[1]], [D.bbox[2], D.bbox[3]]], { padding: 30, duration: 0 });

$('#layers').innerHTML = layersPopover(PLACES ? [['setOutlines', 'Municipal boundaries']] : []);
function applyLayers() {
  const sat = applyBaseLayers(map, S);
  for (const id of ['alabels', 'alabels-pt']) {
    map.setPaintProperty(id, 'text-halo-color', sat ? '#000' : PAL.halo);
    map.setPaintProperty(id, 'text-color', ['match', ['get', 'st'], 'miss', sat ? '#ff8a8a' : COL.miss, sat ? '#fff' : PAL.text]);
  }
  renderMap();
}
bindLayers(map, S, () => { applyLayers(); save(); });

// what the map shows: {id: status}; status = found | miss | hint | target | sel | atlas
let view = new Map(), labels = new Set();
function setView(statusById, labelIds) { view = statusById; labels = labelIds; renderMap(); }
const STATUS_COL = { found: COL.found, miss: COL.miss, hint: COL.hint, target: COL.target, sel: COL.target, atlas: COL.atlas };
function matchExpr(byStatus, fallback) {
  const groups = {};
  for (const [id, st] of view) (groups[st] ||= []).push(id);
  const e = ['match', ['get', 'id']];
  for (const [st, ids] of Object.entries(groups)) if (byStatus[st] != null) e.push(ids, byStatus[st]);
  return e.length > 2 ? [...e, fallback] : fallback;
}
function renderMap() {
  if (!map.getLayer('sh-fill')) return;
  const ids = [...view.keys()];
  const showShapes = !PLACES || S.layers.setOutlines;
  const shapeIds = PLACES ? ids.filter(id => showShapes || view.get(id) === 'target' || view.get(id) === 'sel') : ids;
  const inIds = ['in', ['get', 'id'], ['literal', shapeIds]];
  map.setFilter('sh-fill', ['all', isType(polyTypes), inIds]);
  map.setFilter('sh-line', ['all', ['any', isType(lineTypes), isType(polyTypes)], inIds]);
  map.setFilter('sh-pt', ['all', ['==', ['geometry-type'], 'Point'], inIds]);
  const color = matchExpr(STATUS_COL, COL.atlas);
  // fills stay light so the map underneath (and overlapping areas) can be read; secondary language areas lighter still
  const op = PLACES ? { found: 0.3, miss: 0.25, hint: 0.08, target: 0.4, sel: 0.4, atlas: 0.1 } : LANGS ? { found: 0.4, miss: 0.35, hint: 0.18, target: 0.5, sel: 0.55, atlas: 0.3 } : { found: 0.32, miss: 0.3, hint: 0.2, target: 0.45, sel: 0.5, atlas: 0.25 };
  const opacity = matchExpr(op, 0.25);
  map.setPaintProperty('sh-fill', 'fill-color', color);
  map.setPaintProperty('sh-fill', 'fill-opacity', LANGS ? ['*', opacity, ['case', ['==', ['get', 't'], 'also'], 0.4, 1]] : opacity);
  map.setPaintProperty('sh-line', 'line-color', color);
  const hi = ids.filter(id => ['target', 'sel'].includes(view.get(id))).concat(['\u0000']);
  const lw = (river, riverHi, edge, edgeHi) => ['case', isType(lineTypes), ['match', ['get', 'id'], hi, riverHi, river], PLACES ? edge : ['match', ['get', 'id'], hi, edgeHi, edge]];
  map.setPaintProperty('sh-line', 'line-width', ['interpolate', ['linear'], ['zoom'], 1, lw(2, 3.5, 0.6, 1.8), 7, lw(3.5, 5, 0.9, 2.4)]);
  map.setPaintProperty('sh-line', 'line-opacity', LANGS ? ['case', ['==', ['get', 't'], 'also'], 0.45, 0.9] : 0.9);
  map.setPaintProperty('sh-pt', 'circle-color', color);
  // anchors: dots (places) and name labels
  map.getSource('anchors').setData({
    type: 'FeatureCollection',
    features: ids.map(id => {
      const it = byId.get(id), st = view.get(id);
      return { type: 'Feature', geometry: { type: 'Point', coordinates: it.ll }, properties: { id, st, imp: it.imp, v: PLACES ? it.m.pop / 1000 : 0, dot: PLACES, pt: PLACES || it.g === 'pt', label: labels.has(id) ? it.name : '' } };
    }),
  });
}
function setMark(features) { map.getSource('mark').setData({ type: 'FeatureCollection', features }); }
function mapPadding() { return sheetPadding(isPhone() ? 20 : 50); }
const worldView = () => map.flyTo({ center: [20, 20], zoom: isPhone() ? 0.6 : 1.5, duration: 900, padding: sheetPadding(0) });
function fitItems(list, maxZoom = PLACES ? 9 : 5) {
  if (!list.length) return;
  let w = 180, e = -180, s = 90, n = -90;
  for (const it of list) {
    const b = it.bb || [it.ll[0], it.ll[1], it.ll[0], it.ll[1]];
    if (!it.bb && !['pt'].includes(it.g)) return worldView();
    w = Math.min(w, b[0]); s = Math.min(s, b[1]); e = Math.max(e, b[2]); n = Math.max(n, b[3]);
  }
  if (e - w > 200) return worldView();
  if (e - w < 0.01) return map.flyTo({ center: [w, s], zoom: maxZoom, padding: mapPadding(), speed: 1.6 });
  map.fitBounds([[w, s], [e, n]], { padding: sheetPadding(isPhone() ? 30 : 70), maxZoom, duration: 900 });
}
function flyToItem(it, minZoom) {
  if (it.g === 'pt' || PLACES) map.flyTo({ center: it.ll, zoom: Math.max(map.getZoom(), minZoom ?? (PLACES ? 10 : 6)), speed: 1.6, padding: mapPadding() });
  else fitItems([it], 7);
}
let popup = null;
function showPopup(it, lngLat) {
  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: false, offset: 10, maxWidth: '260px' })
    .setLngLat(lngLat || it.ll)
    .setHTML(`<b>${esc(it.name)}</b><br><span class="dim">${context(it)}</span>`)
    .addTo(map);
}

// ids under the cursor, smallest first (points, then lines, then the smallest area)
function hitsAt(point) {
  const bb = [[point.x - 6, point.y - 6], [point.x + 6, point.y + 6]];
  const fs = map.queryRenderedFeatures(bb, { layers: ['sh-pt', 'sh-line', 'sh-fill', 'dots', 'alabels', 'alabels-pt'] });
  const rank = f => f.layer.id === 'dots' || f.layer.id === 'sh-pt' ? 0 : f.layer.id.startsWith('alabels') ? 0.5 : f.layer.id === 'sh-line' && lineTypes.includes(f.geometry.type) ? 1 : 2;
  const best = new Map();
  for (const f of fs) {
    const id = String(f.properties.id), r = rank(f);
    if (f.layer.id === 'sh-line' && r === 2) continue; // polygon outlines: the fill decides
    if (!best.has(id) || best.get(id) > r) best.set(id, r);
  }
  return [...best.entries()].map(([id, r]) => [byId.get(id), r]).filter(x => x[0]).sort((a, b) => a[1] - b[1] || a[0].size - b[0].size).map(x => x[0]);
}

// ------------------------------------------------------------------ geometry tests for "Find it"
const KX = lat => 111.32 * Math.cos(lat * Math.PI / 180), KY = 110.57;
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// distance in km from (lon, lat) to an item's shapes (0 = inside)
function distanceTo(it, lon, lat) {
  const lines = [], polys = [], pts = [];
  for (const f of SHAPES.get(it.id) || []) {
    const g = f.geometry;
    if (g.type === 'Point') pts.push(g.coordinates);
    else if (g.type === 'MultiPoint') pts.push(...g.coordinates);
    else if (g.type === 'LineString') lines.push(g.coordinates);
    else if (g.type === 'MultiLineString') lines.push(...g.coordinates);
    else if (g.type === 'Polygon') polys.push(g.coordinates);
    else if (g.type === 'MultiPolygon') polys.push(...g.coordinates);
  }
  const kx = KX(lat), edges = [...lines, ...polys.map(p => p[0])];
  let best = Infinity;
  for (const shift of [0, 360, -360]) {
    const x = lon + shift;
    if (polys.some(p => inRing(x, lat, p[0]) && !p.slice(1).some(h => inRing(x, lat, h)))) return 0;
    for (const [px, py] of pts) best = Math.min(best, Math.hypot((px - x) * kx, (py - lat) * KY));
    for (const l of edges) for (let i = 1; i < l.length; i++) best = Math.min(best, segDist(x * kx, lat * KY, l[i - 1][0] * kx, l[i - 1][1] * KY, l[i][0] * kx, l[i][1] * KY));
  }
  return best;
}

// ------------------------------------------------------------------ modes
function setMode(m) {
  U.mode = m;
  $$('.modes button').forEach(b => b.setAttribute('aria-selected', b.dataset.mode === m));
  $$('.mode').forEach(s => s.classList.toggle('on', s.id === 'mode-' + m));
  setMark([]); popup?.remove();
  $('#qDetail').hidden = true;
  if (findHandler) { map.off('click', findHandler); findHandler = null; }
  if (m === 'quiz') renderQuiz(true);
  if (m === 'practice') startPractice();
  if (m === 'atlas') renderAtlas(true);
  save();
}
$$('.modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
function renderAll() { fillScopes(); if (U.mode === 'quiz') renderQuiz(); else if (U.mode === 'atlas') renderAtlas(); else renderPracticeStats(); }

// ------------------------------------------------------------------ QUIZ
const QZ = () => P.quiz[scopeKey()] ||= { found: {}, ms: 0, gaveUp: false, reset: Date.now() };
let lastTick = Date.now();
function quizTick() {
  const now = Date.now(), q = P.quiz[scopeKey()];
  if (U.mode === 'quiz' && q && Object.keys(q.found).length && !q.gaveUp && document.visibilityState === 'visible') {
    if (scopeItems().some(it => !q.found[it.id])) q.ms = (q.ms || 0) + Math.min(now - lastTick, 5000);
  }
  lastTick = now;
  if (q) $('#qTimer').textContent = fmtTime(q.ms || 0);
}
setInterval(quizTick, 1000);
setInterval(() => { if (U.mode === 'quiz') save(); }, 20000);
watchVisibility(() => quizTick(), () => { lastTick = Date.now(); });

for (const id of ['hintDots', 'flyTo']) $('#' + id).onchange = e => { U[id] = e.target.checked; renderQuiz(); save(); };
$('#hintLabel').textContent = PLACES ? 'Show dots for the missing ones' : `Show the missing ${D.noun[1]} (unnamed)`;
$('#giveUp').onclick = () => { const q = QZ(); q.gaveUp = !q.gaveUp; renderQuiz(); save(); };
$('#resetQuiz').onclick = () => {
  const n = Object.keys(QZ().found).length;
  if (n && !confirm(`Restart "${scopeLabel()}"? Your ${n} answers for it are cleared.`)) return;
  P.quiz[scopeKey()] = { found: {}, ms: 0, gaveUp: false, reset: Date.now() };
  renderQuiz(true); save(); $('#answer').focus();
};

let pendingTimer = null;
function quizMsg(text, cls = '') { const m = $('#quizMsg'); m.textContent = text; m.className = 'msg ' + cls; }
function tryAnswer(final) {
  const inp = $('#answer'), raw = inp.value.trim(), key = norm(raw);
  clearTimeout(pendingTimer);
  if (!key) return;
  const q = QZ(), pool = scopeItems(), inScope = new Set(pool.map(it => it.id));
  const ids = (answers[key] || []).filter(id => inScope.has(id));
  const fresh = ids.filter(id => !q.found[id]);
  if (fresh.length) {
    // wait if this is also the start of another answer still to find ("Niger" → "Nigeria")
    if (!final && Object.keys(answers).some(k => k !== key && k.startsWith(key) && answers[k].some(id => inScope.has(id) && !q.found[id] && !ids.includes(id)))) {
      pendingTimer = setTimeout(() => tryAnswer(true), 900);
      return;
    }
    const t = Date.now();
    for (const id of fresh) q.found[id] = t;
    const its = fresh.map(id => byId.get(id));
    quizMsg('✓ ' + its.map(it => it.name + (fmtMeasure(it) ? ` (${fmtMeasure(it)})` : '')).join(', '), 'good');
    inp.value = ''; inp.classList.remove('bad'); inp.classList.add('good'); setTimeout(() => inp.classList.remove('good'), 400);
    renderQuiz();
    if (U.flyTo) flyToItem(its[0], PLACES ? 9 : 4);
    save();
    if (pool.every(it => q.found[it.id])) quizMsg(`🎉 All ${pool.length} found in ${fmtTime(q.ms)}!`, 'good');
    return;
  }
  if (!final) return;
  let why = 'Not on the list', cls = 'bad';
  if (ids.length) { why = `Already found: ${ids.map(id => byId.get(id).name).join(', ')}`; cls = 'warn'; }
  else if ((answers[key] || []).length) {
    const it = byId.get(answers[key][0]);
    why = `${it.name} is on the list, but not in this selection (${[catLabel(it), REG.get(it.reg)?.label].filter(Boolean).join(' · ')})`;
    cls = 'warn';
  }
  quizMsg(why, cls);
  inp.classList.remove('bad'); void inp.offsetWidth; inp.classList.add('bad');
  inp.select();
}
$('#answer').addEventListener('input', () => tryAnswer(false));
$('#answer').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tryAnswer(true); } });

function renderQuiz(refit) {
  if (refit) $('#qDetail').hidden = true;
  const q = QZ(), pool = scopeItems();
  $('#hintDots').checked = U.hintDots; $('#flyTo').checked = U.flyTo;
  const found = pool.filter(it => q.found[it.id]);
  $('#qFound').textContent = found.length; $('#qTotal').textContent = pool.length;
  $('#qPct').textContent = pool.length ? Math.floor(100 * found.length / pool.length) : 0;
  $('#qBar').style.width = (pool.length ? 100 * found.length / pool.length : 0) + '%';
  $('#qTimer').textContent = fmtTime(q.ms || 0);
  $('#giveUp').textContent = q.gaveUp ? 'Hide missing again' : 'Give up & show missing';
  $('#answer').disabled = !pool.length;
  $('#answer').placeholder = pool.length ? `Type ${LANGS ? 'a language' : PLACES ? 'a town' : 'a name'}…` : 'Nothing in this selection';

  // progress by region (whole world) or by type (one region)
  const byReg = U.where === 'all' && D.regs?.length > 1;
  const keyOf = byReg ? (it => it.reg) : (it => it.cat || it.reg);
  const labelOf = byReg ? (k => REG.get(k)?.label || k) : (k => CAT.get(k)?.label || k);
  const groups = new Map();
  for (const it of pool) { const k = keyOf(it); if (!groups.has(k)) groups.set(k, { n: 0, f: 0 }); const g = groups.get(k); g.n++; if (q.found[it.id]) g.f++; }
  const gl = groups.size > 1 ? [...groups.entries()].sort((a, b) => b[1].n - a[1].n) : [];
  $('#qRegionsTitle').textContent = byReg ? `By ${(D.regLabel || 'region').toLowerCase()}` : `By ${(D.catLabel || 'type').toLowerCase()}`;
  $('#qRegions').innerHTML = gl.map(([k, g]) => `<div class="region" data-k="${esc(k)}"><b>${esc(labelOf(k))}</b><span>${g.f} / ${g.n}</span><div class="bar"><i style="width:${100 * g.f / g.n}%"></i></div></div>`).join('');
  $$('#qRegions .region').forEach(el => el.onclick = () => fitItems(pool.filter(it => keyOf(it) === el.dataset.k)));
  $('#qRegionsTitle').hidden = !gl.length;

  const missing = q.gaveUp ? pool.filter(it => !q.found[it.id]) : [];
  $('#qListTitle').textContent = q.gaveUp ? `Missing (${missing.length}) and found (${found.length})` : `Found (${found.length})`;
  const rows = [...missing.map(it => [it, 'miss']), ...found.sort((a, b) => q.found[b.id] - q.found[a.id]).map(it => [it, 'found'])];
  $('#qList').innerHTML = rows.map(([it, cls]) => listRow(it, cls)).join('');
  $$('#qList li').forEach(li => li.onclick = () => { const it = itemOf(li.dataset.id); flyToItem(it); showPopup(it); quizInfo(it); });

  const st = new Map(), lab = new Set();
  for (const it of pool) {
    if (q.found[it.id]) { st.set(it.id, 'found'); lab.add(it.id); }
    else if (q.gaveUp) { st.set(it.id, 'miss'); lab.add(it.id); }
    else if (U.hintDots) st.set(it.id, 'hint');
  }
  setView(st, lab);
  if (refit) {
    if (D.bbox && U.where === 'all') map.fitBounds([[D.bbox[0], D.bbox[1]], [D.bbox[2], D.bbox[3]]], { padding: sheetPadding(30), duration: 800 });
    else if (U.where === 'all') worldView(); else fitItems(pool);
  }
  if (!isPhone()) setTimeout(() => $('#answer').focus(), 0);
}
function listRow(it, cls = '') {
  return `<li class="${cls}" data-id="${esc(it.id)}"><span class="rk">${leftCol(it)}</span><span class="nm">${esc(it.name)} <small>${esc(PLACES ? it.reg : LANGS ? it.endonym || '' : (it.cs || []).slice(0, 2).join(', ') || REG.get(it.reg)?.label || '')}</small></span><span class="pp">${fmtMeasure(it)}</span></li>`;
}
function quizInfo(it) {
  showInfo($('#qDetail'), it);
  $('#qDetail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  expandSheet();
}

// ------------------------------------------------------------------ PRACTICE
const recent = [];
let cur = null, session = { ok: 0, n: 0 }, findHandler = null;
$('#pracSeg').onclick = e => { const v = e.target.closest('button')?.dataset.v; if (v) { U.pracMode = v; save(); startPractice(); } };
const card = id => P.cards[id] ||= { box: 0, ok: 0, bad: 0, last: 0 };
function grade(it, ok) {
  const k = card(it.id);
  k.last = Date.now();
  if (ok) { k.ok++; k.box = Math.min(4, k.box + 1); } else { k.bad++; k.box = 0; }
  session.n++; if (ok) session.ok++;
  recent.push(it.id); if (recent.length > 8) recent.shift();
  renderPracticeStats(); save();
}
// easiest first: biggest towns / best-known features / most-spoken languages
const byEase = pool => [...pool].sort((a, b) => a.imp - b.imp);
const pracLevel = () => Math.min(LEVELS - 1, U.level[scopeKey()] || 0);
const pick = pool => pickCard(byEase(pool), pracLevel(), it => P.cards[it.id], recent);
function renderLevel() {
  const pool = byEase(scopeItems()), L = pracLevel(), i = levelStart(pool.length, L), it = pool[i];
  const what = PLACES ? 'towns' : D.noun[1];
  $('#pLevel').innerHTML = `<b>Level ${L + 1} of ${LEVELS}</b><small>${L === 0 ? `New ${what} come in ${PLACES ? 'largest' : 'best-known'} first` : it ? `New ${what} from #${i + 1} (${esc(it.name)}) on; easier ones only come back until you know them` : ''}</small>`;
  $('#pEasier').disabled = L === 0; $('#pHarder').disabled = L === LEVELS - 1 || pool.length < LEVELS * 2;
}
$('#pEasier').onclick = () => { U.level[scopeKey()] = Math.max(0, pracLevel() - 1); recent.length = 0; save(); renderLevel(); nextCard(); };
$('#pHarder').onclick = () => { U.level[scopeKey()] = Math.min(LEVELS - 1, pracLevel() + 1); recent.length = 0; save(); renderLevel(); nextCard(); };
function renderPracticeStats() {
  const pool = scopeItems();
  const known = pool.filter(it => (P.cards[it.id]?.box || 0) >= 2).length;
  $('#pKnown').textContent = known; $('#pTotal').textContent = pool.length;
  $('#pKnownBar').style.width = (pool.length ? 100 * known / pool.length : 0) + '%';
  $('#pSession').textContent = `${session.ok} / ${session.n}`;
  $('#biggerBtn').hidden = !pool.some(it => val(it) != null);
  if (U.pracMode === 'bigger' && $('#biggerBtn').hidden) U.pracMode = 'name';
  $$('#pracSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === U.pracMode));
  renderLevel();
}
function startPractice() { session = { ok: 0, n: 0 }; renderPracticeStats(); nextCard(); }
function resultBlock(it, ok, extra = '') {
  return `<div class="result ${ok ? 'good' : 'bad'}"><div class="verdict">${ok ? '✓ Right' : '✗ Not quite'}</div>
    <div class="nm">${esc(it.name)}${LANGS && it.endonym ? ` <small class="dim">${esc(it.endonym)}</small>` : ''}</div>
    <div class="small">${context(it)}</div>${extra}
    <div class="row" style="margin-top:10px"><button class="btn" id="pNext">Next ›</button><button class="btn ghost" id="pMore">Details</button></div></div>`;
}
function bindNext(it) {
  $('#pNext').onclick = () => nextCard();
  $('#pMore').onclick = () => { setMode('atlas'); selectItem(it, true); };
  setTimeout(() => $('#pNext')?.focus(), 0);
}
function nextCard() {
  setMark([]); popup?.remove();
  if (findHandler) { map.off('click', findHandler); findHandler = null; }
  const pool = scopeItems();
  if (!pool.length) { $('#pracCard').innerHTML = '<div class="q">Nothing in this selection.</div>'; setView(new Map(), new Set()); return; }
  if (U.pracMode === 'bigger') return biggerCard(pool);
  cur = pick(pool);
  if (U.pracMode === 'name') nameCard(cur); else findCard(cur, pool);
}
function showTarget(it, st = 'target', label = false) { setView(new Map([[it.id, st]]), label ? new Set([it.id]) : new Set()); }
function nameCard(it) {
  showTarget(it);
  if (it.g === 'pt' || PLACES) map.flyTo({ center: it.ll, zoom: PLACES ? 8.5 : 5, speed: 1.8, padding: mapPadding() });
  else fitItems([it], 6);
  const what = PLACES ? 'Which town is this?' : LANGS ? 'Which language is spoken here?' : `Which ${catOne(it).toLowerCase().replace(/ or .*|,.*/, '')} is this?`;
  const sub = PLACES ? `${esc(it.reg)} · about ${fmtPop(it.m.pop)} people` : LANGS ? 'Solid: main language · lighter: also spoken / official' : esc(REG.get(it.reg)?.label || '');
  $('#pracCard').innerHTML = `<div class="q">${what}<small>${sub}</small></div>
    <input id="pAns" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Name" enterkeyhint="done">
    <div class="row"><button class="btn" id="pCheck">Check</button><button class="btn ghost" id="pHint">Hint</button><button class="btn ghost" id="pSkip">Don't know</button></div>
    <div id="pHintTxt" class="small dim" style="margin-top:6px"></div>`;
  let hints = 0;
  const check = giveUp => {
    const key = norm($('#pAns').value);
    if (!key && !giveUp) return;
    const ok = !giveUp && ((answers[key] || []).includes(it.id) || (key.startsWith('the') && (answers[key.slice(3)] || []).includes(it.id)));
    grade(it, ok && hints < 2);
    showTarget(it, ok ? 'found' : 'miss', true);
    $('#pracCard').innerHTML = resultBlock(it, ok);
    bindNext(it);
  };
  $('#pCheck').onclick = () => check(false);
  $('#pSkip').onclick = () => check(true);
  $('#pAns').onkeydown = e => { if (e.key === 'Enter') check(false); };
  $('#pHint').onclick = () => {
    hints++;
    const first = LANGS ? `${esc(it.family)}${it.cat2 ? ' · ' + esc(it.cat2) : ''}` : PLACES ? `Bezirk: ${esc(it.sub.replace(/^Bezirk /, ''))}` : context(it);
    $('#pHintTxt').innerHTML = hints === 1 ? first : `${first} · starts with “${esc(it.name.slice(0, 2))}…” (${it.name.length} letters)`;
  };
  if (!isPhone()) setTimeout(() => $('#pAns').focus(), 50);
}
function findCard(it, pool) {
  setView(new Map(), new Set());
  if (PLACES) map.fitBounds([[D.bbox[0], D.bbox[1]], [D.bbox[2], D.bbox[3]]], { padding: sheetPadding(30), duration: 800 });
  else if (U.where === 'all') worldView(); else fitItems(pool);
  $('#pracCard').innerHTML = `<div class="q">Where is ${esc(it.name)}?<small>${LANGS ? 'Tap where it is mainly spoken' : PLACES ? `${esc(it.reg)} · ${fmtPop(it.m.pop)}` : esc(catOne(it))} — tap the map</small></div>
    <div class="row"><button class="btn ghost" id="pSkip">Show me</button></div>`;
  const done = ll => {
    map.off('click', findHandler); findHandler = null;
    let extra = '', ok = false;
    if (ll) {
      const d = distanceTo(it, ll.lng, ll.lat);
      // tolerance: a few km for towns / areas, more for points and rivers, and at least ~12 px at the current zoom
      const kmPerPx = 40075 * Math.cos(ll.lat * Math.PI / 180) / (512 * 2 ** map.getZoom());
      const tol = Math.max(PLACES ? 2 : it.g === 'pt' ? 40 : it.g === 'line' ? 25 : 10, 12 * kmPerPx);
      ok = d <= tol;
      extra = `<div class="small">${d === 0 ? 'Spot on — inside it' : ok ? `Close enough (${fmtInt(d)} km away)` : `Off by ${fmtInt(d)} km`}</div>`;
      setMark([{ type: 'Feature', geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } }]);
    }
    grade(it, ok);
    showTarget(it, ok ? 'found' : 'miss', true);
    if (!ll || !ok) { if (it.g === 'pt' || PLACES) flyToItem(it, PLACES ? 8.5 : 4.5); else fitItems([it], 6); }
    $('#pracCard').innerHTML = resultBlock(it, ok, extra);
    bindNext(it);
  };
  findHandler = e => done(e.lngLat);
  map.on('click', findHandler);
  $('#pSkip').onclick = () => done(null);
}
function biggerCard(pool) {
  const withM = pool.filter(it => val(it) != null);
  const a = pick(withM.length ? withM : pool);
  const m = measureOf(a);
  let cands = withM.filter(x => x.id !== a.id && measureOf(x) === m && Math.max(val(x), val(a)) / Math.max(1, Math.min(val(x), val(a))) < 1.8);
  if (!cands.length) cands = withM.filter(x => x.id !== a.id && measureOf(x) === m);
  if (!cands.length || val(a) == null) { $('#pracCard').innerHTML = '<div class="q">Pick a selection with at least two comparable ones.</div>'; return; }
  const b = cands[Math.floor(Math.random() * cands.length)];
  const pair = Math.random() < 0.5 ? [a, b] : [b, a];
  setView(new Map(pair.map(it => [it.id, 'target'])), new Set(pair.map(it => it.id)));
  fitItems(pair, PLACES ? 9 : 5);
  const M = D.measures[m];
  $('#pracCard').innerHTML = `<div class="q">${esc(M.q)}<small>${esc(M.label)}${PLACES ? '' : ' · ' + esc(catLabel(a))}</small></div>
    <div class="pair">${pair.map(it => `<button data-id="${esc(it.id)}"><b>${esc(it.name)}</b><small>${esc(PLACES ? it.reg : LANGS ? it.family : REG.get(it.reg)?.label || '')}</small></button>`).join('')}</div>
    <div id="pRes"></div>`;
  $$('#pracCard .pair button').forEach(btn => btn.onclick = () => {
    const chosen = itemOf(btn.dataset.id), other = pair.find(it => it !== chosen);
    const ok = val(chosen, m) >= val(other, m);
    P.bigger.n++; if (ok) P.bigger.ok++;
    session.n++; if (ok) session.ok++;
    if (!ok) { card(chosen.id).box = Math.min(card(chosen.id).box, 1); card(other.id).box = Math.min(card(other.id).box, 1); }
    $$('#pracCard .pair button').forEach(x => {
      const it = itemOf(x.dataset.id), o = pair.find(y => y !== it);
      x.disabled = true;
      x.classList.add(val(it, m) >= val(o, m) ? 'right' : 'wrong');
      x.insertAdjacentHTML('beforeend', `<span class="pv">${fmtVal(val(it, m), M.fmt)}</span>`);
    });
    $('#pRes').innerHTML = `<div class="result ${ok ? 'good' : 'bad'}"><span class="verdict">${ok ? '✓ Right' : '✗ The other one'}</span> <span class="small dim">· ${Math.round(100 * P.bigger.ok / P.bigger.n)}% right over ${P.bigger.n} rounds</span>
      <div class="row" style="margin-top:10px"><button class="btn" id="pNext">Next ›</button></div></div>`;
    $('#pNext').onclick = () => nextCard();
    $('#pNext').focus();
    renderPracticeStats(); save();
  });
}

// ------------------------------------------------------------------ ATLAS
let selected = null;
const SORTS = [['imp', PLACES ? 'By population' : LANGS ? 'By speakers' : 'Best known first'], ['name', 'A–Z'], ...(D.cats && !LANGS ? [['cat', 'By type']] : []), ...(LANGS ? [['l1', 'By native speakers'], ['cat', 'By family']] : []), ...(!PLACES && !LANGS ? [['size', 'Largest first (within type)']] : [])];
$('#atlasSort').innerHTML = SORTS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
if (!SORTS.some(s => s[0] === U.atlasSort)) U.atlasSort = 'imp';
$('#atlasSort').onchange = e => { U.atlasSort = e.target.value; renderAtlas(); save(); };
$('#atlasSearch').oninput = () => renderAtlas();
$('#atlasHideNames').onchange = e => { U.hideNames = e.target.checked; renderAtlas(); save(); };
function matches(it, k) {
  if (!k) return true;
  if (norm(it.name).includes(k)) return true;
  if ((it.alias || []).some(a => norm(a).includes(k))) return true;
  if (k.length >= 3 && ((it.cs || []).some(c => norm(c).startsWith(k)) || (it.official || []).some(c => norm(c).startsWith(k)) || norm(it.reg || '').startsWith(k))) return true;
  return false;
}
function renderAtlas(refit) {
  $('#atlasSort').value = U.atlasSort; $('#atlasHideNames').checked = U.hideNames;
  const k = norm($('#atlasSearch').value);
  const list = scopeItems().filter(it => matches(it, k));
  const catOrder = new Map((D.cats || []).map((c, i) => [c.k, i]));
  const sorters = {
    imp: (a, b) => a.imp - b.imp,
    name: (a, b) => a.name.localeCompare(b.name),
    cat: (a, b) => (catOrder.get(a.cat) ?? 99) - (catOrder.get(b.cat) ?? 99) || a.imp - b.imp,
    l1: (a, b) => b.m.l1 - a.m.l1,
    size: (a, b) => (catOrder.get(a.cat) ?? 99) - (catOrder.get(b.cat) ?? 99) || (val(b) ?? -1) - (val(a) ?? -1),
  };
  list.sort(sorters[U.atlasSort] || sorters.imp);
  const qAll = P.quiz['all|all']?.found || {};
  $('#atlasCount').textContent = `${list.length} ${noun(list.length)}` + (PLACES ? ` · ${fmtPop(list.reduce((a, it) => a + it.m.pop, 0))} people` : '');
  $('#atlasList').innerHTML = list.map(it => listRow(it, `${selected === it.id ? 'sel' : ''} ${qAll[it.id] ? 'found' : ''}`)).join('');
  $$('#atlasList li').forEach(li => li.onclick = () => selectItem(itemOf(li.dataset.id), true));
  const st = new Map(list.map(it => [it.id, selected === it.id ? 'sel' : 'atlas']));
  if (selected && !st.has(selected)) st.set(selected, 'sel');
  // languages overlap: in the atlas only the selected one is filled strongly, the rest stays light
  setView(st, new Set(list.filter(it => !U.hideNames || selected === it.id).map(it => it.id)));
  if (refit) {
    if (PLACES && U.where === 'all') map.fitBounds([[D.bbox[0], D.bbox[1]], [D.bbox[2], D.bbox[3]]], { padding: sheetPadding(30), duration: 800 });
    else if (U.where !== 'all' || k) fitItems(list); else worldView();
  }
}

// ------------------------------------------------------------------ info box
let factsData = null, factsLoading = null;
const loadFacts = () => factsLoading ||= fetch(`data/sets/${KEY}.facts.json`).then(r => r.json()).then(d => { factsData = d; }).catch(() => { factsData = {}; });
function factsHtml(it) {
  const f = factsData?.[it.id];
  return `${f?.length ? `<div class="dh">Good to know</div><ul class="cfacts">${f.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${it.wiki ? `<div class="small dim">${f?.length ? 'From ' : ''}Wikipedia: <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(it.wiki.replace(/ /g, '_'))}" target="_blank" rel="noopener">${esc(it.wiki)}</a></div>` : ''}`;
}
function statTile([v, fmt, label]) {
  if (fmt === 'popM') return `<div><b>${v >= 10 ? Math.round(v) : v >= 1 ? v.toFixed(1) : v.toFixed(2)} M</b><small>${esc(label)}</small></div>`;
  return `<div><b>${esc(fmtVal(v, fmt).replace(/ km²$| km$| m$/, ''))}</b><small>${esc(label)}</small></div>`;
}
function showInfo(el, it, onClose) {
  if (!factsData) loadFacts().then(() => { const f = $('.cityFacts', el); if (f && el.dataset.id === String(it.id)) f.innerHTML = factsHtml(it); });
  el.dataset.id = it.id;
  const k = P.cards[it.id];
  const sub = PLACES ? `${esc(it.reg)} · ${esc(it.sub)}`
    : LANGS ? `${it.endonym ? esc(it.endonym) + ' · ' : ''}${esc(it.family)}${it.cat2 ? ' › ' + esc(it.cat2) : ''}`
    : `${esc(catOne(it))} · ${esc(REG.get(it.reg)?.label || '')}`;
  const stats = (it.stats || []).slice(0, 6);
  el.hidden = false;
  el.innerHTML = `<button class="icon-btn close" aria-label="Close">×</button>
    <h2>${esc(it.name)}</h2>
    <div class="sub">${sub}</div>
    ${stats.length ? `<div class="facts">${stats.map(statTile).join('')}</div>` : ''}
    ${it.cs?.length ? `<div class="dh">${it.cs.length === 1 ? 'Country' : 'Countries'}</div><div class="chips">${it.cs.map(c => `<span>${esc(c)}</span>`).join('')}${it.ncs > it.cs.length ? `<span>+${it.ncs - it.cs.length} more</span>` : ''}</div>` : ''}
    ${LANGS ? langHtml(it) : ''}
    <div class="cityFacts">${factsHtml(it)}</div>
    ${it.alias?.length ? `<div class="dh">Also accepted</div><div class="chips">${it.alias.slice(0, 10).map(a => `<span>${esc(a)}</span>`).join('')}</div>` : ''}
    <div class="small dim">${k ? `Practice: ${k.ok}× right, ${k.bad}× wrong` : 'Not practised yet'}</div>`;
  $('.close', el).onclick = () => { el.hidden = true; popup?.remove(); onClose?.(); };
  if (LANGS) bindSpeak(el, it);
}
function selectItem(it, fly) {
  selected = it.id;
  showInfo($('#detail'), it, () => { selected = null; renderAtlas(); });
  renderAtlas();
  if (fly) flyToItem(it);
  $('#panel').scrollTo({ top: 0, behavior: 'smooth' });
  expandSheet();
}

// ------------------------------------------------------------------ languages: phrases + speech
const PHRASES = [['hello', 'Hello'], ['thanks', 'Thank you'], ['bye', 'Goodbye']];
function langHtml(it) {
  const off = it.official?.length ? `<div class="dh">Official in</div><div class="chips">${it.official.map(c => `<span>${esc(c)}</span>`).join('')}</div>` : '';
  const scripts = it.scripts?.length ? `<div class="small">Written in: ${esc(it.scripts.join(', '))}</div>` : '';
  const ph = it.phrases ? `<details class="phrases" open><summary>Say it: hello, thank you, goodbye</summary>
    <table>${PHRASES.map(([k, l]) => { const p = it.phrases[k]; if (!p) return ''; return `<tr><th>${l}</th><td><b lang="${esc(it.tts || it.id)}">${esc(p.text)}</b>${p.rom ? `<div class="dim">${esc(p.rom)}</div>` : ''}<div class="say">“${esc(p.say)}”</div></td>
      <td><button class="icon-btn speak" data-k="${k}" title="Listen" aria-label="Listen to ${l}">🔊</button></td></tr>`; }).join('')}</table>
    <div class="small dim speakNote"></div></details>` : '';
  return scripts + off + ph;
}
// device voices: exact tag, then same language; Cantonese voices are usually zh-HK
const TTS_FALLBACK = { yue: ['zh-HK', 'yue'], fil: ['fil', 'tl'], tl: ['fil', 'tl'], nb: ['nb', 'no'], no: ['nb', 'no'], he: ['he', 'iw'], ms: ['ms', 'id'] };
function voiceFor(tag) {
  if (!tag || !('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices(), t = tag.toLowerCase(), lang = t.split('-')[0];
  const want = [t, ...(TTS_FALLBACK[lang] || [lang])].map(x => x.toLowerCase());
  for (const w of want) {
    const v = vs.find(v => v.lang.toLowerCase().replace('_', '-') === w) || vs.find(v => v.lang.toLowerCase().replace('_', '-').split('-')[0] === w.split('-')[0] && (w.includes('-') ? false : true));
    if (v) return v;
  }
  for (const w of want) { const v = vs.find(v => v.lang.toLowerCase().replace('_', '-').startsWith(w.split('-')[0] + '-') && w.split('-')[0] !== 'zh'); if (v) return v; }
  if (lang === 'zh' || lang === 'cmn') return vs.find(v => /^zh[-_](cn|hans)/i.test(v.lang)) || null;
  return null;
}
function bindSpeak(el, it) {
  const update = () => {
    const v = voiceFor(it.tts || it.id);
    $$('.speak', el).forEach(b => { b.disabled = !v; b.title = v ? `Listen (${v.name})` : 'No voice for this language on this device'; });
    const note = $('.speakNote', el);
    if (note) note.innerHTML = v ? `Voice: ${esc(v.name)}` : `No ${esc(it.name)} voice on this device — <a href="https://translate.google.com/?sl=${esc((it.tts || it.id).split('-')[0])}&tl=en&text=${encodeURIComponent(it.phrases?.hello?.text || '')}&op=translate" target="_blank" rel="noopener">try Google Translate</a> (it can read many languages aloud).`;
  };
  update();
  if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', update, { once: true });
  $$('.speak', el).forEach(b => b.onclick = () => {
    const v = voiceFor(it.tts || it.id), p = it.phrases[b.dataset.k];
    if (!v || !p) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(p.text);
    u.voice = v; u.lang = v.lang; u.rate = 0.85;
    speechSynthesis.speak(u);
  });
}

// ------------------------------------------------------------------ map interaction
map.on('click', e => {
  if (findHandler || U.mode === 'practice') return;
  const hits = hitsAt(e.point);
  if (!hits.length) return;
  if (U.mode === 'atlas') {
    const it = hits[0];
    selectItem(it);
    popup?.remove();
    popup = new maplibregl.Popup({ closeButton: false, offset: 10, maxWidth: '280px' }).setLngLat(e.lngLat)
      .setHTML(`<b>${esc(it.name)}</b><br><span class="dim">${context(it)}</span>${hits.length > 1 ? `<div class="also">Also here: ${hits.slice(1, 8).map(h => `<a href="#" data-id="${esc(h.id)}">${esc(h.name)}</a>`).join(', ')}</div>` : ''}`)
      .addTo(map);
    popup.getElement().querySelectorAll('a[data-id]').forEach(a => a.onclick = ev => { ev.preventDefault(); const h = itemOf(a.dataset.id); selectItem(h); showPopup(h, e.lngLat); });
  } else if (U.mode === 'quiz') {
    const it = hits.find(h => view.get(h.id) === 'found' || view.get(h.id) === 'miss');
    if (it) { showPopup(it, it.g === 'pt' || PLACES ? null : e.lngLat); quizInfo(it); }
  }
});
map.on('mousemove', e => {
  if (U.mode === 'practice') { map.getCanvas().style.cursor = findHandler ? 'crosshair' : ''; return; }
  const hits = hitsAt(e.point);
  const ok = U.mode === 'atlas' ? hits.length : hits.some(h => view.get(h.id) === 'found' || view.get(h.id) === 'miss');
  map.getCanvas().style.cursor = ok ? 'pointer' : '';
});

bindSheet();
$('#aboutBtn').onclick = () => $('#about').showModal();
$('#about').addEventListener('click', e => { if (e.target === $('#about')) $('#about').close(); });

map.on('load', () => {
  $('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  applyLayers();
  setMode(U.mode);
});
