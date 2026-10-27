#!/usr/bin/env python3
"""Austria physical features, raw inputs: resolve src/at_physical.txt (German Wikipedia titles) to Wikidata, fetch
Wikidata entities, German intros, and OSM geometry (rivers, lakes, glaciers by their wikidata tag, via Overpass).

Caches in data/raw/atphys/ (incremental): titles.json, wd.json, intros_de.json, osm/<qid>.json.
GMBA mountain inventory (range polygons) is expected in data/raw/atphys/gmba/ (see prepare_raw.sh).
"""
import json, sys, time, urllib.parse, urllib.request
from wiki import RAW, SRC, UA, get, wd_entities, titles_to_qids, intros, load, dump

A = RAW / 'atphys'
OSM_CATS = {'river', 'lake', 'glacier'}
OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
            'https://maps.mail.ru/osm/tools/overpass/api/interpreter']


def read_list():
    out = []
    for line in open(SRC / 'at_physical.txt', encoding='utf-8'):
        if not line.strip() or line.startswith('#'):
            continue
        f = [x.strip() for x in line.split('|')]
        cat, title = f[0], f[1]
        name = f[2] if len(f) > 2 and f[2] else None
        alias = [a for a in f[3].split(';') if a] if len(f) > 3 and f[3] not in ('', '-') else []
        gmba = None
        if '@gmba:' in title:
            title, gmba = title.split('@gmba:')
        elif title.startswith('gmba:'):
            gmba, title = title[5:], ''
        out.append(dict(cat=cat, title=title, name=name, alias=alias, gmba=gmba and int(gmba)))
    return out


def overpass(q):
    data = urllib.parse.urlencode({'data': q}).encode()
    for i in range(12):
        url = OVERPASS[i % len(OVERPASS)]
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except Exception as e:
            print('overpass retry', url, e, file=sys.stderr)
            time.sleep(min(60, 5 * 2 ** (i // len(OVERPASS))))
    raise RuntimeError('overpass failed')


if __name__ == '__main__':
    items = read_list()
    tq = load(A / 'titles.json', {})
    todo = [it['title'] for it in items if it['title'] and it['title'] not in tq]
    if todo:
        for t, (final, q) in titles_to_qids(todo, lang='de').items():
            tq[t] = [final, q]
        dump(tq, A / 'titles.json', pretty=True)
    missing = [it['title'] for it in items if it['title'] and not tq.get(it['title'], [0, 0])[1]]
    if missing:
        print('NOT FOUND on dewiki:', missing)
    # coordinates from the German article (fallback when Wikidata has none)
    co = load(A / 'coords_de.json', {})
    tl = [tq[t][0] for t in tq if tq[t][0] and tq[t][0] not in co]
    for i in range(0, len(tl), 50):
        r = get('https://de.wikipedia.org/w/api.php', dict(action='query', titles='|'.join(tl[i:i + 50]), prop='coordinates'))
        for pg in r['query']['pages']:
            c = pg.get('coordinates')
            co[pg['title']] = [c[0]['lon'], c[0]['lat']] if c else None
    dump(co, A / 'coords_de.json', pretty=True)
    wd = load(A / 'wd.json', {})
    wd_entities([tq[t][1] for t in tq if tq[t][1]], wd)
    dump(wd, A / 'wd.json')
    cache = load(A / 'intros_de.json', {})
    intros([tq[t][0] for t in tq if tq[t][0]], cache, lang='de')
    dump(cache, A / 'intros_de.json')
    # OSM geometry: everything carrying the wikidata tag (relations and ways), in one bbox around Austria
    (A / 'osm').mkdir(parents=True, exist_ok=True)
    need = [tq[it['title']][1] for it in items if it['cat'] in OSM_CATS and tq.get(it['title'], [0, 0])[1]]
    need = [q for q in need if not (A / 'osm' / f'{q}.json').exists()]
    for i in range(0, len(need), 15):
        chunk = need[i:i + 15]
        rx = '^(' + '|'.join(chunk) + ')$'
        q = f'[out:json][timeout:280][bbox:46.0,9.2,49.3,17.5];(relation["wikidata"~"{rx}"];way["wikidata"~"{rx}"];);out geom;'
        r = overpass(q)
        by = {qid: [] for qid in chunk}
        for e in r.get('elements', []):
            w = e.get('tags', {}).get('wikidata')
            if w in by:
                by[w].append(e)
        for qid, els in by.items():
            dump(els, A / 'osm' / f'{qid}.json')
            print(qid, len(els), 'elements', file=sys.stderr)
        time.sleep(3)
    # by name where the wikidata tag gave nothing usable (no water/glacier/waterway object)
    KIND = {'river': '["waterway"~"^(river|canal)$"]', 'lake': '["natural"="water"]', 'glacier': '["natural"="glacier"]'}
    for it in items:
        if it['cat'] not in OSM_CATS or not tq.get(it['title'], [0, 0])[1]:
            continue
        qid = tq[it['title']][1]
        p = A / 'osm' / f'{qid}.json'
        els = load(p, [])
        good = [e for e in els if e.get('tags', {}).get('natural') in ('water', 'glacier') or e.get('tags', {}).get('waterway') or e.get('tags', {}).get('type') in ('waterway', 'multipolygon')]
        if good:
            continue
        nm = it['name'] or it['title']
        r = overpass(f'[out:json][timeout:280][bbox:46.0,9.2,49.3,17.5];(relation{KIND[it["cat"]]}["name"="{nm}"];way{KIND[it["cat"]]}["name"="{nm}"];);out geom;')
        els = r.get('elements', [])
        if it['cat'] == 'river' and any(e['type'] == 'relation' for e in els):
            els = [e for e in els if e['type'] == 'relation']
        dump(els, p)
        print('by name:', nm, len(els), 'elements', file=sys.stderr)
        time.sleep(2)
    print(len(items), 'features listed;', len(missing), 'not found')
