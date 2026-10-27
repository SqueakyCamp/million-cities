#!/usr/bin/env python3
"""Austria: the 200 largest Gemeinden (municipalities) by population on 1 January of the latest year.

Inputs (data/raw/at/, see prepare_austria.sh): Statistik Austria population by Gemeinde (pop.csv, pop2016.csv,
gem.csv names), Gemeinde + Bezirk polygons (gem.geojson, bez.geojson, WFS), Wikidata (wd_gkz.json: article titles,
coordinates, elevation). Facts: tools/sets/facts/at-gemeinden.json ({gkz: [facts]}) written from the Wikipedia intros
(data/raw/sets/at_intros.json, fetched here).
Output: static/data/sets/at-gemeinden.json, .geojson, .facts.json
"""
import csv, collections, json, re
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Geod

from wiki import RAW, OUT, intros, load, dump
from common import norm, aliases_unique, round_geom

A = RAW / 'at'
N = 200
BANDS = [(1, 100), (101, 200)]  # extra scopes in the "what" selector (rank ranges)
geod = Geod(ellps='WGS84')
LAND = {'1': 'Burgenland', '2': 'Kärnten', '3': 'Niederösterreich', '4': 'Oberösterreich', '5': 'Salzburg',
        '6': 'Steiermark', '7': 'Tirol', '8': 'Vorarlberg', '9': 'Wien'}


def read_pop(p):
    pop, year = collections.Counter(), None
    for r in csv.reader(open(p, encoding='utf-8'), delimiter=';'):
        if r[0].startswith('A10-'):
            year = r[0][4:]
            g = r[2].split('-')[1]
            pop['90001' if g.startswith('9') else g] += int(r[4])
    return pop, year


pop, year = read_pop(A / 'pop.csv')
pop16, _ = read_pop(A / 'pop2016.csv')
names = {}
for r in csv.reader(open(A / 'gem.csv', encoding='utf-8'), delimiter=';'):
    m = re.match(r'(.*) <(\d+)>', r[1])
    if m:
        names[m.group(2)] = m.group(1)
names['90001'] = 'Wien'
bez = {f['properties']['g_id']: f['properties']['g_name'] for f in json.load(open(A / 'bez.geojson'))['features']}

geo = collections.defaultdict(list)
for f in json.load(open(A / 'gem.geojson'))['features']:
    g = f['properties']['g_id']
    geo['90001' if g.startswith('9') else g].append(shape(f['geometry']))

wd = {}
for b in json.load(open(A / 'wd_gkz.json'))['results']['bindings']:
    g = b['gkz']['value']
    e = wd.setdefault(g, {'qid': b['item']['value'].rsplit('/', 1)[1]})
    if 'en' in b: e['en'] = b['en']['value'].rsplit('/wiki/', 1)[1].replace('_', ' ')
    if 'de' in b: e['de'] = b['de']['value'].rsplit('/wiki/', 1)[1].replace('_', ' ')
    if 'elev' in b: e.setdefault('elev', round(float(b['elev']['value'])))
    if 'coord' in b and 'coord' not in e:
        x, y = re.findall(r'[-\d.]+', b['coord']['value'])[:2]
        e['coord'] = [float(x), float(y)]
from urllib.parse import unquote
for e in wd.values():
    for k in ('en', 'de'):
        if k in e: e[k] = unquote(e[k])

top = [g for g, _ in pop.most_common() if g in names][:N]
items, feats = [], []
for rank, g in enumerate(top, 1):
    poly = unary_union([p if p.is_valid else p.buffer(0) for p in geo[g]])
    area = abs(geod.geometry_area_perimeter(poly)[0]) / 1e6
    w = wd.get(g, {})
    name = names[g]
    land = LAND[g[0]]
    b = bez.get(g[:3], '')
    statutory = g == '90001' or '(Stadt)' in b or b.startswith('Stadt ')
    sub = 'Statutarstadt' if statutory else ('Bezirk ' + b if b else '')
    al = [w.get('en', '').split(',')[0], name.replace('St. ', 'Sankt '), re.sub(r'\s*\(.*\)$', '', w.get('de', ''))]
    if g == '90001': al += ['Vienna']
    ll = w.get('coord') or list(poly.representative_point().coords[0])
    p16 = pop16.get(g)
    growth = (pop[g] / p16 - 1) * 100 if p16 else None
    stats = [[pop[g], 'int', f'Einwohner (1.1.{year})'], [rank, 'rank', 'in Österreich'],
             [area, 'area', 'km²'], [pop[g] / area, 'dens', 'Einw./km²']]
    if growth is not None: stats.append([growth, 'pct', 'seit 2016'])
    if w.get('elev'): stats.append([w['elev'], 'm', 'm ü. A.'])
    items.append(dict(id=g, name=name, alias=al, reg=land, sub=sub, ll=[round(ll[0], 4), round(ll[1], 4)],
                      bb=[round(v, 3) for v in poly.bounds], g='poly', m={'pop': pop[g]}, imp=rank, stats=stats,
                      wiki=w.get('de') or w.get('en'), qid=w.get('qid')))
    feats.append({'type': 'Feature', 'properties': {'id': g},
                  'geometry': round_geom(mapping(poly.simplify(0.0008, preserve_topology=True)), 4)})

aliases_unique(items)
facts = load(__import__('pathlib').Path(__file__).parent / 'facts' / 'at-gemeinden.json', {})
meta = dict(
    key='at-gemeinden', title='Österreich · größte Gemeinden', short='Gemeinden', kind='places', lang='de',
    sub=f'Die {N} größten Gemeinden · {year}', noun=['Gemeinde', 'Gemeinden'],
    regLabel='Bundesland', regs=[{'k': v, 'label': v} for v in LAND.values()], catLabel='Auswahl',
    ranks=[{'k': f'r:{a}-{b}', 'label': f'Top {b}' if a == 1 else f'Plätze {a}–{b}', 'lo': a, 'hi': b} for a, b in BANDS],
    defaultWhat=f'r:1-{BANDS[0][1]}', migrateAll=f'r:1-{BANDS[0][1]}', allWhere='Ganz Österreich', wikiLang='de',
    measures={'pop': {'label': 'Einwohner', 'fmt': 'pop', 'q': 'Welche hat mehr Einwohner?'}},
    bigger='pop', bbox=[9.53, 46.37, 17.16, 49.02], dots=True,
    about=f"""<p>Die {N} größten der 2.092 österreichischen Gemeinden nach der Einwohnerzahl am 1. Jänner {year}, laut
    <a href="https://data.statistik.gv.at/" target="_blank" rel="noopener">Statistik Austria</a> (CC BY 4.0). Wien ist eine Gemeinde (und ein Bundesland)
    und zählt daher nur einmal. Oben bei „Auswahl“ kann man die Top 100, alle {N} oder nur die Plätze 101–{N} üben.
    Gemeindegrenzen: Statistik Austria (Gemeindegrenzen {year}). Seehöhe und Artikel-Links aus Wikidata; die kurzen Texte wurden
    mit Claude aus den Einleitungen der Wikipedia-Artikel geschrieben.</p>""",
    items=items)
dump(meta, OUT / 'at-gemeinden.json')
dump({'type': 'FeatureCollection', 'features': feats}, OUT / 'at-gemeinden.geojson')
dump({it['id']: facts[it['id']] for it in items if it['id'] in facts}, OUT / 'at-gemeinden.facts.json')

# intros for the fact writers (English + German, the German ones are often more informative for small towns)
cache_en = load(RAW / 'sets' / 'at_intros_en.json', {})
cache_de = load(RAW / 'sets' / 'at_intros_de.json', {})
intros([wd.get(it['id'], {}).get('en') for it in items], cache_en)
intros([wd.get(it['id'], {}).get('de') for it in items], cache_de, lang='de')
dump(cache_en, RAW / 'sets' / 'at_intros_en.json')
dump(cache_de, RAW / 'sets' / 'at_intros_de.json')
src = [dict(id=it['id'], name=it['name'], land=it['reg'], pop=it['m']['pop'], rank=it['imp'], wiki=it['wiki'],
            en=cache_en.get(wd.get(it['id'], {}).get('en') or '', ''), de=cache_de.get(wd.get(it['id'], {}).get('de') or '', ''))
       for it in items]
dump(src, RAW / 'sets' / 'at_factsrc.json', pretty=True)
print(len(items), 'Gemeinden;', sum(1 for it in items if it['id'] in facts), 'with facts; smallest:', items[-1]['name'], items[-1]['m']['pop'])
