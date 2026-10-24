#!/usr/bin/env python3
"""Simplify Natural Earth 10m layers into small GeoJSON files for the map (static/data/geo/)."""
import json
from pathlib import Path

from shapely.geometry import shape, mapping

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data' / 'raw'
OUT = ROOT / 'static' / 'data' / 'geo'
OUT.mkdir(parents=True, exist_ok=True)


def rnd(o, nd):
    if isinstance(o, (list, tuple)):
        return [rnd(x, nd) for x in o]
    return round(o, nd)


def build(src, dst, tol, props=lambda p: {}, keep=lambda p: True, nd=3):
    fc = json.load(open(RAW / src, encoding='utf-8'))
    feats = []
    for f in fc['features']:
        p = f['properties']
        if not f.get('geometry') or not keep(p):
            continue
        g = shape(f['geometry']).simplify(tol, preserve_topology=True)
        if g.is_empty:
            continue
        gj = mapping(g)
        gj['coordinates'] = rnd(gj['coordinates'], nd)
        feats.append(dict(type='Feature', properties=props(p), geometry=gj))
    json.dump(dict(type='FeatureCollection', features=feats), open(OUT / dst, 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    print(dst, len(feats), (OUT / dst).stat().st_size // 1024, 'KB')


build('ne_10m_land.geojson', 'land.geojson', 0.01)


def build_ocean():
    # one giant polygon renders with seams; cut it into 10° tiles after fixing validity
    from shapely import make_valid, box
    g = make_valid(shape(json.load(open(RAW / 'ne_10m_ocean.geojson'))['features'][0]['geometry']))
    feats = []
    for x in range(-180, 180, 10):
        for y in range(-90, 90, 10):
            part = g.intersection(box(x, y, x + 10, y + 10))
            if part.is_empty:
                continue
            part = make_valid(part.simplify(0.01, preserve_topology=True))
            polys = [p for p in getattr(part, 'geoms', [part]) if p.geom_type in ('Polygon', 'MultiPolygon')]
            for p in polys:
                gj = mapping(p)
                gj['coordinates'] = rnd(gj['coordinates'], 3)
                feats.append(dict(type='Feature', properties={}, geometry=gj))
    json.dump(dict(type='FeatureCollection', features=feats), open(OUT / 'ocean.geojson', 'w'), separators=(',', ':'))
    print('ocean.geojson', len(feats), (OUT / 'ocean.geojson').stat().st_size // 1024, 'KB')


build_ocean()
build('ne_10m_lakes.geojson', 'lakes.geojson', 0.01, keep=lambda p: (p.get('scalerank') or 0) <= 6)
build('ne_10m_admin_0_boundary_lines_land.geojson', 'borders.geojson', 0.01,
      props=lambda p: dict(k=p.get('FEATURECLA', '')))
build('ne_10m_admin_1_states_provinces_lines.geojson', 'admin1.geojson', 0.01,
      props=lambda p: {})
build('ne_10m_rivers_lake_centerlines.geojson', 'rivers.geojson', 0.01,
      props=lambda p: dict(r=p.get('scalerank'), n=p.get('name_en') or p.get('name')),
      keep=lambda p: p.get('featurecla') in ('River', 'Lake Centerline') and (p.get('scalerank') or 99) <= 9)

# label points (no geometry simplification needed)
lab = []
for f in json.load(open(RAW / 'ne_10m_admin_0_countries.geojson', encoding='utf-8'))['features']:
    p = f['properties']
    lab.append(dict(type='Feature', properties=dict(n=p['NAME_EN'] or p['NAME'], r=p['LABELRANK'], t='c'),
                    geometry=dict(type='Point', coordinates=[round(p['LABEL_X'], 3), round(p['LABEL_Y'], 3)])))
for f in json.load(open(RAW / 'ne_10m_admin_1_states_provinces.geojson', encoding='utf-8'))['features']:
    p = f['properties']
    if p.get('longitude') is None or not p.get('name'):
        continue
    lab.append(dict(type='Feature', properties=dict(n=p.get('name_en') or p['name'], r=p.get('labelrank') or 9, t='s'),
                    geometry=dict(type='Point', coordinates=[round(p['longitude'], 3), round(p['latitude'], 3)])))
json.dump(dict(type='FeatureCollection', features=lab), open(OUT / 'labels.geojson', 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print('labels.geojson', len(lab), (OUT / 'labels.geojson').stat().st_size // 1024, 'KB')
