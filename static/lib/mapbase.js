// The base map shared by all pages: background styles (plain / terrain / physical / satellite) and the
// overlays (borders, subdivisions, rivers & lakes, their names, country and subdivision names).
// Pages add their own sources/layers between `below` and `above` (and on top).
import * as maplibregl from '../vendor/maplibre-gl.mjs';
import { $, $$, dark, isPhone } from './util.js';

export { maplibregl };
export const PAL = dark
  ? { ocean: '#0e1a24', land: '#1d262e', lake: '#0e1a24', river: '#2b4a63', border: '#6c7a86', admin: '#46525d', text: '#c9d2da', halo: '#0e1a24', ctext: '#8c99a5', wtext: '#7fa9c9', bold: '#e6ebef', boldAdmin: '#b8c2ca', casing: '#0e1a24' }
  : { ocean: '#c6dbe7', land: '#f4f2ec', lake: '#c6dbe7', river: '#8fb6cf', border: '#8b8f94', admin: '#b9b6ad', text: '#22292f', halo: '#ffffff', ctext: '#6d757c', wtext: '#2f6286', bold: '#2a2a2a', boldAdmin: '#4f4a44', casing: '#ffffff' };
export const COL = dark
  ? { found: '#3ecf7a', miss: '#ff6b6b', hint: '#7b8894', atlas: '#ffcc4d', target: '#ff9f1c', outline: '#ffcc4d' }
  : { found: '#1f9d55', miss: '#d64545', hint: '#7d8790', atlas: '#c2410c', target: '#e8590c', outline: '#c2410c' };
export const empty = { type: 'FeatureCollection', features: [] };
export const DEFAULT_LAYERS = { borders: true, bordersBold: false, admin1: false, admin1Bold: false, rivers: true, wlabels: false, clabels: false, slabels: false, outlines: true };
const RLABELS = ['rlabels0-0', 'rlabels0-1', 'rlabels4-0', 'rlabels4-1', 'rlabels7-0', 'rlabels7-1'];

export function baseSources() {
  return {
    land: { type: 'geojson', data: 'data/geo/land.geojson', attribution: 'Natural Earth' },
    dem: { type: 'raster-dem', encoding: 'terrarium', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 12, attribution: 'Terrain: Mapzen/AWS' },
    physical: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 8, attribution: '© Esri, US NPS' },
    satellite: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18, attribution: '© Esri, Maxar, Earthstar Geographics' },
    oceanpoly: { type: 'geojson', data: empty }, lakes: { type: 'geojson', data: empty }, rivers: { type: 'geojson', data: empty },
    rlines: { type: 'geojson', data: empty }, borders: { type: 'geojson', data: empty }, admin1: { type: 'geojson', data: empty }, labels: { type: 'geojson', data: empty },
  };
}
export function belowLayers() {
  return [
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
    // "bold" borders: a light casing under a dark line so they read on terrain/physical maps
    { id: 'admin1-casing', type: 'line', source: 'admin1', minzoom: 1.5, layout: { visibility: 'none', 'line-join': 'round' }, paint: { 'line-color': PAL.casing, 'line-opacity': 0.6, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 2, 8, 4] } },
    { id: 'borders-casing', type: 'line', source: 'borders', layout: { visibility: 'none', 'line-join': 'round' }, paint: { 'line-color': PAL.casing, 'line-opacity': 0.7, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 2.6, 8, 6] } },
    { id: 'admin1', type: 'line', source: 'admin1', minzoom: 1.5, paint: { 'line-color': PAL.admin, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 8, 1.2], 'line-dasharray': [3, 2] } },
    { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': PAL.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 8, 1.6] } },
    // river names follow smoothed copies of the rivers (rlines): coarse below zoom 6, fine above
    ...[[0, 3, 2], [4, 6, 4], [7, 99, 5.5]].flatMap(([lo, hi, z]) => [[z, 6, 0], [6, 24, 1]].map(([z0, z1, fine]) => ({
      id: `rlabels${lo}-${fine}`, type: 'symbol', source: 'rlines', minzoom: Math.max(z, z0), maxzoom: z1,
      filter: ['all', ['==', ['get', 'z'], fine], ['>=', ['get', 'r'], lo], ['<=', ['get', 'r'], hi]],
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 250, 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10.5, 8, 13], 'text-max-angle': 70, 'text-padding': 4, visibility: 'none',
      },
      paint: { 'text-color': PAL.wtext, 'text-halo-color': PAL.halo, 'text-halo-width': 1.3 },
    }))),
    {
      id: 'llabels', type: 'symbol', source: 'labels', filter: ['==', ['get', 't'], 'l'], minzoom: 2.5, layout: {
        'text-field': ['get', 'n'], 'text-font': ['Noto Sans Italic'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 13],
        'symbol-sort-key': ['get', 'r'], 'text-max-width': 7, visibility: 'none',
      }, paint: { 'text-color': PAL.wtext, 'text-halo-color': PAL.halo, 'text-halo-width': 1.3 },
    },
  ];
}
export function aboveLayers() {
  return [
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
  ];
}

export function createMap({ sources = {}, middle = [], top = [], center = [30, 22], zoom }) {
  const map = new maplibregl.Map({
    container: 'map',
    attributionControl: { compact: true },
    center, zoom: zoom ?? (isPhone() ? 0.6 : 1.6), minZoom: 0.3, maxZoom: 13,
    renderWorldCopies: true,
    style: {
      version: 8,
      glyphs: 'fonts/{fontstack}/{range}.pbf',
      sources: { ...baseSources(), ...sources },
      layers: [...belowLayers(), ...middle, ...aboveLayers(), ...top],
    },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.touchZoomRotate.disableRotation();
  map.dragRotate.disable();
  return map;
}

const geoLoaded = {};
function ensureGeo(map, ...names) {
  for (const n of names) {
    if (geoLoaded[n]) continue;
    geoLoaded[n] = true;
    map.getSource(n).setData(`data/geo/${n === 'oceanpoly' ? 'ocean' : n}.geojson`);
  }
}
// show/hide the base layers for S.basemap + S.layers; returns true when the satellite map is on
export function applyBaseLayers(map, S) {
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  const b = S.basemap;
  vis('relief', b === 'terrain'); vis('hillshade', b === 'terrain');
  if (b === 'terrain') ensureGeo(map, 'oceanpoly');
  vis('oceanpoly', b === 'terrain');
  vis('physical', b === 'physical'); vis('satellite', b === 'satellite');
  vis('land', b !== 'satellite' && b !== 'physical');
  // under the terrain colours, land below sea level should look like lowland, not like paper
  map.setPaintProperty('land', 'fill-color', b === 'terrain' ? (dark ? '#5d6f55' : '#a7c99a') : PAL.land);
  const L = S.layers;
  if (L.borders) ensureGeo(map, 'borders');
  if (L.admin1) ensureGeo(map, 'admin1');
  if (L.rivers) ensureGeo(map, 'rivers', 'lakes');
  if (L.wlabels) ensureGeo(map, 'rlines');
  if (L.clabels || L.slabels || L.wlabels) ensureGeo(map, 'labels');
  vis('borders', L.borders); vis('admin1', L.admin1); vis('rivers', L.rivers);
  vis('lakes', L.rivers && b !== 'satellite' && b !== 'physical');
  vis('clabels', L.clabels); vis('slabels', L.slabels);
  RLABELS.forEach(id => vis(id, L.wlabels)); vis('llabels', L.wlabels);
  vis('borders-casing', L.borders && L.bordersBold); vis('admin1-casing', L.admin1 && L.admin1Bold);
  const sat = b === 'satellite';
  const bb = L.bordersBold, ab = L.admin1Bold;
  map.setPaintProperty('borders', 'line-color', bb ? (sat ? '#fff' : PAL.bold) : sat ? '#ffffffaa' : PAL.border);
  map.setPaintProperty('borders', 'line-width', ['interpolate', ['linear'], ['zoom'], 1, bb ? 1.3 : 0.6, 8, bb ? 3 : 1.6]);
  map.setPaintProperty('admin1', 'line-color', ab ? (sat ? '#ffffffdd' : PAL.boldAdmin) : sat ? '#ffffff66' : PAL.admin);
  map.setPaintProperty('admin1', 'line-width', ['interpolate', ['linear'], ['zoom'], 2, ab ? 0.9 : 0.4, 8, ab ? 2.2 : 1.2]);
  for (const id of ['borders-casing', 'admin1-casing']) map.setPaintProperty(id, 'line-color', sat ? '#000' : PAL.casing);
  for (const id of [...RLABELS, 'llabels']) {
    map.setPaintProperty(id, 'text-color', sat ? '#cfe6ff' : PAL.wtext);
    map.setPaintProperty(id, 'text-halo-color', sat ? '#000' : PAL.halo);
  }
  $$('#basemapSeg button').forEach(x => x.classList.toggle('on', x.dataset.v === b));
  $$('#layersPop [data-layer]').forEach(x => { x.checked = !!L[x.dataset.layer]; });
  $$('#layersPop [data-bold]').forEach(x => { x.disabled = !L[x.dataset.bold]; });
  return sat;
}

// the layers button + popover; `extra` = [[layerKey, label html]] for page-specific overlays
export function layersPopover(extra = []) {
  return `<button class="icon-btn layers-btn" id="layersBtn" title="Map layers" aria-label="Map layers">
      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 3 2 8.5l10 5.5 10-5.5L12 3Zm-7.6 9.4L2 13.7 12 19.2l10-5.5-2.4-1.3L12 16.6l-7.6-4.2Z" fill="currentColor"/></svg>
    </button>
    <div class="layers-pop" id="layersPop" hidden>
      <div class="lp-title">Base map</div>
      <div class="seg" id="basemapSeg">
        <button data-v="plain">Plain</button><button data-v="terrain">Terrain</button><button data-v="physical">Physical</button><button data-v="satellite">Satellite</button>
      </div>
      <div class="lp-title">Overlays</div>
      <div class="lp-row"><label><input type="checkbox" data-layer="borders"> Country borders</label>
        <label class="bold" title="Thicker, darker lines"><input type="checkbox" data-layer="bordersBold" data-bold="borders"> Bold</label></div>
      <div class="lp-row"><label title="States, provinces, regions"><input type="checkbox" data-layer="admin1"> Subdivision borders</label>
        <label class="bold" title="Thicker, darker lines"><input type="checkbox" data-layer="admin1Bold" data-bold="admin1"> Bold</label></div>
      <label><input type="checkbox" data-layer="rivers"> Rivers &amp; lakes</label>
      <label><input type="checkbox" data-layer="wlabels"> River &amp; lake names</label>
      <label><input type="checkbox" data-layer="clabels"> Country names</label>
      <label><input type="checkbox" data-layer="slabels"> Subdivision names</label>
      ${extra.map(([k, html]) => `<label><input type="checkbox" data-layer="${k}"> ${html}</label>`).join('')}
    </div>`;
}
// wire the popover; onChange() is called after S was updated
export function bindLayers(map, S, onChange) {
  $('#layersBtn').onclick = () => { $('#layersPop').hidden = !$('#layersPop').hidden; };
  map.on('click', () => { $('#layersPop').hidden = true; });
  $('#basemapSeg').onclick = e => { const v = e.target.closest('button')?.dataset.v; if (v) { S.basemap = v; onChange(); } };
  $$('#layersPop [data-layer]').forEach(x => x.onchange = () => { S.layers[x.dataset.layer] = x.checked; onChange(); });
}
