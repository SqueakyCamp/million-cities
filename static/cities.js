import { $, $$, esc, norm, fmtPop, fmtInt, flag, fmtTime, dark, isPhone, haversine, toast, pickCard, LEVELS, levelStart } from './lib/util.js';
import { store, loadState, save, watchVisibility } from './lib/store.js';
import { maplibregl, COL, PAL, empty, DEFAULT_LAYERS, createMap, applyBaseLayers, layersPopover, bindLayers } from './lib/mapbase.js';

// ------------------------------------------------------------------ databases
// Each database is one file in data/db/ (built by tools/build_data.py and build_alt.py).
const DBS = [
  { key: 'wup2025', label: 'Agglomerations · UN 2025' },
  { key: 'wup2018', label: 'National definitions · UN 2018' },
  { key: 'wikidata', label: 'City proper · Wikidata' },
];
const CONTS = ['Asia', 'Africa', 'Europe', 'Latin America', 'Northern America', 'Oceania'];
let data = {}, C = [], byId = new Map(), answers = {}, parts = {}, near = {};
const dbCache = {};
// ids are numbers (UN) or strings (Wikidata Q-ids); DOM data-* attributes are always strings
const cityOf = v => byId.get(v) ?? byId.get(+v);
async function loadDb(key) {
  if (!DBS.some(d => d.key === key)) key = 'wup2025';
  data = dbCache[key] ||= await fetch(`data/db/${key}.json`).then(r => r.json());
  C = data.cities;
  byId = new Map(C.map(c => [c.id, c]));
  answers = data.answers; parts = data.parts || {}; near = data.near || {};
  for (const c of C) c.growth = c.ts?.[2000] ? c.pop / c.ts[2000] : null;
}
// progress is kept per database; the original one (WUP 2025) keeps its unprefixed keys
const dbPrefix = () => S.db === 'wup2025' ? '' : S.db + ':';
const ck = id => dbPrefix() + id;

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
  basemap: 'terrain', layers: DEFAULT_LAYERS,
  hintDots: false, flyTo: false, acceptParts: false, atlasHideNames: false,
  db: 'wup2025', // which database (DBS)
  minPop: 1e6,   // 1e6 or 8e5
  quiz: {},      // [db:]scope[@800k] -> {found: {id: ts}, ms, gaveUp}
  cards: {},     // [db:]id -> {box, ok, bad, last}
  bigger: { ok: 0, n: 0 },
  pracLevel: {}, // practice difficulty per [db:]scope (0 = largest cities first … LEVELS-1)
};
// progress lives in the shared store (lib/store.js); this app uses its top level
let S;
function adopt() {
  S = store.S;
  for (const [k, v] of Object.entries(DEFAULT)) if (!(k in S)) S[k] = structuredClone(v);
  S.layers = Object.assign({}, DEFAULT.layers, S.layers);
}
store.onRemote = () => { adopt(); renderAll(); };
watchVisibility(() => quizTick(), () => { lastTick = Date.now(); });

await loadState();
adopt();
const local = store.local;
await loadDb(S.db);
$('#storageNote').textContent = local
  ? 'Your progress is saved in this browser only.'
  : 'Progress is saved on the server, so all your devices share it.';

// ------------------------------------------------------------------ map
const map = createMap({
  sources: {
    outlines: { type: 'geojson', data: empty, attribution: 'GHSL UCDB R2024A' },
    cities: { type: 'geojson', data: empty, attribution: 'UN WUP 2025 · GeoNames' },
    mark: { type: 'geojson', data: empty },
  },
  middle: [
      { id: 'outline-fill', type: 'fill', source: 'outlines', filter: ['in', ['get', 'id'], ['literal', []]], paint: { 'fill-color': COL.outline, 'fill-opacity': 0.16 } },
      { id: 'outline-line', type: 'line', source: 'outlines', minzoom: 4, filter: ['in', ['get', 'id'], ['literal', []]], paint: { 'line-color': COL.outline, 'line-width': 1.2, 'line-opacity': 0.8 } },
  ],
  top: [
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
});

let outlinesLoaded = false;
$('#layers').innerHTML = layersPopover([['outlines', 'City outlines <small>(urban extent)</small>']]);
function applyLayers() {
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  const sat = applyBaseLayers(map, S), L = S.layers;
  if (L.outlines && data.outlines && !outlinesLoaded) { outlinesLoaded = true; map.getSource('outlines').setData('data/outlines.geojson'); }
  vis('outline-fill', L.outlines); vis('outline-line', L.outlines);
  // labels over imagery need a darker halo
  map.setPaintProperty('city-labels', 'text-halo-color', sat ? '#000' : PAL.halo);
  map.setPaintProperty('city-labels', 'text-color', ['match', ['get', 'st'], 'miss', sat ? '#ff8a8a' : COL.miss, sat ? '#fff' : PAL.text]);
}
bindLayers(map, S, () => { applyLayers(); save(); });

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
  if (!data.outlines) ids = [];
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


// ------------------------------------------------------------------ modes
function setMode(m) {
  S.mode = m;
  $$('.modes button').forEach(b => b.setAttribute('aria-selected', b.dataset.mode === m));
  $$('.mode').forEach(s => s.classList.toggle('on', s.id === 'mode-' + m));
  setMark([]);
  popup?.remove();
  $('#qDetail').hidden = true;
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
const qKey = () => dbPrefix() + S.quizScope + (S.minPop < 1e6 ? '@800k' : '');
const QZ = () => {
  const k = qKey();
  if (!S.quiz[k]) {
    const base = S.minPop < 1e6 ? S.quiz[dbPrefix() + S.quizScope] : null;
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

// database + city-set selectors (shared by all modes)
function applyMinPop() {
  countCountries();
  const n1 = C.filter(c => c.pop >= 1e6).length, n8 = C.length;
  $('#subtitle').textContent = `${S.minPop < 1e6 ? n8 + ' cities ≥ 800,000' : n1 + ' cities ≥ 1 million'} · ${data.name}`;
  for (const [sel, key] of [['#quizScope', 'quizScope'], ['#pracScope', 'pracScope'], ['#atlasScope', 'atlasScope']]) {
    fillScopeSelect($(sel), true);
    if (!scopeCities(S[key]).length) S[key] = 'all';
    $(sel).value = S[key];
  }
  $('#minPopSel').innerHTML = `<option value="1000000">≥ 1 million (${n1})</option><option value="800000">≥ 800,000 (${n8})</option>`;
  $('#minPopSel').value = String(S.minPop);
  $('#dbSel').innerHTML = DBS.map(d => `<option value="${d.key}">${esc(d.label)}</option>`).join('');
  $('#dbSel').value = data.key;
  $('#dbDesc').textContent = data.desc || '';
  // outlines exist only for the WUP 2025 cities
  const ol = $('#layersPop [data-layer="outlines"]');
  ol.disabled = !data.outlines;
  ol.parentElement.title = data.outlines ? '' : 'Only available for the UN 2025 database';
  ol.parentElement.style.opacity = data.outlines ? '' : '.5';
}
function rerenderMode() {
  selected = null; popup?.remove(); recent.length = 0;
  if (S.mode === 'quiz') renderQuiz(true); else if (S.mode === 'atlas') { $('#detail').hidden = true; renderAtlas(true); } else startPractice();
}
$('#minPopSel').onchange = e => { S.minPop = +e.target.value; applyMinPop(); rerenderMode(); save(); };
$('#dbSel').onchange = async e => {
  S.db = e.target.value;
  await loadDb(S.db);
  applyMinPop(); applyLayers(); rerenderMode(); save();
};
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
  if (refit) $('#qDetail').hidden = true;
  const q = QZ(), pool = scopeCities(S.quizScope);
  $('#quizScope').value = S.quizScope;
  $('#hintDots').checked = S.hintDots; $('#flyTo').checked = S.flyTo; $('#acceptParts').checked = S.acceptParts;
  $('#acceptParts').parentElement.hidden = !Object.keys(parts).length;
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
  $$('#qList li').forEach(li => li.onclick = () => { const c = cityOf(li.dataset.id); flyToCity(c, Math.max(map.getZoom(), 5)); showPopup(c); quizInfo(c); });

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
const recent = [];
let cur = null, session = { ok: 0, n: 0 };
$('#pracScope').onchange = e => { S.pracScope = e.target.value; recent.length = 0; save(); startPractice(); };
$('#pracSeg').onclick = e => { const v = e.target.closest('button')?.dataset.v; if (v) { S.pracMode = v; save(); startPractice(); } };

function card(id) { return S.cards[ck(id)] ||= { box: 0, ok: 0, bad: 0, last: 0 }; }
function grade(c, ok) {
  const k = card(c.id);
  k.last = Date.now();
  if (ok) { k.ok++; k.box = Math.min(4, k.box + 1); } else { k.bad++; k.box = 0; }
  session.n++; if (ok) session.ok++;
  recent.push(c.id); if (recent.length > 8) recent.shift();
  renderPracticeStats(); save();
}
// difficulty: at higher levels new cities start further down the size ranking (lib/util.js pickCard)
const levelKey = () => dbPrefix() + S.pracScope + (S.minPop < 1e6 ? '@800k' : '');
const pracLevel = () => Math.min(LEVELS - 1, S.pracLevel[levelKey()] || 0);
const bySize = pool => [...pool].sort((a, b) => b.pop - a.pop);
function pick(pool) {
  return pickCard(bySize(pool), pracLevel(), c => S.cards[ck(c.id)], recent);
}
function renderLevel() {
  const pool = bySize(scopeCities(S.pracScope)), L = pracLevel(), i = levelStart(pool.length, L), c = pool[i];
  $('#pLevel').innerHTML = `<b>Level ${L + 1} of ${LEVELS}</b><small>${L === 0 ? 'New cities come in largest first' : c ? `New cities from #${i + 1} (${esc(c.name)}, ${fmtPop(c.pop)}) down; bigger ones only come back until you know them` : ''}</small>`;
  $('#pEasier').disabled = L === 0; $('#pHarder').disabled = L === LEVELS - 1 || pool.length < LEVELS;
}
$('#pEasier').onclick = () => { S.pracLevel[levelKey()] = Math.max(0, pracLevel() - 1); recent.length = 0; save(); renderLevel(); nextCard(); };
$('#pHarder').onclick = () => { S.pracLevel[levelKey()] = Math.min(LEVELS - 1, pracLevel() + 1); recent.length = 0; save(); renderLevel(); nextCard(); };
function renderPracticeStats() {
  const pool = scopeCities(S.pracScope);
  const known = pool.filter(c => (S.cards[ck(c.id)]?.box || 0) >= 2).length;
  $('#pKnown').textContent = known; $('#pTotal').textContent = pool.length;
  $('#pKnownBar').style.width = (100 * known / pool.length) + '%';
  $('#pSession').textContent = `${session.ok} / ${session.n}`;
  $('#pracScope').value = S.pracScope;
  renderLevel();
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
    const radius = c.area ? Math.max(50, Math.sqrt(c.area / Math.PI) * 1.4) : 60;
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
  $('#pracCard').innerHTML = `<div class="q">Which has more people?<small>${esc(data.short || data.name)}</small></div>
    <div class="pair">${pair.map(c => `<button data-id="${c.id}"><b>${esc(c.name)}</b><small>${flag(c.iso2)} ${esc(c.country)}</small></button>`).join('')}</div>
    <div id="pRes"></div>`;
  $$('#pracCard .pair button').forEach(btn => btn.onclick = () => {
    const chosen = cityOf(btn.dataset.id), other = pair.find(c => c !== chosen);
    const ok = chosen.pop >= other.pop;
    S.bigger.n++; if (ok) S.bigger.ok++;
    session.n++; if (ok) session.ok++;
    // a wrong answer is a sign the smaller one's size isn't known yet
    if (!ok) { card(chosen.id).box = Math.min(card(chosen.id).box, 1); card(other.id).box = Math.min(card(other.id).box, 1); }
    $$('#pracCard .pair button').forEach(x => {
      const c = cityOf(x.dataset.id);
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
  const q = S.quiz[dbPrefix() + 'all' + (S.minPop < 1e6 ? '@800k' : '')]?.found || {};
  $('#atlasList').innerHTML = list.map(c => {
    const right = S.atlasSort === 'growth' && c.growth ? `×${c.growth.toFixed(2)}` : fmtPop(c.pop);
    return `<li data-id="${c.id}" class="${selected === c.id ? 'sel' : ''} ${q[c.id] ? 'found' : ''}"><span class="rk">${c.rank}</span><span class="nm">${esc(c.name)} <small>${flag(c.iso2)} ${esc(c.country)}</small></span><span class="pp">${right}</span></li>`;
  }).join('');
  $$('#atlasList li').forEach(li => li.onclick = () => selectCity(cityOf(li.dataset.id), true));
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
  const last = ys[ys.length - 1];
  const iNow = Math.max(0, ys.indexOf(2025));
  const past = pts.slice(0, iNow + 1).join(' '), fut = pts.slice(iNow).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Population ${ys[0]} to ${last}">
    <polygon class="ar" points="${x(ys[0])},${H - 14} ${pts.join(' ')} ${x(ys[ys.length - 1])},${H - 14}"/>
    <polyline class="ln" points="${past}"/><polyline class="ln proj" points="${fut}"/>
    <circle class="now" cx="${x(2025)}" cy="${yv(c.ts[2025])}" r="3.5"/>
    <text x="${pad}" y="${H - 2}">${ys[0]}: ${fmtPop(vals[0])}</text>
    ${last - 2025 >= 20 ? `<text x="${x(2025)}" y="${H - 2}" text-anchor="middle">2025</text>` : ''}
    <text x="${W - pad}" y="${H - 2}" text-anchor="end">${last}: ${fmtPop(vals[vals.length - 1])}</text></svg>`;
}
// short facts per city (tools/build_facts.py), loaded the first time a city is opened
let factsData = null, factsLoading = null;
function loadFacts() {
  return factsLoading ||= fetch('data/facts.json').then(r => r.json()).then(d => { factsData = d; }).catch(() => { factsData = { map: {}, f: {}, t: {} }; });
}
function factsHtml(c) {
  const q = factsData?.map[`${S.db}:${c.id}`];
  const f = q && factsData.f[q];
  if (!f) return '';
  const t = factsData.t[q];
  return `<div class="dh">Good to know</div><ul class="cfacts">${f.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    ${t ? `<div class="small dim">From Wikipedia: <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}" target="_blank" rel="noopener">${esc(t)}</a></div>` : ''}`;
}
// the info box for a city (atlas detail, and in the quiz for cities already found)
function showCityInfo(el, c, onClose) {
  if (!factsData) loadFacts().then(() => { const f = $('.cityFacts', el); if (f && el.dataset.id === String(c.id)) f.innerHTML = factsHtml(c); });
  el.dataset.id = c.id;
  const k = S.cards[ck(c.id)];
  const density = c.area ? Math.round(c.pop / c.area) : null;
  const other = c.aliases.filter(a => norm(a) !== norm(c.name) && a !== c.wup && a !== c.local).slice(0, 12);
    el.hidden = false;
  el.innerHTML = `<button class="icon-btn close" aria-label="Close">×</button>
    <h2>${esc(c.name)}${c.cap ? '<span class="badge cap">capital</span>' : ''}${c.plaus === 'Low' ? '<span class="badge low" title="WUP 2025 plausibility rating">low plausibility</span>' : ''}${c.pop < 1e6 ? '<span class="badge">800k–1M</span>' : ''}</h2>
    <div class="sub">${c.local ? esc(c.local) + ' · ' : ''}${flag(c.iso2)} ${esc(c.country)} · ${esc(c.sub || c.cont)}</div>
    <div class="facts">
      <div><b>${fmtPop(c.pop)}</b><small>people ${esc(c.popyear || data.year || '')}</small></div>
      <div><b>#${c.rank}</b><small>world · #${c.crank} of ${c.cn} in country</small></div>
      ${c.area ? `<div><b>${fmtInt(c.area)}</b><small>km² · ${density ? fmtInt(density) + '/km²' : ''}</small></div>`
               : `<div><b class="def">${esc(c.concept || c.defn || '')}</b><small>${c.concept ? 'national definition' : 'counted area'}</small></div>`}
    </div>
    ${c.ts ? spark(c) : ''}
    <div class="cityFacts">${factsHtml(c)}</div>
    ${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}
    ${c.wup && c.wup !== c.name ? `<div class="small dim">Name in the UN list: ${esc(c.wup)}</div>` : ''}
    ${c.popsrc ? `<div class="small dim">Figure: ${esc(c.popsrc)}${c.popyear ? ' (' + esc(c.popyear) + ')' : ''}</div>` : ''}
    ${c.contains.length ? `<div class="dh">Includes</div><div class="chips">${c.contains.slice(0, 18).map(p => `<span>${esc(p.n)} <small>${fmtPop(p.p)}</small></span>`).join('')}</div>` : ''}
    ${other.length ? `<div class="dh">Also accepted</div><div class="chips">${other.map(a => `<span>${esc(a)}</span>`).join('')}</div>` : ''}
    <div class="small dim">${k ? `Practice: ${k.ok}× right, ${k.bad}× wrong` : 'Not practised yet'}${c.plaus ? ' · plausibility ' + esc(c.plaus.toLowerCase()) : ''}${c.split ? ' · outline approximate' : ''}${c.wikidata ? ` · <a href="https://www.wikidata.org/wiki/${esc(c.wikidata)}" target="_blank" rel="noopener">Wikidata</a>` : ''}</div>`;
  $('.close', el).onclick = () => { el.hidden = true; popup?.remove(); onClose?.(); };
}
function selectCity(c, fly) {
  selected = c.id;
  showCityInfo($('#detail'), c, () => { selected = null; renderAtlas(); });
  renderAtlas();
  if (fly) flyToCity(c, Math.max(map.getZoom(), 6.5));
  $('#panel').scrollTo({ top: 0, behavior: 'smooth' });
  if (isPhone()) $('#panel').classList.remove('short');
}
// quiz: open the info box of a found (or revealed) city without leaving the quiz
function quizInfo(c) {
  showCityInfo($('#qDetail'), c);
  $('#qDetail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
  else if (S.mode === 'quiz' && (f.properties.st === 'found' || f.properties.st === 'miss')) { showPopup(c); quizInfo(c); }
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
