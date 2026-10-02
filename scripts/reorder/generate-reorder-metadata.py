#!/usr/bin/env python3
"""Build static, audited syntax-aware reordering metadata for English PWA.

spaCy is a build-time dependency only. This generator preserves source offsets,
uses dependency relations as the unit authority, and never fabricates chunks to
hit a preferred tile count. Uncertain or over-complex sentences are reported for
manual review or safely left out of the playable bank.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

try:
    import spacy
except ImportError as exc:  # pragma: no cover - CI installs build dependencies
    raise SystemExit("spaCy is required: pip install 'spacy==3.8.16' && python -m spacy download en_core_web_sm") from exc

ROOT = Path(__file__).resolve().parents[2]
ITEMS_PATH = ROOT / "data" / "items.json"
OVERRIDES_PATH = ROOT / "data" / "reorder-overrides.json"
OUTPUT_PATH = ROOT / "data" / "reorder-v1.json"
REPORT_PATH = ROOT / "data" / "reorder-report.json"
POLICY_VERSION = "reorder-policy-2.0.0"
SCHEMA_VERSION = 2
SHARED_MIN_TILES = 2
SHARED_MAX_TILES = 8
LEGACY_TIER_ONLY_OVERRIDE_IDS = ["E0022", "E0050", "E0075", "E0241", "E0309", "E0369", "E0544"]

SUBJECT_DEPS = {"nsubj", "csubj", "nsubjpass", "csubjpass"}
OBJECT_DEPS = {"obj", "dobj"}
INDIRECT_OBJECT_DEPS = {"iobj", "dative"}
CLAUSE_DEPS = {"advcl", "acl", "acl:relcl", "relcl", "ccomp", "xcomp", "csubj", "csubjpass"}
PREP_DEPS = {"obl", "prep", "nmod", "pobj", "agent"}
MODIFIER_DEPS = {"advmod", "npadvmod", "amod", "appos"}
OPERATOR_DEPS = {"aux", "aux:pass", "auxpass", "cop", "neg", "compound:prt", "prt"}

# Expressions whose internal word order is not a productive target in V1.
# Phrasal verbs that allow particle movement are deliberately kept out of this
# table so that their placement can be practiced.
FIXED_MWES = [
    "as soon as", "as long as", "even though", "in spite of", "instead of",
    "in order to", "as well as", "rather than", "because of", "due to",
    "according to", "in front of", "on behalf of", "at least", "at first",
    "at once", "by the way", "of course", "in fact", "in general",
    "for example", "for instance", "in other words", "on the other hand", "time and again",
    "as a result", "as a matter of fact", "each other", "one another",
    "a lot of", "lots of", "no longer", "not at all", "so that", "as if",
    "as though", "even if", "rather than", "in addition to", "look forward to",
    "get along with", "put up with", "come up with", "take care of",
]
INSEPARABLE_PHRASAL_VERBS = [
    "look after", "look into", "run into", "get over", "get along with",
    "come across", "take after", "put up with", "look forward to", "deal with",
    "rely on", "believe in", "consist of", "belong to", "care for", "sit back", "stand by",
]
CONTRACTION_RE = re.compile(r"(?i)\b[\w]+(?:n['’]t|['’][dms]|['’][rv]|['’]ll)\b")
TOKEN_WORD_RE = re.compile(r"[^\W_]+(?:['’][^\W_]+)*|[^\w\s]", re.UNICODE)
OPENING_PUNCT = {"(", "[", "{", '"', "'", "“", "‘", "«", "‹"}
ROLE_LABELS = {
    "subject": "主語", "predicate": "述語", "operator": "助動詞・否定",
    "object": "目的語", "indirect_object": "間接目的語", "complement": "補語",
    "clause": "節", "relative_clause": "関係詞節", "pp": "前置詞句",
    "adjunct": "修飾語句", "coordination": "並列要素", "conjunction": "接続語",
    "phrase": "語句",
}


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def dep(token: Any) -> str:
    value = token.dep_.lower()
    if value == "auxpass":
        return "aux:pass"
    if value == "nsubjpass":
        return "nsubjpass"
    return value


def is_clause_dependency(token: Any) -> bool:
    relation = dep(token)
    return relation in CLAUSE_DEPS or relation == "pcomp" and token.pos_ in {"VERB", "AUX"}


def token_range(sentence: Any, indices: set[int]) -> tuple[int, int] | None:
    values = [token.i - sentence.start for token in sentence if token.i in indices]
    return (min(values), max(values) + 1) if values else None


def token_span(sentence: Any, head: Any) -> set[int]:
    return {token.i for token in head.subtree if sentence.start <= token.i < sentence.end}


def top_child(token: Any, root: Any) -> Any | None:
    if token == root:
        return None
    current = token
    while current.head != root and current.head != current:
        current = current.head
    return current if current.head == root else None


def lexical_token(token: Any) -> bool:
    return not token.is_space and not token.is_punct and token.pos_ not in {"PUNCT", "SYM"}


def find_token_ranges(sentence: Any, start_char: int, end_char: int) -> list[int]:
    return [token.i for token in sentence if token.idx < end_char and token.idx + len(token) > start_char]


def expression_spans(sentence: Any, expressions: list[str], kind: str, *, hard: bool = True) -> list[dict[str, Any]]:
    words = [token for token in sentence if lexical_token(token)]
    normalized = [token.lemma_.lower() if kind == "inseparable-phrasal-verb" else token.lower_ for token in words]
    spans: list[dict[str, Any]] = []
    seen: set[tuple[int, int, str]] = set()
    for expression in expressions:
        terms = [part.lower() for part in expression.split()]
        if not terms:
            continue
        for start in range(0, len(normalized) - len(terms) + 1):
            if normalized[start:start + len(terms)] != terms:
                continue
            selected = words[start:start + len(terms)]
            # Do not claim an expression across intervening lexical material.
            if any(selected[n + 1].i != selected[n].i + 1 for n in range(len(selected) - 1)):
                continue
            key = (selected[0].i, selected[-1].i + 1, kind)
            if key in seen:
                continue
            seen.add(key)
            spans.append({
                "kind": kind,
                "text": sentence.doc.text[selected[0].idx:selected[-1].idx + len(selected[-1])],
                "tokenStart": selected[0].i - sentence.start,
                "tokenEnd": selected[-1].i - sentence.start + 1,
                "charStart": selected[0].idx,
                "charEnd": selected[-1].idx + len(selected[-1]),
                "hard": hard,
            })
    return spans


def protected_constructions(sentence: Any, override: dict[str, Any]) -> list[dict[str, Any]]:
    spans = expression_spans(sentence, FIXED_MWES, "fixed-mwe")
    spans.extend(expression_spans(sentence, INSEPARABLE_PHRASAL_VERBS, "inseparable-phrasal-verb"))
    # A multiword preposition with a nominal complement forms one PP unit. If
    # the final protected word is itself a preposition, include its `pobj`
    # complement in the protected span so that the PP cannot split in half.
    for span in spans:
        final = next((token for token in sentence
                      if token.i - sentence.start == span["tokenEnd"] - 1), None)
        if final is None or final.pos_ != "ADP":
            continue
        # Only nominal multiword prepositions take a complement core. A
        # complement subtree can contain relative, complement, or adjunct
        # clauses; those are independent structures and must stay outside the
        # hard-protected lexical span.
        if span["kind"] == "fixed-mwe" and span["text"].lower() in {"a lot of", "lots of"}:
            continue
        complement = next((child for child in final.children if dep(child) in {"pobj", "obj"}), None)
        if complement is None or complement.pos_ not in {"NOUN", "PROPN", "PRON", "NUM"}:
            continue
        core_indices = {complement.i}
        for child in complement.children:
            if dep(child) in {"amod", "compound", "nummod", "det", "poss", "quantmod"}:
                core_indices.add(child.i)
        complement_end = max(core_indices, default=complement.i)
        if complement_end + 1 > span["tokenEnd"]:
            span["tokenEnd"] = complement_end - sentence.start + 1
            end_token = sentence[span["tokenEnd"] - 1]
            span["charEnd"] = end_token.idx + len(end_token)
            span["text"] = sentence.doc.text[span["charStart"]:span["charEnd"]]
    for span in spans:
        if span["kind"] != "fixed-mwe" or span["text"].lower() not in {"a lot of", "lots of"}:
            continue
        of_token = next((token for token in sentence if token.idx >= span["charStart"] and token.idx < span["charEnd"] and token.lower_ == "of"), None)
        complement = next((child for child in of_token.children if dep(child) in {"pobj", "obj"}), None) if of_token else None
        if complement is not None:
            complement_tokens = {complement.i}
            for child in complement.children:
                if dep(child) in {"amod", "compound", "nummod", "det", "poss", "quantmod"}:
                    complement_tokens |= token_span(sentence, child)
            range_ = token_range(sentence, complement_tokens)
            if range_:
                end_token = sentence[range_[1] - 1]
                span["tokenEnd"] = max(span["tokenEnd"], range_[1])
                span["charEnd"] = max(span["charEnd"], end_token.idx + len(end_token))
                span["text"] = sentence.doc.text[span["charStart"]:span["charEnd"]]
    for match in CONTRACTION_RE.finditer(sentence.text):
        absolute_start = sentence.start_char + match.start()
        absolute_end = sentence.start_char + match.end()
        indices = find_token_ranges(sentence, absolute_start, absolute_end)
        if indices:
            spans.append({
                "kind": "contraction", "text": match.group(0),
                "tokenStart": min(indices) - sentence.start,
                "tokenEnd": max(indices) - sentence.start + 1,
                "charStart": absolute_start, "charEnd": absolute_end, "hard": True,
            })
    for token in sentence:
        if dep(token) != "fixed":
            continue
        indices = token_span(sentence, token.head)
        span = token_range(sentence, indices)
        if span and span[1] - span[0] > 1:
            start = sentence[span[0]].idx
            end = sentence[span[1] - 1].idx + len(sentence[span[1] - 1])
            spans.append({"kind": "dependency-fixed", "text": sentence.doc.text[start:end],
                          "tokenStart": span[0], "tokenEnd": span[1],
                          "charStart": start, "charEnd": end, "hard": True})
    for value in override.get("protectedExpressions", []):
        if not isinstance(value, str) or not value.strip():
            continue
        spans.extend(expression_spans(sentence, [value.strip()], "manual-protected-expression"))
    # Keep the longest interpretation when a generic lexicon entry overlaps a
    # more specific entry; nested hard spans cannot be independently tiled.
    spans.sort(key=lambda span: (span["tokenStart"], -(span["tokenEnd"] - span["tokenStart"]), span["kind"]))
    accepted: list[dict[str, Any]] = []
    occupied: set[int] = set()
    for span in spans:
        positions = set(range(span["tokenStart"], span["tokenEnd"]))
        if positions & occupied:
            continue
        occupied |= positions
        accepted.append(span)
    return accepted


def correlative_constructions(sentence: Any) -> list[dict[str, Any]]:
    tokens = [token.lower_ for token in sentence]
    pairs = [("not only", "but also"), ("either", "or"), ("neither", "nor"), ("no sooner", "than"), ("both", "and")]
    result = []
    for first, second in pairs:
        first_terms, second_terms = first.split(), second.split()
        first_at = next((i for i in range(len(tokens) - len(first_terms) + 1) if tokens[i:i + len(first_terms)] == first_terms), None)
        if first_at is None:
            continue
        if first == "not only":
            # The second pair member often wraps a subject: "but he also ...".
            but_at = next((i for i in range(first_at + len(first_terms), len(tokens)) if tokens[i] == "but"), None)
            also_at = next((i for i in range((but_at or 0) + 1, len(tokens)) if tokens[i] == "also"), None)
            if but_at is None or also_at is None:
                continue
            marker_spans = [[first_at, first_at + len(first_terms)], [but_at, but_at + 1], [also_at, also_at + 1]]
        else:
            second_at = next((i for i in range(first_at + len(first_terms), len(tokens) - len(second_terms) + 1)
                              if tokens[i:i + len(second_terms)] == second_terms), None)
            if second_at is None:
                continue
            marker_spans = [[first_at, first_at + len(first_terms)], [second_at, second_at + len(second_terms)]]
        result.append({"kind": "correlative", "pair": [first, second],
                       "tokenSpans": marker_spans})
    return result


def construction_spans(sentence: Any) -> list[dict[str, Any]]:
    spans = []
    for token in sentence:
        value = dep(token)
        if value in CLAUSE_DEPS and token != sentence.root:
            indices = token_span(sentence, token)
            span = token_range(sentence, indices)
            if not span:
                continue
            start_token, end_token = sentence[span[0]], sentence[span[1] - 1]
            spans.append({"kind": "clause", "relation": value, "head": token.text,
                          "tokenStart": span[0], "tokenEnd": span[1],
                          "charStart": start_token.idx, "charEnd": end_token.idx + len(end_token)})
    return spans


def sentence_spans(doc: Any) -> list[Any]:
    """Keep parser boundaries, and split clearly separate quoted dialogue turns.

    The small English model sometimes treats two quoted turns as one sentence
    when the quote-close and quote-open sit beside terminal punctuation. The
    split below only acts on that unambiguous surface boundary.
    """
    result = []
    closing_quotes = {"”", "’", "»", "\u2019", '"'}
    opening_quotes = {"“", "‘", "«", '"'}
    for parsed in doc.sents:
        tokens = list(parsed)
        start = parsed.start
        index = 0
        while index < len(tokens):
            token = tokens[index]
            if token.text not in {".", "?", "!", "？", "！"}:
                index += 1
                continue
            close = index + 1
            if close < len(tokens) and tokens[close].text in closing_quotes:
                close += 1
            if close >= len(tokens) or tokens[close].text not in opening_quotes:
                index += 1
                continue
            close_token_index = tokens[close - 1].i if close > index + 1 else token.i
            cut = close_token_index + 1
            if cut > start:
                result.append(doc[start:cut])
                start = cut
            index = close
        if start < parsed.end:
            result.append(doc[start:parsed.end])
    return [span for span in result if len(span)]


def annotate_syntax(sentence: Any, text: str) -> dict[str, Any]:
    root = sentence.root
    clauses = construction_spans(sentence)
    subject = next((child for child in root.children if dep(child) in SUBJECT_DEPS), None)
    children = [dep(child) for child in root.children]
    aux_before_subject = bool(subject is not None and (
        any(dep(token) in OPERATOR_DEPS and token.i < subject.i for token in root.children)
        or root.i < subject.i and root.pos_ in {"AUX", "VERB"}
    ))
    question = text.rstrip().endswith(("?", "？"))
    object_child = any(value in OBJECT_DEPS for value in children)
    indirect_child = any(value in INDIRECT_OBJECT_DEPS for value in children)
    complement_child = any(value in {"attr", "acomp", "oprd"} for value in children)
    has_copula = any(value == "cop" for value in children) or root.lemma_.lower() in {"be", "become", "seem", "remain", "appear"}
    pattern = None
    confidence = 0.0
    if subject is not None and len([child for child in root.children if dep(child) in SUBJECT_DEPS]) == 1:
        if indirect_child and object_child:
            pattern, confidence = "SVOO", 0.92
        elif object_child and complement_child:
            pattern, confidence = "SVOC", 0.82
        elif has_copula or complement_child:
            pattern, confidence = "SVC", 0.88
        elif object_child:
            pattern, confidence = "SVO", 0.92
        else:
            pattern, confidence = "SV", 0.86
        if clauses:
            confidence = round(confidence * 0.72, 2)
        if question and aux_before_subject:
            confidence = round(confidence * 0.8, 2)
        if confidence < 0.8:
            pattern = None
    return {
        "surfaceForm": "question" if question else "declarative-or-imperative",
        "isQuestion": question,
        "hasInversion": bool(aux_before_subject),
        "clauses": clauses,
        "fivePattern": {"value": pattern, "confidence": confidence},
    }


def _role_for_top(child: Any) -> tuple[str, str]:
    relation = dep(child)
    if relation in SUBJECT_DEPS:
        return "subject", "subject"
    if relation in OBJECT_DEPS:
        return "object", "object"
    if relation in INDIRECT_OBJECT_DEPS:
        return "indirect_object", "indirect_object"
    if relation in {"ccomp", "xcomp", "advcl", "acl", "acl:relcl", "relcl", "csubj", "csubjpass"}:
        return "clause", "clause"
    if relation in PREP_DEPS:
        return "pp", "pp"
    if relation in {"advmod", "npadvmod"}:
        return "adjunct", "adjunct"
    if relation == "cc":
        return "conjunction", "conjunction"
    if relation == "conj":
        return "coordination", "coordination"
    if relation in {"attr", "acomp", "oprd"}:
        return "complement", "complement"
    if relation == "pobj":
        return "object", "noun-phrase"
    return "phrase", "phrase"


def sentence_local_root(sentence: Any) -> Any:
    root = sentence.root
    if sentence.start <= root.i < sentence.end:
        return root
    local_tokens = list(sentence)
    candidates = [token for token in local_tokens
                  if token.head.i < sentence.start or token.head.i >= sentence.end or token.head == token]
    verbal = [token for token in candidates if token.pos_ in {"VERB", "AUX"}]
    if verbal:
        return max(verbal, key=lambda token: (len(token.subtree), token.i))
    return max(candidates or local_tokens, key=lambda token: (len(token.subtree), token.i))


def structural_owner_kind(token: Any, sentence: Any) -> str:
    relation = dep(token)
    if token == sentence_local_root(sentence):
        return "main-clause"
    if relation in {"acl:relcl", "relcl"}:
        return "relative-clause"
    if relation == "conj" and token.pos_ in {"VERB", "AUX"}:
        return "coordinated-clause"
    if relation in CLAUSE_DEPS or relation == "pcomp" and token.pos_ in {"VERB", "AUX"}:
        return "subordinate-clause"
    return "phrase"


def owner_role_for_child(token: Any) -> tuple[str, str]:
    relation = dep(token)
    if relation in SUBJECT_DEPS:
        return "subject", "noun-phrase"
    if relation in OBJECT_DEPS:
        return "object", "noun-phrase"
    if relation in INDIRECT_OBJECT_DEPS:
        return "indirect_object", "noun-phrase"
    if relation in {"attr", "acomp", "oprd"}:
        return "complement", "complement"
    if relation == "pobj":
        return "object", "noun-phrase"
    if relation in {"advmod", "npadvmod"}:
        return "adjunct", "adjunct"
    if relation == "conj":
        return "coordination", "coordination"
    return _role_for_top(token)[1], "phrase"


def assign_groups(sentence: Any, policy: str, protected: list[dict[str, Any]], quote_state: dict[str, bool] | None = None) -> tuple[list[str], list[dict[str, Any]]]:
    """Assign disjoint constituent owners while preserving clause-parent identity.

    Clause and PP owners receive unique IDs keyed by their dependency head. A
    recursive child pass may replace only tokens in that child's subtree; it
    never changes the parent owner's role record.
    """
    root = sentence_local_root(sentence)
    groups: list[str | None] = [None] * len(sentence)
    roles: dict[str, dict[str, Any]] = {}
    clause_keys: dict[int, str] = {}
    clause_subject_keys: dict[int, str] = {}
    visited_clauses: set[int] = set()
    visited_pps: set[int] = set()
    marker_words = {"after", "although", "as", "before", "because", "if", "once", "since", "that", "though", "unless", "until", "when", "whenever", "whereas", "while", "whether"}

    def local(token: Any) -> int:
        return token.i - sentence.start

    def add_owner(kind: str, head: Any, role: str, relation: str | None = None,
                  parent_kind: str | None = None, parent_head: Any | None = None,
                  suffix: str = "") -> str:
        head_index = local(head)
        key = f"{kind}-{head_index}{suffix}"
        value: dict[str, Any] = {
            "role": role,
            "relation": relation or dep(head),
            "ownerKind": kind,
            "ownerRelation": relation or dep(head),
            "ownerHead": head_index,
        }
        if parent_kind:
            value["ownerParentKind"] = parent_kind
        if parent_head is not None:
            value["ownerParentHead"] = local(parent_head)
        existing = roles.get(key)
        if existing is not None and existing != value:
            raise ValueError(f"conflicting structural owner metadata for {key}")
        roles[key] = value
        return key

    def mark_tokens(tokens: Any, key: str) -> None:
        for token in tokens:
            index = local(token)
            if 0 <= index < len(groups):
                groups[index] = key

    def subtree_tokens(head: Any) -> list[Any]:
        return [token for token in head.subtree if sentence.start <= token.i < sentence.end]

    def is_clause(head: Any) -> bool:
        relation = dep(head)
        if is_clause_dependency(head):
            return True
        return relation == "conj" and head.pos_ in {"VERB", "AUX"}

    def is_pp(head: Any) -> bool:
        relation = dep(head)
        return relation in {"prep", "obl", "agent"} or (relation == "dative" and head.text.lower() == "to")

    def is_marker(token: Any) -> bool:
        relation = dep(token)
        return relation == "mark" or (token.lower_ in marker_words and relation in {"advmod", "npadvmod"})

    def clause_markers(head: Any) -> list[Any]:
        return [child for child in head.children if is_marker(child)]

    def coordinator_for(head: Any) -> Any | None:
        if dep(head) != "conj":
            return None
        parent = head.head
        return next((child for child in parent.children if dep(child) == "cc" and child.i < head.i), None)

    def assign_nested(parent: Any, parent_kind: str, parent_head: Any) -> None:
        for child in sorted(parent.children, key=lambda value: value.i):
            if child.i < sentence.start or child.i >= sentence.end:
                continue
            if dep(child) == "punct":
                continue
            if is_clause(child):
                assign_clause(child, parent_kind, parent_head)
            elif is_pp(child):
                assign_pp(child, parent_kind, parent_head)
            else:
                assign_nested(child, parent_kind, parent_head)

    def assign_pp(head: Any, parent_kind: str, parent_head: Any) -> None:
        if head.i in visited_pps:
            return
        visited_pps.add(head.i)
        key = add_owner("pp", head, "pp", dep(head), parent_kind, parent_head)
        mark_tokens(subtree_tokens(head), key)
        assign_nested(head, "pp", head)

    def assign_atomic_clause(head: Any, parent_kind: str | None = None,
                             parent_head: Any | None = None) -> str:
        kind = structural_owner_kind(head, sentence)
        key = add_owner(kind, head, "clause", dep(head), parent_kind, parent_head)
        clause_keys[head.i] = key
        mark_tokens(subtree_tokens(head), key)
        return key

    def assign_clause(head: Any, parent_kind: str | None = None,
                      parent_head: Any | None = None) -> None:
        if head.i in visited_clauses:
            return
        visited_clauses.add(head.i)
        kind = structural_owner_kind(head, sentence)
        clause_key = add_owner(kind, head, "clause", dep(head), parent_kind, parent_head)
        clause_keys[head.i] = clause_key
        mark_tokens(subtree_tokens(head), clause_key)
        children = sorted((child for child in head.children if dep(child) != "punct"), key=lambda value: value.i)
        subjects = [child for child in children if dep(child) in SUBJECT_DEPS]
        markers = clause_markers(head)
        coordinator = coordinator_for(head)

        # Clause markers stay with the first core constituent; they are not standalone tiles.
        subject_key: str | None = None
        if subjects:
            subject = subjects[0]
            if markers:
                subject_key = add_owner(kind, head, "subject", dep(head), parent_kind, parent_head, "-core")
                mark_tokens(markers, subject_key)
                mark_tokens(subtree_tokens(subject), subject_key)
            elif kind == "coordinated-clause" and coordinator is not None:
                subject_key = add_owner(kind, head, "subject", dep(head), parent_kind, parent_head, "-core")
                mark_tokens(subtree_tokens(subject), subject_key)
                groups[local(coordinator)] = subject_key
            else:
                subject_key = add_owner("noun-phrase", subject, "subject", dep(subject), kind, head)
                mark_tokens(subtree_tokens(subject), subject_key)
            clause_subject_keys[head.i] = subject_key

        # A short copular relative core ("who are eager") remains one productive
        # predicate unit; its infinitival complement is handled as
        # a nested clause below.
        copular_complements = [child for child in children if dep(child) in {"attr", "acomp", "oprd"}]
        relative_copular_core = (kind == "relative-clause" and head.pos_ == "AUX" and bool(subjects)
                                 and bool(copular_complements))
        if relative_copular_core:
            core = add_owner(kind, head, "clause", dep(head), parent_kind, parent_head, "-copular-core")
            mark_tokens(subtree_tokens(subjects[0]), core)
            groups[local(head)] = core
            for child in head.children:
                if dep(child) in OPERATOR_DEPS or dep(child) == "expl":
                    mark_tokens(subtree_tokens(child), core)
            for child in copular_complements:
                mark_tokens(subtree_tokens(child), core)
            clause_subject_keys[head.i] = core

        # Auxiliaries, modals, negation and particles stay with the lexical predicate core.
        predicate = add_owner("predicate", head, "predicate", dep(head), kind, head)
        if not relative_copular_core:
            groups[local(head)] = predicate
        for child in children:
            relation = dep(child)
            if relation in OPERATOR_DEPS or relation == "expl":
                if relative_copular_core:
                    continue
                mark_tokens(subtree_tokens(child), predicate)

        for child in children:
            relation = dep(child)
            if relation in OPERATOR_DEPS or relation == "expl" or relation in SUBJECT_DEPS or is_marker(child):
                continue
            if relative_copular_core and child in copular_complements:
                assign_nested(child, kind, head)
                continue
            if relation == "cc":
                # This is a coordinator between this clause and a later verbal
                # conjunct. assign_clause() on that child owns the marker.
                following = next((candidate for candidate in head.children
                                  if candidate.i > child.i and dep(candidate) == "conj" and candidate.pos_ in {"VERB", "AUX"}), None)
                if following is not None:
                    groups[local(child)] = clause_subject_keys.get(following.i, clause_keys.get(following.i, clause_key))
                continue
            if is_clause(child):
                nested_key = assign_atomic_clause(child, kind, head)
                visited_clauses.discard(child.i)
                assign_clause(child, kind, head)
                continue
            if is_pp(child):
                assign_pp(child, kind, head)
                continue
            role, child_kind = owner_role_for_child(child)
            child_key = add_owner(child_kind, child, role, dep(child), kind, head)
            mark_tokens(subtree_tokens(child), child_key)
            assign_nested(child, child_kind, child)

        # Copular core complements and their xcomp/ccomp descendants are
        # recursively decomposed without overwriting the relative core itself.
        if relative_copular_core:
            for child in copular_complements:
                assign_nested(child, kind, head)
        if kind == "coordinated-clause" and coordinator is not None and not subjects:
            groups[local(coordinator)] = clause_key

    assign_clause(root)
    # Handle non-clausal parent tokens that can own postmodifying PPs or
    # clauses (for example for + NP + relative clause).
    assign_nested(root, "main-clause", root)

    # Conjunction markers can be attached to a verbal conjunct whose head is a
    # sibling of the coordinator in spaCy's dependency tree.
    for token in sentence:
        if dep(token) != "conj" or token.pos_ not in {"VERB", "AUX"}:
            continue
        coordinator = coordinator_for(token)
        if coordinator is None:
            continue
        if token.i in clause_subject_keys:
            groups[local(coordinator)] = clause_subject_keys[token.i]

    # Preserve non-verbal coordination boundaries inside complements and noun
    # phrases. The coordinator opens the later member; nested PPs, clauses,
    # operators, and hard expressions keep their more specific owners.
    phrase_coordinations: dict[int, list[tuple[Any, Any]]] = {}
    for token in sentence:
        if dep(token) != "conj" or is_clause(token):
            continue
        coordinator = coordinator_for(token)
        if coordinator is None:
            continue
        owner = token
        while dep(owner) == "conj" and not is_clause(owner):
            owner = owner.head
        phrase_coordinations.setdefault(owner.i, []).append((coordinator, token))

    protected_owner_kinds = {
        "pp", "main-clause", "coordinated-clause", "subordinate-clause",
        "relative-clause", "protected-expression", "operator", "predicate",
    }
    for owner_index, members in phrase_coordinations.items():
        owner = sentence[owner_index - sentence.start]
        span_tokens = subtree_tokens(owner)
        if not span_tokens:
            continue
        span_start = min(local(token) for token in span_tokens)
        span_end = max(local(token) for token in span_tokens) + 1
        boundaries = sorted({(local(coordinator), conjunct) for coordinator, conjunct in members}, key=lambda value: value[0])
        boundaries = [(index, conjunct) for index, conjunct in boundaries if span_start < index < span_end]
        if not boundaries:
            continue
        part_starts = [span_start, *[index for index, _ in boundaries]]
        part_ends = [*[index for index, _ in boundaries], span_end]
        first_key = groups[local(owner)]
        first_metadata = roles.get(first_key or "", {})
        for part_index, (start, end) in enumerate(zip(part_starts, part_ends)):
            part_head = owner if part_index == 0 else next(
                conjunct for boundary, conjunct in boundaries if boundary == start
            )
            part_kind = "coordination"
            part_role = first_metadata.get("role", "coordination") if part_index == 0 else "coordination"
            part_relation = dep(part_head)
            part_key = f"coordination-{local(owner)}-{part_index}"
            part_metadata: dict[str, Any] = {
                "role": part_role,
                "relation": part_relation,
                "ownerKind": part_kind,
                "ownerRelation": part_relation,
                "ownerHead": local(part_head),
            }
            if part_index == 0:
                if first_metadata.get("ownerParentKind"):
                    part_metadata["ownerParentKind"] = first_metadata["ownerParentKind"]
                    part_metadata["ownerParentHead"] = first_metadata.get("ownerParentHead")
            else:
                part_metadata["ownerParentKind"] = "coordination"
                part_metadata["ownerParentHead"] = local(owner)
            roles[part_key] = part_metadata
            for index in range(start, end):
                current = roles.get(groups[index] or "", {})
                if current.get("ownerKind") not in protected_owner_kinds:
                    groups[index] = part_key

    # Hard lexical cores take final precedence. Their spans are bounded by the
    # curated construction and minimum required complement only.
    for span in protected:
        key = add_owner("protected-expression", sentence[span["tokenStart"]], "phrase", span["kind"], suffix=f"-{span['tokenStart']}-{span['tokenEnd']}")
        for index in range(span["tokenStart"], span["tokenEnd"]):
            groups[index] = key

    # Punctuation belongs to an adjacent owner, never to a punctuation-only
    # tile. Quotes retain the cross-sentence opening/closing state.
    quote_open = {"\"": bool((quote_state or {}).get("double", False)), "'": bool((quote_state or {}).get("single", False))}
    for index, token in enumerate(sentence):
        if not (token.is_punct or token.pos_ == "PUNCT"):
            continue
        is_opening = token.text in OPENING_PUNCT
        if token.text in quote_open:
            is_opening = not quote_open[token.text]
            quote_open[token.text] = is_opening
        if token.text in {"”", "’", "»", "\u2019"}:
            is_opening = False
        if token.text in {"“", "‘", "«"}:
            is_opening = True
        if is_opening:
            target = next((j for j in range(index + 1, len(sentence)) if groups[j] is not None), None)
            if target is None:
                target = next((j for j in range(index - 1, -1, -1) if groups[j] is not None), None)
        else:
            target = next((j for j in range(index - 1, -1, -1) if groups[j] is not None), None)
            if target is None:
                target = next((j for j in range(index + 1, len(sentence)) if groups[j] is not None), None)
        if target is not None:
            groups[index] = groups[target]

    for index, value in enumerate(groups):
        if value is None:
            target = next((j for j in range(index - 1, -1, -1) if groups[j] is not None), None)
            if target is None:
                target = next((j for j in range(index + 1, len(groups)) if groups[j] is not None), None)
            groups[index] = groups[target] if target is not None else "whole-sentence"
            roles.setdefault(groups[index], {"role": "phrase", "relation": "fallback-attachment",
                                               "ownerKind": "phrase", "ownerRelation": "fallback-attachment",
                                               "ownerHead": index})

    # Keep every structural group contiguous. Fill only empty gaps; never let a
    # later nested owner overwrite the parent's metadata or another child.
    positions: dict[str, list[int]] = {}
    for index, key in enumerate(groups):
        if key is not None:
            positions.setdefault(key, []).append(index)
    for key, indices in positions.items():
        for index in range(indices[0], indices[-1] + 1):
            if groups[index] is None:
                groups[index] = key

    # Suppress standalone function-word groups before enforcing the tile cap.
    # Attach coordinators/markers/determiners forward; attach auxiliaries,
    # negation and infinitival markers to their syntactic head when possible.
    # This changes only ownership of the function token, never lexical order.
    function_pos = {"DET", "ADP", "AUX", "CCONJ", "SCONJ", "PART"}
    function_deps = {"cc", "mark", "det", "case", "aux", "aux:pass", "auxpass", "neg"}
    forward_deps = {"cc", "mark", "det", "case"}

    def lexical_tokens_in(start: int, end: int) -> list[Any]:
        return [sentence[index] for index in range(start, end) if lexical_token(sentence[index])]

    changed = True
    while changed:
        changed = False
        ranges = ranges_from_groups([str(value) for value in groups])
        for range_index, (start, end, key) in enumerate(ranges):
            lexical = lexical_tokens_in(start, end)
            if len(lexical) != 1:
                continue
            token = lexical[0]
            relation = dep(token)
            if token.pos_ not in function_pos and relation not in function_deps:
                continue

            target_key: str | None = None
            head_index = local(token.head)
            if token.head != token and 0 <= head_index < len(groups):
                head_key = groups[head_index]
                if head_key != key and relation not in forward_deps:
                    target_key = head_key

            previous_key = ranges[range_index - 1][2] if range_index > 0 else None
            next_key = ranges[range_index + 1][2] if range_index + 1 < len(ranges) else None
            if target_key is None:
                if relation in forward_deps or token.pos_ in {"DET", "CCONJ", "SCONJ"}:
                    target_key = next_key or previous_key
                elif relation in {"aux", "aux:pass", "auxpass", "neg"} or token.pos_ in {"AUX", "PART"}:
                    target_key = next_key or previous_key
                else:
                    target_key = next_key or previous_key

            if target_key is None or target_key == key:
                continue
            # A hard-protected core can absorb its own adjacent function marker,
            # but never reassign tokens from inside one hard span to another owner.
            if any(span.get("hard") and start < span["tokenEnd"] and end > span["tokenStart"]
                   and not (span["tokenStart"] <= start and end <= span["tokenEnd"])
                   for span in protected):
                continue
            for index in range(start, end):
                groups[index] = target_key
            changed = True
            break

    # Tile-count bounds are met only by undoing low-priority structural splits.
    # The removed boundary is recorded as a composite child of the smallest
    # common dependency ancestor; words are never merged by lexical count.
    merge_rank = {
        "operator": 0, "conjunction": 0, "adjunct": 1, "phrase": 1,
        "protected-expression": 1, "noun-phrase": 2, "complement": 2,
        "structural-composite": 100, "predicate": 4, "subordinate-clause": 5,
        "relative-clause": 6, "pp": 6, "coordination": 7,
        "coordinated-clause": 8, "main-clause": 9,
    }

    def common_head(left_key: str, right_key: str) -> Any:
        left = roles.get(left_key, {}).get("ownerHead", 0)
        right = roles.get(right_key, {}).get("ownerHead", 0)
        left_token = sentence[int(left)]
        right_token = sentence[int(right)]
        ancestors = []
        current = left_token
        while True:
            ancestors.append(current)
            if current.head == current:
                break
            current = current.head
        right_ancestors = {token.i for token in [right_token]}
        current = right_token
        while True:
            right_ancestors.add(current.i)
            if current.head == current:
                break
            current = current.head
        return next((token for token in ancestors if token.i in right_ancestors), root)

    maximum = SHARED_MAX_TILES
    while len(ranges_from_groups([str(value) for value in groups])) > maximum:
        ranges = ranges_from_groups([str(value) for value in groups])
        candidates = []
        for boundary_index, (left, right) in enumerate(zip(ranges, ranges[1:])):
            left_role = roles.get(left[2], {})
            right_role = roles.get(right[2], {})
            # Never collapse a coordinated independent-clause boundary just to hit the target.
            if "coordinated-clause" in {left_role.get("ownerKind"), right_role.get("ownerKind")}:
                continue
            score = max(merge_rank.get(left_role.get("ownerKind", "phrase"), 1),
                        merge_rank.get(right_role.get("ownerKind", "phrase"), 1))
            candidates.append((score, boundary_index, left_role, right_role))
        if not candidates:
            break
        _, boundary_index, left_role, right_role = min(candidates, key=lambda item: (item[0], item[1]))
        left, right = ranges[boundary_index], ranges[boundary_index + 1]
        ancestor = common_head(left[2], right[2])
        ancestor_kind = structural_owner_kind(ancestor, sentence)
        merged_key = f"structural-composite-{local(ancestor)}-{left[0]}-{right[1]}"
        roles[merged_key] = {
            "role": "phrase", "relation": dep(ancestor) if ancestor != root else "ROOT",
            "ownerKind": "structural-composite", "ownerRelation": dep(ancestor) if ancestor != root else "ROOT",
            "ownerHead": local(ancestor), "ownerParentKind": ancestor_kind,
            "ownerParentHead": local(ancestor),
            "ownerMemberKinds": sorted({str(left_role.get("ownerKind", "phrase")),
                                         str(right_role.get("ownerKind", "phrase"))}),
        }
        for index in range(left[0], right[1]):
            groups[index] = merged_key
    return [str(value) for value in groups], [{"id": key, **value} for key, value in roles.items()]

def ranges_from_groups(groups: list[str]) -> list[tuple[int, int, str]]:
    result = []
    start = 0
    current = groups[0] if groups else ""
    for index in range(1, len(groups) + 1):
        value = groups[index] if index < len(groups) else None
        if value != current:
            result.append((start, index, current))
            start, current = index, value
    return result


def apply_manual_ranges(sentence: Any, specification: list[list[int]]) -> list[tuple[int, int, str]]:
    cursor = 0
    ranges = []
    for index, pair in enumerate(specification):
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError(f"manual range must be [start,end): {pair!r}")
        start, end = pair
        if not isinstance(start, int) or not isinstance(end, int) or start != cursor or end <= start or end > len(sentence):
            raise ValueError(f"manual chunk ranges must partition sentence tokens in source order: {specification!r}")
        ranges.append((start, end, f"manual-shared-{index}"))
        cursor = end
    if cursor != len(sentence):
        raise ValueError("manual chunk ranges do not cover every sentence token")
    return ranges


def build_partition(sentence: Any, source: str, groups: list[str], roles: list[dict[str, Any]],
                    protected: list[dict[str, Any]], manual: dict[str, Any]) -> dict[str, Any] | None:
    ranges = apply_manual_ranges(sentence, manual["manualChunks"]) if manual.get("manualChunks") else ranges_from_groups(groups)
    if len(ranges) < SHARED_MIN_TILES:
        return None
    role_map = {role["id"]: role for role in roles}
    manual_roles = manual.get("manualRoles", [])
    chunks = []
    for chunk_index, (range_start, range_end, group_id) in enumerate(ranges):
        contained = list(sentence)[range_start:range_end]
        lexical = [token for token in contained if lexical_token(token)]
        if not lexical:
            return None
        char_start, char_end = contained[0].idx, contained[-1].idx + len(contained[-1])
        value = source[char_start:char_end]
        if not value.strip():
            return None
        role = role_map.get(group_id, {"role": "phrase", "relation": "manual"})
        if chunk_index < len(manual_roles):
            manual_role = manual_roles[chunk_index]
            if isinstance(manual_role, str):
                role = {**role, "role": manual_role, "relation": "manual-override"}
            elif isinstance(manual_role, dict) and manual_role.get("role"):
                role = {**role, "role": str(manual_role["role"]),
                        "relation": str(manual_role.get("relation", "manual-override"))}
        if not role.get("ownerKind"):
            contained_indices = {token.i for token in contained}
            roots = [token for token in contained if token.head.i not in contained_indices]
            role_name = role.get("role", "phrase")
            compatible = {
                "subject": {"NOUN", "PROPN", "PRON"}, "object": {"NOUN", "PROPN", "PRON"},
                "indirect_object": {"NOUN", "PROPN", "PRON"}, "predicate": {"VERB", "AUX"},
                "clause": {"VERB", "AUX"}, "pp": {"ADP"}, "operator": {"AUX", "PART"},
            }.get(role_name, set())
            head = next((token for token in roots if not compatible or token.pos_ in compatible), None)
            if head is None:
                head = next((token for token in contained if not token.is_punct), contained[0])
            owner_kind = {
                "subject": "noun-phrase", "object": "noun-phrase", "indirect_object": "noun-phrase",
                "predicate": "predicate", "operator": "operator", "pp": "pp",
                "clause": structural_owner_kind(head, sentence), "conjunction": "coordinated-clause",
            }.get(role_name, "phrase")
            role = {**role, "ownerKind": owner_kind, "ownerRelation": dep(head),
                    "ownerHead": head.i - sentence.start}
        label = role.get("role", "phrase")
        chunk_id = f"s{sentence.start_char}-c{chunk_index}"
        protections = [span["kind"] for span in protected if span["tokenStart"] >= range_start and span["tokenEnd"] <= range_end]
        chunk = {
            "id": chunk_id, "text": value, "tokenStart": range_start, "tokenEnd": range_end,
            "charStart": char_start, "charEnd": char_end,
            "role": label, "label": ROLE_LABELS.get(label, ROLE_LABELS["phrase"]),
            "dependency": role.get("relation", "manual"),
            "ownerKind": role["ownerKind"], "ownerRelation": role["ownerRelation"],
            "ownerHead": role["ownerHead"],
            "protectedConstructions": protections,
        }
        if role.get("ownerParentKind"):
            chunk["ownerParentKind"] = role["ownerParentKind"]
        if isinstance(role.get("ownerParentHead"), int):
            chunk["ownerParentHead"] = role["ownerParentHead"]
        chunks.append(chunk)
    for index, chunk in enumerate(chunks[:-1]):
        chunk["separatorAfter"] = source[chunk["charEnd"]:chunks[index + 1]["charStart"]]
    if chunks:
        chunks[-1]["separatorAfter"] = source[chunks[-1]["charEnd"]:sentence.end_char]
    canonical = "".join(chunk["text"] + chunk["separatorAfter"] for chunk in chunks)
    sentence_text = source[sentence.start_char:sentence.end_char]
    if canonical != sentence_text:
        return None
    canonical_order = [chunk["id"] for chunk in chunks]
    accepted = [canonical_order]
    for order in manual.get("acceptedOrders", []):
        if isinstance(order, list) and order not in accepted:
            accepted.append(order)
    if any(len(order) != len(chunks) or set(order) != set(canonical_order) for order in accepted):
        raise ValueError("invalid acceptedOrders in manual shared partition")
    return {
        "chunks": chunks,
        "canonicalOrder": canonical_order,
        "acceptedOrders": accepted,
        "canonicalReconstruction": canonical,
    }


def quote_state_before(source: str, char_index: int) -> dict[str, bool]:
    prefix = source[:char_index]
    return {"double": prefix.count('"') % 2 == 1, "single": False}


def sentence_metadata(sentence: Any, source: str, item_override: dict[str, Any], sentence_index: int,
                      quote_state: dict[str, bool] | None = None) -> dict[str, Any]:
    override = item_override.get("sentences", {}).get(str(sentence_index), {})
    text = source[sentence.start_char:sentence.end_char]
    protected = protected_constructions(sentence, override)
    parsed = [{"i": token.i - sentence.start, "text": token.text, "lemma": token.lemma_,
               "pos": token.pos_, "tag": token.tag_, "dep": dep(token),
               "head": token.head.i - sentence.start, "start": token.idx,
               "end": token.idx + len(token), "isPunct": bool(token.is_punct)} for token in sentence]
    syntax = annotate_syntax(sentence, text)
    construction_tags = correlative_constructions(sentence)
    for token in sentence:
        if dep(token) not in {"prt", "compound:prt"}:
            continue
        construction_tags.append({
            "kind": "separable-phrasal-verb", "verbLemma": token.head.lemma_.lower(),
            "particle": token.text,
            "tokenSpan": [min(token.i, token.head.i) - sentence.start, max(token.i, token.head.i) - sentence.start + 1],
            "particleToken": token.i - sentence.start, "maySeparate": True,
        })
    construction_tags += [{"kind": span["kind"], "text": span["text"],
                           "tokenSpan": [span["tokenStart"], span["tokenEnd"]], "hard": True}
                          for span in protected]
    entry: dict[str, Any] = {
        "sentenceIndex": sentence_index, "text": text,
        "charStart": sentence.start_char, "charEnd": sentence.end_char,
        "tokenStart": sentence.start, "tokenEnd": sentence.end,
        "tokens": parsed, "syntax": syntax, "constructions": construction_tags,
        "protectedConstructions": protected,
        "fixedContext": bool(override.get("fixedContext")),
        "fixedContextReason": str(override.get("fixedContextReason", "")) or None,
        "excludedReason": str(override.get("excludeReason", "")) or None,
        "manualOverrideApplied": bool(override.get("manualChunks") or override.get("fixedContext")
                                      or override.get("excludeReason") or override.get("protectedExpressions")
                                      or override.get("acceptedOrders")),
        "chunks": [], "canonicalOrder": [], "acceptedOrders": [], "canonicalReconstruction": None,
    }
    if entry["fixedContext"] or entry["excludedReason"]:
        return entry
    lexical_count = sum(1 for token in sentence if lexical_token(token))
    if lexical_count < 2:
        entry["fixedContext"] = True
        entry["fixedContextReason"] = "one-word-fragment"
        return entry
    groups, roles = assign_groups(sentence, "shared", protected, quote_state)
    partition = build_partition(sentence, source, groups, roles, protected, override)
    if partition is None:
        if len(ranges_from_groups(groups)) <= 1:
            entry["fixedContext"] = True
            entry["fixedContextReason"] = "single-constituent-fragment"
        else:
            entry["excludedReason"] = "no-validated-shared-partition"
        return entry
    entry.update(partition)
    return entry


def classify_item(sentences: list[dict[str, Any]]) -> tuple[str, str | None]:
    if not sentences:
        return "excluded", "sentence-segmentation-empty"
    if any(sentence.get("excludedReason") for sentence in sentences):
        return "excluded", "one-or-more-sentences-excluded"
    if any(sentence.get("chunks") for sentence in sentences):
        return "playable", None
    return "fixed-context", "all-sentences-fixed-context"


def validate_generated_dataset(source_items: list[dict[str, Any]], metadata: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    sources = {str(item["id"]): item for item in source_items}
    generated = {str(item["itemId"]): item for item in metadata.get("items", [])}
    if len(source_items) != 560 or len(generated) != 560 or set(sources) != set(generated):
        errors.append("source/metadata item coverage must be exactly 560 unique IDs")
    if metadata.get("schemaVersion") != SCHEMA_VERSION or metadata.get("partitionPolicy", {}).get("kind") != "shared":
        errors.append("shared partition schema/policy mismatch")
    if metadata.get("source", {}).get("sha256") != sha256(json.dumps(source_items, ensure_ascii=False, separators=(",", ":"))):
        errors.append("metadata source hash does not match the current item corpus")
    for item_id, source_item in sources.items():
        item = generated.get(item_id)
        if item is None:
            continue
        source = str(source_item.get("en", ""))
        if item.get("sourceHash") != sha256(source):
            errors.append(f"{item_id}: stale sourceHash")
        sentences = item.get("sentences", [])
        if not sentences or item.get("sentenceCount") != len(sentences):
            errors.append(f"{item_id}: invalid sentence coverage")
            continue
        spans: list[tuple[int, int]] = []
        for sentence in sentences:
            context = f"{item_id}/s{sentence.get('sentenceIndex')}"
            start_char, end_char = sentence.get("charStart"), sentence.get("charEnd")
            if not isinstance(start_char, int) or not isinstance(end_char, int) or start_char < 0 or end_char <= start_char or end_char > len(source):
                errors.append(f"{context}: invalid source character span")
                continue
            spans.append((start_char, end_char))
            if sentence.get("text") != source[start_char:end_char]:
                errors.append(f"{context}: sentence text does not match source span")
            tokens = sentence.get("tokens", [])
            if not tokens or any(token.get("i") != index for index, token in enumerate(tokens)):
                errors.append(f"{context}: invalid token sequence")
            for token in tokens:
                token_start, token_end = token.get("start"), token.get("end")
                if not isinstance(token_start, int) or not isinstance(token_end, int) or token_start < start_char or token_end <= token_start or token_end > end_char or source[token_start:token_end] != token.get("text"):
                    errors.append(f"{context}: token span does not match the source")
                    break
            chunks = sentence.get("chunks", [])
            if sentence.get("fixedContext") or sentence.get("excludedReason"):
                if chunks:
                    errors.append(f"{context}: fixed/excluded sentence has sortable chunks")
                continue
            if len(chunks) < SHARED_MIN_TILES:
                errors.append(f"{context}: playable sentence has fewer than two chunks")
                continue
            ids = [chunk.get("id") for chunk in chunks]
            if len(ids) != len(set(ids)) or sentence.get("canonicalOrder") != ids:
                errors.append(f"{context}: invalid unique canonical chunk IDs")
            accepted = sentence.get("acceptedOrders", [])
            if sentence.get("canonicalOrder") not in accepted or any(
                not isinstance(order, list) or len(order) != len(ids) or len(set(order)) != len(ids) or set(order) != set(ids)
                for order in accepted
            ):
                errors.append(f"{context}: invalid acceptedOrders")
            cursor = 0
            reconstruction = ""
            for chunk in chunks:
                if chunk.get("tokenStart") != cursor or not isinstance(chunk.get("tokenEnd"), int) or chunk["tokenEnd"] <= cursor:
                    errors.append(f"{context}: token loss, duplication, or overlap")
                    break
                cursor = chunk["tokenEnd"]
                if chunk.get("charStart", -1) < start_char or chunk.get("charEnd", 0) > end_char or chunk.get("charEnd", 0) <= chunk.get("charStart", -1):
                    errors.append(f"{context}: cross-sentence chunk span")
                    break
                if source[chunk["charStart"]:chunk["charEnd"]] != chunk.get("text"):
                    errors.append(f"{context}: chunk text/span mismatch")
                if all(token.get("isPunct") for token in tokens[chunk["tokenStart"]:chunk["tokenEnd"]]):
                    errors.append(f"{context}: punctuation-only chunk")
                reconstruction += chunk.get("text", "") + chunk.get("separatorAfter", "")
            if cursor != len(tokens):
                errors.append(f"{context}: chunk spans do not cover all sentence tokens")
            if reconstruction != sentence["text"] or sentence.get("canonicalReconstruction") != sentence["text"]:
                errors.append(f"{context}: canonical reconstruction mismatch")
            for protected_span in sentence.get("protectedConstructions", []):
                if protected_span.get("hard") and sum(chunk.get("tokenStart", 0) <= protected_span["tokenStart"]
                                                       and chunk.get("tokenEnd", 0) >= protected_span["tokenEnd"]
                                                       for chunk in chunks) != 1:
                    errors.append(f"{context}: hard protected expression was split")
        spans.sort()
        if any(spans[index][0] < spans[index - 1][1] for index in range(1, len(spans))):
            errors.append(f"{item_id}: sentence spans overlap")
        covered = bytearray(len(source))
        for start_char, end_char in spans:
            for index in range(start_char, end_char):
                covered[index] = 1
        if any(not char.isspace() and not covered[index] for index, char in enumerate(source)):
            errors.append(f"{item_id}: source text falls outside sentence boundaries")
        expected_status, expected_reason = classify_item(sentences)
        if item.get("status") != expected_status or item.get("classificationReason") != expected_reason:
            errors.append(f"{item_id}: unsafe item classification")
    return errors


def chunk_quality_metrics(metadata: dict[str, Any]) -> dict[str, Any]:
    function_pos = {"DET", "ADP", "AUX", "CCONJ", "SCONJ", "PART"}
    function_deps = {"cc", "mark", "det", "case", "aux", "aux:pass", "auxpass", "neg"}
    distribution = Counter({"1": 0, "2-3": 0, "4-5": 0, "6-8": 0, ">8": 0})
    long_chunks = 0
    misowned_roles = 0
    protected_overreach = 0
    standalone_function_words: list[dict[str, Any]] = []
    over_eight: list[dict[str, Any]] = []
    max_chunk_count = 0
    for item in metadata.get("items", []):
        for sentence in item.get("sentences", []):
            chunks = sentence.get("chunks", [])
            if not chunks:
                continue
            count = len(chunks)
            max_chunk_count = max(max_chunk_count, count)
            bucket = "1" if count == 1 else "2-3" if count <= 3 else "4-5" if count <= 5 else "6-8" if count <= 8 else ">8"
            distribution[bucket] += 1
            if count > SHARED_MAX_TILES:
                over_eight.append({"itemId": item["itemId"], "sentenceIndex": sentence["sentenceIndex"], "tileCount": count})
            tokens = sentence.get("tokens", [])
            for protected in sentence.get("protectedConstructions", []):
                if not protected.get("hard"):
                    continue
                selected = set(range(max(0, protected.get("tokenStart", 0)), min(len(tokens), protected.get("tokenEnd", 0))))
                if any(tokens[index].get("head") in selected and tokens[index].get("dep") in CLAUSE_DEPS for index in selected):
                    protected_overreach += 1
            for chunk in chunks:
                lexical = [token for token in tokens[chunk["tokenStart"]:chunk["tokenEnd"]]
                           if not token.get("isPunct") and token.get("pos") not in {"PUNCT", "SYM"}]
                if len(lexical) >= 8:
                    long_chunks += 1
                if len(lexical) == 1 and (lexical[0].get("pos") in function_pos
                                           or lexical[0].get("dep") in function_deps):
                    standalone_function_words.append({"itemId": item["itemId"], "sentenceIndex": sentence["sentenceIndex"],
                                                      "text": chunk.get("text"), "token": lexical[0].get("text"),
                                                      "pos": lexical[0].get("pos"), "dep": lexical[0].get("dep")})
                kind, relation, head = chunk.get("ownerKind"), chunk.get("ownerRelation"), chunk.get("ownerHead")
                if not isinstance(kind, str) or not kind or not isinstance(relation, str) or not relation \
                        or not isinstance(head, int) or not 0 <= head < len(tokens):
                    misowned_roles += 1
                elif chunk.get("role") == "pp" and kind != "pp":
                    misowned_roles += 1
                elif kind == "pp" and chunk.get("role") != "pp":
                    misowned_roles += 1
                elif kind == "pp" and relation.lower() not in {"prep", "obl", "agent", "dative"}:
                    misowned_roles += 1
                elif kind != "protected-expression" and relation.lower() != str(tokens[head].get("dep", "")).lower():
                    misowned_roles += 1
    return {
        "tileCountDistribution": dict(distribution),
        "maxTileCount": max_chunk_count,
        "overEightCount": len(over_eight),
        "overEight": over_eight,
        "longChunkCount": long_chunks,
        "standaloneFunctionWordChunkCount": len(standalone_function_words),
        "standaloneFunctionWordChunks": standalone_function_words[:50],
        "misownedRoleCount": misowned_roles,
        "protectedOverreachCount": protected_overreach,
    }


def main() -> None:
    if spacy.__version__ != "3.8.16":
        raise SystemExit(f"expected spaCy 3.8.16, found {spacy.__version__}")
    nlp = spacy.load("en_core_web_sm")
    model_version = str(nlp.meta.get("version", "unknown"))
    if model_version != "3.8.0":
        raise SystemExit(f"expected en_core_web_sm 3.8.0, found {model_version}")
    items = read_json(ITEMS_PATH, [])
    overrides = read_json(OVERRIDES_PATH, {"schemaVersion": 2, "items": {}})
    override_items = overrides.get("items", {})
    if overrides.get("schemaVersion") != 2:
        raise SystemExit("reorder override schemaVersion 2 required")
    if not isinstance(items, list) or len(items) != 560:
        raise SystemExit(f"expected 560 source items, found {len(items) if isinstance(items, list) else 'invalid'}")
    output_items = []
    reason_counts: Counter[str] = Counter()
    sentence_count = playable_sentences = fixed_sentences = excluded_sentences = 0
    manual_override_count = protected_count = review_required = 0
    fixed_context_details: list[dict[str, Any]] = []
    for item in items:
        item_id = str(item.get("id", ""))
        source = str(item.get("en", ""))
        if not item_id or not source:
            raise SystemExit("every source record must have id and en")
        item_override = override_items.get(item_id, {})
        if item_override.get("sourceHash") and item_override["sourceHash"] != sha256(source):
            raise SystemExit(f"stale manual override sourceHash: {item_id}")
        doc = nlp(source)
        parsed_sentences = sentence_spans(doc)
        sentences = [sentence_metadata(sentence, source, item_override, index,
                                       quote_state_before(source, sentence.start_char))
                     for index, sentence in enumerate(parsed_sentences)]
        status, reason = classify_item(sentences)
        output_items.append({"itemId": item_id, "sourceHash": sha256(source), "status": status,
                             "classificationReason": reason, "sentenceCount": len(sentences), "sentences": sentences})
        sentence_count += len(sentences)
        for sentence in sentences:
            protected_count += len(sentence["protectedConstructions"])
            if sentence.get("manualOverrideApplied"):
                manual_override_count += 1
            if sentence["fixedContext"]:
                fixed_sentences += 1
                fixed_context_details.append({
                    "itemId": item_id,
                    "sentenceIndex": sentence["sentenceIndex"],
                    "text": sentence["text"],
                    "reason": sentence.get("fixedContextReason"),
                    "manual": bool(sentence.get("manualOverrideApplied")),
                })
            elif sentence["excludedReason"]:
                excluded_sentences += 1
                review_required += 1
                reason_counts[sentence["excludedReason"]] += 1
            else:
                playable_sentences += 1
        if reason:
            reason_counts[reason] += 1
    if len({item["itemId"] for item in output_items}) != 560:
        raise SystemExit("duplicate item id in generation output")
    metadata = {
        "schemaVersion": SCHEMA_VERSION,
        "source": {"path": "data/items.json", "itemCount": len(items),
                   "sha256": sha256(json.dumps(items, ensure_ascii=False, separators=(",", ":")))},
        "parser": {"engine": "spaCy", "version": spacy.__version__, "model": "en_core_web_sm",
                   "modelVersion": model_version, "policyVersion": POLICY_VERSION},
        "partitionPolicy": {"kind": "shared", "minTiles": SHARED_MIN_TILES, "targetMaxTiles": SHARED_MAX_TILES,
                            "levelInvariant": True, "asrReusable": True},
        "items": output_items,
    }
    report = {
        "schemaVersion": SCHEMA_VERSION, "parser": metadata["parser"],
        "partitionPolicy": metadata["partitionPolicy"],
        "itemCount": len(output_items), "itemClassification": dict(Counter(item["status"] for item in output_items)),
        "sentenceCount": sentence_count, "playableSentenceCount": playable_sentences,
        "fixedContextSentenceCount": fixed_sentences, "fixedContextDetails": fixed_context_details,
        "excludedSentenceCount": excluded_sentences,
        "sharedPartitionCount": playable_sentences, "reviewRequiredCount": review_required,
        "excludedReasons": dict(reason_counts), "manualOverrideCount": manual_override_count,
        "protectedConstructionCount": protected_count, "crossSentenceViolationCount": 0,
        "reconstructionViolationCount": 0,
        "manualOverrideMigration": {
            "removedLegacyTierOnlyItems": LEGACY_TIER_ONLY_OVERRIDE_IDS,
            "remainingManualChunkOverrideCount": sum(1 for item in override_items.values()
                for sentence in item.get("sentences", {}).values() if sentence.get("manualChunks")),
        },
    }
    report["chunkQuality"] = chunk_quality_metrics(metadata)
    validation_errors = validate_generated_dataset(items, metadata)
    if validation_errors:
        raise SystemExit("generated reorder data failed corpus validation:\n" + "\n".join(validation_errors[:80]))
    if report["chunkQuality"]["misownedRoleCount"] or report["chunkQuality"]["protectedOverreachCount"]:
        raise SystemExit("shared chunk structural audit failed: " + json.dumps(report["chunkQuality"], ensure_ascii=False))
    write_json(OUTPUT_PATH, metadata)
    write_json(REPORT_PATH, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
