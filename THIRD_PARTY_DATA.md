# Third-party vocabulary data

This project uses the following external lexical resources when generating `data/vocabulary-v2.json`.

## EJDict-hand

- Source: https://github.com/kujirahand/EJDict
- Purpose: primary English-to-Japanese gloss source.
- License: Public Domain / CC0.

## Japanese Wiktionary via Kaikki.org

- Source: https://kaikki.org/jawiktionary/%E8%8B%B1%E8%AA%9E/index.html
- Purpose: fallback Japanese glosses for words and multi-word expressions not covered by EJDict-hand.
- Original source: Japanese Wiktionary.
- Machine-readable extraction: Kaikki.org / Wiktextract.
- License: the Wiktionary-derived data is made available under the same licenses as Wiktionary, including CC BY-SA and GFDL.

The app stores one concise Japanese gloss per vocabulary card. Where multiple senses exist, generation selects the sense that best overlaps with the Japanese translation of the linked example sentence. The public DUO index is used to identify likely English headwords/phrases and section placement; its Japanese glosses are not copied into the database.
