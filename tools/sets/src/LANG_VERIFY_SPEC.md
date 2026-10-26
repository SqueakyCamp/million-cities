# Verifying the language entries

Each row in data/raw/sets/lang_verify_<n>.json has our values (`ours`) and reference data:
`wikidata_speakers` (P1098 values with part L1/L2/total, year, rank), `wikidata_official_in` (countries whose
official languages include this exact Wikidata item), `wikipedia_infobox` (raw speakers/speakers2/nation fields),
`wiktionary` (raw translation-table lines for hello / thank you / goodbye) and `wikivoyage` (phrasebook lines).
data/raw/sets/lang_verify_official_by_label.json lists, per official-language label in Wikidata, the countries
(useful when Wikidata uses a variant item: "Standard Chinese", "Modern Standard Arabic", "Malaysian", "Dari", "Serbo-Croatian" …).

Check three things and write corrections only where ours is wrong:

1. Speakers (`l1` = native, `total` = L1+L2, in millions). The Wikipedia infobox is the main reference (it's the
   most current, usually Ethnologue 2023–2025); Wikidata is secondary. Ours is fine if within ~20% of the reference
   or if the references disagree and ours is in their range. Otherwise set the infobox value (rounded to 2 significant
   digits). If the infobox only gives L1, keep our total unless it is below L1 or clearly implausible.
2. Official in (`official`: ADM0_A3 codes, see tools/sets/ref/countries.txt): countries where it is an official or
   national language at the national level. Compare with wikidata_official_in, the infobox `nation` field and the
   variant labels. Add clear omissions, remove clear errors. Regional-only status (a state/province) does not count.
3. Phrases (hello / thanks / bye: `text` in native script, `rom` romanisation for non-Latin scripts, `say` English
   pronunciation guide with the stressed syllable in capitals). Compare with Wikivoyage (preferred, it's written for
   travellers and has pronunciation) and Wiktionary. Fix wrong words, wrong spellings/diacritics/script, misleading
   pronunciation guides. Keep a reasonable choice if it's just a different but valid option (e.g. a more formal form).

Output: a JSON object {"<id>": {"l1": …, "total": …, "official": [...full new list...], "phrases": {"hello": {...full new phrase...}}, "why": "short reason per change"}}
containing ONLY languages and fields that change (omit a field to keep it). Also add an entry
{"<id>": {"unsure": "…"}} for things you couldn't resolve. Validate with python3 json.load and that every ADM0 code exists.
