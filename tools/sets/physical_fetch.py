#!/usr/bin/env python3
"""Collect physical-feature candidates from Natural Earth and fetch Wikidata + Wikipedia intros for them.

Writes data/raw/sets/phys_cand.json (candidates) and data/raw/sets/wd.json / intros.json (caches, incremental).
build_physical.py then selects the features and writes the app files.
"""
import json
from wiki import RAW, SRC, wd_entities, titles_to_qids, intros, load, dump

R = RAW / 'sets'
NE = lambda n: json.load(open(RAW / f'ne_10m_{n}.geojson', encoding='utf-8'))['features']

MARINE = {'ocean': 'ocean', 'sea': 'sea', 'gulf': 'bay', 'bay': 'bay', 'sound': 'bay', 'fjord': 'bay', 'lagoon': 'bay',
          'inlet': 'bay', 'strait': 'strait', 'channel': 'strait', 'reef': 'coast'}
REGION = {'Range/mtn': 'range', 'Desert': 'desert', 'Plateau': 'plateau', 'Plain': 'lowland', 'Basin': 'lowland',
          'Lowland': 'lowland', 'Valley': 'lowland', 'Tundra': 'lowland', 'Wetlands': 'lowland', 'Delta': 'lowland',
          'Gorge': 'lowland', 'Foothills': 'lowland', 'Depression': 'lowland', 'Geoarea': 'region', 'Coast': 'coast',
          'Peninsula': 'peninsula', 'Pen/cape': 'peninsula', 'Isthmus': 'peninsula', 'Island': 'island',
          'Island group': 'island', 'Continent': 'continent'}
POINT = {'island': 'island', 'island group': 'island', 'cape': 'cape', 'waterfall': 'waterfall', 'pole': 'pole'}

cands = []
for i, f in enumerate(NE('geography_marine_polys')):
    p = f['properties']
    cat = MARINE.get(p['featurecla'])
    if cat and p['name']:
        cands.append(dict(key=f'm{p["ne_id"]}', cat=cat, cla=p['featurecla'], ne=p['name'], sr=9 if p['scalerank'] is None else p['scalerank'],
                          qid=p.get('wikidataid'), src=['geography_marine_polys', i]))
for i, f in enumerate(NE('geography_regions_polys')):
    p = f['properties']
    cat = REGION.get(p['FEATURECLA'])
    if cat and p['NAME']:
        cands.append(dict(key=f'r{p["NE_ID"]}', cat=cat, cla=p['FEATURECLA'], ne=p['NAME'], sr=p['SCALERANK'],
                          qid=p.get('WIKIDATAID'), src=['geography_regions_polys', i], region=p.get('REGION')))
for i, f in enumerate(NE('geography_regions_points')):
    p = f['properties']
    cat = POINT.get(p['featurecla'])
    if cat and p['name']:
        cands.append(dict(key=f'p{p["ne_id"]}', cat=cat, cla=p['featurecla'], ne=p['name'], sr=p['scalerank'],
                          qid=p.get('wikidataid'), src=['geography_regions_points', i]))
for i, f in enumerate(NE('geography_regions_elevation_points')):
    p = f['properties']
    if p['featurecla'] in ('mountain', 'depression') and p['name']:
        cands.append(dict(key=f'e{p["ne_id"]}', cat='peak' if p['featurecla'] == 'mountain' else 'lowland', cla=p['featurecla'],
                          ne=p['name'], sr=p['scalerank'], qid=p.get('wikidataid'), elev=p.get('elevation'),
                          src=['geography_regions_elevation_points', i]))
for i, f in enumerate(NE('lakes')):
    p = f['properties']
    if p['name'] and (9 if p['scalerank'] is None else p['scalerank']) <= 6:
        cands.append(dict(key=f'l{p["ne_id"]}', cat='lake', cla=p['featurecla'], ne=p['name'], sr=p['scalerank'],
                          qid=p.get('wikidataid'), src=['lakes', i]))

extra = json.load(open(SRC / 'extra_features.json', encoding='utf-8'))
for cat, titles in extra.items():
    res = titles_to_qids(titles)
    for t in titles:
        final, q = res[t]
        if not q:
            print('no article:', t)
            continue
        cands.append(dict(key=f'x{q}', cat=cat, cla=cat, ne=t, sr=3, qid=q, src=None))

rivers = load(SRC / 'rivers.json', [])
res = titles_to_qids([r['wiki'] for r in rivers]) if rivers else {}
for r in rivers:
    final, q = res[r['wiki']]
    cands.append(dict(key=f'v{q or r["name"]}', cat='river', cla='river', ne=r['name'], sr=0, qid=q, src=['rivers', r['segments']]))

cache = load(R / 'wd.json', {})
wd_entities([c['qid'] for c in cands if c['qid']], cache)
dump(cache, R / 'wd.json')
dump(cands, R / 'phys_cand.json')
print(len(cands), 'candidates,', sum(1 for c in cands if c['qid'] and cache.get(c['qid'], {}) and cache[c['qid']]['en']), 'with an enwiki article')
