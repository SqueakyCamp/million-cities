#!/usr/bin/env python3
"""Build the two alternative databases:

  wup2018   UN World Urbanization Prospects 2018, cities over 300k (F12) with each country's own
            definition (city proper / urban agglomeration / metropolitan area). Population = the
            revision's 2025 projection.
  wikidata  City proper: population of the administrative city from Wikidata (wd_*.json, fetched by
            fetch_wikidata.py). Chinese prefecture-level cities count only their urban districts.
"""
import json, re, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (RAW, EXTENDED, norm, is_latin, split_wup_name, load_locations, country_name,  # noqa: E402
                    continent, gn_names, gn_match, finish, write_db)
from overrides import EXTRA_ALIASES, ALT_OVERRIDES, ANSWER_UNION  # noqa: E402

loc, by_iso2 = load_locations()


def names_for(name, extra, lat, lon, cc):
    """Accepted answers: the given names, parts of 'A, B' / 'A-B' names, and GeoNames names of the place."""
    aliases = {name} | {e for e in extra if e}
    for a in list(aliases):
        for part in re.split(r',\s*|\s+[-–]\s+|\s*\[|\]|\s*\(|\)', a):
            if len(norm(part)) >= 3:
                aliases.add(part.strip())
    # "Los Angeles-Long Beach-Santa Ana", "Dallas-Fort Worth" (but not "Port-au-Prince")
    hy = name.split('-')
    if len(hy) > 1 and all(h[:1].isupper() for h in hy):
        aliases |= {h.strip() for h in hy if len(norm(h)) >= 3}
    g = gn_match(aliases, lat, lon, cc)
    hist = set()
    if g:
        nm, hist = gn_names(g, cc)
        aliases |= nm
    aliases |= set(EXTRA_ALIASES.get(name, []))
    return aliases, hist


def apply_override(db, c):
    ov = ALT_OVERRIDES.get((db, c['name'], c['iso2'])) or ALT_OVERRIDES.get((db, c['name'])) or {}
    if 'name' in ov:
        c['aliases'].append(c['name'])
        c['name'] = ov['name']
    c['aliases'] = sorted(set(c['aliases']) | set(ov.get('aliases', [])))
    drop = {norm(x) for x in ov.get('drop', [])}
    c['aliases'] = [a for a in c['aliases'] if norm(a) not in drop]
    c['historic'] = [h for h in c['historic'] if norm(h) not in drop and norm(h) not in {norm(a) for a in c['aliases']}]
    if ov.get('note'):
        c['note'] = ov['note']
    return not ov.get('skip')


def region(cc, locid=None):
    L = loc.get(locid) if locid else None
    L = L or by_iso2.get(cc, {})
    return continent(L), L.get('SubRegName')


# ====================================================================== WUP 2018
def build_wup2018():
    import xlrd
    sh = xlrd.open_workbook(RAW / 'WUP2018-F12-Cities_Over_300K.xls').sheet_by_name('Data')
    notes_sh = xlrd.open_workbook(RAW / 'WUP2018-F12-Cities_Over_300K.xls').sheet_by_name('NOTES')
    notes = {}
    for i in range(notes_sh.nrows):
        m = re.match(r'^\((\d+)\)\s*(.*)$', str(notes_sh.cell_value(i, 0)))
        if m:
            notes[m.group(1)] = m.group(2)
    src = xlrd.open_workbook(RAW / 'WUP2018-DataSource-UrbanAgglomeration-and-CapitalCities.xls').sheet_by_index(0)
    meta = {}
    for i in range(17, src.nrows):
        r = src.row_values(i)
        if r[5]:
            meta[int(r[5])] = dict(iso2=r[4], concept=r[10], cap=r[7] == 'Capital')
    # "Suzhou, Jiangsu": show the province only where the city name is used twice
    base_count = defaultdict(int)
    for i in range(17, sh.nrows):
        raw = str(sh.cell_value(i, 4)).strip()
        if raw:
            base_count[norm(split_wup_name(raw)[0].split(',')[0])] += 1
    hdr = sh.row_values(16)
    years = [int(y) for y in hdr[8:]]
    cities, near = [], {}
    for i in range(17, sh.nrows):
        r = sh.row_values(i)
        if not r[3]:
            continue
        code = int(r[3])
        vals = {y: round(float(v) * 1000) for y, v in zip(years, r[8:]) if v != ''}
        pop = vals.get(2025)
        raw = str(r[4]).strip()
        name, local = split_wup_name(raw)
        prov = None
        if ',' in name:
            name, prov = [x.strip() for x in name.split(',', 1)]
        if prov and base_count[norm(name)] > 1:
            name = f'{name} ({prov})'
        m = meta.get(code, {})
        cc = m.get('iso2') or ''
        if pop is None:
            continue
        if pop < EXTENDED:
            if pop >= 300_000:
                for a in {name, local, raw} - {None}:
                    k = norm(a)
                    if k and (k not in near or near[k][2] < pop):
                        near[k] = [name, cc, pop]
            continue
        lat, lon = float(r[6]), float(r[7])
        aliases, hist = names_for(name, [local], lat, lon, cc)
        if prov:
            aliases = {a for a in aliases if norm(a) != norm(prov)} | {name.split(' (')[0]}
        cont, sub = region(cc, int(r[1]))
        note_ids = re.findall(r'\d+', str(r[5]))
        concept = m.get('concept') or ''
        c = dict(id=code, name=name, local=local if local and local != name else None, wup=raw,
                 country=country_name(cc, r[2]), iso2=cc, cont=cont, sub=sub,
                 lat=round(lat, 4), lon=round(lon, 4), pop=pop, cap=m.get('cap', False),
                 ts={y: v for y, v in vals.items() if y >= 1975}, contains=[],
                 aliases=sorted(aliases), historic=sorted(hist - aliases),
                 concept=concept, note=' '.join(notes.get(n, '') for n in note_ids).strip() or None)
        if apply_override('wup2018', c):
            cities.append(c)
    answers = finish(cities, ANSWER_UNION)
    near = {k: v for k, v in near.items() if k not in answers}
    write_db('wup2018', dict(
        name='UN WUP 2018', short='National definitions (UN 2018)', year=2025,
        desc='The classic UN list: each country\'s own definition of a city (city proper, urban agglomeration or metropolitan area). Populations are the 2018 revision\'s projection for 2025.',
        source='UN DESA, World Urbanization Prospects: The 2018 Revision (urban agglomerations ≥ 300,000); names: GeoNames'),
        cities, answers, near)


# ====================================================================== Wikidata (city proper)
# Metro areas and regions: never city proper
ALWAYS_DENY = re.compile(r'metropolitan (area|region|statistical|prefecture|city of italy)|agglomeration|conurbation|capital region|'
                         r'statistical area|district municipality|regional municipality|upazila|ortsteil|suburb|town of china|'
                         r'pedanía|autonomous region|kurdish|county-level city of china', re.I)
# Entries of these kinds are usually regions or districts, not cities ...
DENY_TYPE = re.compile(r'metropolitan (area|region|statistical|county|borough|prefecture)|agglomeration|conurbation|urban area|'
                       r'region of|capital region|statistical area|province|state of|federal member state|regency|district of|'
                       r'county of|county-level city|prefecture of|oblast|governorate|department of|métropole|township|'
                       r'neighbo|ward of|borough|census-designated|unincorporated|island', re.I)
# ... unless Wikidata also calls them a city outright (Jakarta is formally a province)
STRONG_TYPE = {'big city', 'megacity', 'national capital', 'largest city', 'city', 'global city', 'million city', 'capital city'}
CN_PREFECTURE = re.compile(r'prefecture-level|sub-province|direct-administered|specifically designated', re.I)
ISO_FIX = {'Q8646': 'HK', 'Q14773': 'MO', 'Q1218': 'IL'}


def build_wikidata():
    from shapely import Point
    from common import geonames
    gn, gn_list, gn_tree = geonames()
    wd = json.load(open(RAW / 'wd.json'))

    def pick(lst):
        """Latest census since 2010 if there is one (other estimates are often for the metro area),
        else the latest preferred value, else the latest value."""
        lst = [s for s in lst if s['rank'] != 'DeprecatedRank']
        census = [s for s in lst if 'census' in s['how'].lower() and s['date'] >= '2010']
        pool = census or [s for s in lst if s['rank'] == 'PreferredRank'] or lst
        return max(pool, key=lambda s: (s['date'], s['pop'])) if pool else None

    cands = []
    for q, i in wd.items():
        types = set(i['types'])
        if not i['coord'] or not i['en'] or not i['pops']:
            continue
        i = dict(i, en=re.sub(r' Municipality$', '', i['en']))  # Mexican "X Municipality" = city X
        ov = ALT_OVERRIDES.get(('wikidata', i['en'])) or {}
        if ov.get('skip'):
            continue
        if not ov.get('keep'):
            if any(ALWAYS_DENY.search(t) for t in types):
                continue
            if any(DENY_TYPE.search(t) for t in types) and not (types & STRONG_TYPE):
                continue
        m = re.match(r'Point\(([-\d.eE]+) ([-\d.eE]+)\)', i['coord'])
        if not m:
            continue
        lon, lat = float(m.group(1)), float(m.group(2))
        cc = ISO_FIX.get(q) or (i['iso'][0] if i['iso'] else '')
        if not cc:  # e.g. Somaliland, or items without a country: take the nearest GeoNames place's
            cc = gn_list[int(gn_tree.nearest(Point(lon, lat)))]['cc']
        s = pick(i['pops'])
        if not s:
            continue
        pop, year, how, defn = s['pop'], s['date'][:4], s['how'], 'municipality'
        if cc == 'CN' and any(CN_PREFECTURE.search(t) for t in types):
            ds = i['districts']
            if ds and all(ds.values()):
                pop = sum(max(v)[2] for v in ds.values())
                year = max(max(v)[0] for v in ds.values())[:4]
                how, defn = f'sum of {len(ds)} urban districts', 'urban districts'
            elif not any('zhitongzi' in t for t in types):
                defn = 'prefecture'  # whole prefecture incl. rural counties: only kept via ALT_OVERRIDES
        cands.append(dict(q=q, i=i, lat=lat, lon=lon, cc=cc, pop=round(pop), year=year, how=how, defn=defn))

    # duplicates: same country and the same name (Tokyo Metropolis / 23 wards), or nearby with one
    # name containing the other ("Kota Semarang" / "Semarang"): keep the bigger figure, the shorter name
    cands.sort(key=lambda c: -c['pop'])
    kept = []
    for c in cands:
        n = norm(c['i']['en'])
        dup = None
        for k in kept:
            kn = norm(k['i']['en'])
            if k['cc'] == c['cc'] and (kn == n or ((kn.endswith(n) or n.endswith(kn) or kn.startswith(n) or n.startswith(kn))
                                                   and abs(k['lat'] - c['lat']) < 0.3 and abs(k['lon'] - c['lon']) < 0.3)):
                dup = k
                break
        if dup is None:
            kept.append(c)
        elif len(c['i']['en']) < len(dup['i']['en']):
            dup['alt_name'] = dup['i']['en']
            dup['i'] = dict(dup['i'], en=c['i']['en'], de=c['i']['de'] or dup['i']['de'])

    cities, near = [], {}
    for c in kept:
        i, cc = c['i'], c['cc']
        name = i['en']
        ov = ALT_OVERRIDES.get(('wikidata', name, cc)) or ALT_OVERRIDES.get(('wikidata', name)) or {}
        if c['defn'] == 'prefecture' and not ov.get('keep'):
            continue
        pop, year, how = ov.get('pop', c['pop']), ov.get('popyear', c['year']), ov.get('popsrc', c['how'])
        if pop < EXTENDED:
            if pop >= 700_000:
                near[norm(name)] = [name, cc, pop]
            continue
        aliases, hist = names_for(name, [i['de'], c.get('alt_name')], c['lat'], c['lon'], cc)
        cont, sub = region(cc)
        rec = dict(id=c['q'], name=name, local=None, country=country_name(cc), iso2=cc, cont=cont, sub=sub,
                   lat=round(c['lat'], 4), lon=round(c['lon'], 4), pop=pop,
                   cap=any(t in ('national capital', 'federal capital', 'capital city', 'capital') for t in i['types']),
                   contains=[], aliases=sorted(aliases), historic=sorted(hist - aliases),
                   popyear=year, popsrc=how, defn=c['defn'] if c['defn'] != 'prefecture' else 'prefecture-level city',
                   wikidata=c['q'], note=None)
        if apply_override('wikidata', rec):
            cities.append(rec)
    answers = finish(cities, ANSWER_UNION)
    near = {k: v for k, v in near.items() if k not in answers}
    write_db('wikidata', dict(
        name='City proper (Wikidata)', short='City proper (Wikidata)', year=None,
        desc='Population inside the administrative city limits, as recorded in Wikidata (latest census where there is one). Chinese prefecture-level cities count only their urban districts. City limits differ a lot between countries.',
        source='Wikidata (CC0): population of the city/municipality; Chinese cities: sum of urban districts; names: GeoNames'),
        cities, answers, near)


if __name__ == '__main__':
    build_wup2018()
    build_wikidata()
