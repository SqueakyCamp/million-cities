#!/bin/sh
# Rebuild all data files from data/raw and pre-gzip them for the server.
set -e
cd "$(dirname "$0")/.."
python3 -W ignore tools/build_data.py
python3 -W ignore tools/build_alt.py
python3 -W ignore tools/build_geo.py
python3 -W ignore tools/build_facts.py
# quiz sets (tools/sets/): physical features, languages, Austria (Gemeinden, physical features)
(cd tools/sets && python3 -W ignore build_physical.py && python3 -W ignore build_languages.py && python3 -W ignore build_austria.py && python3 -W ignore build_at_physical.py && python3 build_index.py)
for f in static/data/db/*.json static/data/*.geojson static/data/facts.json static/data/geo/*.geojson static/data/sets/*.json static/data/sets/*.geojson; do gzip -9 -k -f "$f"; done
