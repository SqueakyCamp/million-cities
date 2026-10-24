# Million Cities

Learn all 511 cities in the world with more than one million inhabitants: a type-in **quiz** with a map,
**practice** modes (name the city, find it on the map, which one is bigger?) and an **atlas** with every city's
population, rank, growth from 1975 to 2050, and the towns it includes. A selector adds the 149 cities between
800,000 and 1 million (660 in total).

**Play:** https://squeakycamp.github.io/million-cities/

Progress is saved in your browser (localStorage).

## Data

- **Cities and populations:** United Nations, Department of Economic and Social Affairs, Population Division (2025).
  *World Urbanization Prospects 2025*, mid-2025 estimates of cities defined by the Degree of Urbanisation
  (contiguous 1 km² cells with ≥ 1,500 inhabitants/km² and ≥ 50,000 people). CC BY 3.0 IGO.
  <https://population.un.org/wup/>
- **City outlines:** European Commission, JRC. *GHSL Urban Centre Database R2024A*. Where WUP splits one GHSL
  urban centre into several cities, the outline is divided so each city gets its WUP area (approximate).
- **Alternative names and places inside each city:** [GeoNames](https://www.geonames.org/), CC BY 4.0.
- **Borders, rivers, lakes:** [Natural Earth](https://www.naturalearthdata.com/) (public domain).
- **Map tiles:** terrain from AWS Terrain Tiles (Mapzen), physical and satellite maps © Esri.
- **Map library:** [MapLibre GL JS](https://maplibre.org/) (BSD-3-Clause), fonts: Noto Sans (OFL) via OpenFreeMap.

## Running it yourself

`python3 server.py` serves `static/` and stores progress on the server (`data/state.json`), so several devices can
share one profile. Settings go in `settings.local.json` (`{"host": "127.0.0.1", "port": 8170}`).

To rebuild the data: `tools/prepare_raw.sh` (downloads the raw sources, ~700 MB) and then `tools/build.sh`.
Requires `pip install shapely pyproj openpyxl numpy`. Name fixes and extra accepted answers are in `tools/overrides.py`.
