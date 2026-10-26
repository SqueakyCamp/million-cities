#!/usr/bin/env python3
"""Collect reference data to check the language entries (src/languages_*.json) against:
- Wikidata: number of speakers (P1098, with first/second-language qualifiers and year),
  countries whose official languages (P37) include the language
- the English Wikipedia infobox (speakers, speakers2, official fields, raw)
- Wikivoyage phrasebook lines for hello / thank you / goodbye
- Wiktionary translation tables of "hello", "thank you", "goodbye"
Writes data/raw/sets/lang_verify/<id>.json-ish chunks (lang_verify_<n>.json) for reviewers.
"""
import json, re, sys
from wiki import RAW, SRC, get, titles_to_qids, dump

R = RAW / 'sets'
langs = []
for p in sorted(SRC.glob('languages_*.json')):
    for L in json.load(open(p, encoding='utf-8')):
        L['_file'] = p.name
        langs.append(L)
names0 = {}
for f in json.load(open(RAW / 'ne_10m_admin_0_countries.geojson', encoding='utf-8'))['features']:
    p = f['properties']
    names0[p['ADM0_A3']] = (p['ADMIN'], p.get('WIKIDATAID'))

# --- Wikidata: language items + speakers
res = titles_to_qids([L['wiki'] for L in langs])
qid = {L['id']: res[L['wiki']][1] for L in langs}
ents = {}
todo = [q for q in qid.values() if q]
for i in range(0, len(todo), 50):
    r = get('https://www.wikidata.org/w/api.php', dict(action='wbgetentities', ids='|'.join(todo[i:i + 50]), props='claims|labels', languages='en'))
    ents.update(r['entities'])
QUAL = {'Q36870': 'L1', 'Q125421': 'L2', 'Q1196827': 'L1', 'Q12349432': 'total'}


def speakers(e):
    out = []
    for c in e.get('claims', {}).get('P1098', []):
        v = c['mainsnak'].get('datavalue', {}).get('value')
        if not v:
            continue
        q = c.get('qualifiers', {})
        part = [QUAL.get(x['datavalue']['value']['id'], x['datavalue']['value']['id']) for x in q.get('P518', []) if x.get('datavalue')]
        year = [x['datavalue']['value']['time'][1:5] for x in q.get('P585', []) if x.get('datavalue')]
        where = [x['datavalue']['value']['id'] for x in q.get('P276', []) + q.get('P1001', []) + q.get('P17', []) if x.get('datavalue')]
        out.append(dict(n=round(float(v['amount'])), part=part, year=year[0] if year else None, place=where[:2] or None, rank=c.get('rank')))
    return out

# --- countries with this language official (P37), by Wikidata id of NE countries
cq = {q: (a3, n) for a3, (n, q) in names0.items() if q}
off_of = {}
cq_list = list(cq)
for i in range(0, len(cq_list), 50):
    r = get('https://www.wikidata.org/w/api.php', dict(action='wbgetentities', ids='|'.join(cq_list[i:i + 50]), props='claims'))
    for q, e in r['entities'].items():
        for c in e.get('claims', {}).get('P37', []):
            v = c['mainsnak'].get('datavalue', {}).get('value', {}).get('id')
            if v:
                off_of.setdefault(v, []).append(cq[q][1])
lab = {}
allv = list(off_of)
for i in range(0, len(allv), 50):
    r = get('https://www.wikidata.org/w/api.php', dict(action='wbgetentities', ids='|'.join(allv[i:i + 50]), props='labels', languages='en'))
    for q, e in r['entities'].items():
        lab[q] = e.get('labels', {}).get('en', {}).get('value', q)

# --- Wikipedia infobox fields
def infobox(title):
    r = get('https://en.wikipedia.org/w/api.php', dict(action='parse', page=title, prop='wikitext', section=0, redirects=1))
    t = r.get('parse', {}).get('wikitext', '')
    out = {}
    for k in ('speakers', 'speakers2', 'date', 'nation', 'minority', 'familycolor', 'script'):
        m = re.search(r'\n\s*\|\s*' + k + r'\s*=\s*(.*?)(?=\n\s*\|)', t, re.S)
        if m:
            out[k] = re.sub(r'<ref[^>]*/>|<ref.*?</ref>', '', m.group(1), flags=re.S).strip()[:500]
    return out

# --- Wiktionary translation tables
def wikt(page):
    r = get('https://en.wiktionary.org/w/api.php', dict(action='parse', page=page, prop='wikitext'))
    t = r.get('parse', {}).get('wikitext', '')
    rows = {}
    for line in t.split('\n'):
        m = re.match(r'\*:?\s*([^:{]+):\s*(.*)', line)
        if m and '{{t' in m.group(2):
            rows.setdefault(m.group(1).strip(), m.group(2)[:400])
    return rows
wk = {p: wikt(p) for p in ('hello', 'thank you', 'goodbye')}

# --- Wikivoyage phrasebooks
def voyage(name):
    for page in (f'{name} phrasebook', f'{name.split(" ")[0]} phrasebook'):
        r = get('https://en.wikivoyage.org/w/api.php', dict(action='parse', page=page, prop='wikitext', redirects=1))
        t = r.get('parse', {}).get('wikitext')
        if not t:
            continue
        lines = t.split('\n')
        out = []
        for i, line in enumerate(lines):
            if re.match(r';\s*(hello|hi\b|good ?bye|bye|thank you|thanks)', line, re.I):
                out.append((line + (' ' + lines[i + 1] if i + 1 < len(lines) and lines[i + 1].startswith(':') else ''))[:300])
        return dict(page=page, lines=out[:14])
    return None

rows = []
for n, L in enumerate(langs):
    q = qid[L['id']]
    e = ents.get(q, {}) if q else {}
    wk_names = [L['name'], L['name'].split(' (')[0]] + L.get('aliases', [])[:3]
    rows.append(dict(
        id=L['id'], name=L['name'], file=L['_file'], wiki=L['wiki'], qid=q,
        ours=dict(l1_millions=L['l1'], total_millions=L.get('total'), official=[names0.get(c, (c,))[0] for c in L.get('official', [])],
                  phrases=L.get('phrases'), tts=L.get('tts')),
        wikidata_speakers=speakers(e) if e else None,
        wikidata_official_in=sorted(off_of.get(q, [])) if q else None,
        wikipedia_infobox=infobox(L['wiki']),
        wiktionary={p: next((wk[p][k] for k in wk_names if k in wk[p]), None) for p in wk},
        wikivoyage=voyage(L['name']),
    ))
    print(n, L['name'], file=sys.stderr)
# variants countries name as official (e.g. "Standard Chinese", "Modern Standard Arabic") — list them for the reviewer
variants = {lab[v]: sorted(c) for v, c in off_of.items()}
dump(variants, R / 'lang_verify_official_by_label.json', pretty=True)
for k in range(3):
    dump(rows[k::3], R / f'lang_verify_{k}.json', pretty=True)
print(len(rows), 'languages;', sum(1 for r in rows if r['wikivoyage']), 'with a Wikivoyage phrasebook;',
      sum(1 for r in rows if r['wikidata_speakers']), 'with Wikidata speakers')
