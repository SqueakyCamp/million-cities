#!/usr/bin/env python3
"""Languages of the world as map areas, built from Natural Earth country and admin-1 polygons.

Inputs: tools/sets/src/languages_*.json (see src/LANG_SPEC.md: areas as country/admin-1 codes, speakers, phrases, facts).
Output: static/data/sets/languages.json, .geojson (features {id, t: 'core'|'also'}), .facts.json
"""
import collections, json, re, sys
from shapely.geometry import shape, mapping, Point
from shapely.ops import unary_union
from shapely.strtree import STRtree

from wiki import RAW, SRC, OUT, dump
from common import aliases_unique, round_geom

langs = []
for p in sorted(SRC.glob('languages_*.json')):
    langs += json.load(open(p, encoding='utf-8'))

adm0, names0, cont0 = {}, {}, {}
for f in json.load(open(RAW / 'ne_10m_admin_0_countries.geojson', encoding='utf-8'))['features']:
    p = f['properties']
    adm0[p['ADM0_A3']] = shape(f['geometry']).buffer(0)
    names0[p['ADM0_A3']] = p['ADMIN']
    cont0[p['ADM0_A3']] = p['CONTINENT']
adm1 = {}
for f in json.load(open(RAW / 'ne_10m_admin_1_states_provinces.geojson', encoding='utf-8'))['features']:
    adm1[f['properties']['adm1_code']] = shape(f['geometry']).buffer(0)
keys0 = list(adm0)
tree = STRtree([adm0[k] for k in keys0])


def geom(code):
    return adm0.get(code) or adm1.get(code)


def area_of(codes):
    plus = [geom(c) for c in codes if not c.startswith('-') and geom(c) is not None]
    minus = [geom(c[1:]) for c in codes if c.startswith('-') and geom(c[1:]) is not None]
    bad = [c for c in codes if geom(c.lstrip('-')) is None]
    if bad:
        print('unknown codes', bad, file=sys.stderr)
    if not plus:
        return None
    g = unary_union(plus)
    if minus:
        g = g.difference(unary_union(minus).buffer(0.01))
    return g.buffer(0.005).buffer(-0.005)  # closes slivers between neighbouring units


def continent(pt):
    for i in tree.query(pt):
        if adm0[keys0[i]].contains(pt):
            return cont0[keys0[i]]
    return cont0[keys0[tree.nearest(pt)]]


def simplify(g):
    return round_geom(mapping(g.simplify(0.02, preserve_topology=True)), 2)


CONTS = ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania']
items, feats, facts = [], [], {}
for L in langs:
    core = area_of(L.get('core', []))
    also = area_of(L.get('also', []))
    if also is not None and core is not None:
        also = also.difference(core)
    main = core if core is not None and not core.is_empty else also
    if main is None or main.is_empty:
        print('no area:', L['name'], file=sys.stderr)
        continue
    # label in the language's "home" area: the first listed core unit (e.g. France for French, not Quebec)
    first = next((c for c in (L.get('core') or L.get('also') or []) if not c.startswith('-') and geom(c) is not None), None)
    home = main.intersection(geom(first)) if first else main
    if home.is_empty or home.area < 1e-4:
        home = main
    big = max(home.geoms, key=lambda x: x.area) if home.geom_type in ('MultiPolygon', 'GeometryCollection') else home
    if big.geom_type not in ('Polygon',):
        big = max(main.geoms, key=lambda x: x.area) if main.geom_type == 'MultiPolygon' else main
    pt = big.centroid if big.centroid.within(big) else big.representative_point()
    reg = continent(pt)
    if reg == 'Seven seas (open ocean)':
        reg = 'Oceania'
    endo = L.get('endonym', '')
    al = list(L.get('aliases', []))
    m = re.search(r'\(([^)]+)\)', endo)
    al += [m.group(1)] if m else [endo]
    al += [L['name'] + ' language']
    bb = (core if core is not None and not core.is_empty else main).bounds
    off = [names0[c] for c in L.get('official', []) if c in names0]
    stats = [[L['l1'] * 1e6, 'pop', 'native speakers'], [L.get('total') or L['l1'], 'popM', 'speakers in total']]
    if off:
        stats.append([len(off), 'int', 'official in ' + ('country' if len(off) == 1 else 'countries')])
    it = dict(id=L['id'], name=L['name'], alias=al, cat=L.get('family') or 'Other', cat2=L.get('branch') or '',
              reg=reg, g='poly', ll=[round(pt.x, 2), round(pt.y, 2)], bb=[round(v, 2) for v in bb] if bb[2] - bb[0] < 300 else None,
              m={'l1': round(L['l1'] * 1e6), 'total': round((L.get('total') or L['l1']) * 1e6)},
              stats=stats, wiki=L.get('wiki'), endonym=endo, scripts=L.get('scripts', []), official=off,
              tts=L.get('tts'), phrases=L.get('phrases'))
    items.append(it)
    for tier, g in (('core', core), ('also', also)):
        if g is not None and not g.is_empty:
            feats.append({'type': 'Feature', 'properties': {'id': L['id'], 't': tier}, 'geometry': simplify(g)})
    if L.get('facts'):
        facts[L['id']] = L['facts']

# families with a single member go under "Other families" in the selection (the info box shows the real one)
FIX_FAM = {'Afro-Asiatic': 'Afroasiatic', 'Niger-Congo': 'Niger–Congo', 'Eskimo–Aleut': 'Eskimo-Aleut'}
for it in items:
    it['family'] = FIX_FAM.get(it['cat'], it['cat'])
nf = collections.Counter(it['family'] for it in items)
for it in items:
    it['cat'] = it['family'] if nf[it['family']] >= 2 else 'Other'
for i, it in enumerate(sorted(items, key=lambda x: -x['m']['total']), 1):
    it['imp'] = i
aliases_unique(items)
fam = collections.Counter(it['cat'] for it in items)
cats = [{'k': k, 'label': k} for k, _ in fam.most_common() if k != 'Other'] + ([{'k': 'Other', 'label': 'Other families'}] if 'Other' in fam else [])
meta = dict(
    key='languages', title='Languages', short='Languages', kind='languages', sub=f'{len(items)} languages and where they are spoken',
    noun=['language', 'languages'], catLabel='Family', regLabel='Continent', cats=cats, cat2Label='Branch',
    regs=[{'k': c, 'label': c} for c in CONTS],
    measures={'l1': {'label': 'Native speakers', 'fmt': 'pop', 'q': 'Which has more native speakers?'},
              'total': {'label': 'All speakers', 'fmt': 'pop', 'q': 'Which has more speakers in total?'}},
    bigger='l1',
    about="""<p>Each language is drawn as the countries or states/provinces where it is the main language (solid) or co-official, a lingua franca
    or a large minority language (lighter). Areas follow <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>
    country and admin-1 borders, so they're a school-atlas simplification: real language borders don't follow provinces, and cities are mixed.
    Areas overlap where several languages are spoken. Speaker numbers are rounded estimates in the style of Ethnologue / Wikipedia (2025).</p>
    <p>Language areas, numbers, phrases with pronunciation guides and facts were compiled with Claude; treat them as a learning aid, not a reference.
    The 🔊 buttons use your device's built-in speech voices, so they only work for languages your browser or phone has a voice for.</p>""",
    items=items)
dump(meta, OUT / 'languages.json')
dump({'type': 'FeatureCollection', 'features': feats}, OUT / 'languages.geojson')
dump(facts, OUT / 'languages.facts.json')
print(len(items), 'languages', dict(collections.Counter(it['reg'] for it in items)), dict(fam))
