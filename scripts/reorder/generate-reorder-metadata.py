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
POLICY_VERSION = "reorder-policy-1.1.0"
SCHEMA_VERSION = 1
TIERS = {
    "foundation": (2, 5),
    "standard": (3, 7),
    "precision": (4, 9),
}

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


def assign_groups(sentence: Any, tier: str, protected: list[dict[str, Any]], quote_state: dict[str, bool] | None = None) -> tuple[list[str], list[dict[str, Any]]]:
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
        if tier in {"standard", "precision"}:
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
        if tier == "foundation" and head != root:
            return

        children = sorted((child for child in head.children if dep(child) != "punct"), key=lambda value: value.i)
        subjects = [child for child in children if dep(child) in SUBJECT_DEPS]
        markers = clause_markers(head)
        coordinator = coordinator_for(head)

        # Standard keeps subordinate marker + first core constituent together.
        # Precision exposes the marker/coordinator as its own owner.
        subject_key: str | None = None
        if subjects:
            subject = subjects[0]
            if markers and tier == "standard":
                subject_key = add_owner(kind, head, "subject", dep(head), parent_kind, parent_head, "-core")
                mark_tokens(markers, subject_key)
                mark_tokens(subtree_tokens(subject), subject_key)
            elif kind == "coordinated-clause" and coordinator is not None and tier == "standard":
                subject_key = add_owner(kind, head, "subject", dep(head), parent_kind, parent_head, "-core")
                mark_tokens(subtree_tokens(subject), subject_key)
                groups[local(coordinator)] = subject_key
            else:
                subject_key = add_owner("noun-phrase", subject, "subject", dep(subject), kind, head)
                mark_tokens(subtree_tokens(subject), subject_key)
            clause_subject_keys[head.i] = subject_key

        # A short copular relative core ("who are eager") is one productive
        # predicate unit at Standard; its infinitival complement is handled as
        # a nested clause below.
        copular_complements = [child for child in children if dep(child) in {"attr", "acomp", "oprd"}]
        relative_copular_core = (kind == "relative-clause" and head.pos_ == "AUX" and bool(subjects)
                                 and bool(copular_complements) and tier == "standard")
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

        # Predicate and operator owners are distinct nodes. Standard keeps the
        # auxiliary sequence attached to the lexical predicate; Precision may
        # expose each operator and separable particle.
        predicate = add_owner("predicate", head, "predicate", dep(head), kind, head)
        if not relative_copular_core:
            groups[local(head)] = predicate
        for child in children:
            relation = dep(child)
            if relation in OPERATOR_DEPS or relation == "expl":
                if relative_copular_core:
                    continue
                if relation in {"compound:prt", "prt"} and tier == "precision":
                    particle = add_owner("operator", child, "phrase", relation, kind, head, "-particle")
                    mark_tokens(subtree_tokens(child), particle)
                elif tier == "precision" and relation not in {"compound:prt", "prt"}:
                    operator = add_owner("operator", child, "operator", relation, kind, head)
                    mark_tokens(subtree_tokens(child), operator)
                else:
                    mark_tokens(subtree_tokens(child), predicate)

        # Markers in Precision have explicit operator ownership. A coordinated
        # clause marker keeps coordinated-clause ownership for auditability.
        if tier == "precision":
            for marker in markers:
                marker_owner = add_owner("operator", marker, "conjunction", dep(marker), kind, head, "-marker")
                groups[local(marker)] = marker_owner
            if coordinator is not None:
                coordinator_owner = add_owner("coordinated-clause", head, "conjunction", dep(head), parent_kind, parent_head, "-marker")
                groups[local(coordinator)] = coordinator_owner

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
                    if tier == "precision":
                        key = add_owner("coordinated-clause", following, "conjunction", dep(following), kind, head, "-marker")
                        groups[local(child)] = key
                    else:
                        groups[local(child)] = clause_subject_keys.get(following.i, clause_keys.get(following.i, clause_key))
                continue
            if is_clause(child):
                nested_key = assign_atomic_clause(child, kind, head)
                if tier in {"standard", "precision"}:
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
        if kind == "coordinated-clause" and coordinator is not None and tier == "standard" and not subjects:
            groups[local(coordinator)] = clause_key

    def assign_foundation_root() -> None:
        # Foundation exposes only the main clause's major constituents. A
        # subordinate/coordinated clause, full PP, and protected expression
        # remain atomic at this level.
        main = add_owner("main-clause", root, "clause", dep(root))
        mark_tokens(subtree_tokens(root), main)
        for child in sorted((child for child in root.children if dep(child) != "punct"), key=lambda value: value.i):
            relation = dep(child)
            if relation in OPERATOR_DEPS or relation == "expl":
                predicate = add_owner("predicate", root, "predicate", dep(root), suffix="-foundation")
                groups[local(root)] = predicate
                mark_tokens(subtree_tokens(child), predicate)
                continue
            if relation == "cc":
                following = next((candidate for candidate in root.children
                                  if candidate.i > child.i and dep(candidate) == "conj" and candidate.pos_ in {"VERB", "AUX"}), None)
                if following is not None:
                    key = add_owner("coordinated-clause", following, "clause", dep(following), "main-clause", root)
                    groups[local(child)] = key
                continue
            if is_clause(child):
                nested_key = assign_atomic_clause(child, "main-clause", root)
                if dep(child) == "conj":
                    coordinator = coordinator_for(child)
                    if coordinator is not None:
                        groups[local(coordinator)] = nested_key
                continue
            if is_pp(child):
                assign_pp(child, "main-clause", root)
                continue
            role, child_kind = owner_role_for_child(child)
            key = add_owner(child_kind, child, role, relation, "main-clause", root)
            mark_tokens(subtree_tokens(child), key)

    if tier == "foundation":
        assign_foundation_root()
    else:
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
        if coordinator is None or tier == "foundation":
            continue
        if tier == "standard" and token.i in clause_subject_keys:
            groups[local(coordinator)] = clause_subject_keys[token.i]
        elif tier == "precision" and groups[local(coordinator)] is None:
            key = add_owner("coordinated-clause", token, "conjunction", dep(token), structural_owner_kind(token.head, sentence), token.head, "-marker")
            groups[local(coordinator)] = key

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

    maximum = TIERS[tier][1]
    while len(ranges_from_groups([str(value) for value in groups])) > maximum:
        ranges = ranges_from_groups([str(value) for value in groups])
        candidates = []
        for boundary_index, (left, right) in enumerate(zip(ranges, ranges[1:])):
            left_role = roles.get(left[2], {})
            right_role = roles.get(right[2], {})
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


def apply_manual_ranges(sentence: Any, specification: list[list[int]], tier: str) -> list[tuple[int, int, str]]:
    cursor = 0
    ranges = []
    for index, pair in enumerate(specification):
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError(f"manual range must be [start,end): {pair!r}")
        start, end = pair
        if not isinstance(start, int) or not isinstance(end, int) or start != cursor or end <= start or end > len(sentence):
            raise ValueError(f"manual {tier} ranges must partition sentence tokens in source order: {specification!r}")
        ranges.append((start, end, f"manual-{tier}-{index}"))
        cursor = end
    if cursor != len(sentence):
        raise ValueError(f"manual {tier} ranges do not cover every sentence token")
    return ranges


def build_variant(sentence: Any, source: str, tier: str, groups: list[str], roles: list[dict[str, Any]],
                  protected: list[dict[str, Any]], manual: dict[str, Any]) -> dict[str, Any] | None:
    if tier in manual.get("manualVariants", {}):
        ranges = apply_manual_ranges(sentence, manual["manualVariants"][tier], tier)
    else:
        ranges = ranges_from_groups(groups)
    minimum, maximum = TIERS[tier]
    if not minimum <= len(ranges) <= maximum:
        return None
    role_map = {role["id"]: role for role in roles}
    manual_roles = manual.get("manualRoles", {}).get(tier, [])
    tiles = []
    for tile_index, (start, end, group_id) in enumerate(ranges):
        contained = list(sentence)[start:end]
        lexical = [token for token in contained if lexical_token(token)]
        if not lexical:
            return None
        char_start, char_end = contained[0].idx, contained[-1].idx + len(contained[-1])
        value = source[char_start:char_end]
        if not value.strip():
            return None
        role = role_map.get(group_id, {"role": "phrase", "relation": "manual"})
        if tile_index < len(manual_roles):
            manual_role = manual_roles[tile_index]
            if isinstance(manual_role, str):
                role = {**role, "role": manual_role, "relation": "manual-override"}
            elif isinstance(manual_role, dict) and manual_role.get("role"):
                role = {**role, "role": str(manual_role["role"]),
                        "relation": str(manual_role.get("relation", "manual-override"))}
        if not role.get("ownerKind"):
            # Manual tier ranges still receive dependency-derived diagnostic
            # ownership. Prefer a syntactic head inside the range whose head
            # lies outside it, then choose by role-compatible POS.
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
        tile_id = f"s{sentence.start_char}-t{tile_index}"
        protections = [span["kind"] for span in protected if span["tokenStart"] >= start and span["tokenEnd"] <= end]
        tile = {
            "id": tile_id, "text": value, "tokenStart": start, "tokenEnd": end,
            "charStart": char_start, "charEnd": char_end,
            "role": label, "label": ROLE_LABELS.get(label, ROLE_LABELS["phrase"]),
            "dependency": role.get("relation", "manual"),
            "ownerKind": role["ownerKind"], "ownerRelation": role["ownerRelation"],
            "ownerHead": role["ownerHead"],
            "protectedConstructions": protections,
        }
        if role.get("ownerParentKind"):
            tile["ownerParentKind"] = role["ownerParentKind"]
        if isinstance(role.get("ownerParentHead"), int):
            tile["ownerParentHead"] = role["ownerParentHead"]
        tiles.append(tile)
    for index, tile in enumerate(tiles[:-1]):
        tile["separatorAfter"] = source[tile["charEnd"]:tiles[index + 1]["charStart"]]
    if tiles:
        tiles[-1]["separatorAfter"] = source[tiles[-1]["charEnd"]:sentence.end_char]
    canonical = "".join(tile["text"] + tile["separatorAfter"] for tile in tiles)
    sentence_text = source[sentence.start_char:sentence.end_char]
    if canonical != sentence_text:
        return None
    canonical_order = [tile["id"] for tile in tiles]
    alt_orders = manual.get("acceptedOrders", {}).get(tier, [])
    accepted = [canonical_order]
    for order in alt_orders:
        if isinstance(order, list) and order not in accepted:
            accepted.append(order)
    if any(len(order) != len(tiles) or set(order) != set(canonical_order) for order in accepted):
        raise ValueError(f"invalid acceptedOrders in manual {tier} variant")
    labels = [tile["label"] for tile in tiles]
    return {
        "tier": tier,
        "tiles": tiles,
        "canonicalOrder": canonical_order,
        "acceptedOrders": accepted,
        "clauseScaffold": labels,
        "canonicalReconstruction": canonical,
    }

def quote_state_before(source: str, char_index: int) -> dict[str, bool]:
    prefix = source[:char_index]
    return {
        "double": prefix.count('"') % 2 == 1,
        "single": False,
    }


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
            "kind": "separable-phrasal-verb",
            "verbLemma": token.head.lemma_.lower(),
            "particle": token.text,
            "tokenSpan": [min(token.i, token.head.i) - sentence.start, max(token.i, token.head.i) - sentence.start + 1],
            "particleToken": token.i - sentence.start,
            "maySeparate": True,
        })
    construction_tags += [{"kind": span["kind"], "text": span["text"],
                           "tokenSpan": [span["tokenStart"], span["tokenEnd"]], "hard": True}
                          for span in protected]
    entry: dict[str, Any] = {
        "sentenceIndex": sentence_index,
        "text": text,
        "charStart": sentence.start_char,
        "charEnd": sentence.end_char,
        "tokenStart": sentence.start,
        "tokenEnd": sentence.end,
        "tokens": parsed,
        "syntax": syntax,
        "constructions": construction_tags,
        "protectedConstructions": protected,
        "fixedContext": bool(override.get("fixedContext")),
        "fixedContextReason": str(override.get("fixedContextReason", "")) or None,
        "excludedReason": str(override.get("excludeReason", "")) or None,
        "manualOverrideApplied": bool(override.get("manualVariants") or override.get("fixedContext")
                                       or override.get("excludeReason") or override.get("protectedExpressions")
                                       or override.get("acceptedOrders")),
        "tierUnavailableReason": {},
        "variants": {},
    }
    if entry["fixedContext"] or entry["excludedReason"]:
        return entry
    lexical_count = sum(1 for token in sentence if lexical_token(token))
    if lexical_count < 2:
        entry["fixedContext"] = True
        entry["fixedContextReason"] = "one-word-fragment"
        return entry
    for tier, (minimum, maximum) in TIERS.items():
        groups, roles = assign_groups(sentence, tier, protected, quote_state)
        variant = build_variant(sentence, source, tier, groups, roles, protected, override)
        if variant is not None:
            entry["variants"][tier] = variant
        else:
            ranges = apply_manual_ranges(sentence, override["manualVariants"][tier], tier) if tier in override.get("manualVariants", {}) else ranges_from_groups(groups)
            if len(ranges) < minimum:
                reason = f"only {len(ranges)} safe structural units; {minimum} required"
            elif len(ranges) > maximum:
                reason = f"{len(ranges)} structural units remain after lower-priority boundary reduction; maximum is {maximum}"
            else:
                reason = "variant failed exact source reconstruction or protected-span validation"
            entry["tierUnavailableReason"][tier] = reason
    if not entry["variants"]:
        coarsest_groups, _ = assign_groups(sentence, "foundation", protected, quote_state)
        if len(ranges_from_groups(coarsest_groups)) <= 1:
            entry["fixedContext"] = True
            entry["fixedContextReason"] = "single-constituent-fragment"
        else:
            entry["excludedReason"] = "no-validated-constituent-variant"
    return entry


def classify_item(sentences: list[dict[str, Any]]) -> tuple[str, str | None]:
    if not sentences:
        return "excluded", "sentence-segmentation-empty"
    if any(sentence.get("excludedReason") for sentence in sentences):
        return "excluded", "one-or-more-sentences-excluded"
    if any(sentence.get("variants") for sentence in sentences):
        return "playable", None
    return "fixed-context", "all-sentences-fixed-context"


def validate_generated_dataset(source_items: list[dict[str, Any]], metadata: dict[str, Any]) -> list[str]:
    """Gate the build before either generated artifact is written."""
    errors: list[str] = []
    sources = {str(item["id"]): item for item in source_items}
    generated = {str(item["itemId"]): item for item in metadata.get("items", [])}
    if len(source_items) != 560 or len(generated) != 560 or set(sources) != set(generated):
        errors.append("source/metadata item coverage must be exactly 560 unique IDs")
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
            start, end = sentence.get("charStart"), sentence.get("charEnd")
            if not isinstance(start, int) or not isinstance(end, int) or start < 0 or end <= start or end > len(source):
                errors.append(f"{context}: invalid source character span")
                continue
            spans.append((start, end))
            if sentence.get("text") != source[start:end]:
                errors.append(f"{context}: sentence text does not match source span")
            tokens = sentence.get("tokens", [])
            if not tokens or any(token.get("i") != index for index, token in enumerate(tokens)):
                errors.append(f"{context}: invalid token sequence")
            for token in tokens:
                token_start, token_end = token.get("start"), token.get("end")
                if not isinstance(token_start, int) or not isinstance(token_end, int) or token_start < start or token_end <= token_start or token_end > end or source[token_start:token_end] != token.get("text"):
                    errors.append(f"{context}: token span does not match the source")
                    break
            if sentence.get("fixedContext") or sentence.get("excludedReason"):
                if sentence.get("variants"):
                    errors.append(f"{context}: fixed/excluded sentence has sortable variants")
                continue
            variants = sentence.get("variants", {})
            if not variants:
                errors.append(f"{context}: playable sentence has no validated tier")
            for tier, variant in variants.items():
                bounds = TIERS.get(tier)
                tiles = variant.get("tiles", [])
                if bounds is None or not bounds[0] <= len(tiles) <= bounds[1]:
                    errors.append(f"{context}/{tier}: tile count out of range")
                    continue
                ids = [tile.get("id") for tile in tiles]
                if len(ids) != len(set(ids)) or variant.get("canonicalOrder") != ids:
                    errors.append(f"{context}/{tier}: invalid unique canonical tile IDs")
                accepted = variant.get("acceptedOrders", [])
                if variant.get("canonicalOrder") not in accepted or any(
                    not isinstance(order, list) or len(order) != len(ids) or len(set(order)) != len(ids) or set(order) != set(ids)
                    for order in accepted
                ):
                    errors.append(f"{context}/{tier}: invalid acceptedOrders")
                cursor = 0
                reconstruction = ""
                for index, tile in enumerate(tiles):
                    if tile.get("tokenStart") != cursor or not isinstance(tile.get("tokenEnd"), int) or tile["tokenEnd"] <= cursor:
                        errors.append(f"{context}/{tier}: token loss, duplication, or overlap")
                        break
                    cursor = tile["tokenEnd"]
                    if tile.get("charStart", -1) < start or tile.get("charEnd", 0) > end or tile.get("charEnd", 0) <= tile.get("charStart", -1):
                        errors.append(f"{context}/{tier}: cross-sentence tile span")
                        break
                    if source[tile["charStart"]:tile["charEnd"]] != tile.get("text"):
                        errors.append(f"{context}/{tier}: tile text/span mismatch")
                    if all(token.get("isPunct") for token in tokens[tile["tokenStart"]:tile["tokenEnd"]]):
                        errors.append(f"{context}/{tier}: punctuation-only tile")
                    reconstruction += tile.get("text", "") + tile.get("separatorAfter", "")
                if cursor != len(tokens):
                    errors.append(f"{context}/{tier}: tile spans do not cover all sentence tokens")
                if reconstruction != sentence["text"] or variant.get("canonicalReconstruction") != sentence["text"]:
                    errors.append(f"{context}/{tier}: canonical reconstruction mismatch")
                for protected in sentence.get("protectedConstructions", []):
                    if protected.get("hard") and sum(tile.get("tokenStart", 0) <= protected["tokenStart"]
                                                       and tile.get("tokenEnd", 0) >= protected["tokenEnd"]
                                                       for tile in tiles) != 1:
                        errors.append(f"{context}/{tier}: hard protected expression was split")
        spans.sort()
        if any(spans[index][0] < spans[index - 1][1] for index in range(1, len(spans))):
            errors.append(f"{item_id}: sentence spans overlap")
        covered = bytearray(len(source))
        for start, end in spans:
            for index in range(start, end):
                covered[index] = 1
        if any(not char.isspace() and not covered[index] for index, char in enumerate(source)):
            errors.append(f"{item_id}: source text falls outside sentence boundaries")
        for left, right, label in (("“", "”", "curly double"), ("‘", "’", "curly single"), ("«", "»", "guillemet")):
            balance = 0
            for index, char in enumerate(source):
                if (label == "curly single" and char == right and index > 0 and index + 1 < len(source)
                        and source[index - 1].isalnum() and source[index + 1].isalnum()):
                    continue
                if char == left:
                    balance += 1
                elif char == right:
                    balance -= 1
                if balance < 0:
                    errors.append(f"{item_id}: misordered {label} quotation")
                    break
            if balance != 0:
                errors.append(f"{item_id}: unmatched {label} quotation")
        if source.count('"') % 2:
            errors.append(f"{item_id}: unmatched ASCII double quotation")
        expected_status, expected_reason = classify_item(sentences)
        if item.get("status") != expected_status or item.get("classificationReason") != expected_reason:
            errors.append(f"{item_id}: unsafe item classification")
    return errors



def chunk_quality_metrics(metadata: dict[str, Any]) -> dict[str, Any]:
    """Audit generated chunk owners from serialized dependency/token spans.

    This report pass reads only the output metadata. It does not call the
    generator's grouping or decomposition helpers.
    """
    clause_relations = {"advcl", "acl", "acl:relcl", "relcl", "ccomp", "xcomp", "csubj", "csubjpass"}
    subject_relations = SUBJECT_DEPS
    object_relations = OBJECT_DEPS | INDIRECT_OBJECT_DEPS
    structural_child_relations = clause_relations | subject_relations | object_relations | {"prep", "obl", "agent", "dative", "attr", "acomp", "oprd"}
    long_counts = Counter({tier: 0 for tier in TIERS})
    dominant_counts = Counter({tier: 0 for tier in TIERS})
    decomposable_counts = Counter({tier: 0 for tier in TIERS})
    unavailable_counts = Counter({tier: 0 for tier in TIERS})
    unexplained_unavailable = 0
    misowned_roles = 0
    manual_coarse_only = 0
    protected_overreach = 0

    def lexical_count(tokens: list[dict[str, Any]], start: int = 0, end: int | None = None) -> int:
        end = len(tokens) if end is None else end
        return sum(1 for token in tokens[start:end]
                   if not token.get("isPunct") and token.get("pos") not in {"PUNCT", "SYM"})

    def subtree_span(tokens: list[dict[str, Any]], head_index: int) -> tuple[int, int]:
        selected = {head_index}
        changed = True
        while changed:
            changed = False
            for token in tokens:
                if token["i"] not in selected and token.get("head") in selected:
                    selected.add(token["i"])
                    changed = True
        return min(selected), max(selected) + 1

    def protected_boundary(tokens: list[dict[str, Any]], sentence: dict[str, Any], boundary: int) -> bool:
        return any(span.get("hard") and span.get("tokenStart", 0) < boundary < span.get("tokenEnd", 0)
                   for span in sentence.get("protectedConstructions", []))

    def legal_split_inside_tile(tokens: list[dict[str, Any]], sentence: dict[str, Any], tile: dict[str, Any], tier: str) -> bool:
        start, end = tile["tokenStart"], tile["tokenEnd"]
        if tile.get("ownerKind") == "structural-composite":
            return False
        for token in tokens[start:end]:
            relation = token.get("dep", "")
            clause_head = (relation in clause_relations
                           or relation == "pcomp" and token.get("pos") in {"VERB", "AUX"}
                           or relation == "conj" and token.get("pos") in {"VERB", "AUX"})
            if not clause_head:
                continue
            child_start, child_end = subtree_span(tokens, token["i"])
            for boundary in (child_start, child_end):
                if start < boundary < end and not protected_boundary(tokens, sentence, boundary):
                    left = lexical_count(tokens, start, boundary)
                    right = lexical_count(tokens, boundary, end)
                    if left and right:
                        return True
            if relation == "conj":
                coordinator = next((candidate for candidate in tokens
                                    if candidate.get("head") == token.get("head")
                                    and candidate.get("dep") == "cc" and candidate["i"] < token["i"]), None)
                boundary = coordinator["i"] if coordinator else token["i"]
                if start < boundary < end and not protected_boundary(tokens, sentence, boundary):
                    if lexical_count(tokens, start, boundary) and lexical_count(tokens, boundary, end):
                        return True
        for token in tokens[start:end]:
            if token.get("dep") != "conj":
                continue
            coordinator = next((candidate for candidate in tokens
                                if candidate.get("head") == token.get("head")
                                and candidate.get("dep") == "cc" and candidate["i"] < token["i"]), None)
            boundary = coordinator["i"] if coordinator else token["i"]
            if start < boundary < end and not protected_boundary(tokens, sentence, boundary):
                if lexical_count(tokens, start, boundary) and lexical_count(tokens, boundary, end):
                    return True
        # An atomic long clause owner with multiple direct core dependents has
        # an exposed structural split, even when no child clause is nested.
        owner_head = tile.get("ownerHead")
        owner_kind = tile.get("ownerKind")
        if isinstance(owner_head, int) and owner_kind in {"main-clause", "coordinated-clause", "subordinate-clause", "relative-clause"}:
            structural_children = [token for token in tokens[start:end]
                                   if token.get("head") == owner_head and token.get("dep") in structural_child_relations]
            if len(structural_children) >= 2:
                points = sorted(token["i"] for token in structural_children if start < token["i"] < end)
                if any(not protected_boundary(tokens, sentence, point) for point in points):
                    return True
        return False

    for item in metadata.get("items", []):
        for sentence in item.get("sentences", []):
            tokens = sentence.get("tokens", [])
            total_lexical = lexical_count(tokens)
            variants = sentence.get("variants", {})
            if not sentence.get("fixedContext") and not sentence.get("excludedReason"):
                if sentence.get("manualOverrideApplied") and "foundation" in variants \
                        and not any(tier in variants for tier in ("standard", "precision")):
                    manual_coarse_only += 1
                for tier in TIERS:
                    if tier not in variants:
                        unavailable_counts[tier] += 1
                        reason = sentence.get("tierUnavailableReason", {}).get(tier)
                        if not isinstance(reason, str) or not reason.strip():
                            unexplained_unavailable += 1
            for protected in sentence.get("protectedConstructions", []):
                if not protected.get("hard"):
                    continue
                start, end = protected.get("tokenStart", 0), protected.get("tokenEnd", 0)
                selected = set(range(max(0, start), min(len(tokens), end)))
                if any(tokens[index].get("head") in selected
                       and (tokens[index].get("dep") in clause_relations
                            or tokens[index].get("dep") == "pcomp" and tokens[index].get("pos") in {"VERB", "AUX"}
                            or tokens[index].get("dep") == "conj" and tokens[index].get("pos") in {"VERB", "AUX"})
                       for index in selected):
                    protected_overreach += 1
            for tier, variant in variants.items():
                if tier not in TIERS:
                    continue
                for tile in variant.get("tiles", []):
                    count = lexical_count(tokens, tile["tokenStart"], tile["tokenEnd"])
                    if count >= 8:
                        long_counts[tier] += 1
                        if tier in {"standard", "precision"} and legal_split_inside_tile(tokens, sentence, tile, tier):
                            decomposable_counts[tier] += 1
                    if count >= 12 or count >= 8 and total_lexical and count / total_lexical >= 0.65:
                        dominant_counts[tier] += 1
                    kind = tile.get("ownerKind")
                    relation = tile.get("ownerRelation")
                    head = tile.get("ownerHead")
                    if not isinstance(kind, str) or not kind or not isinstance(relation, str) or not relation \
                            or not isinstance(head, int) or not 0 <= head < len(tokens):
                        misowned_roles += 1
                    elif tile.get("role") == "pp" and kind != "pp":
                        misowned_roles += 1
                    elif kind == "pp" and tile.get("role") != "pp":
                        misowned_roles += 1
                    elif kind == "pp" and relation.lower() not in {"prep", "obl", "agent", "dative"}:
                        misowned_roles += 1
                    elif kind != "protected-expression" and relation.lower() != str(tokens[head].get("dep", "")).lower():
                        misowned_roles += 1

    return {
        "longTileCountByTier": dict(long_counts),
        "dominantTileCountByTier": dict(dominant_counts),
        "decomposableLongTileCountByTier": dict(decomposable_counts),
        "misownedRoleCount": misowned_roles,
        "tierUnavailableCountByTier": dict(unavailable_counts),
        "unexplainedTierUnavailableCount": unexplained_unavailable,
        "manualCoarseOnlyCount": manual_coarse_only,
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
    overrides = read_json(OVERRIDES_PATH, {"schemaVersion": 1, "items": {}})
    override_items = overrides.get("items", {})
    if not isinstance(items, list) or len(items) != 560:
        raise SystemExit(f"expected 560 source items, found {len(items) if isinstance(items, list) else 'invalid'}")
    output_items = []
    reason_counts: Counter[str] = Counter()
    tier_counts: Counter[str] = Counter()
    sentence_count = 0
    playable_sentences = 0
    fixed_sentences = 0
    excluded_sentences = 0
    manual_variant_count = 0
    protected_count = 0
    review_required = 0
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
        output = {"itemId": item_id, "sourceHash": sha256(source), "status": status,
                  "classificationReason": reason, "sentenceCount": len(sentences), "sentences": sentences}
        output_items.append(output)
        sentence_count += len(sentences)
        for sentence in sentences:
            protected_count += len(sentence["protectedConstructions"])
            if sentence.get("manualOverrideApplied"):
                manual_variant_count += 1
            if sentence["fixedContext"]:
                fixed_sentences += 1
            elif sentence["excludedReason"]:
                excluded_sentences += 1
                review_required += 1
                reason_counts[sentence["excludedReason"]] += 1
            else:
                playable_sentences += 1
                for tier, variant in sentence["variants"].items():
                    tier_counts[tier] += 1
        if reason:
            reason_counts[reason] += 1
    if len({item["itemId"] for item in output_items}) != 560:
        raise SystemExit("duplicate item id in generation output")
    metadata = {
        "schemaVersion": SCHEMA_VERSION,
        "source": {"path": "data/items.json", "itemCount": len(items),
                   "sha256": sha256(json.dumps(items, ensure_ascii=False, separators=(",", ":")))},
        "parser": {"engine": "spaCy", "version": spacy.__version__,
                   "model": "en_core_web_sm", "modelVersion": model_version,
                   "policyVersion": POLICY_VERSION},
        "tierRules": {tier: {"minTiles": bounds[0], "maxTiles": bounds[1]} for tier, bounds in TIERS.items()},
        "items": output_items,
    }
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "parser": metadata["parser"],
        "itemCount": len(output_items),
        "itemClassification": dict(Counter(item["status"] for item in output_items)),
        "sentenceCount": sentence_count,
        "playableSentenceCount": playable_sentences,
        "fixedContextSentenceCount": fixed_sentences,
        "excludedSentenceCount": excluded_sentences,
        "variantCountByTier": dict(tier_counts),
        "reviewRequiredCount": review_required,
        "excludedReasons": dict(reason_counts),
        "manualOverrideCount": manual_variant_count,
        "protectedConstructionCount": protected_count,
        "crossSentenceViolationCount": 0,
        "reconstructionViolationCount": 0,
    }
    report["chunkQuality"] = chunk_quality_metrics(metadata)
    validation_errors = validate_generated_dataset(items, metadata)
    if validation_errors:
        raise SystemExit("generated reorder data failed corpus validation:\n" + "\n".join(validation_errors[:80]))
    write_json(OUTPUT_PATH, metadata)
    write_json(REPORT_PATH, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
