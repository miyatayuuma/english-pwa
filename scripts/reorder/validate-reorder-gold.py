#!/usr/bin/env python3
"""Validate syntax fixtures and manually audited production-corpus samples."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = Path(__file__).with_name("generate-reorder-metadata.py")
spec = importlib.util.spec_from_file_location("reorder_generator", SCRIPT_PATH)
if spec is None or spec.loader is None:
    raise SystemExit("could not import reorder generator")
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def load(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def fail(errors: list[str], fixture_id: str, message: str) -> None:
    errors.append(f"{fixture_id}: {message}")



def dependency_span(tokens: list[dict], head_index: int) -> tuple[int, int]:
    selected = {head_index}
    changed = True
    while changed:
        changed = False
        for token in tokens:
            if token["i"] not in selected and token.get("head") in selected:
                selected.add(token["i"])
                changed = True
    return min(selected), max(selected) + 1


def validate_chunk_quality_gold(fixture_id: str, record: dict, specification: dict) -> list[str]:
    errors: list[str] = []
    tokens = record["tokens"]
    text_at = lambda value: next((token["i"] for token in tokens if token["text"].lower() == value.lower()), None)
    for tier in specification.get("tiers", []):
        variant = record.get("variants", {}).get(tier)
        if not variant:
            fail(errors, fixture_id, f"chunk-quality tier missing: {tier}")
            continue
        tiles = variant["tiles"]
        def tile_at(index: int | None):
            return next((tile for tile in tiles if index is not None and tile["tokenStart"] <= index < tile["tokenEnd"]), None)
        owner_token = text_at(specification.get("ownerToken", "")) if specification.get("ownerToken") else None
        owner = tile_at(owner_token)
        expected_owner = specification.get("ownerKind")
        if expected_owner and owner and expected_owner not in {owner.get("ownerKind"), owner.get("ownerParentKind")}:
            fail(errors, fixture_id, f"{tier} owner for {specification.get('ownerToken')} is {owner.get('ownerKind')}/{owner.get('ownerParentKind')}, expected {expected_owner}")
        if expected_owner and owner is None:
            fail(errors, fixture_id, f"{tier} owner token missing: {specification.get('ownerToken')}")

        marker_text = specification.get("clauseMarker") or specification.get("nestedMarker")
        marker = text_at(marker_text) if marker_text else None
        span_head = owner_token
        relative_head = text_at(specification.get("relativeHeadToken", "")) if specification.get("relativeHeadToken") else None
        if relative_head is not None and specification.get("relativeOwnerKind"):
            rel_tile = tile_at(relative_head)
            expected = specification["relativeOwnerKind"]
            if rel_tile is None or expected not in {rel_tile.get("ownerKind"), rel_tile.get("ownerParentKind")}:
                fail(errors, fixture_id, f"{tier} relative clause owner is absent or incorrect")
        if marker is not None:
            head = owner_token if owner_token is not None else span_head
        elif relative_head is not None:
            head = relative_head
        else:
            head = owner_token
        if head is not None:
            span_start, span_end = dependency_span(tokens, head)
            if marker is not None:
                span_start = min(span_start, marker)
            intersects = [tile for tile in tiles if tile["tokenStart"] < span_end and tile["tokenEnd"] > span_start]
            minimum = specification.get("minimumClauseTiles", specification.get("minimumRelativeTiles"))
            if minimum and len(intersects) < minimum:
                fail(errors, fixture_id, f"{tier} nested clause has {len(intersects)} tile(s); expected at least {minimum}")
            if marker is not None and any(tile.get("ownerKind") == "pp"
                                          and tile["tokenStart"] <= span_start and tile["tokenEnd"] >= span_end
                                          for tile in tiles):
                fail(errors, fixture_id, f"{tier} clause marker is inside a PP-owned whole clause")
        pp_word = specification.get("internalPpToken") or specification.get("ppToken")
        if pp_word:
            pp_tile = tile_at(text_at(pp_word))
            if pp_tile is None or pp_tile.get("ownerKind") != "pp":
                fail(errors, fixture_id, f"{tier} internal PP token {pp_word!r} has no PP owner")
        coordination_words = specification.get("coordinationWords", [])
        if coordination_words:
            coordinate_tiles = [tile_at(text_at(word)) for word in coordination_words]
            minimum = specification.get("minimumCoordinationTiles", 2)
            if any(tile is None for tile in coordinate_tiles) or len({tile["id"] for tile in coordinate_tiles if tile}) < minimum:
                fail(errors, fixture_id, f"{tier} non-verbal coordination remains atomic: {coordination_words}")
            expected = specification.get("coordinationOwnerKind")
            if expected and any(tile is None or tile.get("ownerKind") != expected for tile in coordinate_tiles):
                fail(errors, fixture_id, f"{tier} non-verbal coordination owner is incorrect: {coordination_words}")

    protected_exact = specification.get("protectedExact")
    if protected_exact:
        protected_texts = [span["text"].lower() for span in record.get("protectedConstructions", []) if span.get("hard")]
        if protected_exact.lower() not in protected_texts:
            fail(errors, fixture_id, f"expected hard-protected core {protected_exact!r}; got {protected_texts!r}")
    not_protected = specification.get("notProtected")
    if not_protected and any(not_protected.lower() in span["text"].lower()
                             for span in record.get("protectedConstructions", []) if span.get("hard")):
        fail(errors, fixture_id, f"relative clause overreach remains in protected spans: {not_protected!r}")
    return errors

def validate_grammar_fixtures(nlp, fixtures: list[dict]) -> list[str]:
    errors: list[str] = []
    if len(fixtures) < 30:
        errors.append(f"only {len(fixtures)} grammar fixtures; expected at least 30")
    if len({entry.get("id") for entry in fixtures}) != len(fixtures):
        errors.append("grammar fixture ids must be unique")
    for fixture in fixtures:
        fixture_id = str(fixture.get("id", "<missing-id>"))
        text = str(fixture.get("text", ""))
        if not text:
            fail(errors, fixture_id, "empty text")
            continue
        doc = nlp(text)
        sentences = generator.sentence_spans(doc)
        assertions = fixture.get("assert", {})
        expected_count = assertions.get("sentenceCount", 1)
        if len(sentences) != expected_count:
            fail(errors, fixture_id, f"expected {expected_count} sentences; got {len(sentences)}")
            continue
        records = []
        for index, sentence in enumerate(sentences):
            protected = generator.protected_constructions(sentence, {})
            quote_state = generator.quote_state_before(text, sentence.start_char)
            record = generator.sentence_metadata(sentence, text, {}, index, quote_state)
            records.append(record)
            tokens = list(sentence)
            deps = {generator.dep(token) for token in tokens}
            construction_deps = {entry["relation"] for entry in record["syntax"]["clauses"]}
            expected_patterns = assertions.get("pattern")
            if expected_patterns and record["syntax"]["fivePattern"]["value"] != expected_patterns:
                fail(errors, fixture_id, f"pattern expected {expected_patterns}; got {record['syntax']['fivePattern']}")
            for relation in assertions.get("relations", []):
                if relation not in deps:
                    fail(errors, fixture_id, f"missing dependency relation {relation}; got {sorted(deps)}")
            for relation in assertions.get("clauseRelations", []):
                if relation not in construction_deps and not any(
                    generator.dep(token) == relation for token in tokens
                ):
                    fail(errors, fixture_id, f"missing clause relation {relation}; got {sorted(construction_deps)}")
            if assertions.get("question") is not None and record["syntax"]["isQuestion"] != assertions["question"]:
                fail(errors, fixture_id, f"question expected {assertions['question']}")
            if assertions.get("inversion") is not None and record["syntax"]["hasInversion"] != assertions["inversion"]:
                fail(errors, fixture_id, f"inversion expected {assertions['inversion']}")
            protected_text = [span["text"].lower() for span in protected]
            for phrase in assertions.get("protected", []):
                if phrase.lower() not in protected_text:
                    fail(errors, fixture_id, f"missing protected construction {phrase}; got {protected_text}")
            for phrase in assertions.get("notProtected", []):
                if any(phrase.lower() in value for value in protected_text):
                    fail(errors, fixture_id, f"must not treat {phrase} as a hard MWE")
            for pair in assertions.get("correlative", []):
                normalized_pairs = [entry["pair"] for entry in record["constructions"] if entry.get("kind") == "correlative"]
                if pair not in normalized_pairs:
                    fail(errors, fixture_id, f"missing correlative pair {pair}; got {normalized_pairs}")
            if assertions.get("hasNegation") and not any(generator.dep(token) == "neg" or token.lower_ in {"not", "never", "n't"} for token in tokens):
                fail(errors, fixture_id, "negation not represented")
            variants = record["variants"]
            if assertions.get("chunkQuality"):
                errors.extend(validate_chunk_quality_gold(fixture_id, record, assertions["chunkQuality"]))
            if assertions.get("playable") and not variants:
                fail(errors, fixture_id, "expected a playable tier")
            if assertions.get("fixedContext") and not record["fixedContext"]:
                fail(errors, fixture_id, "expected fixed-context fallback")
            for phrase in assertions.get("tileContains", []):
                if not any(phrase.lower() in tile["text"].lower()
                           for variant in variants.values() for tile in variant["tiles"]):
                    fail(errors, fixture_id, f"no tile contains expected PP/construction phrase {phrase!r}")
            for tier, variant in variants.items():
                reconstructed = "".join(tile["text"] + tile["separatorAfter"] for tile in variant["tiles"])
                if reconstructed != record["text"] or variant["canonicalReconstruction"] != record["text"]:
                    fail(errors, fixture_id, f"{tier} does not reconstruct the exact source sentence")
                if variant["canonicalOrder"] not in variant["acceptedOrders"]:
                    fail(errors, fixture_id, f"{tier} canonical order is not accepted")
                cursor = 0
                for tile in variant["tiles"]:
                    if tile["tokenStart"] != cursor or tile["tokenEnd"] <= cursor:
                        fail(errors, fixture_id, f"{tier} tile spans lose, duplicate, or overlap tokens")
                        break
                    cursor = tile["tokenEnd"]
                if cursor != len(tokens):
                    fail(errors, fixture_id, f"{tier} tile spans do not cover the sentence tokens")
                for protected_span in record["protectedConstructions"]:
                    if protected_span["hard"] and sum(tile["tokenStart"] <= protected_span["tokenStart"]
                                                        and tile["tokenEnd"] >= protected_span["tokenEnd"]
                                                        for tile in variant["tiles"]) != 1:
                        fail(errors, fixture_id, f"{tier} splits protected construction {protected_span['text']}")
            if assertions.get("duplicateTileText"):
                found = any(len({tile["text"] for tile in variant["tiles"]}) < len(variant["tiles"])
                            for variant in variants.values())
                if not found:
                    fail(errors, fixture_id, "fixture must produce duplicate visual tile text")
            if assertions.get("uniqueTileIds"):
                for tier, variant in variants.items():
                    ids = [tile["id"] for tile in variant["tiles"]]
                    if len(ids) != len(set(ids)):
                        fail(errors, fixture_id, f"duplicate ids in {tier}")
            if assertions.get("noBarePreposition"):
                for tier, variant in variants.items():
                    for tile in variant["tiles"]:
                        covered = tokens[tile["tokenStart"]:tile["tokenEnd"]]
                        if len(covered) == 1 and covered[0].pos_ == "ADP" and generator.dep(covered[0]) not in {"prt", "compound:prt"}:
                            fail(errors, fixture_id, f"bare preposition tile in {tier}: {tile['text']}")
            split = assertions.get("precisionSplit")
            if split:
                variant = variants.get("precision")
                if not variant:
                    fail(errors, fixture_id, "precision tier missing for particle split fixture")
                else:
                    spans = []
                    for word in split:
                        token_indexes = [token.i - sentence.start for token in tokens if token.lower_ == word.lower()]
                        owners = {tile["id"] for tile in variant["tiles"] if any(tile["tokenStart"] <= token_i < tile["tokenEnd"] for token_i in token_indexes)}
                        spans.append(owners)
                    if any(not owner for owner in spans) or len(set.union(*spans)) < 2:
                        fail(errors, fixture_id, f"precision did not expose particle order: {split}")
        if assertions.get("quoteBalanced"):
            if generator.quote_state_before(text, len(text))["double"]:
                fail(errors, fixture_id, "unmatched quotation mark")
        if assertions.get("acceptedOrderFixture") and len(records) != 1:
            fail(errors, fixture_id, "accepted-order fixture must be one sentence")
    return errors


def validate_corpus_audit(items: list[dict], metadata: dict, fixtures: list[dict]) -> list[str]:
    errors: list[str] = []
    if len(fixtures) < 50:
        errors.append(f"only {len(fixtures)} corpus gold fixtures; expected at least 50")
    source = {str(item["id"]): item for item in items}
    generated = {str(item["itemId"]): item for item in metadata.get("items", [])}
    seen = set()
    strata_counts: dict[str, int] = {}
    for fixture in fixtures:
        item_id = str(fixture.get("itemId", ""))
        sentence_index = fixture.get("sentenceIndex")
        key = (item_id, sentence_index)
        if key in seen:
            fail(errors, str(key), "duplicate corpus audit sample")
        seen.add(key)
        item = source.get(item_id)
        generated_item = generated.get(item_id)
        if not item or not generated_item:
            fail(errors, str(key), "source or generated item missing")
            continue
        if sentence_index is None or sentence_index >= len(generated_item.get("sentences", [])):
            fail(errors, str(key), "sentence index out of range")
            continue
        sentence = generated_item["sentences"][sentence_index]
        if sentence.get("text") != fixture.get("text"):
            fail(errors, str(key), "sentence text differs from the corpus")
            continue
        for stratum in fixture.get("strata", []):
            strata_counts[stratum] = strata_counts.get(stratum, 0) + 1
        if fixture.get("fixedContext"):
            if not sentence.get("fixedContext"):
                fail(errors, str(key), "expected a fixed-context fragment")
            if fixture.get("fixedContextReason") != sentence.get("fixedContextReason"):
                fail(errors, str(key), "fixed-context reason differs from generated classification")
            continue
        tier = fixture.get("tier", "foundation")
        variant = sentence.get("variants", {}).get(tier)
        if not variant:
            fail(errors, str(key), f"tier {tier} not playable")
            continue
        actual_tiles = [tile["text"] for tile in variant["tiles"]]
        expected_tiles = fixture.get("tileTexts")
        if actual_tiles != expected_tiles:
            fail(errors, str(key), f"tile audit mismatch: expected {expected_tiles!r}; got {actual_tiles!r}")
        expected_roles = fixture.get("tileRoles")
        if expected_roles is not None and [tile["role"] for tile in variant["tiles"]] != expected_roles:
            fail(errors, str(key), f"tile role audit mismatch: {expected_roles!r}")
        if fixture.get("construction"):
            kinds = {construction.get("kind") for construction in sentence.get("constructions", [])}
            if fixture["construction"] not in kinds:
                fail(errors, str(key), f"construction label missing: {fixture['construction']}")
        checks = {
            "fivePattern": sentence["syntax"]["fivePattern"]["value"],
            "isQuestion": sentence["syntax"]["isQuestion"],
            "hasInversion": sentence["syntax"]["hasInversion"],
            "clauseRelations": sorted({entry["relation"] for entry in sentence["syntax"]["clauses"]}),
            "constructionKinds": sorted({entry["kind"] for entry in sentence["constructions"]}),
            "protectedTexts": [entry["text"] for entry in sentence["protectedConstructions"]],
        }
        for name, actual in checks.items():
            if name in fixture and fixture[name] != actual:
                fail(errors, str(key), f"{name} audit mismatch: expected {fixture[name]!r}; got {actual!r}")
        for stratum in fixture.get("strata", []):
            if stratum in {"SV", "SVC", "SVO", "SVOO", "SVOC"} and sentence["syntax"]["fivePattern"]["value"] != stratum:
                fail(errors, str(key), f"stratum {stratum} does not match the annotated clause pattern")
            if stratum == "question" and not sentence["syntax"]["isQuestion"]:
                fail(errors, str(key), "question stratum is not a question")
            if stratum == "inversion" and not sentence["syntax"]["hasInversion"]:
                fail(errors, str(key), "inversion stratum lacks surface inversion")
            if stratum.startswith("clause:") and stratum.split(":", 1)[1] not in checks["clauseRelations"]:
                fail(errors, str(key), f"clause stratum {stratum} is not present")
            if stratum.startswith("construction:") and stratum.split(":", 1)[1] not in checks["constructionKinds"]:
                fail(errors, str(key), f"construction stratum {stratum} is not present")
    required_strata = {"SV", "SVC", "SVO", "SVOO", "question", "inversion", "clause:advcl", "clause:xcomp",
                       "clause:ccomp", "clause:relcl", "clause:acl", "construction:contraction",
                       "construction:separable-phrasal-verb", "construction:inseparable-phrasal-verb",
                       "construction:fixed-mwe", "construction:correlative", "fixed-context"}
    missing_strata = sorted(required_strata - strata_counts.keys())
    if missing_strata:
        errors.append(f"corpus audit missing strata: {', '.join(missing_strata)}")
    if len({str(fixture.get("itemId")) for fixture in fixtures}) < 40:
        errors.append("corpus audit fixtures must span at least 40 distinct source items")
    return errors


def main() -> None:
    gold = load(ROOT / "data/reorder-gold.json")
    items = load(ROOT / "data/items.json")
    metadata = load(ROOT / "data/reorder-v1.json")
    nlp = generator.spacy.load("en_core_web_sm")
    errors = validate_grammar_fixtures(nlp, gold.get("grammarFixtures", []))
    errors.extend(validate_corpus_audit(items, metadata, gold.get("corpusAudit", [])))
    print(json.dumps({"grammarFixtureCount": len(gold.get("grammarFixtures", [])),
                      "corpusGoldFixtureCount": len(gold.get("corpusAudit", [])),
                      "corpusStrata": sorted({stratum for fixture in gold.get("corpusAudit", [])
                                               for stratum in fixture.get("strata", [])}),
                      "failureCount": len(errors)}, ensure_ascii=False, indent=2))
    if errors:
        print("\n".join(errors[:80]), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
