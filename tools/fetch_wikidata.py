#!/usr/bin/env python3
"""Fetch city-proper candidates from Wikidata into data/raw/wd.json (used by build_alt.py).

Candidates: items with a population >= 700k and coordinates whose type is a human settlement,
a municipality or a city (Wikidata's class tree is patchy: Los Angeles is only a "charter city",
which is not linked to "city", so all three roots are needed). Filtering happens in build_alt.py.
"""
import json, time, urllib.parse, urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / 'data' / 'raw'
UA = 'MillionCities/0.1 (https://github.com/SqueakyCamp/million-cities)'


def q(query):
    url = 'https://query.wikidata.org/sparql?' + urllib.parse.urlencode({'query': query})
    req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': UA})
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(req, timeout=300))['results']['bindings']
        except Exception as e:
            print('  retry:', e)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError('query failed')


qid = lambda v: v.rsplit('/', 1)[1]


def chunks(xs, n):
    for i in range(0, len(xs), n):
        yield ' '.join('wd:' + x for x in xs[i:i + n])


print('candidates …')
items = {}
for b in q('SELECT DISTINCT ?c ?t WHERE { ?c wdt:P1082 ?pop . FILTER(?pop >= 700000) ?c wdt:P625 [] . ?c wdt:P31 ?t . }'):
    items.setdefault(qid(b['c']['value']), set()).add(qid(b['t']['value']))
types = sorted({t for s in items.values() for t in s})
tl, settle = {}, set()
for vals in chunks(types, 150):
    for b in q(f'SELECT ?t ?l WHERE {{ VALUES ?t {{ {vals} }} ?t rdfs:label ?l FILTER(lang(?l)="en") }}'):
        tl[qid(b['t']['value'])] = b['l']['value']
    for root in ('Q486972', 'Q15284', 'Q515'):
        for b in q(f'SELECT DISTINCT ?t WHERE {{ VALUES ?t {{ {vals} }} ?t wdt:P279* wd:{root} }}'):
            settle.add(qid(b['t']['value']))
    time.sleep(1)
keep = sorted(k for k, v in items.items() if v & settle)
print(len(items), 'populous items,', len(keep), 'settlement-like')

out = {}
for vals in chunks(keep, 150):
    for b in q(f'''SELECT ?c ?en ?de ?coord ?iso WHERE {{ VALUES ?c {{ {vals} }}
        OPTIONAL {{ ?c rdfs:label ?en FILTER(lang(?en)="en") }} OPTIONAL {{ ?c rdfs:label ?de FILTER(lang(?de)="de") }}
        OPTIONAL {{ ?c wdt:P625 ?coord }} OPTIONAL {{ ?c wdt:P17 ?cn . ?cn wdt:P297 ?iso }}
        FILTER NOT EXISTS {{ ?c wdt:P576 [] }} }}'''):
        k = qid(b['c']['value'])
        o = out.setdefault(k, dict(en=None, de=None, coord=None, iso=[], types=sorted(tl.get(t, t) for t in items[k]), pops=[], districts={}))
        o['en'] = o['en'] or b.get('en', {}).get('value')
        o['de'] = o['de'] or b.get('de', {}).get('value')
        o['coord'] = o['coord'] or b.get('coord', {}).get('value')
        if b.get('iso') and b['iso']['value'] not in o['iso']:
            o['iso'].append(b['iso']['value'])
    for b in q(f'''SELECT ?c ?pop ?date ?rank ?how WHERE {{ VALUES ?c {{ {vals} }} ?c p:P1082 ?s . ?s ps:P1082 ?pop ; wikibase:rank ?rank .
        OPTIONAL {{ ?s pq:P585 ?date }} OPTIONAL {{ ?s pq:P459 ?m . ?m rdfs:label ?how FILTER(lang(?how)="en") }} }}'''):
        k = qid(b['c']['value'])
        if k in out:
            out[k]['pops'].append(dict(rank=b['rank']['value'].rsplit('#', 1)[1], date=b.get('date', {}).get('value', '')[:10],
                                       pop=float(b['pop']['value']), how=b.get('how', {}).get('value', '')))
    time.sleep(1)

# Chinese prefecture-level cities: urban districts (市辖区) and their populations
cn = sorted(k for k, o in out.items() if 'CN' in o['iso'])
print(len(cn), 'Chinese items: districts …')
for vals in chunks(cn, 60):
    for b in q(f'''SELECT ?c ?d ?pop ?date ?rank WHERE {{ VALUES ?c {{ {vals} }}
        ?c wdt:P150 ?d . ?d wdt:P31 wd:Q1065118 . FILTER NOT EXISTS {{ ?d wdt:P576 [] }}
        OPTIONAL {{ ?d p:P1082 ?s . ?s ps:P1082 ?pop ; wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank) OPTIONAL {{ ?s pq:P585 ?date }} }} }}'''):
        d = out[qid(b['c']['value'])]['districts'].setdefault(qid(b['d']['value']), [])
        if 'pop' in b:
            d.append([b.get('date', {}).get('value', '')[:10], b['rank']['value'].endswith('PreferredRank'), float(b['pop']['value'])])
    time.sleep(1)

json.dump(out, open(RAW / 'wd.json', 'w'), ensure_ascii=False)
print('wrote', len(out), 'items to wd.json')
