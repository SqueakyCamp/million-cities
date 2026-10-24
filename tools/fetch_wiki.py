#!/usr/bin/env python3
"""Match every city of every database to its English Wikipedia article and fetch the article intro.

Writes data/raw/wiki.json: {"map": {"<db>:<id>": qid}, "pages": {qid: {"title", "extract"}}}.
The intros are the source material for the hand-written facts in tools/facts/*.json (see build_facts.py).
Re-running only looks up cities that are not matched yet.
"""
import json, math, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

from common import norm, DB_OUT, RAW

API = 'https://en.wikipedia.org/w/api.php'
UA = 'MillionCities/1.0 (https://github.com/SqueakyCamp/million-cities)'
OUT = RAW / 'wiki.json'


def get(params, url=API):
    params = dict(params, format='json', formatversion=2)
    req = urllib.request.Request(url + '?' + urllib.parse.urlencode(params), headers={'User-Agent': UA})
    for i in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            print('retry', e, file=sys.stderr)
            time.sleep(2 + 3 * i)
    raise RuntimeError('API failed')


def km(a, b, c, d):
    p = math.pi / 180
    x = (d - b) * p * math.cos((a + c) / 2 * p)
    return 6371 * math.hypot(x, (c - a) * p)


BAD = re.compile(r'airport|stadium|universit|hospital|station|temple|penitentiary|battle|earthquake|S\.F\.K|F\.C\.|'
                 r'province|governorate|district|prefecture|county|region|\(state\)|union territory|metropolitan|'
                 r'municipality|constituency|\bcamp\b|club|mosque|cathedral|church|school|college|TV |list of', re.I)
# fixes where the automatic match picks the wrong article (key -> enwiki title)
FIX = {
    'wup2025:7121': 'Campinas', 'wup2018:20190': 'Campinas', 'wup2018:21152': 'Ahmedabad',
    'wup2018:22484': 'Ekurhuleni', 'wup2018:20305': 'Greater Vitória', 'wup2018:21847': 'León, Guanajuato',
    'wup2018:206483': 'Comarca Lagunera', 'wup2018:20286': 'São Luís, Maranhão', 'wup2018:23567': 'Al Rayyan',
    'wup2018:205656': 'Ordos City', 'wup2018:22835': 'West Midlands conurbation',
    # states/provinces instead of their capital city
    'wup2025:5915': 'Puebla (city)', 'wup2018:21862': 'Puebla (city)', 'wup2025:4745': 'Jambi (city)',
    'wup2025:5096': 'Querétaro (city)', 'wup2018:21863': 'Querétaro (city)',
    'wup2025:4184': 'Aguascalientes (city)', 'wup2018:21824': 'Aguascalientes (city)',
    'wup2018:20566': 'Jilin City', 'wup2018:22450': 'Biên Hòa',
}


def base(title):
    return norm(re.sub(r'\s*\(.*\)$|,.*$', '', title))


def near(c, p, dist=60):
    co = (p.get('coordinates') or [None])[0]
    if not co and p.get('pageprops', {}).get('wikibase_item'):
        co = wd_coord(p['pageprops']['wikibase_item'])  # some articles have no primary coordinates
    return co and km(c['lat'], c['lon'], co['lat'], co['lon']) < dist


def wd_coord(qid):
    r = get(dict(action='wbgetclaims', entity=qid, property='P625'), 'https://www.wikidata.org/w/api.php')
    for cl in r.get('claims', {}).get('P625', []):
        v = cl['mainsnak'].get('datavalue', {}).get('value')
        if v:
            return {'lat': v['latitude'], 'lon': v['longitude']}


def lookup(titles):
    r = get(dict(action='query', titles='|'.join(titles), redirects=1, prop='coordinates|pageprops',
                 ppprop='wikibase_item|disambiguation'))
    q = r.get('query', {})
    fwd = {x['from']: x['to'] for x in q.get('normalized', []) + q.get('redirects', [])}
    pages = {p['title']: p for p in q.get('pages', []) if not p.get('missing')}
    out = []
    for t in titles:
        while t in fwd and t not in pages:
            t = fwd[t]
        if t in pages and pages[t] not in out:
            out.append(pages[t])
    return out


def candidates(q):
    r = get(dict(action='query', generator='search', gsrsearch=q, gsrlimit=10, gsrnamespace=0,
                 prop='coordinates|pageprops', ppprop='wikibase_item|disambiguation', colimit='max'))
    return sorted(r.get('query', {}).get('pages', []), key=lambda p: p.get('index', 99))


def ok(p):
    return 'disambiguation' not in p.get('pageprops', {}) and p.get('pageprops', {}).get('wikibase_item')


def names_of(c):
    names = [re.sub(r'\s*\(.*\)$', '', c['name']).strip()]
    names += [x.strip() for x in re.split(r'\s*[-–/]\s*', names[0]) if x.strip() and x.strip() != names[0]][:1]
    if c.get('local'):
        names.append(c['local'])
    return names


def match(c):
    """Best article for a city: an exact title near the city, else the best-named search hit near it."""
    if f'{c["db"]}:{c["id"]}' in FIX:
        p = lookup([FIX[f'{c["db"]}:{c["id"]}']])[0]
        return p['pageprops']['wikibase_item'], p['title']
    names = names_of(c)
    for n in names:
        for p in lookup([f'{n} (city)', n, f'{n}, {c["country"]}', f'{n} City']):
            if ok(p) and near(c, p) and not BAD.search(p['title']):
                return p['pageprops']['wikibase_item'], p['title']
    keys = {norm(n) for n in names}
    best = None
    for n in names:
        for q in (f'{n} {c["country"]}', n):
            for i, p in enumerate(candidates(q)):
                if not ok(p) or not near(c, p):
                    continue
                score = (0 if base(p['title']) in keys else 1 if any(base(p['title']).startswith(k) for k in keys) else 2) \
                    + (5 if BAD.search(p['title']) else 0)
                if best is None or (score, i) < best[0]:
                    best = ((score, i), p)
        if best and best[0][0] == 0:
            break
    if best and best[0][0] <= 1:  # anything else is a guess: leave it for FIX
        p = best[1]
        return p['pageprops']['wikibase_item'], p['title']
    return None, None


def good(c, title):
    return base(title) in {norm(n) for n in names_of(c)} and not BAD.search(title)


def main():
    # --redo: look again at matches whose title does not plainly match the city name
    redo = '--redo' if '--redo' in sys.argv else None
    st = json.load(open(OUT)) if OUT.exists() else {'map': {}, 'pages': {}}
    titles = {q: v['title'] for q, v in st['pages'].items()}
    # Wikidata database: QIDs are known, only the enwiki title is needed
    wd = [c for c in json.load(open(DB_OUT / 'wikidata.json'))['cities'] if f'wikidata:{c["id"]}' not in st['map']]
    for i in range(0, len(wd), 50):
        chunk = wd[i:i + 50]
        r = get(dict(action='wbgetentities', ids='|'.join(c['wikidata'] for c in chunk), props='sitelinks',
                     sitefilter='enwiki'), 'https://www.wikidata.org/w/api.php')
        for c in chunk:
            sl = r['entities'].get(c['wikidata'], {}).get('sitelinks', {}).get('enwiki')
            if sl:
                st['map'][f'wikidata:{c["id"]}'] = c['wikidata']
                titles[c['wikidata']] = sl['title']
            else:  # e.g. a municipality item without an English article: search like the WUP cities
                qid, title = match(dict(c, db='wikidata'))
                if qid:
                    st['map'][f'wikidata:{c["id"]}'] = qid
                    titles[qid] = title
                print(f'wikidata:{c["id"]}', c['name'], '->', title, file=sys.stderr)
    for db in ('wup2025', 'wup2018'):
        for c in json.load(open(DB_OUT / f'{db}.json'))['cities']:
            k = f'{db}:{c["id"]}'
            c['db'] = db
            old = st['map'].get(k)
            if old and k not in FIX and (redo is None or good(c, titles.get(old, ''))):
                continue
            qid, title = match(c)
            if qid:
                st['map'][k] = qid
                titles[qid] = title
            else:
                st['map'].pop(k, None)
            print(k, c['name'], '->', title, file=sys.stderr)
    # intros
    need = [q for q in titles if q not in st['pages']]
    for i in range(0, len(need), 20):
        chunk = need[i:i + 20]
        r = get(dict(action='query', prop='extracts', exintro=1, explaintext=1, exlimit=20, redirects=1,
                     titles='|'.join(titles[q] for q in chunk)))
        q = r['query']
        back = {x['to']: x['from'] for x in q.get('redirects', []) + q.get('normalized', [])}
        got = {back.get(p['title'], p['title']): p for p in q['pages']}
        for qid in chunk:
            p = got.get(titles[qid])
            if p and p.get('extract'):
                st['pages'][qid] = {'title': p['title'], 'extract': p['extract'][:3000]}
    json.dump(st, open(OUT, 'w'), ensure_ascii=False, indent=0)
    st['pages'] = {q: v for q, v in st['pages'].items() if q in set(st['map'].values())}
    print(len(st['map']), 'cities matched,', len(st['pages']), 'articles', file=sys.stderr)


main()
