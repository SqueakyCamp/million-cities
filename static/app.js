import * as maplibregl from './vendor/maplibre-gl.mjs';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Same key as tools/build_data.py:norm()
function norm(s) {
  s = s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/đ/g, 'd').replace(/ł/g, 'l').replace(/ı/g, 'i').replace(/æ/g, 'ae').replace(/œ/g, 'oe');
  return s.replace(/[^a-z0-9]+/g, '');
}
const fmtPop = p => p >= 1e7 ? (p / 1e6).toFixed(1) + ' M' : p >= 1e6 ? (p / 1e6).toFixed(2) + ' M' : Math.round(p / 1e3) + ' k';
const fmtInt = n => n.toLocaleString('en-US');
const flag = cc => cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1f1a5 + c.charCodeAt(0))) : '';
const fmtTime = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const isPhone = () => matchMedia('(max-width: 760px)').matches;

// ------------------------------------------------------------------ data
const data = await fetch('data/cities.json').then(r => r.json());
const C = data.cities;
const byId = new Map(C.map(c => [c.id, c]));
const answers = data.answers, parts = data.parts, near = data.near;
const CONTS = ['Asia', 'Africa', 'Europe', 'Latin America', 'Northern America', 'Oceania'];
for (const c of C) c.growth = c.ts[2000] ? c.pop / c.ts[2000] : null;

// The data goes down to 800k; S.minPop (1e6 or 8e5) picks the city set used everywhere.
const pool = () => C.filter(c => c.pop >= S.minPop);
const setName = () => S.minPop < 1e6 ? '800k' : '1M';
// scopes: "all", "top100", "p5", "p2", "c:<continent>", "n:<iso2>"
let countries = new Map();
function countCountries() {
  countries = new Map();
  for (const c of pool()) {
    if (!countries.has(c.iso2)) countries.set(c.iso2, { name: c.country, cc: c.iso2, n: 0 });
    countries.get(c.iso2).n++;
  }
}
function scopeCities(key) {
  const P = pool();
  if (key === 'top100') return P.filter(c => c.rank <= 100);
  if (key === 'p5') return P.filter(c => c.pop >= 5e6);
  if (key === 'p2') return P.filter(c => c.pop >= 2e6);
  if (key.startsWith('c:')) return P.filter(c => c.cont === key.slice(2));
  if (key.startsWith('n:')) return P.filter(c => c.iso2 === key.slice(2));
  return P;
}
function scopeLabel(key) {
  const n = scopeCities(key).length;
  if (key === 'all') return `All ${n} cities`;
  if (key === 'top100') return 'Largest 100';
  if (key === 'p5') return `Over 5 million (${n})`;
  if (key === 'p2') return `Over 2 million (${n})`;
  if (key.startsWith('c:')) return `${key.slice(2)} (${n})`;
  if (key.startsWith('n:')) { const k = countries.get(key.slice(2)) || { cc: key.slice(2), name: key.slice(2) }; return `${flag(k.cc)} ${k.name} (${n})`; }
  return key;
}
function fillScopeSelect(sel, withAllCountries) {
  const opt = (k, label) => `<option value="${esc(k)}">${esc(label ?? scopeLabel(k))}</option>`;
  const cs = [...countries.values()].filter(k => withAllCountries || k.n >= 2).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  sel.innerHTML = `<optgroup label="World">${['all', 'top100', 'p5', 'p2'].map(k => opt(k)).join('')}</optgroup>
    <optgroup label="Continent">${CONTS.map(k => opt('c:' + k)).join('')}</optgroup>
    <optgroup label="Country">${cs.map(k => opt('n:' + k.cc)).join('')}</optgroup>`;
}

// ------------------------------------------------------------------ state (shared via server)
const DEFAULT = {
  mode: 'quiz', quizScope: 'all', pracScope: 'all', pracMode: 'name', atlasScope: 'all', atlasSort: 'pop',
  basemap: 'terrain', layers: { borders: true, admin1: false, rivers: true, clabels: false, slabels: false, outlines: true },
  hintDots: false, flyTo: false, acceptParts: false, atlasHideNames: false,
  minPop: 1e6,   // 1e6 or 8e5
  quiz: {},      // scope (+ '@800k') -> {found: {id: ts}, ms, gaveUp}
  cards: {},     // id -> {box, ok, bad, last, streak}
  bigger: { ok: 0, n: 0 },
};
let S = structuredClone(DEFAULT), rev = 0, saveTimer = null, saving = false;

// With server.py, progress lives on the server (shared by all devices). As a static site
// (GitHub Pages) there is no API, so each browser keeps its own copy in localStorage.
let local = false;
const LS_KEY = 'million-cities-state';
function readLocal() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
function adopt(st) {
  S = Object.assign(structuredClone(DEFAULT), st);
  S.layers = Object.assign({}, DEFAULT.layers, st.layers);
}
async function loadState() {
  try {
    if (location.hostname.endsWith('github.io')) throw new Error('static host');
    const r = await fetch('api/state');
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('no api');
    const d = await r.json();
    rev = d.rev;
    adopt(d.state);
  } catch {
    local = true;
    adopt(readLocal());
  }
}
// merge another copy (e.g. from the phone) into ours: union of found cities, newest card stats
function mergeState(other) {
  for (const [k, q] of Object.entries(other.quiz || {})) {
    const mine = S.quiz[k];
    if (!mine) { S.quiz[k] = q; continue; }
    if ((q.reset || 0) > (mine.reset || 0)) { S.quiz[k] = q; continue; }
    if ((q.reset || 0) < (mine.reset || 0)) continue;
    Object.assign(mine.found, q.found);
    mine.ms = Math.max(mine.ms || 0, q.ms || 0);
    mine.gaveUp = mine.gaveUp || q.gaveUp;
  }
  for (const [id, c] of Object.entries(other.cards || {})) {
    if (!S.cards[id] || (c.last || 0) > (S.cards[id].last || 0)) S.cards[id] = c;
  }
  if ((other.bigger?.n || 0) > S.bigger.n) S.bigger = other.bigger;
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 700);
}
async function flush() {
  if (local) { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch { } return; }
  if (saving) return save();
  saving = true;
  try {
    let r = await fetch('api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev, state: S }) });
    if (r.status === 409) {
      const cur = await r.json();
      mergeState(cur.state); rev = cur.rev;
      r = await fetch('api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev, state: S }) });
      renderAll();
    }
    if (r.ok) rev = (await r.json()).rev;
  } catch (e) { console.warn('save failed', e); }
  saving = false;
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') { quizTick(); if (saveTimer) { clearTimeout(saveTimer); flush(); } return; }
  if (local) { lastTick = Date.now(); return; }
  try {
    const r = await fetch('api/state').then(r => r.json());
    if (r.rev !== rev) { mergeState(r.state); rev = r.rev; renderAll(); }
  } catch { }
  lastTick = Date.now();
});

await loadState();
$('#storageNote').textContent = local
  ? 'Your progress is saved in this browser only.'
  : 'Progress is saved on the server, so all your devices share it.';

// ------------------------------------------------------------------ map
const PAL = dark
  ? { ocean: '#0e1a24', land: '#1d262e', lake: '#0e1a24', river: '#2b4a63', border: '#6c7a86', admin: '#46525d', text: '#c9d2da', halo: '#0e1a24', ctext: '#8c99a5' }
  : { ocean: '#c6dbe7', land: '#f4f2ec', lake: '#c6dbe7', river: '#8fb6cf', border: '#8b8f94', admin: '#b9b6ad', text: '#22292f', halo: '#ffffff', ctext: '#6d757c' };
const COL = dark
  ? { found: '#3ecf7a', miss: '#ff6b6b', hint: '#7b8894', atlas: '#ffcc4d', target: '#ff9f1c', outline: '#ffcc4d' }
  : { found: '#1f9d55', miss: '#d64545', hint: '#7d8790', atlas: '#c2410c', target: '#e8590c', outline: '#c2410c' };

const empty = { type: 'FeatureCollection', features: [] };
const map = new maplibregl.Map({
  container: 'map',
  attributionControl: { compact: true },
  center: [30, 22], zoom: isPhone() ? 0.6 : 1.6, minZoom: 0.3, maxZoom: 13,
  renderWorldCopies: true,
  style: {
    version: 8,
    glyphs: 'fonts/{fontstack}/{range}.pbf',
    sources: {
      land: { type: 'geojson', data: 'data/geo/land.geojson', attribution: 'Natural Earth' },
      dem: { type: 'raster-dem', encoding: 'terrarium', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 12, attribution: 'Terrain: Mapzen/AWS' },
      physical: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 8, attribution: '© Esri, US NPS' },
      satellite: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18, attribution: '© Esri, Maxar, Earthstar Geographics' },
      oceanpoly: { type: 'geojson', data: empty }, lakes: { type: 'geojson', data: empty }, rivers: { type: 'geojson', data: empty },
      borders: { type: 'geojson', data: empty }, admin1: { type: 'geojson', data: empty }, labels: { type: 'geojson', data: empty },
      outlines: { type: 'geojson', data: empty, attribution: 'GHSL UCDB R2024A' },
      cities: { type: 'geojson', data: empty, attribution: 'UN WUP 2025 · GeoNames' },
      mark: { type: 'geojson', data: empty },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': PAL.ocean } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': PAL.land } },
      { id: 'physical', type: 'raster', source: 'physical', layout: { visibility: 'none' } },
      { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
      {
        id: 'relief', type: 'color-relief', source: 'dem', layout: { visibility: 'none' },
        paint: {
          'color-relief-opacity': dark ? 0.55 : 0.75,
          'color-relief-color': ['interpolate', ['linear'], ['elevation'],
            -12000, 'rgba(0,0,0,0)', -1, 'rgba(0,0,0,0)', 0, '#a7c99a', 200, '#c8d9a4', 600, '#e5dfae', 1200, '#d9bf8c', 2000, '#c19a6b', 3000, '#a8876a', 4500, '#e6e2dc', 6000, '#ffffff'],
        },
      },
      {
        id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': dark ? '#000' : '#5a5040', 'hillshade-highlight-color': dark ? '#3a4650' : '#fff' },
      },
      { id: 'oceanpoly', type: 'fill', source: 'oceanpoly', layout: { visibility: 'none' }, paint: { 'fill-color': PAL.ocean, 'fill-antialias': false } },
      { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': PAL.lake } },
      {
        id: 'rivers', type: 'line', source: 'rivers', paint: {
          'line-color': PAL.river,
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, ['match', ['get', 'r'], [0, 1, 2, 3], 0.9, 0.3], 6, ['match', ['get', 'r'], [0, 1, 2, 3], 2, 1], 10, 2.5],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 1, ['match', ['get', 'r'], [0, 1, 2, 3, 4, 5], 0.9, 0], 3, ['match', ['get', 'r'], [0, 1, 2, 3, 4, 5, 6, 7], 0.9, 0], 5, 0.9],
        },
      },
      { id: 'admin1', type: 'line', source: 'admin1', minzoom: 1.5, paint: { 'line-color': PAL.admin, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 8, 1.2], 'line-dasharray': [3, 2] } },
      { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': PAL.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 8, 1.6] } },
      { id: 'outline-fill', type: 'fill', source: 'outlines', filter: ['in', ['get', 'id'], ['literal', []]], paint: { 'fill-color': COL.outline, 'fill-opacity': 0.16 } },
      { id: 'outline-line', type: 'line', source: 'outlines', minzoom: 4, filter: ['in', ['get', 'id'], ['literal', []]], paint: { 'line-color': COL.outline, 'line-width': 1.2, 'line-opacity': 0.8 } },
      {
        id: 'slabels', type: 'symbol', source: 'labels', filter: ['==', ['get', 't'], 's'], minzoom: 3.5, layout: {
          'text-field': ['get', 'n'], 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'symbol-sort-key': ['get', 'r'], 'text-max-width': 7, visibility: 'none',
        }, paint: { 'text-color': PAL.ctext, 'text-halo-color': PAL.halo, 'text-halo-width': 1.2, 'text-opacity': 0.85 },
      },
      {
        id: 'clabels', type: 'symbol', source: 'labels', filter: ['==', ['get', 't'], 'c'], layout: {
          'text-field': ['get', 'n'], 'text-font': ['Noto Sans Bold'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.08,
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9, 5, 13], 'symbol-sort-key': ['get', 'r'], 'text-max-width': 8, visibility: 'none',
        }, paint: { 'text-color': PAL.ctext, 'text-halo-color': PAL.halo, 'text-halo-width': 1.2 },
      },
      { id: 'mark-line', type: 'line', source: 'mark', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': COL.target, 'line-width': 2, 'line-dasharray': [2, 2] } },
      {
        id: 'cities', type: 'circle', source: 'cities', layout: { 'circle-sort-key': ['get', 'pop'] }, paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            0, ['interpolate', ['linear'], ['sqrt', ['get', 'pop']], 1000, 1.6, 6400, 5.5],
            5, ['interpolate', ['linear'], ['sqrt', ['get', 'pop']], 1000, 4, 6400, 14],
            9, ['interpolate', ['linear'], ['sqrt', ['get', 'pop']], 1000, 6, 6400, 20]],
          'circle-color': ['match', ['get', 'st'], 'found', COL.found, 'miss', COL.miss, 'hint', COL.hint, 'target', COL.target, 'sel', COL.target, COL.atlas],
          'circle-opacity': ['match', ['get', 'st'], 'hint', 0.55, 0.85],
          'circle-stroke-color': dark ? '#0e1a24' : '#ffffff', 'circle-stroke-width': ['match', ['get', 'st'], 'target', 3, 'sel', 2.5, 1],
        },
      },
      {
        id: 'city-labels', type: 'symbol', source: 'cities', filter: ['to-boolean', ['get', 'label']], layout: {
          'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['interpolate', ['linear'], ['get', 'pop'], 1e6, 10, 2e7, 13], 6, ['interpolate', ['linear'], ['get', 'pop'], 1e6, 12, 2e7, 16]],
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.7, 'text-justify': 'auto',
          'symbol-sort-key': ['-', 0, ['get', 'pop']], 'text-max-width': 9, 'text-padding': 1,
        },
        paint: {
          'text-color': ['match', ['get', 'st'], 'miss', COL.miss, PAL.text],
          'text-halo-color': PAL.halo, 'text-halo-width': 1.6,
        },
      },
    ],
  },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
map.touchZoomRotate.disableRotation();
map.dragRotate.disable();

const geoLoaded = {};
async function ensureGeo(name, ...more) {
  for (const n of [name, ...more]) {
    if (geoLoaded[n]) continue;
    geoLoaded[n] = true;
    map.getSource(n).setData(`data/geo/${n}.geojson`);
  }
}
let outlinesLoaded = false;

function applyLayers() {
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  const b = S.basemap;
  vis('relief', b === 'terrain'); vis('hillshade', b === 'terrain' || b === 'plain_relief');
  if (b === 'terrain') { if (!geoLoaded.oceanpoly) { geoLoaded.oceanpoly = true; map.getSource('oceanpoly').setData('data/geo/ocean.geojson'); } }
  vis('oceanpoly', b === 'terrain');
  vis('physical', b === 'physical'); vis('satellite', b === 'satellite');
  vis('land', b !== 'satellite' && b !== 'physical');
  // under the terrain colours, land below sea level should look like lowland, not like paper
  map.setPaintProperty('land', 'fill-color', b === 'terrain' ? (dark ? '#5d6f55' : '#a7c99a') : PAL.land);
  const L = S.layers;
  if (L.borders) ensureGeo('borders');
  if (L.admin1) ensureGeo('admin1');
  if (L.rivers) ensureGeo('rivers', 'lakes');
  if (L.clabels || L.slabels) ensureGeo('labels');
  vis('borders', L.borders); vis('admin1', L.admin1); vis('rivers', L.rivers);
  vis('lakes', L.rivers && b !== 'satellite' && b !== 'physical');
  vis('clabels', L.clabels); vis('slabels', L.slabels);
  if (L.outlines && !outlinesLoaded) { outlinesLoaded = true; map.getSource('outlines').setData('data/outlines.geojson'); }
  vis('outline-fill', L.outlines); vis('outline-line', L.outlines);
  // labels over imagery need a darker halo
  const sat = b === 'satellite';
  map.setPaintProperty('city-labels', 'text-halo-color', sat ? '#000' : PAL.halo);
  map.setPaintProperty('city-labels', 'text-color', ['match', ['get', 'st'], 'miss', sat ? '#ff8a8a' : COL.miss, sat ? '#fff' : PAL.text]);
  map.setPaintProperty('borders', 'line-color', sat ? '#ffffffaa' : PAL.border);
  map.setPaintProperty('admin1', 'line-color', sat ? '#ffffff66' : PAL.admin);
  $$('#basemapSeg button').forEach(x => x.classList.toggle('on', x.dataset.v === b));
  $$('#layersPop [data-layer]').forEach(x => { x.checked = !!L[x.dataset.layer]; });
}
$('#layersBtn').onclick = () => { $('#layersPop').hidden = !$('#layersPop').hidden; };
map.on('click', () => { $('#layersPop').hidden = true; });
$('#basemapSeg').onclick = e => { const v = e.target.closest('button')?.dataset.v; if (v) { S.basemap = v; applyLayers(); save(); } };
$$('#layersPop [data-layer]').forEach(x => x.onchange = () => { S.layers[x.dataset.layer] = x.checked; applyLayers(); save(); });

function setCities(list) {
  // list: [{c, st, label}]
  map.getSource('cities').setData({
    type: 'FeatureCollection',
    features: list.map(({ c, st, label }) => ({
      type: 'Feature', id: c.id, geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: { id: c.id, pop: c.pop, st, label: label || '' },
    })),
  });
}
function setOutlines(ids) {
  const f = ['in', ['get', 'id'], ['literal', ids]];
  map.setFilter('outline-fill', f); map.setFilter('outline-line', f);
}
function setMark(features) { map.getSource('mark').setData({ type: 'FeatureCollection', features }); }
function flyToCity(c, zoom) {
  const z = zoom ?? Math.max(map.getZoom(), 6);
  map.flyTo({ center: [c.lon, c.lat], zoom: z, speed: 1.6, padding: mapPadding() });
}
function mapPadding() {
  if (isPhone()) return { top: 20, bottom: 20, left: 20, right: 20 };
  return { top: 40, bottom: 40, left: 40, right: 40 };
}
function fitCities(list, maxZoom = 6) {
  if (!list.length) return;
  let w = 180, e = -180, s = 90, n = -90;
  for (const c of list) { w = Math.min(w, c.lon); e = Math.max(e, c.lon); s = Math.min(s, c.lat); n = Math.max(n, c.lat); }
  if (e - w > 200) { map.flyTo({ center: [30, 22], zoom: isPhone() ? 0.6 : 1.6 }); return; }
  map.fitBounds([[w, s], [e, n]], { padding: isPhone() ? 40 : 90, maxZoom, duration: 900 });
}

let toastTimer;
function toast(t) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; $('main').append(el); }
  el.textContent = t; el.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

// ------------------------------------------------------------------ modes
function setMode(m) {
  S.mode = m;
  $$('.modes button').forEach(b => b.setAttribute('aria-selected', b.dataset.mode === m));
  $$('.mode').forEach(s => s.classList.toggle('on', s.id === 'mode-' + m));
  setMark([]);
  popup?.remove();
  if (m === 'quiz') renderQuiz(true);
  if (m === 'practice') startPractice();
  if (m === 'atlas') renderAtlas(true);
  save();
}
$$('.modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
function renderAll() {
  if (S.mode === 'quiz') renderQuiz(); else if (S.mode === 'atlas') renderAtlas(); else renderPracticeStats();
}

// ------------------------------------------------------------------ QUIZ
// quiz progress is kept per selection and city set; a new 800k run starts with the 1M finds
const qKey = () => S.quizScope + (S.minPop < 1e6 ? '@800k' : '');
const QZ = () => {
  const k = qKey();
  if (!S.quiz[k]) {
    const base = S.minPop < 1e6 ? S.quiz[S.quizScope] : null;
    S.quiz[k] = { found: { ...(base?.found || {}) }, ms: 0, gaveUp: false, reset: Date.now() };
  }
  return S.quiz[k];
};
let lastTick = Date.now();
function quizTick() {
  const now = Date.now(), q = S.quiz[qKey()];
  if (S.mode === 'quiz' && q && Object.keys(q.found).length && !q.gaveUp && document.visibilityState === 'visible') {
    const pool = scopeCities(S.quizScope);
    if (Object.keys(q.found).length < pool.length) q.ms = (q.ms || 0) + Math.min(now - lastTick, 5000);
  }
  lastTick = now;
  if (q) $('#qTimer').textContent = fmtTime(q.ms || 0);
}
setInterval(quizTick, 1000);
setInterval(() => { if (S.mode === 'quiz') save(); }, 20000);

function applyMinPop() {
  countCountries();
  const n1 = C.filter(c => c.pop >= 1e6).length, n8 = C.length;
  $('#subtitle').textContent = S.minPop < 1e6 ? `${n8} cities ≥ 800,000 · UN WUP 2025` : `${n1} cities ≥ 1 million · UN WUP 2025`;
  for (const [sel, key] of [['#quizScope', 'quizScope'], ['#pracScope', 'pracScope'], ['#atlasScope', 'atlasScope']]) {
    fillScopeSelect($(sel), true);
    if (!scopeCities(S[key]).length) S[key] = 'all';
    $(sel).value = S[key];
  }
  $$('.minpop').forEach(x => {
    x.innerHTML = `<option value="1000000">≥ 1 million (${n1})</option><option value="800000">≥ 800,000 (${n8})</option>`;
    x.value = String(S.minPop);
  });
}
$$('.minpop').forEach(x => x.onchange = () => {
  S.minPop = +x.value;
  applyMinPop();
  recent.length = 0;
  if (S.mode === 'quiz') renderQuiz(true); else if (S.mode === 'atlas') renderAtlas(true); else startPractice();
  save();
});
applyMinPop();
$('#quizScope').onchange = e => { S.quizScope = e.target.value; renderQuiz(true); save(); $('#answer').focus(); };
for (const id of ['hintDots', 'flyTo', 'acceptParts']) {
  $('#' + id).onchange = e => { S[id] = e.target.checked; renderQuiz(); save(); };
}
$('#giveUp').onclick = () => {
  const q = QZ();
  q.gaveUp = !q.gaveUp;
  renderQuiz(); save();
};
$('#resetQuiz').onclick = () => {
  const n = Object.keys(QZ().found).length;
  if (n && !confirm(`Restart "${scopeLabel(S.quizScope)}"? Your ${n} answers for it are cleared.`)) return;
  S.quiz[qKey()] = { found: {}, ms: 0, gaveUp: false, reset: Date.now() };
  renderQuiz(true); save(); $('#answer').focus();
};

let pendingTimer = null;
function quizMsg(text, cls = '') { const m = $('#quizMsg'); m.textContent = text; m.className = 'msg ' + cls; }
function tryAnswer(final) {
  const inp = $('#answer'), raw = inp.value.trim(), key = norm(raw);
  clearTimeout(pendingTimer);
  if (!key) return;
  const q = QZ(), pool = scopeCities(S.quizScope), inScope = new Set(pool.map(c => c.id));
  let ids = (answers[key] || []).filter(id => inScope.has(id));
  let viaPart = null;
  if (!ids.length && S.acceptParts && parts[key]) { ids = parts[key].filter(id => inScope.has(id)); viaPart = raw; }
  const fresh = ids.filter(id => !q.found[id]);
  if (fresh.length) {
    // wait if this is also the start of another answer still to find ("Cali" → "Calicut")
    if (!final && Object.keys(answers).some(k => k !== key && k.startsWith(key) && answers[k].some(id => inScope.has(id) && !q.found[id] && !ids.includes(id)))) {
      pendingTimer = setTimeout(() => tryAnswer(true), 900);
      return;
    }
    const t = Date.now();
    for (const id of fresh) q.found[id] = t;
    const cs = fresh.map(id => byId.get(id));
    quizMsg((viaPart ? `${viaPart} → ` : '✓ ') + cs.map(c => `${c.name} (${fmtPop(c.pop)})`).join(', '), 'good');
    inp.value = ''; inp.classList.remove('bad'); inp.classList.add('good'); setTimeout(() => inp.classList.remove('good'), 400);
    renderQuiz();
    if (S.flyTo) flyToCity(cs[0], Math.max(map.getZoom(), 4));
    save();
    if (Object.keys(q.found).length >= pool.length) quizMsg(`🎉 All ${pool.length} found in ${fmtTime(q.ms)}!`, 'good');
    return;
  }
  if (!final) return;
  // Enter on something that isn't a new answer: explain why
  let why = 'Not on the list', cls = 'bad';
  if (ids.length) { why = `Already found: ${ids.map(id => byId.get(id).name).join(', ')}`; cls = 'warn'; }
  else if ((answers[key] || []).length) {
    const c = byId.get(answers[key][0]);
    why = c.pop < S.minPop ? `${c.name} has ${fmtPop(c.pop)} — switch the list to “≥ 800,000” to include it` : `${c.name} is on the list, but not in this selection`;
    cls = 'warn';
  }
  else if (parts[key]) { const c = byId.get(parts[key][0]); why = `${raw} is part of the ${c.name} agglomeration — name the agglomeration`; cls = 'warn'; }
  else if (near[key]) { const [n, cc, p] = near[key]; why = `Close! ${n} ${flag(cc)} has ${fmtPop(p)}, below the cutoff`; cls = 'warn'; }
  quizMsg(why, cls);
  inp.classList.remove('bad'); void inp.offsetWidth; inp.classList.add('bad');
  inp.select();
}
$('#answer').addEventListener('input', () => tryAnswer(false));
$('#answer').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tryAnswer(true); } });

function renderQuiz(refit) {
  const q = QZ(), pool = scopeCities(S.quizScope);
  $('#quizScope').value = S.quizScope;
  $('#hintDots').checked = S.hintDots; $('#flyTo').checked = S.flyTo; $('#acceptParts').checked = S.acceptParts;
  const found = pool.filter(c => q.found[c.id]);
  const popAll = pool.reduce((a, c) => a + c.pop, 0), popF = found.reduce((a, c) => a + c.pop, 0);
  $('#qFound').textContent = found.length; $('#qTotal').textContent = pool.length;
  $('#qPct').textContent = Math.floor(100 * found.length / pool.length);
  $('#qPopPct').textContent = popAll ? Math.floor(100 * popF / popAll) : 0;
  $('#qBar').style.width = (100 * found.length / pool.length) + '%';
  $('#qTimer').textContent = fmtTime(q.ms || 0);
  $('#giveUp').textContent = q.gaveUp ? 'Hide missing again' : 'Give up & show missing';
  $('#answer').disabled = false; $('#answer').placeholder = 'Type a city…';

  // regions: continents for world scopes, countries otherwise
  const groups = new Map();
  const keyOf = S.quizScope.startsWith('c:') || S.quizScope.startsWith('n:') ? (c => c.country) : (c => c.cont);
  for (const c of pool) {
    const k = keyOf(c);
    if (!groups.has(k)) groups.set(k, { n: 0, f: 0, cc: c.iso2 });
    const g = groups.get(k); g.n++; if (q.found[c.id]) g.f++;
  }
  const gl = [...groups.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, S.quizScope.startsWith('n:') ? 0 : 30);
  $('#qRegions').innerHTML = gl.map(([k, g]) => `<div class="region" data-k="${esc(k)}"><b>${S.quizScope.startsWith('c:') ? flag(g.cc) + ' ' : ''}${esc(k)}</b><span>${g.f} / ${g.n}</span><div class="bar"><i style="width:${100 * g.f / g.n}%"></i></div></div>`).join('');
  $$('#qRegions .region').forEach(el => el.onclick = () => fitCities(pool.filter(c => keyOf(c) === el.dataset.k)));
  $('#qRegions').previousElementSibling.hidden = !gl.length;

  // list: found (newest first) + missing after giving up
  const missing = q.gaveUp ? pool.filter(c => !q.found[c.id]) : [];
  $('#qListTitle').textContent = q.gaveUp ? `Missing (${missing.length}) and found (${found.length})` : `Found (${found.length})`;
  const rows = [...missing.map(c => [c, 'miss']), ...found.sort((a, b) => q.found[b.id] - q.found[a.id]).map(c => [c, 'found'])];
  $('#qList').innerHTML = rows.map(([c, cls]) => `<li class="${cls}" data-id="${c.id}"><span class="rk">${c.rank}</span><span class="nm">${esc(c.name)} <small>${flag(c.iso2)} ${esc(c.country)}</small></span><span class="pp">${fmtPop(c.pop)}</span></li>`).join('');
  $$('#qList li').forEach(li => li.onclick = () => { const c = byId.get(+li.dataset.id); flyToCity(c, Math.max(map.getZoom(), 5)); showPopup(c); });

  // map
  const list = [];
  for (const c of pool) {
    if (q.found[c.id]) list.push({ c, st: 'found', label: c.name });
    else if (q.gaveUp) list.push({ c, st: 'miss', label: c.name });
    else if (S.hintDots) list.push({ c, st: 'hint' });
  }
  setCities(list);
  setOutlines(list.filter(x => x.st !== 'hint').map(x => x.c.id));
  if (refit) {
    if (S.quizScope === 'all' || S.quizScope === 'top100' || S.quizScope === 'p5' || S.quizScope === 'p2') fitCities(C);
    else fitCities(pool, S.quizScope.startsWith('n:') ? 7 : 5);
  }
  if (!isPhone()) setTimeout(() => $('#answer').focus(), 0);
}

// ------------------------------------------------------------------ PRACTICE
// Leitner-style boxes: 0 = new/missed … 4 = solid. "Known" = box >= 2.
const BOXW = [10, 6, 2.5, 1, 0.4];
const recent = [];
let cur = null, session = { ok: 0, n: 0 };
$('#pracScope').onchange = e => { S.pracScope = e.target.value; recent.length = 0; save(); startPractice(); };
$('#pracSeg').onclick = e => { const v = e.target.closest('button')?.dataset.v; if (v) { S.pracMode = v; save(); startPractice(); } };

function card(id) { return S.cards[id] ||= { box: 0, ok: 0, bad: 0, last: 0 }; }
function grade(c, ok) {
  const k = card(c.id);
  k.last = Date.now();
  if (ok) { k.ok++; k.box = Math.min(4, k.box + 1); } else { k.bad++; k.box = 0; }
  session.n++; if (ok) session.ok++;
  recent.push(c.id); if (recent.length > 8) recent.shift();
  renderPracticeStats(); save();
}
function pick(pool) {
  const avoid = new Set(recent.slice(-Math.min(recent.length, Math.max(1, Math.floor(pool.length / 2)))));
  let cands = pool.filter(c => !avoid.has(c.id));
  if (!cands.length) cands = pool;
  // unseen cities come in roughly by size, so the big ones are learned first
  const seenAny = cands.filter(c => S.cards[c.id]);
  const unseen = cands.filter(c => !S.cards[c.id]).sort((a, b) => b.pop - a.pop).slice(0, 8);
  const pickFrom = [...seenAny, ...unseen];
  const w = pickFrom.map(c => S.cards[c.id] ? BOXW[S.cards[c.id].box] : 5);
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pickFrom.length; i++) { r -= w[i]; if (r <= 0) return pickFrom[i]; }
  return pickFrom[pickFrom.length - 1];
}
function renderPracticeStats() {
  const pool = scopeCities(S.pracScope);
  const known = pool.filter(c => (S.cards[c.id]?.box || 0) >= 2).length;
  $('#pKnown').textContent = known; $('#pTotal').textContent = pool.length;
  $('#pKnownBar').style.width = (100 * known / pool.length) + '%';
  $('#pSession').textContent = `${session.ok} / ${session.n}`;
  $('#pracScope').value = S.pracScope;
  $$('#pracSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.pracMode));
}
function contextLine(c) { return `${flag(c.iso2)} ${esc(c.country)} · ${fmtPop(c.pop)} · #${c.rank} in the world`; }
function resultBlock(c, ok, extra = '') {
  return `<div class="result ${ok ? 'good' : 'bad'}"><div class="verdict">${ok ? '✓ Right' : '✗ Not quite'}</div>
    <div class="nm">${esc(c.name)}${c.local ? ` <small class="dim">(${esc(c.local)})</small>` : ''}</div>
    <div class="small">${contextLine(c)}${c.crank ? ` · #${c.crank} of ${c.cn} in ${esc(c.country)}` : ''}</div>${extra}
    ${c.contains.length ? `<div class="small dim">Includes ${c.contains.slice(0, 5).map(p => esc(p.n)).join(', ')}</div>` : ''}
    <div class="row" style="margin-top:10px"><button class="btn" id="pNext">Next ›</button><button class="btn ghost" id="pMore">Details</button></div></div>`;
}
function bindNext(c) {
  $('#pNext').onclick = () => nextCard();
  $('#pMore').onclick = () => { setMode('atlas'); selectCity(c); };
  setTimeout(() => $('#pNext')?.focus(), 0);
}
function startPractice() {
  session = { ok: 0, n: 0 };
  renderPracticeStats();
  nextCard();
}
function nextCard() {
  setMark([]); popup?.remove();
  const pool = scopeCities(S.pracScope);
  if (S.pracMode === 'bigger') return biggerCard(pool);
  cur = pick(pool);
  if (S.pracMode === 'name') nameCard(cur); else findCard(cur, pool);
}
function nameCard(c) {
  setCities([{ c, st: 'target' }]);
  setOutlines([c.id]);
  map.flyTo({ center: [c.lon, c.lat], zoom: 5.2, speed: 1.8, padding: mapPadding() });
  $('#pracCard').innerHTML = `<div class="q">Which city is this?<small>The highlighted dot — about ${fmtPop(c.pop)}</small></div>
    <input id="pAns" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="City name" enterkeyhint="done">
    <div class="row"><button class="btn" id="pCheck">Check</button><button class="btn ghost" id="pHint">Hint</button><button class="btn ghost" id="pSkip">Don't know</button></div>
    <div id="pHintTxt" class="small dim" style="margin-top:6px"></div>`;
  let hints = 0;
  const check = (giveUp) => {
    const key = norm($('#pAns').value);
    if (!key && !giveUp) return;
    const ok = !giveUp && ((answers[key] || []).includes(c.id) || (parts[key] || []).includes(c.id));
    const viaPart = ok && !(answers[key] || []).includes(c.id);
    grade(c, ok && hints < 2);
    setCities([{ c, st: ok ? 'found' : 'miss', label: c.name }]);
    $('#pracCard').innerHTML = resultBlock(c, ok, viaPart ? `<div class="small warn">${esc($('#pAns')?.value || '')} is inside it — the agglomeration is called <b>${esc(c.name)}</b>.</div>` : '');
    bindNext(c);
  };
  $('#pCheck').onclick = () => check(false);
  $('#pSkip').onclick = () => check(true);
  $('#pAns').onkeydown = e => { if (e.key === 'Enter') check(false); };
  $('#pHint').onclick = () => {
    hints++;
    $('#pHintTxt').innerHTML = hints === 1 ? `${flag(c.iso2)} ${esc(c.country)}` : `${flag(c.iso2)} ${esc(c.country)} · starts with “${esc(c.name.slice(0, 2))}…” (${c.name.length} letters)`;
  };
  if (!isPhone()) setTimeout(() => $('#pAns').focus(), 50);
}
let findHandler = null;
function findCard(c, pool) {
  setCities([]); setOutlines([]);
  const cont = C.filter(x => x.cont === c.cont);
  fitCities(S.pracScope.startsWith('n:') ? pool : cont, 5);
  $('#pracCard').innerHTML = `<div class="q">Where is ${esc(c.name)}?<small>${flag(c.iso2)} ${esc(c.country)} · ${fmtPop(c.pop)} — tap the map</small></div>
    <div class="row"><button class="btn ghost" id="pSkip">Show me</button></div>`;
  const done = (ll) => {
    map.off('click', findHandler); findHandler = null;
    const radius = Math.max(50, Math.sqrt(c.area / Math.PI) * 1.4);
    let extra = '', ok = false;
    if (ll) {
      const d = haversine(ll.lat, ll.lng, c.lat, c.lon);
      ok = d <= radius;
      extra = `<div class="small">${ok ? 'Within' : 'Off by'} ${fmtInt(Math.round(d))} km${ok ? '' : ` (needed < ${Math.round(radius)} km)`}</div>`;
      setMark([{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[ll.lng, ll.lat], [c.lon, c.lat]] } }]);
    }
    grade(c, ok);
    setCities([{ c, st: ok ? 'found' : 'miss', label: c.name }]);
    setOutlines([c.id]);
    if (ll) {
      const b = new maplibregl.LngLatBounds([ll.lng, ll.lat], [ll.lng, ll.lat]).extend([c.lon, c.lat]);
      map.fitBounds(b, { padding: 80, maxZoom: 6.5, duration: 700 });
    } else flyToCity(c, 5.5);
    $('#pracCard').innerHTML = resultBlock(c, ok, extra);
    bindNext(c);
  };
  if (findHandler) map.off('click', findHandler);
  findHandler = e => done(e.lngLat);
  map.on('click', findHandler);
  $('#pSkip').onclick = () => done(null);
}
function haversine(a1, o1, a2, o2) {
  const R = 6371, r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function biggerCard(pool) {
  if (pool.length < 2) { $('#pracCard').innerHTML = '<div class="q">Pick a selection with at least two cities.</div>'; return; }
  const a = pick(pool);
  // a partner of similar size makes it interesting: within ×1.6 if possible
  let cands = pool.filter(x => x.id !== a.id && Math.max(x.pop, a.pop) / Math.min(x.pop, a.pop) < 1.6);
  if (!cands.length) cands = pool.filter(x => x.id !== a.id);
  const b = cands[Math.floor(Math.random() * cands.length)];
  const pair = Math.random() < 0.5 ? [a, b] : [b, a];
  setCities(pair.map(c => ({ c, st: 'target', label: c.name })));
  setOutlines(pair.map(c => c.id));
  fitCities(pair, 5);
  $('#pracCard').innerHTML = `<div class="q">Which has more people?<small>Urban agglomeration population, 2025</small></div>
    <div class="pair">${pair.map(c => `<button data-id="${c.id}"><b>${esc(c.name)}</b><small>${flag(c.iso2)} ${esc(c.country)}</small></button>`).join('')}</div>
    <div id="pRes"></div>`;
  $$('#pracCard .pair button').forEach(btn => btn.onclick = () => {
    const chosen = byId.get(+btn.dataset.id), other = pair.find(c => c !== chosen);
    const ok = chosen.pop >= other.pop;
    S.bigger.n++; if (ok) S.bigger.ok++;
    session.n++; if (ok) session.ok++;
    // a wrong answer is a sign the smaller one's size isn't known yet
    if (!ok) { card(chosen.id).box = Math.min(card(chosen.id).box, 1); card(other.id).box = Math.min(card(other.id).box, 1); }
    $$('#pracCard .pair button').forEach(x => {
      const c = byId.get(+x.dataset.id);
      x.disabled = true;
      x.classList.add(c.pop >= (pair.find(y => y !== c).pop) ? 'right' : 'wrong');
      x.insertAdjacentHTML('beforeend', `<span class="pv">${fmtPop(c.pop)}</span><small>#${c.rank} in the world</small>`);
    });
    $('#pRes').innerHTML = `<div class="result ${ok ? 'good' : 'bad'}"><span class="verdict">${ok ? '✓ Right' : '✗ The other one'}</span> <span class="small dim">· ${Math.round(100 * S.bigger.ok / S.bigger.n)}% right over ${S.bigger.n} rounds</span>
      <div class="row" style="margin-top:10px"><button class="btn" id="pNext">Next ›</button></div></div>`;
    $('#pNext').onclick = () => nextCard();
    $('#pNext').focus();
    renderPracticeStats(); save();
  });
}

// ------------------------------------------------------------------ ATLAS
let selected = null;
$('#atlasScope').onchange = e => { S.atlasScope = e.target.value; renderAtlas(true); save(); };
$('#atlasSort').onchange = e => { S.atlasSort = e.target.value; renderAtlas(); save(); };
$('#atlasSearch').oninput = () => renderAtlas();
$('#atlasHideNames').onchange = e => { S.atlasHideNames = e.target.checked; renderAtlas(); save(); };

function matchesSearch(c, k) {
  if (!k) return true;
  if (norm(c.name).includes(k) || norm(c.country).includes(k)) return true;
  if (c.aliases.some(a => norm(a).includes(k))) return true;
  if (k.length >= 3 && c.contains.some(p => norm(p.n).startsWith(k))) return true;
  return false;
}
function renderAtlas(refit) {
  $('#atlasScope').value = S.atlasScope; $('#atlasSort').value = S.atlasSort; $('#atlasHideNames').checked = S.atlasHideNames;
  const k = norm($('#atlasSearch').value);
  let list = scopeCities(S.atlasScope).filter(c => matchesSearch(c, k));
  const sorters = {
    pop: (a, b) => b.pop - a.pop,
    name: (a, b) => a.name.localeCompare(b.name),
    country: (a, b) => a.country.localeCompare(b.country) || b.pop - a.pop,
    growth: (a, b) => (b.growth || 0) - (a.growth || 0),
  };
  list.sort(sorters[S.atlasSort]);
  $('#atlasCount').textContent = `${list.length} cities · ${fmtPop(list.reduce((a, c) => a + c.pop, 0))} people`;
  const q = S.quiz['all' + (S.minPop < 1e6 ? '@800k' : '')]?.found || {};
  $('#atlasList').innerHTML = list.map(c => {
    const right = S.atlasSort === 'growth' && c.growth ? `×${c.growth.toFixed(2)}` : fmtPop(c.pop);
    return `<li data-id="${c.id}" class="${selected === c.id ? 'sel' : ''} ${q[c.id] ? 'found' : ''}"><span class="rk">${c.rank}</span><span class="nm">${esc(c.name)} <small>${flag(c.iso2)} ${esc(c.country)}</small></span><span class="pp">${right}</span></li>`;
  }).join('');
  $$('#atlasList li').forEach(li => li.onclick = () => selectCity(byId.get(+li.dataset.id), true));
  setCities(list.map(c => ({ c, st: selected === c.id ? 'sel' : 'atlas', label: S.atlasHideNames && selected !== c.id ? '' : c.name })));
  setOutlines(list.map(c => c.id));
  if (refit) {
    if (S.atlasScope.startsWith('c:') || S.atlasScope.startsWith('n:')) fitCities(list, S.atlasScope.startsWith('n:') ? 7 : 5);
  }
}
function spark(c) {
  const ys = Object.keys(c.ts).map(Number).sort((a, b) => a - b);
  const vals = ys.map(y => c.ts[y]);
  const W = 320, H = 64, pad = 4, max = Math.max(...vals) * 1.05;
  const x = y => pad + (W - 2 * pad) * (y - ys[0]) / (ys[ys.length - 1] - ys[0]);
  const yv = v => H - 14 - (H - 20) * v / max;
  const pts = ys.map((y, i) => `${x(y).toFixed(1)},${yv(vals[i]).toFixed(1)}`);
  const iNow = ys.indexOf(2025);
  const past = pts.slice(0, iNow + 1).join(' '), fut = pts.slice(iNow).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Population 1975 to 2050">
    <polygon class="ar" points="${x(ys[0])},${H - 14} ${pts.join(' ')} ${x(ys[ys.length - 1])},${H - 14}"/>
    <polyline class="ln" points="${past}"/><polyline class="ln proj" points="${fut}"/>
    <circle class="now" cx="${x(2025)}" cy="${yv(c.ts[2025])}" r="3.5"/>
    <text x="${pad}" y="${H - 2}">${ys[0]}: ${fmtPop(vals[0])}</text>
    <text x="${x(2025)}" y="${H - 2}" text-anchor="middle">2025</text>
    <text x="${W - pad}" y="${H - 2}" text-anchor="end">2050: ${fmtPop(vals[vals.length - 1])}</text></svg>`;
}
function selectCity(c, fly) {
  selected = c.id;
  const k = S.cards[c.id];
  const density = c.area ? Math.round(c.pop / c.area) : null;
  const other = c.aliases.filter(a => norm(a) !== norm(c.name) && a !== c.wup && a !== c.local).slice(0, 12);
  $('#detail').hidden = false;
  $('#detail').innerHTML = `<button class="icon-btn close" aria-label="Close">×</button>
    <h2>${esc(c.name)}${c.cap ? '<span class="badge cap">capital</span>' : ''}${c.plaus === 'Low' ? '<span class="badge low" title="WUP 2025 plausibility rating">low plausibility</span>' : ''}${c.pop < 1e6 ? '<span class="badge">800k–1M</span>' : ''}</h2>
    <div class="sub">${c.local ? esc(c.local) + ' · ' : ''}${flag(c.iso2)} ${esc(c.country)} · ${esc(c.sub || c.cont)}</div>
    <div class="facts">
      <div><b>${fmtPop(c.pop)}</b><small>people 2025</small></div>
      <div><b>#${c.rank}</b><small>world · #${c.crank} of ${c.cn} in country</small></div>
      <div><b>${fmtInt(c.area)}</b><small>km² · ${density ? fmtInt(density) + '/km²' : ''}</small></div>
    </div>
    ${spark(c)}
    ${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}
    ${c.wup !== c.name ? `<div class="small dim">WUP name: ${esc(c.wup)}</div>` : ''}
    ${c.contains.length ? `<div class="dh">Includes</div><div class="chips">${c.contains.slice(0, 18).map(p => `<span>${esc(p.n)} <small>${fmtPop(p.p)}</small></span>`).join('')}</div>` : ''}
    ${other.length ? `<div class="dh">Also accepted</div><div class="chips">${other.map(a => `<span>${esc(a)}</span>`).join('')}</div>` : ''}
    <div class="small dim">${k ? `Practice: ${k.ok}× right, ${k.bad}× wrong` : 'Not practised yet'} · plausibility ${esc(c.plaus.toLowerCase())}${c.split ? ' · outline approximate' : ''}</div>`;
  $('#detail .close').onclick = () => { selected = null; $('#detail').hidden = true; popup?.remove(); renderAtlas(); };
  renderAtlas();
  if (fly) flyToCity(c, Math.max(map.getZoom(), 6.5));
  $('#panel').scrollTo({ top: 0, behavior: 'smooth' });
  if (isPhone()) $('#panel').classList.remove('short');
}

// ------------------------------------------------------------------ map interaction
let popup = null;
function showPopup(c) {
  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: false, offset: 10, maxWidth: '260px' })
    .setLngLat([c.lon, c.lat])
    .setHTML(`<b>${esc(c.name)}</b> ${flag(c.iso2)}<br><span class="dim">${esc(c.country)} · ${fmtPop(c.pop)} · #${c.rank}</span>`)
    .addTo(map);
}
map.on('click', 'cities', e => {
  const f = e.features[0]; if (!f) return;
  const c = byId.get(f.properties.id);
  if (S.mode === 'atlas') { selectCity(c); showPopup(c); }
  else if (S.mode === 'quiz' && (f.properties.st === 'found' || f.properties.st === 'miss')) showPopup(c);
});
map.on('mouseenter', 'cities', e => {
  const st = e.features[0]?.properties.st;
  if (S.mode === 'atlas' || st === 'found' || st === 'miss') map.getCanvas().style.cursor = 'pointer';
});
map.on('mouseleave', 'cities', () => { map.getCanvas().style.cursor = ''; });

// phone: drag the grip to resize the bottom sheet
$('#grip').onclick = () => {
  const p = $('#panel');
  if (p.classList.contains('tall')) { p.classList.remove('tall'); p.classList.add('short'); }
  else if (p.classList.contains('short')) p.classList.remove('short');
  else p.classList.add('tall');
  setTimeout(() => map.resize(), 250);
};
let dragY = null;
$('#grip').addEventListener('touchstart', e => { dragY = e.touches[0].clientY; }, { passive: true });
$('#grip').addEventListener('touchend', e => {
  if (dragY == null) return;
  const dy = e.changedTouches[0].clientY - dragY, p = $('#panel');
  dragY = null;
  if (Math.abs(dy) < 20) return;
  e.preventDefault();
  if (dy < 0) { if (p.classList.contains('short')) p.classList.remove('short'); else p.classList.add('tall'); }
  else { if (p.classList.contains('tall')) p.classList.remove('tall'); else p.classList.add('short'); }
  setTimeout(() => map.resize(), 250);
});

$('#aboutBtn').onclick = () => $('#about').showModal();
$('#about').addEventListener('click', e => { if (e.target === $('#about')) $('#about').close(); });

map.on('load', () => {
  $('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  applyLayers();
  setMode(S.mode);
});
