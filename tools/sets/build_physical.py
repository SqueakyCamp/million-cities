#!/usr/bin/env python3
"""Physical features of the world: oceans, seas, rivers, lakes, mountain ranges, peaks, deserts, islands …

Inputs: data/raw/sets/phys_cand.json + wd.json (physical_fetch.py), Natural Earth geometries in data/raw,
tools/sets/src/rivers.json (river = list of NE segment keys), src/phys_overrides.json (review fixes, extra items),
tools/sets/facts/physical-*.json ({key: [facts]}).
Output: static/data/sets/physical.json, .geojson, .facts.json; data/raw/sets/phys_factsrc.json (intros for fact writers).
"""
import collections, json, math, re, sys
from pathlib import Path
from shapely.geometry import shape, mapping, Point, MultiLineString, LineString
from shapely.ops import unary_union, linemerge
from shapely.strtree import STRtree
from pyproj import Geod

from wiki import RAW, SRC, OUT, wd_entities, titles_to_qids, intros, load, dump
from common import norm, aliases_unique, round_geom

R = RAW / 'sets'
geod = Geod(ellps='WGS84')
HERE = Path(__file__).parent

CATS = [  # key, label, group, measure
    ('ocean', 'Oceans', 'Water', 'area'), ('sea', 'Seas', 'Water', 'area'), ('bay', 'Gulfs & bays', 'Water', 'area'),
    ('strait', 'Straits & channels', 'Water', None), ('river', 'Rivers', 'Water', 'length'), ('lake', 'Lakes', 'Water', 'area'),
    ('waterfall', 'Waterfalls', 'Water', 'height'), ('glacier', 'Glaciers & ice', 'Water', 'area'),
    ('continent', 'Continents', 'Land', 'area'), ('range', 'Mountain ranges', 'Land', 'area'), ('peak', 'Mountains & volcanoes', 'Land', 'elev'),
    ('desert', 'Deserts', 'Land', 'area'), ('plateau', 'Plateaus & highlands', 'Land', 'area'),
    ('lowland', 'Plains, basins & valleys', 'Land', 'area'), ('peninsula', 'Peninsulas & capes', 'Land', 'area'),
    ('island', 'Islands', 'Land', 'area'), ('region', 'Regions & coasts', 'Land', 'area'),
]
CATKEYS = {c[0] for c in CATS}
# minimum Wikidata sitelinks (= how widely known) per candidate category
MIN_SL = dict(ocean=0, sea=0, continent=0, waterfall=0, glacier=0, river=0, bay=30, strait=25, island=45, range=30,
              peninsula=25, cape=30, desert=20, plateau=25, region=30, coast=30, lowland=25, peak=45, lake=35)
MERGE_CAT = {'cape': 'peninsula', 'coast': 'region'}
CONTS = ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania', 'Antarctica']

cands = json.load(open(R / 'phys_cand.json', encoding='utf-8'))
wd = load(R / 'wd.json', {})
ov = load(SRC / 'phys_overrides.json', {})
ov_items, ov_add = ov.get('items', {}), ov.get('add', [])

# extra point items from the review (wiki title -> coordinates from Wikidata)
if ov_add:
    res = titles_to_qids([a['wiki'] for a in ov_add])
    for a in ov_add:
        final, q = res[a['wiki']]
        if q:
            cands.append(dict(key=f'x{q}', cat=a['cat'], cla=a['cat'], ne=a.get('name') or a['wiki'], sr=3, qid=q, src=None, added=True))
        else:
            print('override add: no article', a['wiki'], file=sys.stderr)
    wd_entities([c['qid'] for c in cands if c['qid']], wd)
    dump(wd, R / 'wd.json')

NEF = {}
def ne(name):
    if name not in NEF:
        NEF[name] = json.load(open(RAW / f'ne_10m_{name}.geojson', encoding='utf-8'))['features']
    return NEF[name]

# river segments by key
seg = collections.defaultdict(list)
for f in ne('rivers_lake_centerlines'):
    p = f['properties']
    if p['featurecla'] == 'River' and p['name'] and f['geometry']:
        seg[f"{p['name']}#{p['rivernum']}"].append(shape(f['geometry']))


def river_geom(keys):
    parts = []
    for k in keys:
        for g in seg.get(k, []):
            parts += list(g.geoms) if g.geom_type == 'MultiLineString' else [g]
    if not parts:
        return None
    # drop stray pieces far from the rest (some NE names repeat across continents)
    cx = sorted(p.centroid.x for p in parts)[len(parts) // 2]
    cy = sorted(p.centroid.y for p in parts)[len(parts) // 2]
    parts = [p for p in parts if math.hypot(p.centroid.x - cx, p.centroid.y - cy) < 30]
    m = linemerge(MultiLineString(parts))
    return m


def geometry(c):
    src = c['src']
    e = wd.get(c['qid']) if c['qid'] else None
    if src is None:
        return Point(e['coord']) if e and e.get('coord') else None
    if src[0] == 'rivers':
        return river_geom(src[1])
    f = ne(src[0])[src[1]]
    return shape(f['geometry']) if f['geometry'] else None


def title_name(t):
    return re.sub(r'\s*\(.*\)$', '', t).split(',')[0].strip()


def nice(s):
    return s.title() if s.isupper() else s


# ---------------------------------------------------------------- select + merge duplicates
sel = {}
for c in cands:
    o = ov_items.get(c['key'], {})
    if o.get('drop'):
        continue
    e = wd.get(c['qid']) if c['qid'] else None
    sl = e['sl'] if e else 0
    if not o and not c.get('added') and sl < MIN_SL.get(c['cat'], 999):
        continue
    if c['cat'] == 'pole':
        continue
    cat = o.get('cat') or MERGE_CAT.get(c['cat'], c['cat'])
    if cat not in CATKEYS:
        continue
    g = geometry(c)
    if g is None or g.is_empty:
        print('no geometry', c['key'], c['ne'], file=sys.stderr)
        continue
    wiki = o.get('wiki') or (e and e['en'])
    if not wiki:
        continue
    uid = c['qid'] or c['key']
    if uid in sel:  # same feature drawn twice (e.g. North + South Atlantic): merge
        s = sel[uid]
        s['geoms'].append(g)
        s['sr'] = min(s['sr'], 9 if c['sr'] is None else c['sr'])
        continue
    sel[uid] = dict(key=c['key'], cat=cat, qid=c['qid'], ne=c['ne'], sr=9 if c['sr'] is None else c['sr'], sl=sl, wiki=wiki, o=o, e=e or {},
                    geoms=[g], elev=c.get('elev'), src=c['src'])

# wiki titles changed by overrides may belong to other items: fetch their entities for names/links
retitled = [s['wiki'] for s in sel.values() if s['o'].get('wiki')]
if retitled:
    res = titles_to_qids(retitled)
    for s in sel.values():
        if s['o'].get('wiki'):
            final, q = res[s['wiki']]
            if final:
                s['wiki'] = final

# ---------------------------------------------------------------- continents + countries
countries = []
for f in ne('admin_0_countries'):
    p = f['properties']
    countries.append((shape(f['geometry']).buffer(0), p['ADMIN'], p['CONTINENT'], p['ISO_A2_EH']))
tree = STRtree([c[0] for c in countries])


def continent_of(pt):
    hits = [countries[i] for i in tree.query(pt) if countries[i][0].contains(pt)]
    if hits and hits[0][2] in CONTS:
        return hits[0][2]
    i = tree.nearest(pt)
    c = countries[i]
    if c[2] in CONTS and c[0].distance(pt) < 12:
        return c[2]
    return None


def countries_of(g):
    if g.geom_type == 'Point':
        g = g.buffer(0.05)
    elif 'Line' in g.geom_type:
        g = g.buffer(0.03)
    out = []
    for i in tree.query(g):
        c = countries[i]
        try:
            a = c[0].intersection(g).area
        except Exception:
            continue
        if a > 0:
            out.append((a, c[1], c[3]))
    out.sort(reverse=True)
    tot = sum(a for a, _, _ in out) or 1
    return [(n, cc) for a, n, cc in out if a / tot > 0.004]


def km_length(g):
    return geod.geometry_length(g) / 1000


def km2_area(g):
    return abs(geod.geometry_area_perimeter(g)[0]) / 1e6


items, feats = [], []
for uid, s in sel.items():
    # same feature from several sources (polygon + point): keep the most detailed kind
    dim = max(gg.dim if hasattr(gg, 'dim') else {'Point': 0, 'MultiPoint': 0, 'LineString': 1, 'MultiLineString': 1}.get(gg.geom_type, 2) for gg in s['geoms'])
    gs = [gg for gg in s['geoms'] if ({'Point': 0, 'MultiPoint': 0, 'LineString': 1, 'MultiLineString': 1}.get(gg.geom_type, 2)) == dim]
    g = unary_union(gs) if len(gs) > 1 else gs[0]
    gt = 'pt' if g.geom_type in ('Point', 'MultiPoint') else 'line' if 'Line' in g.geom_type else 'poly'
    if gt == 'pt' and g.geom_type == 'MultiPoint':
        g = g.geoms[0]
    e, o = s['e'], s['o']
    name = o.get('name') or title_name(s['wiki'])
    # anchor for the label: the point, the middle of a river, or a point inside the polygon
    if gt == 'pt':
        ll = (g.x, g.y)
    elif gt == 'line':
        longest = max(g.geoms, key=lambda x: x.length) if g.geom_type == 'MultiLineString' else g
        mp = longest.interpolate(0.5, normalized=True)
        ll = (mp.x, mp.y)
    else:
        big = max(g.geoms, key=lambda x: x.area) if g.geom_type == 'MultiPolygon' else g
        rp = big.representative_point() if not big.centroid.within(big) else big.centroid
        ll = (rp.x, rp.y)
    if s['cat'] in ('ocean', 'continent'):
        reg = 'World'
    else:
        reg = o.get('reg') or continent_of(Point(ll)) or 'World'
    cs = countries_of(g) if s['cat'] not in ('ocean', 'continent') else []
    m = {}
    cat = s['cat']
    if cat == 'river':
        m['length'] = round(e.get('length') or km_length(g))
    elif cat == 'peak':
        el = e.get('elev') or s['elev']
        if el:
            m['elev'] = round(el)
    elif cat == 'waterfall':
        if e.get('height'):
            m['height'] = round(e['height'])
    elif gt == 'poly' or e.get('area'):
        a = e.get('area') or (km2_area(g) if gt == 'poly' else None)
        if a:
            m['area'] = round(a)
    if e.get('length') and cat in ('range', 'glacier', 'strait', 'bay', 'region') and 'length' not in m:
        m['length'] = round(e['length'])
    al = [nice(s['ne']), e.get('label_en'), *(e.get('alias_en') or []), title_name(e['de']) if e.get('de') else None,
          e.get('label_de'), *(e.get('alias_de') or [])[:3], *(o.get('alias') or [])]
    if cat == 'river':
        rv = next((r for r in load(SRC / 'rivers.json', []) if r['wiki'] == s['wiki'] or r['name'] == s['ne']), None)
        if rv:
            al += rv.get('aliases', []) + [rv['name'], rv['name'] + ' River']
    al = [a for a in al if a and len(a) >= 3 and not re.search(r'\d{3}', a)]
    # also accept the name without its generic part ("Everest", "Titicaca", "Gobi", "Rhine River" -> "Rhine")
    short = []
    for a in [name] + al:
        b = re.sub(r'^(Mount|Mt\.?|Lake|Loch|Monte|Mont|Pico|Cerro)\s+', '', a)
        b = re.sub(r'\s+(Mountains|Range|Desert|River|Glacier|Falls|Waterfall|Island|Islands|Peninsula|Plateau|Basin|Lake|Volcano|Massif|Ice Sheet|ice sheet)$', '', b)
        if b != a and len(b) >= 3:
            short.append(b)
    bb = g.bounds
    if bb[2] - bb[0] > 300:  # crosses the antimeridian (Pacific, Bering Sea…): no bbox fitting
        bb = None
    it = dict(id=s['key'], name=name, alias=al + short, cat=cat, reg=reg, g=gt, ll=[round(ll[0], 3), round(ll[1], 3)],
              bb=[round(v, 2) for v in bb] if bb else None, m=m, sl=s['sl'], wiki=s['wiki'], qid=s['qid'],
              cs=[n for n, _ in cs[:12]], ncs=len(cs))
    items.append(it)
    tol = 0.002 if gt == 'pt' else max(0.004, min(0.05, math.sqrt(max(g.area, 1e-6)) / 60)) if gt == 'poly' else 0.01
    sg = g if gt == 'pt' else g.simplify(tol, preserve_topology=True)
    feats.append({'type': 'Feature', 'properties': {'id': s['key']}, 'geometry': round_geom(mapping(sg), 3)})

# importance rank (1 = most widely known) from Wikipedia language editions
for i, it in enumerate(sorted(items, key=lambda x: -x['sl']), 1):
    it['imp'] = i
aliases_unique(items)

MEAS = {
    'area': {'label': 'Area', 'fmt': 'km2', 'q': 'Which is larger?'},
    'length': {'label': 'Length', 'fmt': 'km', 'q': 'Which is longer?'},
    'elev': {'label': 'Height', 'fmt': 'm', 'q': 'Which is higher?'},
    'height': {'label': 'Drop', 'fmt': 'm', 'q': 'Which falls further?'},
}
for it in items:
    stats = []
    for k, v in it['m'].items():
        stats.append([v, MEAS[k]['fmt'], {'area': 'km²', 'length': 'km long', 'elev': 'm above sea level', 'height': 'm drop'}[k]])
    if it['ncs']:
        stats.append([it['ncs'], 'int', 'country' if it['ncs'] == 1 else 'countries'])
    it['stats'] = stats
    it.pop('sl')

facts = {}
for p in sorted((HERE / 'facts').glob('physical-*.json')):
    facts.update(json.load(open(p, encoding='utf-8')))
meta = dict(
    key='physical', title='Physical features', short='Physical', kind='features', sub=f'{len(items)} oceans, rivers, mountains, deserts …',
    noun=['feature', 'features'], catLabel='Type', regLabel='Continent',
    cats=[{'k': k, 'label': l, 'grp': g, 'm': m} for k, l, g, m in CATS if any(i['cat'] == k for i in items)],
    regs=[{'k': c, 'label': c} for c in CONTS] + [{'k': 'World', 'label': 'Oceans & continents'}],
    measures=MEAS,
    about="""<p>Features and outlines come from <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a> 1:10m
    (public domain): marine areas, physical regions, elevation points, lakes and rivers. Outlines of regions such as deserts or mountain ranges are
    hand-drawn generalisations, so treat their edges as approximate. Waterfalls and glaciers are placed from Wikidata. Which features are included is decided
    by how widely known they are (number of Wikipedia language editions). Lengths, areas and heights are from Wikidata where available, otherwise
    measured on the map outline. The short facts were written with Claude from each feature's English Wikipedia article intro (CC BY-SA 4.0).</p>""",
    items=items)
dump(meta, OUT / 'physical.json')
dump({'type': 'FeatureCollection', 'features': feats}, OUT / 'physical.geojson')
dump({it['id']: facts[it['id']] for it in items if it['id'] in facts}, OUT / 'physical.facts.json')

cache = load(R / 'intros.json', {})
intros([it['wiki'] for it in items], cache)
dump(cache, R / 'intros.json')
src = [dict(id=it['id'], name=it['name'], type=it['cat'], continent=it['reg'], countries=it['cs'][:6], numbers=it['m'],
            wiki=it['wiki'], intro=cache.get(it['wiki'], '')[:2500]) for it in sorted(items, key=lambda x: x['imp'])]
dump(src, R / 'phys_factsrc.json', pretty=True)
cnt = collections.Counter(it['cat'] for it in items)
print(len(items), 'features', dict(cnt), '·', sum(1 for it in items if it['id'] in facts), 'with facts')
