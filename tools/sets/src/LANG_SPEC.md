# Language data spec (for tools/sets/build_languages.py)

The app gets a "Languages" quiz: a world map where each language is drawn as the area(s) where it is spoken,
built from Natural Earth country and admin-1 (state/province) polygons. Areas may overlap (Canada: English + French;
Catalonia: Catalan + Spanish; Indian states: Hindi + English…). Users learn: where is it spoken, name it, facts,
and three phrases with a pronunciation guide (and browser text-to-speech).

Write one JSON file: a list of language objects. UTF-8, valid JSON (no comments, no trailing commas).

```json
{
  "id": "es",
  "name": "Spanish",
  "endonym": "español",
  "aliases": ["Castilian", "Spanisch", "castellano"],
  "family": "Indo-European",
  "branch": "Romance",
  "l1": 485,
  "total": 560,
  "scripts": ["Latin"],
  "official": ["ESP", "MEX", "COL", "ARG"],
  "core": ["ESP", "MEX", "-ESP-5807"],
  "also": ["USA-3521", "AND"],
  "wiki": "Spanish language",
  "tts": "es-ES",
  "phrases": {
    "hello":  {"text": "Hola", "rom": "", "say": "OH-lah"},
    "thanks": {"text": "Gracias", "rom": "", "say": "GRAH-syahs"},
    "bye":    {"text": "Adiós", "rom": "", "say": "ah-DYOHS"}
  },
  "facts": ["…", "…", "…"]
}
```

Fields
- `id`: ISO 639-1 code if one exists, else ISO 639-3 (e.g. "yue" Cantonese, "nan" Min Nan, "wuu" Wu). Unique.
- `name`: common English name, as a learner would type it ("Mandarin Chinese" → use "Mandarin"; put "Chinese", "Standard Chinese", "Putonghua" in aliases).
- `endonym`: the language's name for itself, in its own script (add a romanisation in parentheses for non-Latin scripts, e.g. "日本語 (Nihongo)").
- `aliases`: other names a player might type and should be accepted: other English names, the German name (the player is Austrian),
  the endonym in Latin letters. Don't include names that clearly belong to another language in the set.
- `family` / `branch`: e.g. "Indo-European" / "Indo-Aryan"; "Sino-Tibetan" / "Sinitic"; "Niger–Congo" / "Bantu"; isolates: family "Language isolate", branch "".
- `l1`: native (first-language) speakers in millions, `total`: L1+L2 speakers in millions. Use Ethnologue 2025 / current Wikipedia infobox figures, rounded sensibly
  (2 significant digits; small languages may be < 1, e.g. 0.75). If total is unknown, use l1.
- `scripts`: writing systems in common use, e.g. ["Latin"], ["Cyrillic"], ["Arabic"], ["Devanagari"], ["Chinese characters"], ["Hangul"], ["Ge'ez"].
- `official`: ADM0_A3 codes (see ref/countries.txt) of countries where it is an official/national language at the national level.
- `core`: where it is the main / first language of most people. Entries are either an ADM0_A3 country code ("FRA") meaning the whole country,
  an adm1_code from ref/admin1.txt ("BEL-1234") meaning that state/province, or a subtraction "-<code>" to remove a region from a whole country
  that was added (e.g. "CAN" wouldn't be core for English because of Quebec: use "CAN", "-CAN-xxxx" (Quebec), or list the provinces).
- `also`: secondary areas: where it is co-official or a widely spoken lingua franca / large minority, but not the main language
  (French in all of francophone West/Central Africa, English in India/Nigeria/Kenya, Russian in Kazakhstan/Kyrgyzstan, Arabic in Chad, Swahili in DR Congo east, Spanish in the US southwest…).
  Be selective and reasonable: the map should look like a good school atlas language map. Do not repeat a code in both core and also.
- `wiki`: exact English Wikipedia article title (e.g. "Spanish language", "Mandarin Chinese", "Swahili language", "Tagalog language").
- `tts`: BCP-47 tag for browser speech synthesis (e.g. "es-ES", "pt-BR", "zh-CN", "yue-HK" for Cantonese, "sw-KE", "am-ET", "fil-PH"). Use the main variety.
- `phrases`: the most common everyday greeting ("hello"), "thank you" ("thanks"), and goodbye ("bye") — the standard neutral/polite forms
  a traveller would learn first. `text` = native script exactly as written; `rom` = romanisation for non-Latin scripts (Pinyin with tone marks, Hepburn, ISO/common transliteration), "" for Latin-script languages;
  `say` = an English-speaker pronunciation guide in capitals for the stressed syllable, hyphen-separated, like "GRAH-syahs", "kohn-NEE-chee-wah", "SHAY-shay"; add very short notes in brackets only where essential, e.g. "(rolled r)", "(rising tone)".
  If a language has gendered/formal variants, pick the most generally usable one and you may mention the other briefly in `say`'s note.
- `facts`: 3–4 short facts (one sentence each, ≤ ~200 characters), the most important or interesting things to know: where it is spoken / official status,
  origin or history, script or notable features (tones, cases, clicks…), cultural notes. Factual, concise, encyclopaedic tone — no marketing, no "fun fact!" phrasing,
  no claims you are not confident about. Same style as: "Capital of Japan and seat of the Emperor, at the head of Tokyo Bay on Honshu."

Region codes
- Look up every code with grep in tools/sets/ref/countries.txt (ADM0_A3 | ISO_A2 | name) and tools/sets/ref/admin1.txt
  (adm1_code | iso_3166_2 | name | type | country). Only use codes that exist in those files. Use the adm1_code column (e.g. "IND-3508"), not iso_3166_2.
- Granularity is states/provinces at best; that's fine. For a regional language use the admin-1 units where it dominates
  (e.g. Catalan: Catalonia, Balearic Islands, Valencia region as "also" or core; Andorra core). For India use the states (Tamil Nadu for Tamil, etc.).
  For China use provinces (Cantonese: Guangdong, Hong Kong, Macau; Guangxi as also). Note: Natural Earth may split some countries into many small units
  (e.g. UK counties, France départements) — grep by country to see what exists; list all units needed.
- Overseas territories/islands that have their own ADM0_A3 code (e.g. French Polynesia, Puerto Rico, Greenland, Hong Kong "HKG", Macau "MAC") should be listed when relevant.

Quality bar: this is a learning app; a geography teacher should find the maps and numbers sensible. Prefer correct and slightly simplified over detailed and wrong.
