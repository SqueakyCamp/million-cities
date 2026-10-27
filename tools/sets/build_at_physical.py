#!/usr/bin/env python3
"""Austria · physical features (Gewässer, Berge & Landschaften), from the raw data of at_physical_fetch.py.

Geometry: rivers, lakes and glaciers from OpenStreetMap (data/raw/atphys/osm/<qid>.json), mountain groups from the GMBA
Mountain Inventory v2 (data/raw/atphys/gmba/), everything else a point (Wikidata / German Wikipedia coordinates).
Rivers are cut to Austria (plus a small margin); lakes and ranges keep their full shape.
Facts (German): tools/sets/facts/at-physical.json, written from data/raw/atphys/factsrc.json.
Output: static/data/sets/at-physical.json, .geojson, .facts.json
"""
import json, re
from pathlib import Path
import shapefile
from shapely.geometry import shape, mapping, LineString, MultiLineString, Polygon, MultiPolygon, Point
from shapely.ops import unary_union, linemerge, polygonize, polylabel, nearest_points
from pyproj import Geod

from wiki import RAW, OUT, load, dump
from common import aliases_unique, round_geom
from at_physical_fetch import read_list, A

geod = Geod(ellps='WGS84')
LAND = {'1': 'Burgenland', '2': 'Kärnten', '3': 'Niederösterreich', '4': 'Oberösterreich', '5': 'Salzburg',
        '6': 'Steiermark', '7': 'Tirol', '8': 'Vorarlberg', '9': 'Wien'}
# points that neither Wikidata nor the German article place (lon, lat)
MANUAL_LL = {'Klagenfurter Becken': [14.35, 46.68], 'Ötschergräben': [15.24, 47.86], 'Großglockner-Hochalpenstraße': [12.8433, 47.0822],
             'Lungau': [13.75, 47.13]}
CATS = [  # key, label, singular, practice question, measure, group
    ('river', 'Flüsse', 'Fluss', 'Welcher Fluss ist das?', 'length', 'Gewässer'),
    ('lake', 'Seen', 'See', 'Welcher See ist das?', 'area', 'Gewässer'),
    ('glacier', 'Gletscher', 'Gletscher', 'Welcher Gletscher ist das?', 'area', 'Gewässer'),
    ('waterfall', 'Wasserfälle', 'Wasserfall', 'Welcher Wasserfall ist das?', 'height', 'Gewässer'),
    ('range', 'Gebirgsgruppen', 'Gebirgsgruppe', 'Welche Gebirgsgruppe ist das?', 'area', 'Berge & Land'),
    ('peak', 'Berge', 'Berg', 'Welcher Berg ist das?', 'elev', 'Berge & Land'),
    ('pass', 'Pässe', 'Pass', 'Welcher Pass ist das?', 'elev', 'Berge & Land'),
    ('valley', 'Täler & Becken', 'Tal oder Becken', 'Welches Tal oder Becken ist das?', None, 'Berge & Land'),
    ('gorge', 'Klammen & Höhlen', 'Klamm oder Höhle', 'Welche Klamm oder Höhle ist das?', None, 'Berge & Land'),
    ('region', 'Landschaften', 'Landschaft', 'Welche Landschaft ist das?', None, 'Berge & Land'),
]
CAT_M = {c[0]: c[4] for c in CATS}

# Austria and the Bundesländer (from the Bezirk polygons)
lands = {}
for f in json.load(open(RAW / 'at' / 'bez.geojson'))['features']:
    g = shape(f['geometry'])
    lands.setdefault(LAND[f['properties']['g_id'][0]], []).append(g if g.is_valid else g.buffer(0))
lands = {k: unary_union(v).simplify(0.002) for k, v in lands.items()}
austria = unary_union(list(lands.values()))
margin = austria.buffer(0.03)


def land_of(p):
    for k, g in lands.items():
        if g.contains(p):
            return k
    k = min(lands, key=lambda k: lands[k].distance(p))
    return k if lands[k].distance(p) < 0.15 else None


def lands_touched(geom):
    """Bundesländer a shape lies in, most first."""
    if geom.geom_type in ('Point',):
        k = land_of(geom)
        return [k] if k else []
    out = []
    for k, g in lands.items():
        x = geom.intersection(g)
        if x.is_empty:
            continue
        size = x.length if 'Line' in geom.geom_type else x.area
        whole = geom.length if 'Line' in geom.geom_type else geom.area
        if size > 0.1 * whole or size > (0.05 if 'Line' in geom.geom_type else 0.05):
            out.append((size, k))
    return [k for _, k in sorted(out, reverse=True)]


def ways_of(el, roles=None):
    if el['type'] == 'way':
        return [LineString([(p['lon'], p['lat']) for p in el['geometry']])] if el.get('geometry') else []
    out = []
    for m in el.get('members', []):
        if m['type'] == 'way' and m.get('geometry') and (roles is None or m.get('role', '') in roles):
            out.append(LineString([(p['lon'], p['lat']) for p in m['geometry']]))
    return out


def osm_geom(qid, cat):
    els = load(A / 'osm' / f'{qid}.json', [])
    if cat == 'river':
        rel = [e for e in els if e['type'] == 'relation']
        lines = [l for e in (rel or els) for l in ways_of(e, None if not rel else {'', 'main_stream', 'main'})]
        if not lines:
            return None
        g = linemerge(unary_union(lines)).intersection(margin)
        return g if not g.is_empty else None
    polys = []
    for e in els:
        t = e.get('tags', {})
        if cat == 'lake' and t.get('natural') != 'water' and t.get('water') is None and t.get('type') != 'multipolygon':
            continue
        if cat == 'glacier' and t.get('natural') != 'glacier':
            continue
        if e['type'] == 'way':
            c = [(p['lon'], p['lat']) for p in e.get('geometry', [])]
            if len(c) >= 4 and c[0] == c[-1]:
                polys.append(Polygon(c))
        else:
            outer = list(polygonize(unary_union(ways_of(e, {'outer', ''}))))
            inner = list(polygonize(unary_union(ways_of(e, {'inner'})))) if any(m.get('role') == 'inner' for m in e.get('members', [])) else []
            g = unary_union(outer)
            if inner:
                g = g.difference(unary_union(inner))
            if not g.is_empty:
                polys.append(g)
    if not polys:
        return None
    g = unary_union([p if p.is_valid else p.buffer(0) for p in polys])
    return g if not g.is_empty else None


def gmba_shapes():
    r = shapefile.Reader(str(A / 'gmba' / 'GMBA_Inventory_v2.0_standard_basic.shp'))
    by_q, by_id = {}, {}
    for sr in r.iterShapeRecords():
        b = sr.shape.bbox
        if not (b[2] > 9 and b[0] < 17.5 and b[3] > 46 and b[1] < 49.3):
            continue
        d = sr.record.as_dict()
        g = shape(sr.shape.__geo_interface__)
        g = g if g.is_valid else g.buffer(0)
        by_id[d['GMBA_V2_ID']] = (g, d)
        q = d['WikiDataUR'].rsplit('/', 1)[-1]
        if q:
            by_q[q] = (g, d)
    return by_q, by_id


def area_km2(g):
    return abs(geod.geometry_area_perimeter(g)[0]) / 1e6


def length_km(g):
    return geod.geometry_length(g) / 1000


def label_point(g):
    if g.geom_type == 'Point':
        return g
    if 'Line' in g.geom_type:
        part = g.intersection(austria) if not g.intersection(austria).is_empty else g
        lines = list(part.geoms) if hasattr(part, 'geoms') else [part]
        lines = [l for l in lines if l.geom_type == 'LineString']
        if not lines:
            return g.representative_point()
        longest = max(lines, key=lambda l: l.length)
        return longest.interpolate(0.5, normalized=True)
    part = g.intersection(austria)
    part = part if not part.is_empty and part.area > 0.02 * g.area else g
    polys = list(part.geoms) if hasattr(part, 'geoms') else [part]
    big = max([p for p in polys if p.geom_type == 'Polygon'], key=lambda p: p.area)
    return polylabel(big, tolerance=0.002)


items_src = read_list()
tq = load(A / 'titles.json', {})
wd = load(A / 'wd.json', {})
co = load(A / 'coords_de.json', {})
intro = load(A / 'intros_de.json', {})
g_by_q, g_by_id = gmba_shapes()

items, feats, problems = [], [], []
for src in items_src:
    cat = src['cat']
    title = src['title']
    final, qid = tq.get(title, [None, None]) if title else (None, None)
    e = (wd.get(qid) or {}) if qid else {}
    name = src['name'] or (re.sub(r'\s*\(.*\)$', '', title) if title else None)
    geom = None
    if cat in ('river', 'lake', 'glacier') and qid:
        geom = osm_geom(qid, cat)
    if cat == 'range':
        hit = g_by_id.get(src['gmba']) if src['gmba'] else g_by_q.get(qid)
        if hit:
            geom = hit[0]
    if geom is None:
        ll = e.get('coord') or co.get(final or '') or MANUAL_LL.get(name) or MANUAL_LL.get(final)
        if not ll:
            problems.append(f'no geometry or coordinates: {cat} {name}')
            continue
        geom = Point(ll)
        if cat in ('river', 'lake', 'glacier', 'range'):
            problems.append(f'point only: {cat} {name}')
    iid = qid or f'gmba{src["gmba"]}'
    lp = label_point(geom)
    cs = lands_touched(geom)
    reg = land_of(lp) or (cs[0] if cs else None)
    if not reg:
        problems.append(f'outside Austria: {cat} {name}')
        continue
    m = {}
    if cat == 'river':
        L = e.get('length') or length_km(geom)
        m['length'] = round(L)
    elif cat in ('lake', 'glacier', 'range') and geom.geom_type != 'Point':
        m['area'] = round(e.get('area') if cat == 'lake' and e.get('area') else area_km2(geom), 2)
    elif cat in ('peak', 'pass') and (e.get('elev')):
        m['elev'] = round(e['elev'])
    elif cat == 'waterfall' and e.get('height'):
        m['height'] = round(e['height'])
    stats = []
    if 'length' in m: stats.append([m['length'], 'km', 'km Gesamtlänge'])
    if 'area' in m: stats.append([m['area'], 'km2', 'km² Fläche'])
    if 'elev' in m: stats.append([m['elev'], 'm', 'm ü. A.' if cat == 'pass' else 'm hoch'])
    if 'height' in m: stats.append([m['height'], 'm', 'm Fallhöhe'])
    if cat == 'lake' and e.get('elev'): stats.append([round(e['elev']), 'm', 'm ü. A.'])
    if cat == 'range' and src['gmba'] is None and g_by_q.get(qid):
        stats.append([round(g_by_q[qid][1]['Elev_High']), 'm', 'm höchster Punkt'])
    elif cat == 'range' and src['gmba'] and g_by_id.get(src['gmba']):
        stats.append([round(g_by_id[src['gmba']][1]['Elev_High']), 'm', 'm höchster Punkt'])
    alias = list(src['alias'])
    if e.get('label_de'): alias.append(e['label_de'])
    if e.get('label_en'): alias.append(e['label_en'])
    alias += (e.get('alias_de') or [])[:3]
    if title: alias.append(re.sub(r'\s*\(.*\)$', '', title))
    gt = 'pt' if geom.geom_type == 'Point' else 'line' if 'Line' in geom.geom_type else 'poly'
    simp = geom if gt == 'pt' else geom.simplify(0.0015 if gt == 'line' else 0.002, preserve_topology=True)
    items.append(dict(id=iid, name=name, alias=alias, cat=cat, reg=reg, cs=cs or [reg], g=gt,
                      ll=[round(lp.x, 4), round(lp.y, 4)], bb=[round(v, 3) for v in geom.bounds], m=m, stats=stats,
                      wiki=final, qid=qid, sl=e.get('sl', 0)))
    feats.append({'type': 'Feature', 'properties': {'id': iid}, 'geometry': round_geom(mapping(simp), 4)})
    if gt == 'pt':
        items[-1].pop('bb')

# how well known: Wikipedia language editions, the big ones of each type first
order = {c[0]: i for i, c in enumerate(CATS)}
for i, it in enumerate(sorted(items, key=lambda it: (-it['sl'], order[it['cat']])), 1):
    it['imp'] = i
for it in items:
    it.pop('sl')
aliases_unique(items)
items.sort(key=lambda it: it['imp'])

facts = load(Path(__file__).parent / 'facts' / 'at-physical.json', {})
meta = dict(
    key='at-physical', title='Österreich · Gewässer, Berge & Landschaften', short='Physisch', kind='features', lang='de', wikiLang='de',
    sub=f'{len(items)} Flüsse, Seen, Gletscher, Gebirge, Gipfel, Pässe, Täler …', noun=['Objekt', 'Objekte'],
    catLabel='Typ', regLabel='Bundesland', csLabel=['Bundesland', 'Bundesländer'], allWhere='Ganz Österreich',
    cats=[{'k': k, 'label': l, 'one': o, 'q': q, 'm': mm, 'grp': g} for k, l, o, q, mm, g in CATS],
    regs=[{'k': v, 'label': v} for v in LAND.values()],
    measures={'area': {'label': 'Fläche', 'fmt': 'km2', 'q': 'Was ist größer?'}, 'length': {'label': 'Länge', 'fmt': 'km', 'q': 'Was ist länger?'},
              'elev': {'label': 'Höhe', 'fmt': 'm', 'q': 'Was liegt höher?'}, 'height': {'label': 'Fallhöhe', 'fmt': 'm', 'q': 'Wo fällt das Wasser tiefer?'}},
    bbox=[9.53, 46.37, 17.16, 49.02], z0=4.9, attribution='OpenStreetMap, GMBA, Wikidata',
    about="""<p>Die wichtigsten Gewässer, Berge und Landschaften Österreichs: Flüsse, Seen, Gletscher, Wasserfälle, Gebirgsgruppen,
    Gipfel, Pässe, Täler und Becken, Klammen und Höhlen. Auswahl nach Bekanntheit; „Bekannteste zuerst“ richtet sich nach der Zahl
    der Wikipedia-Sprachversionen.</p>
    <p>Flüsse, Seen und Gletscher: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende (ODbL);
    Flüsse sind auf den österreichischen Abschnitt (plus Grenzstrecken) gekürzt, die Länge gilt für den ganzen Fluss.
    Gebirgsgruppen: <a href="https://www.earthenv.org/mountains" target="_blank" rel="noopener">GMBA Mountain Inventory v2</a> (Snethlage et al. 2022, CC BY 4.0),
    deren Einteilung etwas von der Alpenvereinseinteilung abweicht. Gipfel, Pässe, Täler und Landschaften sind Punkte aus
    <a href="https://www.wikidata.org/" target="_blank" rel="noopener">Wikidata</a> (CC0), ebenso Höhen, Längen und Flächen.
    Die kurzen Texte wurden mit Claude aus den Einleitungen der deutschen Wikipedia-Artikel geschrieben (CC BY-SA 4.0).</p>""",
    items=items)
dump(meta, OUT / 'at-physical.json')
dump({'type': 'FeatureCollection', 'features': feats}, OUT / 'at-physical.geojson')
dump({it['id']: facts[it['id']] for it in items if it['id'] in facts}, OUT / 'at-physical.facts.json')
src = [dict(id=it['id'], name=it['name'], cat=it['cat'], reg=it['reg'], m=it['m'], wiki=it['wiki'], de=intro.get(it['wiki'] or '', '')[:900])
       for it in items]
dump(src, A / 'factsrc.json', pretty=True)
for p in problems:
    print(p)
missing = [it['name'] for it in items if it['id'] not in facts]
print(len(items), 'features;', len(items) - len(missing), 'with facts', '; missing:', len(missing))
