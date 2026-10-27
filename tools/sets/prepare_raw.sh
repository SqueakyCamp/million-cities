#!/bin/sh
# Raw inputs for the quiz sets (run after tools/prepare_raw.sh, which fetches the Natural Earth base layers).
set -e
cd "$(dirname "$0")/../../data/raw"
for f in geography_regions_polys geography_regions_points geography_regions_elevation_points geography_marine_polys; do
  curl -sLo ne_10m_$f.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_$f.geojson
done
# Austria: Statistik Austria population by Gemeinde (1 Jan) + boundaries, Wikidata article links
mkdir -p at sets && cd at
Y=$(date +%Y)
curl -sfLo pop.csv "https://data.statistik.gv.at/data/OGD_bevstandjbab2002_BevStand_$Y.csv" || { Y=$((Y-1)); curl -sfLo pop.csv "https://data.statistik.gv.at/data/OGD_bevstandjbab2002_BevStand_$Y.csv"; }
curl -sfLo gem.csv "https://data.statistik.gv.at/data/OGD_bevstandjbab2002_BevStand_${Y}_C-GRGEMAKT-0.csv"
curl -sfLo pop2016.csv "https://data.statistik.gv.at/data/OGD_bevstandjbab2002_BevStand_2016.csv"
WFS="https://www.statistik.gv.at/gs-open/GEODATA/ows?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326"
curl -sfLo gem.geojson "$WFS&typeName=GEODATA:STATISTIK_AUSTRIA_GEM_${Y}0101"
curl -sfLo bez.geojson "$WFS&typeName=GEODATA:STATISTIK_AUSTRIA_POLBEZ_${Y}0101"
curl -sfG https://query.wikidata.org/sparql -H 'Accept: application/sparql-results+json' -A 'MillionCities/1.0' -o wd_gkz.json --data-urlencode \
  'query=SELECT ?item ?gkz ?en ?de ?elev ?coord WHERE { ?item wdt:P964 ?gkz . OPTIONAL{?en schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>} OPTIONAL{?de schema:about ?item; schema:isPartOf <https://de.wikipedia.org/>} OPTIONAL{?item wdt:P2044 ?elev} OPTIONAL{?item wdt:P625 ?coord} }'
# Austria physical features: GMBA mountain inventory (range polygons), then Wikidata/Wikipedia/OSM via at_physical_fetch.py
mkdir -p ../atphys/gmba && (cd ../atphys/gmba && curl -sfLO https://data.earthenv.org/mountains/standard/GMBA_Inventory_v2.0_standard_basic.zip && unzip -oq GMBA_Inventory_v2.0_standard_basic.zip)
cd ../../../tools/sets && python3 physical_fetch.py && python3 at_physical_fetch.py
