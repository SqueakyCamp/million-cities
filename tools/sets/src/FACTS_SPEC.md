# Writing "Good to know" facts

The app shows 2–4 short facts per item in its info box, below the key numbers (which are shown separately, so
don't just restate the population, area, elevation or rank figure the app already shows).

Write facts from the provided Wikipedia intro text (the source of truth). You may add widely known, uncontroversial
context, but never invent specifics (dates, numbers, superlatives) that aren't in the text or that you aren't sure of.
If the intro is thin, write 2 facts rather than padding.

Style (match exactly):
- English, one sentence each, ≤ ~200 characters, plain factual tone. No "fun fact", no exclamation marks, no "you", no marketing.
- The most important or most interesting things to know: where it is and what it's known for, history highlights,
  notable landmarks/industry/culture, superlatives (largest/deepest/oldest) when stated in the source.
- Examples of the style:
  "Capital of Japan and seat of the Emperor, at the head of Tokyo Bay on Honshu."
  "Originally called Edo; it became the seat of the Tokugawa shogunate in 1603 and was renamed Tokyo ('eastern capital') in 1868."
  "Has three UNESCO World Heritage Sites: the Qutub Minar, Humayun's Tomb and the Red Fort."

Output: one JSON object {"<id>": ["fact", "fact", ...], ...}, UTF-8, valid JSON. Validate with python3 json.load at the end
and check that every id of your input got an entry.
