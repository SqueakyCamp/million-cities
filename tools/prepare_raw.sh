#!/bin/sh
# Download the raw sources into data/raw and convert the two big ones into small pickles
# (uc.pkl, gn.pkl) used by build_data.py.  Needs: pip install --user shapely pyproj openpyxl numpy
set -e
cd "$(dirname "$0")/../data/raw"
WUP=https://population.un.org/wup/assets/Download
curl -sLo cities.csv.gz "$WUP/Cities/WUP2025-DB-DEGURBA-Cities-Population-Surface-Data.csv.gz"
curl -sLo locations.xlsx "$WUP/WUP2025-F00-LOCATIONS.xlsx"
curl -sLo ucdb.zip https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_UCDB_GLOBE_R2024A/GHS_UCDB_GLOBE_R2024A/V1-1/GHS_UCDB_GLOBE_R2024A_V1_1.zip
curl -sLO https://download.geonames.org/export/dump/cities15000.zip
curl -sLO https://download.geonames.org/export/dump/alternateNamesV2.zip
curl -sLO https://download.geonames.org/export/dump/countryInfo.txt
for f in admin_0_countries admin_1_states_provinces admin_1_states_provinces_lines admin_0_boundary_lines_land rivers_lake_centerlines lakes land ocean; do
  curl -sLo ne_10m_$f.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_$f.geojson
done
unzip -o -q ucdb.zip GHS_UCDB_GLOBE_R2024A.gpkg
unzip -o -q cities15000.zip
python3 -W ignore ../../tools/load_uc.py
python3 ../../tools/load_gn.py
rm -f GHS_UCDB_GLOBE_R2024A.gpkg ucdb.zip alternateNamesV2.zip
