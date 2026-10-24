#!/usr/bin/env python3
"""Build the app's data files from the raw sources in data/raw.

Sources (see README.md):
  - UN DESA World Urbanization Prospects 2025, city file
    WUP2025-DB-DEGURBA-Cities-Population-Surface-Data.csv.gz  -> list, populations, centroids
  - UN WUP2025-F00-LOCATIONS.xlsx                              -> continents / subregions
  - GHSL Urban Centre Database R2024A (uc.pkl, made by load_uc.py) -> outlines + place lists
  - GeoNames cities15000 + alternateNamesV2 (gn.pkl)             -> alternate names, places inside
  - Natural Earth 10m                                            -> borders, rivers, lakes

Output goes to static/data/.
"""
import csv, gzip, json, math, pickle, re, sys
from collections import defaultdict
from pathlib import Path

import shapely
import shapely.ops
from shapely import STRtree, Point, MultiPoint
from shapely.geometry import mapping, shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (RAW, OUT, EXTENDED, norm, split_wup_name, load_locations, country_name, continent,  # noqa: E402
                    geonames, gn_names, finish, write_db)
from overrides import OVERRIDES, EXTRA_ALIASES, COUNTRY_OVERRIDES, ANSWER_UNION  # noqa: E402

EXT_K = EXTENDED / 1000  # WUP populations are in thousands
YEARS = [1975, 1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025, 2030, 2035, 2040, 2045, 2050]


# ---------------------------------------------------------------- WUP
print('reading WUP cities …')
rows = defaultdict(dict)
meta = {}
with gzip.open(RAW / 'cities.csv.gz', 'rt', encoding='utf-8-sig') as f:
    for r in csv.DictReader(f):
        y = int(r['Year'])
        code = int(r['City_Code'])
        if y in YEARS:
            rows[code][y] = r
all2025 = {c: ys[2025] for c, ys in rows.items() if 2025 in ys}
print(len(all2025), 'cities in 2025')

loc, _ = load_locations()


# ---------------------------------------------------------------- UCDB polygons
print('reading GHSL urban centres …')
uc = pickle.load(open(RAW / 'uc.pkl', 'rb'))
tree = STRtree([u['geom'] for u in uc])

uc_of = {}
members = defaultdict(list)
for code, r in all2025.items():
    p = Point(float(r['PWCent_Longitude']), float(r['PWCent_Latitude']))
    idx = tree.query(p, predicate='intersects')
    i = int(idx[0]) if len(idx) else int(tree.nearest(p))
    uc_of[code] = i
    members[i].append(code)

big = sorted([c for c, r in all2025.items() if float(r['Pop']) >= EXT_K], key=lambda c: -float(all2025[c]['Pop']))
print(len(big), 'cities >= 800k,', sum(float(all2025[c]['Pop']) >= 1000 for c in big), '>= 1M')


def local_xy(lat0):
    k = math.cos(math.radians(lat0))
    return (lambda x, y, z=None: (x * k, y)), (lambda x, y, z=None: (x / k, y))


_split_cache = {}


def split_uc(i):
    """Divide a GHSL urban centre between the WUP cities inside it.

    The centre is sampled on a ~1 km grid and each sample goes to the city with the smallest
    power distance |p - c|^2 - w; the weights w are tuned until every city's share matches
    its WUP area. Returns {code: geometry}."""
    import numpy as np
    from shapely import box, contains_xy, union_all
    g = uc[i]['geom']
    ms = members[i]
    lat0 = g.centroid.y
    k = math.cos(math.radians(lat0))
    step = 0.009  # degrees latitude ~ 1 km
    sx = step / k
    x0, y0, x1, y1 = g.bounds
    xs = np.arange(x0 + sx / 2, x1, sx)
    ys = np.arange(y0 + step / 2, y1, step)
    X, Y = np.meshgrid(xs, ys)
    X, Y = X.ravel(), Y.ravel()
    inside = contains_xy(g, X, Y)
    X, Y = X[inside], Y[inside]
    if len(X) < len(ms):
        return {m: g for m in ms}
    cx = np.array([float(all2025[m]['PWCent_Longitude']) for m in ms])
    cy = np.array([float(all2025[m]['PWCent_Latitude']) for m in ms])
    area = np.array([max(float(all2025[m]['AREA_km2']), 1.0) for m in ms])
    target = area / area.sum() * len(X)
    D = ((X[:, None] - cx[None, :]) * k) ** 2 + (Y[:, None] - cy[None, :]) ** 2  # deg^2
    w = np.zeros(len(ms))
    scale = D.mean()
    for it in range(400):
        lab = np.argmin(D - w[None, :], axis=1)
        cnt = np.bincount(lab, minlength=len(ms))
        err = (target - cnt) / len(X)
        if np.abs(err).max() < 0.004:
            break
        w += err * scale * 0.8
    out = {}
    for j, m in enumerate(ms):
        sel = lab == j
        if not sel.any():
            out[m] = Point(cx[j], cy[j]).buffer(0.01)
            continue
        boxes = [box(x - sx / 2, y - step / 2, x + sx / 2, y + step / 2) for x, y in zip(X[sel], Y[sel])]
        out[m] = union_all(boxes).intersection(g).buffer(0)
    return out


def outline(code):
    """GHSL polygon of the city's urban centre, or its share when WUP splits the centre."""
    i = uc_of[code]
    if len(members[i]) == 1:
        return uc[i]['geom'], False
    if i not in _split_cache:
        _split_cache[i] = split_uc(i)
    return _split_cache[i][code], True


# ---------------------------------------------------------------- GeoNames
print('reading GeoNames …')
gn, gn_list, gn_tree = geonames()

cities = []
features = []
for code in big:
    r = all2025[code]
    ys = rows[code]
    iso2 = r['ISO2_Code']
    cc = 'TW' if r['ISO3_Code'] == 'TWN' else iso2
    raw_name = r['City_Name']
    name, local = split_wup_name(raw_name)
    ov = COUNTRY_OVERRIDES.get((raw_name, cc)) or OVERRIDES.get(raw_name, {})
    aliases = {name, raw_name}
    if local:
        aliases.add(local)
    for part in re.split(r'\s+-\s+|\s*\[|\]|,\s*', raw_name):
        if part.strip() and len(norm(part)) >= 3:
            aliases.add(part.strip())
    for suf in (' City', ' District'):
        if name.endswith(suf) and name != 'New York City':
            aliases.add(name[: -len(suf)])

    geom, split = outline(code)
    geom_s = geom.simplify(0.004, preserve_topology=True)
    if geom_s.is_empty:
        geom_s = geom

    # GeoNames places inside the outline (within 2 km buffer for points on the edge)
    lat = float(r['PWCent_Latitude'])
    lon = float(r['PWCent_Longitude'])
    area_poly = geom.buffer(0.02)
    inside = [gn_list[int(j)] for j in gn_tree.query(area_poly, predicate='intersects')]
    inside = [g for g in inside if g['cc'] == cc or not cc]
    inside.sort(key=lambda g: -g['pop'])

    # the GeoNames place that *is* this city: a name match inside, else the biggest inside
    keys = {norm(a) for a in aliases}
    match = None
    for g in inside:
        nm, _ = gn_names(g, cc)
        if keys & {norm(x) for x in nm}:
            match = g
            break
    if match is None and 'gn' in ov:
        match = gn.get(ov['gn'])
    if match is None and inside and not split:
        match = inside[0]
    hist = set()
    if match is not None:
        nm, hist = gn_names(match, cc)
        aliases |= nm

    # the GHSL name of the whole urban centre is a fine alias when the centre isn't split
    ucname = uc[uc_of[code]]['name']
    if not split and ucname:
        aliases.add(ucname)

    if 'name' in ov:
        aliases.add(ov['name'])
        name = ov['name']
    if 'local' in ov:
        local = ov['local']
    aliases |= set(ov.get('aliases', []))
    aliases |= set(EXTRA_ALIASES.get(name, []))
    hist |= set(ov.get('historic', []))
    drop = {norm(x) for x in ov.get('drop', [])}
    aliases = {a for a in aliases if norm(a) not in drop}
    hist = {h for h in hist if norm(h) not in drop}

    contains = []
    seen = {norm(a) for a in aliases}
    for g in inside:
        if match is not None and g['id'] == match['id']:
            continue
        if g['pop'] < 50000 or not geom.buffer(0.005).contains(Point(g['lon'], g['lat'])):
            continue
        if norm(g['name']) in seen:
            continue
        seen.add(norm(g['name']))
        nm, _ = gn_names(g, cc)
        contains.append(dict(n=g['name'], p=g['pop'], a=sorted({x for x in nm if norm(x) != norm(g['name'])})[:4]))
        if len(contains) >= 25:
            break

    L = loc.get(int(r['LocID']), {})
    cname = country_name(cc, r['Location'])
    ts = {y: round(float(ys[y]['Pop']) * 1000) for y in YEARS if y in ys}
    c = dict(
        id=code, name=name, local=local if local and local != name else None,
        wup=raw_name, country=cname, iso2=cc, cont=continent(L), sub=L.get('SubRegName'),
        lat=round(lat, 4), lon=round(lon, 4),
        pop=round(float(r['Pop']) * 1000), area=round(float(r['AREA_km2'])),
        cap=r['Capital'] == '1', plaus=r['Pop_plausibility'], ts=ts,
        uc=ucname, split=split, contains=contains,
        aliases=sorted(a for a in aliases if a and norm(a)), historic=sorted(h for h in hist if norm(h) not in {norm(a) for a in aliases}),
        note=ov.get('note'),
    )
    cities.append(c)
    gj = mapping(geom_s)

    def rnd(o):
        if isinstance(o, (list, tuple)):
            return [rnd(x) for x in o]
        return round(o, 4)
    gj['coordinates'] = rnd(gj['coordinates'])
    features.append(dict(type='Feature', id=code, properties=dict(id=code), geometry=gj))

answers = finish(cities, ANSWER_UNION)
parts = defaultdict(set)
for c in cities:
    for p in c['contains']:
        for n in [p['n']] + p['a']:
            k = norm(n)
            if k and k not in answers:
                parts[k].add(c['id'])

# cities just below the threshold, so the quiz can say "close, but not on the list"
near = {}
for code, r in all2025.items():
    p = float(r['Pop'])
    if 300 <= p < EXT_K:
        nm, lc = split_wup_name(r['City_Name'])
        for a in {nm, lc, r['City_Name']} - {None}:
            k = norm(a)
            if k and k not in answers and (k not in near or near[k][2] < p):
                near[k] = [nm, r['ISO2_Code'], round(p * 1000)]

write_db('wup2025', dict(
    name='UN WUP 2025', short='Agglomerations (UN 2025)', year=2025, outlines=True,
    desc='Cities measured the same way everywhere (Degree of Urbanisation): contiguous built-up areas with at least 1,500 people per km².',
    source='UN DESA, World Urbanization Prospects 2025 (cities, Degree of Urbanisation); outlines: GHSL UCDB R2024A; names: GeoNames'),
    cities, answers, near, {k: sorted(v) for k, v in parts.items()})
json.dump(dict(type='FeatureCollection', features=features), open(OUT / 'outlines.geojson', 'w'), separators=(',', ':'))
print('outlines', (OUT / 'outlines.geojson').stat().st_size // 1024, 'KB')
