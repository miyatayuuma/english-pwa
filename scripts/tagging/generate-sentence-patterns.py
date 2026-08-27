#!/usr/bin/env python3
"""Generate auditable five-sentence-pattern candidates for DUO items.

This is a tagging-time tool, not an application runtime dependency. It uses spaCy's
English dependency parser to propose SV/SVC/SVO/SVOO/SVOC structures, accepts only
high-confidence analyses automatically, and leaves uncertain clauses in a review queue.
Manual overrides are applied after the automatic analysis and remain auditable.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

try:
    import spacy
except ImportError as exc:  # pragma: no cover - exercised in CI bootstrap
    raise SystemExit("spaCy is required: pip install spacy && python -m spacy download en_core_web_sm") from exc

ROOT = Path(__file__).resolve().parents[2]
ITEMS_PATH = ROOT / "data" / "items.json"
OVERRIDES_PATH = ROOT / "data" / "sentence-pattern-overrides.json"
GOLD_PATH = ROOT / "data" / "sentence-pattern-gold.json"
ANALYSIS_PATH = ROOT / "data" / "sentence-pattern-analysis.json"
REVIEW_PATH = ROOT / "data" / "sentence-pattern-review.json"

PATTERNS = {"SV", "SVC", "SVO", "SVOO", "SVOC"}
CLAUSE_DEPS = {"conj", "advcl", "ccomp", "relcl", "parataxis", "csubj", "csubjpass"}
FINITE_TAGS = {"VBD", "VBP", "VBZ", "MD"}
DIRECT_OBJECT_DEPS = {"dobj", "obj"}
INDIRECT_OBJECT_DEPS = {"iobj", "dative"}
PREDICATIVE_DEPS = {"attr", "acomp", "oprd"}
SUBJECT_DEPS = {"nsubj", "nsubjpass", "csubj", "csubjpass"}
LINKING_LEMMAS = {
    "be", "become", "seem", "remain", "appear", "feel", "look", "sound",
    "smell", "taste", "grow", "turn", "get", "stay", "prove",
}
RAISING_LINKING_LEMMAS = {"seem", "appear", "prove", "turn"}
INFINITIVE_OBJECT_LEMMAS = {
    "want", "wish", "hope", "plan", "decide", "intend", "try", "attempt",
    "manage", "refuse", "agree", "promise", "learn", "remember", "forget",
    "prefer", "choose", "expect", "need", "deserve", "afford", "aim",
}


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def child_list(token: Any, deps: set[str]) -> list[Any]:
    return [child for child in token.children if child.dep_ in deps]


def is_finite_clause_head(token: Any) -> bool:
    if token.dep_ == "ROOT":
        return True
    if token.pos_ not in {"VERB", "AUX", "ADJ", "NOUN"}:
        return False
    if token.tag_ in FINITE_TAGS:
        return True
    if "Fin" in token.morph.get("VerbForm"):
        return True
    return any(
        child.dep_ in {"aux", "auxpass", "cop"}
        and (child.tag_ in FINITE_TAGS or "Fin" in child.morph.get("VerbForm"))
        for child in token.children
    )


def clause_text(token: Any, sentence: Any) -> str:
    if token.dep_ == "ROOT":
        return sentence.text.strip()
    nodes = list(token.subtree)
    if not nodes:
        return token.text
    start = min(node.i for node in nodes)
    end = max(node.i for node in nodes) + 1
    return token.doc[start:end].text.strip()


def clause_heads(sentence: Any) -> list[Any]:
    root = sentence.root
    heads = [root]
    for token in sentence:
        if token is root or token.dep_ not in CLAUSE_DEPS:
            continue
        if is_finite_clause_head(token):
            heads.append(token)
    unique = {token.i: token for token in heads}
    return [unique[index] for index in sorted(unique)]


def analysis_record(pattern: str | None, confidence: str, reason: str, head: Any, sentence: Any) -> dict[str, Any]:
    return {
        "pattern": pattern,
        "confidence": confidence,
        "accepted": confidence == "high" and pattern in PATTERNS,
        "reason": reason,
        "relation": head.dep_,
        "predicate": head.lemma_.lower() if getattr(head, "lemma_", "") else head.text.lower(),
        "text": clause_text(head, sentence),
    }


def is_small_clause_complement(token: Any) -> bool:
    """Detect parser-style O+C small clauses such as make [him happy]."""
    if token.dep_ not in {"ccomp", "xcomp"} or token.pos_ not in {"ADJ", "NOUN", "PROPN"}:
        return False
    subjects = child_list(token, SUBJECT_DEPS)
    if not subjects:
        return False
    # A finite copula/auxiliary would indicate a full clause (e.g. think he is honest),
    # not the surface O+C relation used by the traditional fifth pattern.
    return not any(
        child.dep_ in {"cop", "aux", "auxpass"}
        and (child.tag_ in FINITE_TAGS or "Fin" in child.morph.get("VerbForm"))
        for child in token.children
    )


def is_bare_object_complement(token: Any) -> bool:
    if token.dep_ not in {"ccomp", "xcomp"} or token.pos_ not in {"ADJ", "NOUN", "PROPN"}:
        return False
    return not child_list(token, SUBJECT_DEPS)


def classify_clause(head: Any, sentence: Any) -> dict[str, Any]:
    direct_objects = child_list(head, DIRECT_OBJECT_DEPS)
    indirect_objects = child_list(head, INDIRECT_OBJECT_DEPS)
    predicatives = child_list(head, PREDICATIVE_DEPS)
    xcomps = child_list(head, {"xcomp"})
    ccomps = child_list(head, {"ccomp"})
    complement_clauses = [*xcomps, *ccomps]
    small_clauses = [child for child in complement_clauses if is_small_clause_complement(child)]
    bare_object_complements = [child for child in complement_clauses if is_bare_object_complement(child)]
    object_complements = predicatives + bare_object_complements
    copulas = child_list(head, {"cop"})
    preps = child_list(head, {"prep"})
    advmods = child_list(head, {"advmod"})
    passive = bool(child_list(head, {"auxpass"}) or child_list(head, {"nsubjpass", "csubjpass"}))
    lemma = (head.lemma_ or head.text).lower()

    if copulas and head.pos_ in {"ADJ", "NOUN", "PROPN", "ADV"}:
        return analysis_record("SVC", "high", "copular_predicate_head", head, sentence)

    if lemma in LINKING_LEMMAS and predicatives and not direct_objects and not indirect_objects:
        return analysis_record("SVC", "high", "linking_verb_predicative_complement", head, sentence)

    if direct_objects and indirect_objects:
        return analysis_record("SVOO", "high", "direct_and_indirect_objects", head, sentence)

    # spaCy can analyse the O+C pair as an adjective/noun ccomp whose own subject
    # is the surface object: make [him happy], consider [him a fool].
    if small_clauses:
        return analysis_record("SVOC", "high", "small_clause_object_complement", head, sentence)

    object_like = direct_objects or indirect_objects
    if object_like and object_complements:
        return analysis_record("SVOC", "high", "object_plus_object_complement", head, sentence)

    if passive and object_complements and not object_like:
        return analysis_record("SVC", "medium", "passive_with_remaining_predicative_complement", head, sentence)

    if direct_objects:
        return analysis_record("SVO", "high", "direct_object", head, sentence)

    if indirect_objects:
        return analysis_record("SVO", "medium", "single_indirect_object_surface_complement", head, sentence)

    if ccomps:
        return analysis_record("SVO", "medium", "finite_clausal_complement", head, sentence)

    if xcomps:
        if lemma in RAISING_LINKING_LEMMAS:
            return analysis_record("SVC", "medium", "raising_or_linking_xcomp", head, sentence)
        if lemma in INFINITIVE_OBJECT_LEMMAS:
            return analysis_record("SVO", "medium", "infinitival_object_candidate", head, sentence)
        return analysis_record(None, "low", "unresolved_xcomp_valency", head, sentence)

    if lemma == "be" and (preps or advmods):
        return analysis_record("SVC", "medium", "be_with_prepositional_or_adverbial_complement", head, sentence)

    if lemma in LINKING_LEMMAS and not object_like:
        return analysis_record("SV", "high", "linking_lexeme_used_without_complement", head, sentence)

    if head.pos_ in {"VERB", "AUX"} or copulas:
        return analysis_record("SV", "high", "no_object_or_predicative_complement", head, sentence)

    return analysis_record(None, "low", "nonverbal_or_fragment_root", head, sentence)


def analyse_item(nlp: Any, item: dict[str, Any]) -> dict[str, Any]:
    text = str(item.get("en") or "").strip()
    doc = nlp(text)
    clauses: list[dict[str, Any]] = []
    for sentence in doc.sents:
        for head in clause_heads(sentence):
            clauses.append(classify_clause(head, sentence))
    main = clauses[0] if clauses else {
        "pattern": None,
        "confidence": "low",
        "accepted": False,
        "reason": "no_clause_detected",
        "relation": "",
        "predicate": "",
        "text": text,
    }
    extras = clauses[1:]
    review_required = not main.get("accepted") or any(not clause.get("accepted") for clause in extras)
    return {
        "id": item.get("id"),
        "en": text,
        "main": main,
        "clauses": extras,
        "review_required": review_required,
    }


def manual_record(pattern: str | None, reason: str, text: str = "") -> dict[str, Any]:
    if pattern is not None and pattern not in PATTERNS:
        raise ValueError(f"invalid manual sentence pattern: {pattern}")
    return {
        "pattern": pattern,
        "confidence": "manual",
        "accepted": pattern in PATTERNS,
        "reason": reason,
        "relation": "manual",
        "predicate": "",
        "text": text,
    }


def apply_override(entry: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    reason = str(override.get("reason") or "manual_review")
    result = dict(entry)
    if "main" in override:
        result["main"] = manual_record(override.get("main"), reason, entry.get("main", {}).get("text", ""))
    if "clauses" in override:
        result["clauses"] = [manual_record(pattern, reason) for pattern in override.get("clauses", [])]
    result["review_required"] = bool(override.get("review_required", False))
    result["override_applied"] = True
    return result


def accepted_pattern(record: dict[str, Any] | None) -> str | None:
    if not isinstance(record, dict) or not record.get("accepted"):
        return None
    pattern = record.get("pattern")
    return pattern if pattern in PATTERNS else None


def accepted_clause_patterns(entry: dict[str, Any]) -> list[str]:
    return [pattern for clause in entry.get("clauses", []) if (pattern := accepted_pattern(clause))]


def unique(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def validate_gold(auto_entries: dict[str, dict[str, Any]], gold: dict[str, Any]) -> dict[str, Any]:
    mismatches: list[dict[str, Any]] = []
    total = 0
    matches = 0
    for expected in gold.get("entries", []):
        item_id = str(expected.get("id") or "")
        entry = auto_entries.get(item_id)
        if not entry:
            continue
        total += 1
        actual_main = accepted_pattern(entry.get("main"))
        actual_clauses = unique(accepted_clause_patterns(entry))
        expected_main = expected.get("main")
        expected_clauses = unique(expected.get("clauses", []))
        ok = actual_main == expected_main and actual_clauses == expected_clauses
        if ok:
            matches += 1
        else:
            mismatches.append({
                "id": item_id,
                "expected": {"main": expected_main, "clauses": expected_clauses},
                "actual": {"main": actual_main, "clauses": actual_clauses},
                "en": entry.get("en", ""),
            })
    accuracy = matches / total if total else 1.0
    return {"total": total, "matches": matches, "accuracy": round(accuracy, 4), "mismatches": mismatches}


def synthetic_self_test(nlp: Any) -> None:
    cases = [
        ("Birds fly.", "SV"),
        ("She is kind.", "SVC"),
        ("He opened the door.", "SVO"),
        ("She gave me a book.", "SVOO"),
        ("They made him happy.", "SVOC"),
        ("He was praised.", "SV"),
    ]
    failures = []
    for text, expected in cases:
        doc = nlp(text)
        sentence = next(iter(doc.sents))
        actual = classify_clause(sentence.root, sentence).get("pattern")
        if actual != expected:
            failures.append({"text": text, "expected": expected, "actual": actual})
    if failures:
        raise RuntimeError(f"sentence-pattern self-test failed: {failures}")


def main() -> int:
    items = read_json(ITEMS_PATH, [])
    if not isinstance(items, list) or len(items) != 560:
        raise RuntimeError(f"expected 560 items, got {len(items) if isinstance(items, list) else 'non-list'}")
    overrides_doc = read_json(OVERRIDES_PATH, {"entries": {}})
    overrides = overrides_doc.get("entries", {}) if isinstance(overrides_doc, dict) else {}
    gold = read_json(GOLD_PATH, {"entries": []})

    nlp = spacy.load("en_core_web_sm")
    synthetic_self_test(nlp)

    automatic_entries = [analyse_item(nlp, item) for item in items]
    automatic_by_id = {entry["id"]: entry for entry in automatic_entries}
    gold_result = validate_gold(automatic_by_id, gold)

    final_entries = []
    for entry in automatic_entries:
        override = overrides.get(entry["id"])
        final_entries.append(apply_override(entry, override) if isinstance(override, dict) else entry)

    main_counts = Counter()
    clause_counts = Counter()
    confidence_counts = Counter()
    main_accepted = 0
    clause_accepted = 0
    clause_total = 0
    review_entries = []
    for entry in final_entries:
        main = entry.get("main", {})
        confidence_counts[str(main.get("confidence") or "unknown")] += 1
        pattern = accepted_pattern(main)
        if pattern:
            main_accepted += 1
            main_counts[pattern] += 1
        for clause in entry.get("clauses", []):
            clause_total += 1
            confidence_counts[str(clause.get("confidence") or "unknown")] += 1
            clause_pattern = accepted_pattern(clause)
            if clause_pattern:
                clause_accepted += 1
                clause_counts[clause_pattern] += 1
        if entry.get("review_required"):
            review_entries.append(entry)

    summary = {
        "item_count": len(final_entries),
        "main_accepted": main_accepted,
        "main_unresolved": len(final_entries) - main_accepted,
        "main_coverage": round(main_accepted / len(final_entries), 4),
        "clause_total": clause_total,
        "clause_accepted": clause_accepted,
        "review_item_count": len(review_entries),
        "main_pattern_counts": dict(sorted(main_counts.items())),
        "clause_pattern_counts": dict(sorted(clause_counts.items())),
        "confidence_counts": dict(sorted(confidence_counts.items())),
        "gold": gold_result,
    }

    analysis_doc = {
        "schema_version": 1,
        "policy_version": 1,
        "engine": "spacy",
        "model": "en_core_web_sm",
        "spacy_version": spacy.__version__,
        "summary": summary,
        "entries": final_entries,
    }
    review_doc = {
        "schema_version": 1,
        "policy_version": 1,
        "summary": {
            "review_item_count": len(review_entries),
            "main_unresolved": summary["main_unresolved"],
        },
        "entries": review_entries,
    }
    write_json(ANALYSIS_PATH, analysis_doc)
    write_json(REVIEW_PATH, review_doc)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
