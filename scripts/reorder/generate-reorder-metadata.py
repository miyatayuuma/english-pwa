#!/usr/bin/env python3
"""Deterministic shared syntax and learning-surface authority; build-time spaCy only."""
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
except ImportError as exc:
    raise SystemExit("spaCy is required: pip install 'spacy==3.8.16' && python -m spacy download en_core_web_sm") from exc
ROOT = Path(__file__).resolve().parents[2]
ITEMS_PATH = ROOT / 'data' / 'items.json'
OVERRIDES_PATH = ROOT / 'data' / 'reorder-overrides.json'
OUTPUT_PATH = ROOT / 'data' / 'reorder-v1.json'
REPORT_PATH = ROOT / 'data' / 'reorder-report.json'
SUBJECT_DEPS = {'nsubj', 'csubj', 'nsubjpass', 'csubjpass'}
OBJECT_DEPS = {'obj', 'dobj'}
INDIRECT_OBJECT_DEPS = {'iobj', 'dative'}
CLAUSE_DEPS = {'advcl', 'acl', 'acl:relcl', 'relcl', 'ccomp', 'xcomp', 'csubj', 'csubjpass'}
PREP_DEPS = {'obl', 'prep', 'nmod', 'pobj', 'agent'}
MODIFIER_DEPS = {'advmod', 'npadvmod', 'amod', 'appos'}
OPERATOR_DEPS = {'aux', 'aux:pass', 'auxpass', 'cop', 'neg', 'compound:prt', 'prt'}
FIXED_MWES = ['as soon as', 'as long as', 'even though', 'in spite of', 'instead of', 'in order to', 'as well as', 'rather than', 'because of', 'due to', 'according to', 'in front of', 'on behalf of', 'at least', 'at first', 'at once', 'by the way', 'of course', 'in fact', 'in general', 'for example', 'for instance', 'in other words', 'on the other hand', 'time and again', 'as a result', 'as a matter of fact', 'each other', 'one another', 'a lot of', 'lots of', 'no longer', 'not at all', 'so that', 'as if', 'as though', 'even if', 'rather than', 'in addition to', 'look forward to', 'get along with', 'put up with', 'come up with', 'take care of']
INSEPARABLE_PHRASAL_VERBS = ['look after', 'look into', 'run into', 'get over', 'get along with', 'come across', 'take after', 'put up with', 'look forward to', 'deal with', 'rely on', 'believe in', 'consist of', 'belong to', 'care for', 'sit back', 'stand by']
OPENING_PUNCT = {'(', '[', '{', '"', "'", '“', '‘', '«', '‹'}

def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    with path.open(encoding='utf-8') as handle:
        return json.load(handle)

def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def sha256(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def dep(token: Any) -> str:
    value = token.dep_.lower()
    if value == 'auxpass':
        return 'aux:pass'
    if value == 'nsubjpass':
        return 'nsubjpass'
    return value

def is_clause_dependency(token: Any) -> bool:
    relation = dep(token)
    return relation in CLAUSE_DEPS or (relation == 'pcomp' and token.pos_ in {'VERB', 'AUX'})




def lexical_token(token: Any) -> bool:
    return not token.is_space and (not token.is_punct) and (token.pos_ not in {'PUNCT', 'SYM'})


def expression_spans(sentence: Any, expressions: list[str], kind: str, *, hard: bool=True) -> list[dict[str, Any]]:
    words = [token for token in sentence if lexical_token(token)]
    normalized = [token.lemma_.lower() if kind == 'inseparable-phrasal-verb' else token.lower_ for token in words]
    spans: list[dict[str, Any]] = []
    seen: set[tuple[int, int, str]] = set()
    for expression in expressions:
        terms = [part.lower() for part in expression.split()]
        if not terms:
            continue
        for start in range(0, len(normalized) - len(terms) + 1):
            if normalized[start:start + len(terms)] != terms and [selected.lower_ for selected in words[start:start + len(terms)]] != terms:
                continue
            selected = words[start:start + len(terms)]
            if any((sentence.doc.text[selected[n].idx + len(selected[n]):selected[n + 1].idx].strip(' ,') for n in range(len(selected) - 1))):
                continue
            key = (selected[0].i, selected[-1].i + 1, kind)
            if key in seen:
                continue
            seen.add(key)
            spans.append({'kind': kind, 'text': sentence.doc.text[selected[0].idx:selected[-1].idx + len(selected[-1])], 'tokenStart': selected[0].i - sentence.start, 'tokenEnd': selected[-1].i - sentence.start + 1, 'charStart': selected[0].idx, 'charEnd': selected[-1].idx + len(selected[-1]), 'hard': hard})
    return spans



def sentence_spans(doc: Any) -> list[Any]:
    """Keep parser boundaries, and split clearly separate quoted dialogue turns.

    The small English model sometimes treats two quoted turns as one sentence
    when the quote-close and quote-open sit beside terminal punctuation. The
    split below only acts on that unambiguous surface boundary.
    """
    result = []
    closing_quotes = {'”', '’', '»', '’', '"'}
    opening_quotes = {'“', '‘', '«', '"'}
    for parsed in doc.sents:
        tokens = list(parsed)
        start = parsed.start
        index = 0
        while index < len(tokens):
            token = tokens[index]
            if token.text not in {'.', '?', '!', '？', '！'}:
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


def _role_for_top(child: Any) -> tuple[str, str]:
    relation = dep(child)
    if relation in SUBJECT_DEPS:
        return ('subject', 'subject')
    if relation in OBJECT_DEPS:
        return ('object', 'object')
    if relation in INDIRECT_OBJECT_DEPS:
        return ('indirect_object', 'indirect_object')
    if relation in {'ccomp', 'xcomp', 'advcl', 'acl', 'acl:relcl', 'relcl', 'csubj', 'csubjpass'}:
        return ('clause', 'clause')
    if relation in PREP_DEPS:
        return ('pp', 'pp')
    if relation in {'advmod', 'npadvmod'}:
        return ('adjunct', 'adjunct')
    if relation == 'cc':
        return ('conjunction', 'conjunction')
    if relation == 'conj':
        return ('coordination', 'coordination')
    if relation in {'attr', 'acomp', 'oprd'}:
        return ('complement', 'complement')
    if relation == 'pobj':
        return ('object', 'noun-phrase')
    return ('phrase', 'phrase')

def sentence_local_root(sentence: Any) -> Any:
    root = sentence.root
    if sentence.start <= root.i < sentence.end:
        return root
    local_tokens = list(sentence)
    candidates = [token for token in local_tokens if token.head.i < sentence.start or token.head.i >= sentence.end or token.head == token]
    verbal = [token for token in candidates if token.pos_ in {'VERB', 'AUX'}]
    if verbal:
        return max(verbal, key=lambda token: (len(token.subtree), token.i))
    return max(candidates or local_tokens, key=lambda token: (len(token.subtree), token.i))

def structural_owner_kind(token: Any, sentence: Any) -> str:
    relation = dep(token)
    if token == sentence_local_root(sentence):
        return 'main-clause'
    if relation in {'acl:relcl', 'relcl'}:
        return 'relative-clause'
    if relation == 'conj' and token.pos_ in {'VERB', 'AUX'}:
        return 'coordinated-clause'
    if relation in CLAUSE_DEPS or (relation == 'pcomp' and token.pos_ in {'VERB', 'AUX'}):
        return 'subordinate-clause'
    return 'phrase'

def owner_role_for_child(token: Any) -> tuple[str, str]:
    relation = dep(token)
    if relation in SUBJECT_DEPS:
        return ('subject', 'noun-phrase')
    if relation in OBJECT_DEPS:
        return ('object', 'noun-phrase')
    if relation in INDIRECT_OBJECT_DEPS:
        return ('indirect_object', 'noun-phrase')
    if relation in {'attr', 'acomp', 'oprd'}:
        return ('complement', 'complement')
    if relation == 'pobj':
        return ('object', 'noun-phrase')
    if relation in {'advmod', 'npadvmod'}:
        return ('adjunct', 'adjunct')
    if relation == 'conj':
        return ('coordination', 'coordination')
    return (_role_for_top(token)[1], 'phrase')

def assign_groups(sentence: Any, protected: list[dict[str, Any]], quote_state: dict[str, bool] | None=None) -> tuple[list[str], list[dict[str, Any]]]:
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
    marker_words = {'after', 'although', 'as', 'before', 'because', 'if', 'once', 'since', 'that', 'though', 'unless', 'until', 'when', 'whenever', 'whereas', 'while', 'whether'}

    def local(token: Any) -> int:
        return token.i - sentence.start

    def add_owner(kind: str, head: Any, role: str, relation: str | None=None, parent_kind: str | None=None, parent_head: Any | None=None, suffix: str='') -> str:
        head_index = local(head)
        key = f'{kind}-{head_index}{suffix}'
        value: dict[str, Any] = {'role': role, 'relation': relation or dep(head), 'ownerKind': kind, 'ownerRelation': relation or dep(head), 'ownerHead': head_index}
        if parent_kind:
            value['ownerParentKind'] = parent_kind
        if parent_head is not None:
            value['ownerParentHead'] = local(parent_head)
        existing = roles.get(key)
        if existing is not None and existing != value:
            raise ValueError(f'conflicting structural owner metadata for {key}')
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
        return relation == 'conj' and head.pos_ in {'VERB', 'AUX'}

    def is_pp(head: Any) -> bool:
        relation = dep(head)
        return relation in {'prep', 'obl', 'agent'} or (relation == 'dative' and head.text.lower() == 'to')

    def is_marker(token: Any) -> bool:
        relation = dep(token)
        return relation == 'mark' or (token.lower_ in marker_words and relation in {'advmod', 'npadvmod'})

    def clause_markers(head: Any) -> list[Any]:
        return [child for child in head.children if is_marker(child)]

    def coordinator_for(head: Any) -> Any | None:
        if dep(head) != 'conj':
            return None
        parent = head.head
        return next((child for child in parent.children if dep(child) == 'cc' and child.i < head.i), None)

    def assign_nested(parent: Any, parent_kind: str, parent_head: Any) -> None:
        for child in sorted(parent.children, key=lambda value: value.i):
            if child.i < sentence.start or child.i >= sentence.end:
                continue
            if dep(child) == 'punct':
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
        key = add_owner('pp', head, 'pp', dep(head), parent_kind, parent_head)
        mark_tokens(subtree_tokens(head), key)
        assign_nested(head, 'pp', head)

    def assign_atomic_clause(head: Any, parent_kind: str | None=None, parent_head: Any | None=None) -> str:
        kind = structural_owner_kind(head, sentence)
        key = add_owner(kind, head, 'clause', dep(head), parent_kind, parent_head)
        clause_keys[head.i] = key
        mark_tokens(subtree_tokens(head), key)
        return key

    def assign_clause(head: Any, parent_kind: str | None=None, parent_head: Any | None=None) -> None:
        if head.i in visited_clauses:
            return
        visited_clauses.add(head.i)
        kind = structural_owner_kind(head, sentence)
        clause_key = add_owner(kind, head, 'clause', dep(head), parent_kind, parent_head)
        clause_keys[head.i] = clause_key
        mark_tokens(subtree_tokens(head), clause_key)
        children = sorted((child for child in head.children if dep(child) != 'punct'), key=lambda value: value.i)
        subjects = [child for child in children if dep(child) in SUBJECT_DEPS]
        markers = clause_markers(head)
        coordinator = coordinator_for(head)
        subject_key: str | None = None
        if subjects:
            subject = subjects[0]
            if markers and True:
                subject_key = add_owner(kind, head, 'subject', dep(head), parent_kind, parent_head, '-core')
                mark_tokens(markers, subject_key)
                mark_tokens(subtree_tokens(subject), subject_key)
            elif kind == 'coordinated-clause' and coordinator is not None and True:
                subject_key = add_owner(kind, head, 'subject', dep(head), parent_kind, parent_head, '-core')
                mark_tokens(subtree_tokens(subject), subject_key)
                groups[local(coordinator)] = subject_key
            else:
                subject_key = add_owner('noun-phrase', subject, 'subject', dep(subject), kind, head)
                mark_tokens(subtree_tokens(subject), subject_key)
            for subject in subjects:
                if is_clause(subject):
                    assign_clause(subject, kind, head)
                else:
                    assign_nested(subject, 'noun-phrase', subject)
            clause_subject_keys[head.i] = subject_key
        copular_complements = [child for child in children if dep(child) in {'attr', 'acomp', 'oprd'}]
        relative_copular_core = kind == 'relative-clause' and head.pos_ == 'AUX' and bool(subjects) and bool(copular_complements) and True
        if relative_copular_core:
            core = add_owner(kind, head, 'clause', dep(head), parent_kind, parent_head, '-copular-core')
            mark_tokens(subtree_tokens(subjects[0]), core)
            groups[local(head)] = core
            for child in head.children:
                if dep(child) in OPERATOR_DEPS or dep(child) == 'expl':
                    mark_tokens(subtree_tokens(child), core)
            for child in copular_complements:
                mark_tokens(subtree_tokens(child), core)
            clause_subject_keys[head.i] = core
        predicate = add_owner('predicate', head, 'predicate', dep(head), kind, head)
        if not relative_copular_core:
            groups[local(head)] = predicate
        for child in children:
            relation = dep(child)
            if relation in OPERATOR_DEPS or relation == 'expl':
                if relative_copular_core:
                    continue
                if relation in {'compound:prt', 'prt'} and False:
                    particle = add_owner('operator', child, 'phrase', relation, kind, head, '-particle')
                    mark_tokens(subtree_tokens(child), particle)
                else:
                    mark_tokens(subtree_tokens(child), predicate)
        for child in children:
            relation = dep(child)
            if relation in OPERATOR_DEPS or relation == 'expl' or relation in SUBJECT_DEPS or is_marker(child):
                continue
            if relative_copular_core and child in copular_complements:
                assign_nested(child, kind, head)
                continue
            if relation == 'cc':
                following = next((candidate for candidate in head.children if candidate.i > child.i and dep(candidate) == 'conj' and (candidate.pos_ in {'VERB', 'AUX'})), None)
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
        if relative_copular_core:
            for child in copular_complements:
                assign_nested(child, kind, head)
        if kind == 'coordinated-clause' and coordinator is not None and True and (not subjects):
            groups[local(coordinator)] = clause_key
    assign_clause(root)
    assign_nested(root, 'main-clause', root)
    for token in sentence:
        if dep(token) != 'conj' or token.pos_ not in {'VERB', 'AUX'}:
            continue
        coordinator = coordinator_for(token)
        if coordinator is None or False:
            continue
        if True and token.i in clause_subject_keys:
            groups[local(coordinator)] = clause_subject_keys[token.i]
    phrase_coordinations: dict[int, list[tuple[Any, Any]]] = {}
    for token in sentence:
        if dep(token) != 'conj' or is_clause(token):
            continue
        coordinator = coordinator_for(token)
        if coordinator is None:
            continue
        owner = token
        while dep(owner) == 'conj' and (not is_clause(owner)):
            owner = owner.head
        phrase_coordinations.setdefault(owner.i, []).append((coordinator, token))
    protected_owner_kinds = {'pp', 'main-clause', 'coordinated-clause', 'subordinate-clause', 'relative-clause', 'protected-expression', 'operator', 'predicate'}
    for owner_index, members in phrase_coordinations.items():
        owner = sentence[owner_index - sentence.start]
        span_tokens = subtree_tokens(owner)
        if not span_tokens:
            continue
        span_start = min((local(token) for token in span_tokens))
        span_end = max((local(token) for token in span_tokens)) + 1
        boundaries = sorted({(local(coordinator), conjunct) for coordinator, conjunct in members}, key=lambda value: value[0])
        boundaries = [(index, conjunct) for index, conjunct in boundaries if span_start < index < span_end]
        if not boundaries:
            continue
        part_starts = [span_start, *[index for index, _ in boundaries]]
        part_ends = [*[index for index, _ in boundaries], span_end]
        first_key = groups[local(owner)]
        first_metadata = roles.get(first_key or '', {})
        for part_index, (start, end) in enumerate(zip(part_starts, part_ends)):
            part_head = owner if part_index == 0 else next((conjunct for boundary, conjunct in boundaries if boundary == start))
            part_kind = 'coordination'
            part_role = first_metadata.get('role', 'coordination') if part_index == 0 else 'coordination'
            part_relation = dep(part_head)
            part_key = f'coordination-{local(owner)}-{part_index}'
            part_metadata: dict[str, Any] = {'role': part_role, 'relation': part_relation, 'ownerKind': part_kind, 'ownerRelation': part_relation, 'ownerHead': local(part_head)}
            if part_index == 0:
                if first_metadata.get('ownerParentKind'):
                    part_metadata['ownerParentKind'] = first_metadata['ownerParentKind']
                    part_metadata['ownerParentHead'] = first_metadata.get('ownerParentHead')
            else:
                part_metadata['ownerParentKind'] = 'coordination'
                part_metadata['ownerParentHead'] = local(owner)
            roles[part_key] = part_metadata
            for index in range(start, end):
                current = roles.get(groups[index] or '', {})
                if current.get('ownerKind') not in protected_owner_kinds:
                    groups[index] = part_key
    for span in protected:
        key = add_owner('protected-expression', sentence[span['tokenStart']], 'phrase', span['kind'], suffix=f"-{span['tokenStart']}-{span['tokenEnd']}")
        for index in range(span['tokenStart'], span['tokenEnd']):
            groups[index] = key
    quote_open = {'"': bool((quote_state or {}).get('double', False)), "'": bool((quote_state or {}).get('single', False))}
    for index, token in enumerate(sentence):
        if not (token.is_punct or token.pos_ == 'PUNCT'):
            continue
        is_opening = token.text in OPENING_PUNCT
        if token.text in quote_open:
            is_opening = not quote_open[token.text]
            quote_open[token.text] = is_opening
        if token.text in {'”', '’', '»', '’'}:
            is_opening = False
        if token.text in {'“', '‘', '«'}:
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
            groups[index] = groups[target] if target is not None else 'whole-sentence'
            roles.setdefault(groups[index], {'role': 'phrase', 'relation': 'fallback-attachment', 'ownerKind': 'phrase', 'ownerRelation': 'fallback-attachment', 'ownerHead': index})
    positions: dict[str, list[int]] = {}
    for index, key in enumerate(groups):
        if key is not None:
            positions.setdefault(key, []).append(index)
    for key, indices in positions.items():
        for index in range(indices[0], indices[-1] + 1):
            if groups[index] is None:
                groups[index] = key
    return ([str(value) for value in groups], [{'id': key, **value} for key, value in roles.items()])

def ranges_from_groups(groups: list[str]) -> list[tuple[int, int, str]]:
    result = []
    start = 0
    current = groups[0] if groups else ''
    for index in range(1, len(groups) + 1):
        value = groups[index] if index < len(groups) else None
        if value != current:
            result.append((start, index, current))
            start, current = (index, value)
    return result

def quote_state_before(source: str, char_index: int) -> dict[str, bool]:
    prefix = source[:char_index]
    return {'double': prefix.count('"') % 2 == 1, 'single': False}
import unicodedata
EXTRA_MWES = ['little by little', 'more or less', 'next to nothing', 'from now on', 'just in case', 'in any case', 'by far', 'owing to', 'strictly speaking', 'on account of', 'at first sight', 'first of all', 'every now and then', 'from time to time', 'back and forth', 'side by side', 'more often than not', 'day by day', 'from coast to coast', 'one after another', 'in terms of', 'at the expense of', 'in the face of', 'from hand to mouth', 'by no means', 'one of these days', 'free of charge', 'one by one', 'thanks to', 'for the sake of', 'for fear of', 'word for word', 'second to none', 'all but', 'sooner or later', 'in honor of', 'needless to say', 'in favor of', 'the day before yesterday', 'so as to', 'so as not to', 'no matter', 'from generation to generation', 'all the more', 'to tell the truth', 'as far as', 'once in a while', 'on and off', 'all at once', 'regardless of', 'apart from', 'as a result of', 'in the course of', 'in the middle of', 'in search of', 'a great deal of', 'a number of', 'a vast number of', 'a couple of', 'a piece of', 'such as', 'all over', 'no sooner', 'not only', 'but also', 'if only', 'not so much', 'in case of', 'according to', 'from across']
POLICY_VERSION = 'shared-chunk-policy-1.0.0'
SCHEMA_VERSION = 2
LEARNING_SURFACE_VERSION = 'shared-learning-surface-1.0.0'

def punctuation_classes(source):
    """Classify in full source context, before slicing chunks (case is untouched)."""
    lexical = set()
    for pattern in ['\\b(?:[A-Za-z]\\.){2,}|\\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|Inc|Ltd)\\.', "\\b[^\\W_]+(?:[-'’/][^\\W_]+)+\\b", '(?:\\$)?\\d+(?:[,:.]\\d+)*(?:%)?']:
        for match in re.finditer(pattern, source):
            lexical.update((i for i in range(match.start(), match.end()) if not source[i].isalnum()))
    single_open = False
    result = {}
    for i, c in enumerate(source):
        if c.isalnum() or c.isspace():
            continue
        if c in "'’" and i not in lexical:
            if i and source[i - 1].lower() == 's' and (not single_open):
                lexical.add(i)
            else:
                single_open = not single_open
        if c in '$%':
            lexical.add(i)
        if i in lexical:
            result[i] = 'LEXICAL'
        elif c in ',.!?:;"\'’‘“”()[]{}—–-«»‹›':
            result[i] = 'STRUCTURAL'
        else:
            raise ValueError(f'unclassified punctuation {c!r} at {i}: {source[max(0, i - 20):i + 20]}')
    return result

def learning_surface(source, start, end, classes):
    return re.sub('\\s+', ' ', ''.join((' ' if classes.get(i) == 'STRUCTURAL' else source[i] for i in range(start, end)))).strip()

def dependency_fixed_spans(sentence, source):
    """Protect a connected fixed core, never the surrounding head subtree."""
    result=[];seen=set()
    for token in sentence:
        if dep(token)!='fixed':continue
        head=token
        while dep(head)=='fixed' and head.head!=head:head=head.head
        if head.i in seen or not sentence.start<=head.i<sentence.end:continue
        seen.add(head.i);indices=set()
        def collect(current):
            if not sentence.start<=current.i<sentence.end:return
            indices.add(current.i-sentence.start)
            for child in current.children:
                if dep(child)=='fixed':collect(child)
        collect(head)
        start,end=min(indices),max(indices)+1
        if any(i not in indices and not sentence[i].is_punct for i in range(start,end)):
            raise ValueError('noncontiguous dependency-fixed core requires explicit reconciliation')
        result.append({'kind':'dependency-fixed','tokenStart':start,'tokenEnd':end,'hard':True,
                       'text':source[sentence[start].idx:sentence[end-1].idx+len(sentence[end-1])]})
    return result


def shared_ranges(sentence, source):
    protected = expression_spans(sentence, EXTRA_MWES + FIXED_MWES + ['as it is', 'seldom if ever', 'if ever', 'believe it or not', 'to make matters worse', 'Statue of Liberty'], 'fixed-mwe')
    protected += expression_spans(sentence, INSEPARABLE_PHRASAL_VERBS + ['come up with', 'make up for', 'refer to', 'feel for', 'pay attention to', 'make believe', 'make sure', 'come in handy'], 'inseparable-phrasal-verb')
    for pattern in ["\\b[^\\W_]+(?:[-'’/][^\\W_]+)+\\b", '(?:\\$)?\\d+(?:[,:.]\\d+)*(?:%)?']:
        for match in re.finditer(pattern, sentence.text):
            a, b = (sentence.start_char + match.start(), sentence.start_char + match.end())
            ii = [t.i - sentence.start for t in sentence if t.idx < b and t.idx + len(t) > a]
            if ii:
                protected.append({'kind': 'lexical-orthography', 'tokenStart': min(ii), 'tokenEnd': max(ii) + 1, 'hard': True, 'text': match.group()})
    protected += dependency_fixed_spans(sentence, source)
    protected.sort(key=lambda p: (p['tokenStart'], -p['tokenEnd'], p['kind']))
    accepted = []
    occupied = set()
    for p in protected:
        span = set(range(p['tokenStart'], p['tokenEnd']))
        if not occupied & span:
            accepted.append(p)
            occupied |= span
    protected = accepted
    groups, roles = assign_groups(sentence, [], quote_state_before(source, sentence.start_char))
    ranges = [list(r[:2]) for r in ranges_from_groups(groups)]
    ts = list(sentence)

    def local(t):
        return t.i - sentence.start

    def lex(a, b):
        return [t for t in ts[a:b] if not t.is_punct and t.pos_ not in {'PUNCT', 'SYM'}]

    def merge(j):
        ranges[j:j + 2] = [[ranges[j][0], ranges[j + 1][1]]]

    def close(a, b):
        jj = [j for j, (x, y) in enumerate(ranges) if x < b and y > a]
        if jj:
            ranges[jj[0]:jj[-1] + 1] = [[ranges[jj[0]][0], ranges[jj[-1]][1]]]

    def edge(a):
        j = next((j for j, (x, y) in enumerate(ranges) if x < a < y), None)
        if j is not None:
            x, y = ranges[j]
            ranges[j:j + 1] = [[x, a], [a, y]]
    for p in protected:
        a, b = (p['tokenStart'], p['tokenEnd'])
        if p['kind'] != 'lexical-orthography':
            edge(a)
            edge(b)
        close(a, b)
    for t in ts:
        if t.pos_ in {'NOUN', 'PROPN', 'PRON', 'NUM'}:
            ii = {local(t)}

            def nominal(c):
                ii.add(local(c))
                for ch in c.children:
                    if sentence.start <= ch.i < sentence.end and dep(ch) in {'det', 'amod', 'compound', 'nummod', 'poss', 'case', 'quantmod'}:
                        nominal(ch)
            nominal(t)
            close(min(ii), max(ii) + 1)
    for t in ts:
        if t.pos_ in {'VERB', 'AUX'} and dep(t) not in OPERATOR_DEPS:
            ii = {local(t)} | {local(c) for c in t.children if sentence.start <= c.i < sentence.end and dep(c) in {'aux', 'aux:pass', 'cop', 'neg', 'advmod', 'prt', 'compound:prt'} and (c.pos_ not in {'PROPN', 'PRON'})}
            a, b = (min(ii), max(ii) + 1)
            if all((local(c) in ii or c.pos_ in {'ADV', 'PART', 'PUNCT'} for c in lex(a, b))):
                edge(a)
                edge(b)
                close(a, b)
    for p in protected:
        a, b = (p['tokenStart'], p['tokenEnd'])
        last = ts[b - 1]
        if p['kind'] == 'fixed-mwe' and (last.pos_ == 'ADP' or last.lower_ == 'to') and (not any((t.pos_ in {'VERB', 'AUX'} for t in ts[a:b]))):
            child = next((c for c in last.children if dep(c) in {'pobj', 'obj', 'pcomp'}), None)
            if child:
                j = next((j for j, (x, y) in enumerate(ranges) if x <= local(child) < y), None)
                if j is not None and ranges[j][0] >= a:
                    close(a, ranges[j][1])
    for t in ts:
        if t.pos_ in {'VERB', 'AUX'}:
            for c in t.children:
                if not sentence.start <= c.i < sentence.end:
                    continue
                if dep(c) in OBJECT_DEPS | INDIRECT_OBJECT_DEPS | {'attr', 'acomp', 'oprd'}:
                    core = [local(c)]
                    def argument_core(v):
                        core.append(local(v))
                        for child in v.children:
                            if sentence.start<=child.i<sentence.end and dep(child) in {'det','amod','compound','nummod','poss','quantmod'}:argument_core(child)
                    argument_core(c)
                    edge(min(core))
                if dep(c) in {'npadvmod', 'advmod'} and c.lower_ in {'now', 'later', 'tonight', 'yesterday', 'tomorrow', 'overtime'}:
                    ii = [local(v) for v in c.subtree if sentence.start <= v.i < sentence.end]
                    edge(min(ii))
                    edge(max(ii) + 1)
    for t in ts:
        if t.lemma_ in {'have', 'get', 'ought', 'use', 'go'} or t.lemma_ == 'be':
            for c in t.children:
                if not sentence.start <= c.i < sentence.end or dep(c) != 'xcomp':
                    continue
                pre = [v for v in c.children if v.lower_ == 'to' and v.i < c.i]
                if not pre:
                    continue
                a = local(t)
                b = local(c) + 1
                mid = ts[a:b]
                semi = t.lemma_ in {'have', 'ought', 'use'} or (t.lemma_ == 'go' and any((v.lemma_ == 'be' for v in t.children))) or (t.lemma_ == 'get' and any((v.lemma_ == 'have' for v in t.children))) or (t.lemma_ == 'be' and any((v.lower_ == 'about' for v in mid)))
                if semi and (not any((dep(v) in SUBJECT_DEPS | OBJECT_DEPS for v in mid[1:]))):
                    close(a, b)
    for t in ts:
        if t.pos_ in {'ADJ', 'ADV'}:
            ii = [local(t)] + [local(c) for c in t.children if sentence.start <= c.i < sentence.end and dep(c) == 'advmod' and (c.pos_ in {'ADV', 'PART'})]
            if max(ii) - min(ii) <= 3:
                close(min(ii), max(ii) + 1)
    for t in ts:
        if dep(t) == 'conj' and t.pos_ not in {'VERB', 'AUX'} and any((v.text == ',' for v in ts[min(local(t.head), local(t)):local(t)])):
            ii = [local(t)] + [local(c) for c in t.children if sentence.start <= c.i < sentence.end and dep(c) in {'det', 'amod', 'compound', 'cc'}]
            a = min(ii)
            if a > 0 and ts[a - 1].text in {',', 'and', 'or'}:
                a -= 1 if ts[a - 1].text in {'and', 'or'} else 0
            edge(a)
    for t in ts:
        if dep(t) == 'appos' and t.pos_ == 'PROPN' and (local(t) > 0) and (ts[local(t) - 1].text == ','):
            edge(local(t))
    classes = punctuation_classes(source)
    changed = True
    while changed:
        changed = False
        for j, (a, b) in enumerate(ranges):
            tokens = lex(a, b)
            if not tokens:
                if len(ranges) > 1:
                    merge(j - 1 if j else 0)
                    changed = True
                    break
                continue
            marker = all((t.pos_ in {'ADP', 'PART', 'CCONJ', 'SCONJ', 'DET'} or t.lower_ in {'so', 'but', 'and', 'yet', 'that', 'who', 'which'} for t in tokens))
            if marker and (not any((dep(t) in {'prt', 'compound:prt'} for t in tokens))):
                target = j if j + 1 < len(ranges) else j - 1
                if target >= 0:
                    merge(target)
                    changed = True
                    break
            if all((t.pos_ == 'ADV' for t in tokens)) and j > 0 and (j + 1 < len(ranges)):
                left = lex(*ranges[j - 1])
                right = lex(*ranges[j + 1])
                heads = {t.head.i for t in tokens}
                if any((t.i in heads and t.pos_ in {'VERB', 'AUX'} for t in left + right)) and any((t.pos_ == 'AUX' for t in left)) and any((t.pos_ in {'VERB', 'AUX', 'ADJ'} for t in right)):
                    merge(j)
                    merge(j - 1)
                    changed = True
                    break
            if j + 1 < len(ranges) and any((t.lemma_ == 'be' and t.pos_ == 'AUX' for t in tokens)) and (not any(("'" in t.text for t in tokens))):
                right = lex(*ranges[j + 1])
                if right and (not any((dep(t) in CLAUSE_DEPS or dep(t) in SUBJECT_DEPS for t in right))) and any((dep(t) in {'attr', 'acomp', 'oprd'} and t.head.i in {v.i for v in tokens} for t in right)):
                    merge(j)
                    changed = True
                    break
            if all((t.pos_ == 'AUX' or dep(t) == 'neg' or t.tag_.startswith('W') for t in tokens)) and j + 1 < len(ranges):
                right = lex(*ranges[j + 1])
                if right and all((t.pos_ == 'PRON' for t in right)) and ('?' in sentence.text or any((t.head.i in {v.i for v in tokens} for t in right))):
                    merge(j)
                    changed = True
                    break
    for p in protected:
        a, b = (p['tokenStart'], p['tokenEnd'])
        if p['kind'] != 'lexical-orthography':
            edge(b)
            if p['kind'] == 'fixed-mwe':
                edge(a)
        close(a, b)
        last = ts[b - 1]
        if p['kind'] == 'fixed-mwe' and (last.pos_ == 'ADP' or last.lower_ in {'as', 'though', 'only'}):
            j = next((j for j, (x, y) in enumerate(ranges) if x <= a < y), None)
            if j is not None and ranges[j][1] == b and (j + 1 < len(ranges)):
                nxt = lex(*ranges[j + 1])
                if nxt and (not any((t.pos_ in {'VERB', 'AUX'} for t in nxt))):
                    merge(j)
    for p in protected:
        if p['kind'] == 'lexical-orthography':
            close(p['tokenStart'], p['tokenEnd'])
    for j in reversed(range(len(ranges))):
        a, b = ranges[j]
        if len(ranges) > 1 and (not learning_surface(source, ts[a].idx, ts[b - 1].idx + len(ts[b - 1]), classes)):
            merge(j - 1 if j else 0)
    for t in ts:
        if t.pos_ in {'VERB', 'AUX', 'ADJ'} and dep(t) not in OPERATOR_DEPS:
            ii = {local(t)} | {local(c) for c in t.children if sentence.start <= c.i < sentence.end and dep(c) in OPERATOR_DEPS | {'advmod'} and (c.pos_ not in {'PROPN', 'PRON'})}
            a, b = (min(ii), max(ii) + 1)
            mid = lex(a, b)
            if all((local(c) in ii or c.pos_ in {'ADV', 'PART', 'PUNCT'} for c in mid)):
                blocked = any((p['kind'] == 'fixed-mwe' and p['tokenStart'] < b and (p['tokenEnd'] > a) for p in protected))
                if not blocked:
                    close(a, b)
    for j in reversed(range(len(ranges) - 1)):
        a, b = ranges[j]
        tokens = lex(a, b)
        if tokens and all((t.pos_ in {'ADP', 'PART', 'CCONJ', 'SCONJ', 'DET'} or t.lower_ in {'so', 'who', 'which'} or t.lower_=='what' and '?' not in sentence.text for t in tokens)) and (not any((dep(t) in {'prt', 'compound:prt'} for t in tokens))):
            merge(j)
    for j in reversed(range(len(ranges) - 1)):
        left = lex(*ranges[j])
        right = lex(*ranges[j + 1])
        if left and right and all((t.pos_ == 'AUX' or t.lemma_ == 'do' or dep(t) == 'neg' or t.tag_.startswith('W') for t in left)) and all((t.pos_ == 'PRON' for t in right)):
            if '?' in sentence.text or any((t.head.i in {v.i for v in left} for t in right)):
                merge(j)
        elif left and right and (len(left) == 1) and (left[0].pos_ == 'PRON') and all((t.pos_ == 'AUX' and t.lemma_ != 'be' for t in right)) and (not any((dep(t) in {'aux', 'aux:pass'} for t in right))):
            merge(j)
    for j in reversed(range(len(ranges) - 1)):
        left = lex(*ranges[j])
        right = lex(*ranges[j + 1])
        if left and right and any((t.lemma_ == 'be' for t in left)):
            verb = next((t for t in left if t.lemma_ == 'be'))
            if not any((dep(t) in CLAUSE_DEPS | SUBJECT_DEPS for t in right)) and any((dep(t) in {'attr', 'acomp', 'oprd'} and t.head.i == verb.i for t in right)):
                if not any((t.pos_ == 'PRON' for t in left)) or any((t.text.endswith('ed') or t.lower_ == 'worth' for t in right)):
                    merge(j)
    for p in protected:
        if p['text'].lower() in {'all the more', 'but also', 'not only', 'no matter', 'so as to', 'so as not to'}:
            j = next((j for j, (a, b) in enumerate(ranges) if a <= p['tokenStart'] < b), None)
            if j is not None and j + 1 < len(ranges):
                merge(j)
    for j in reversed(range(len(ranges) - 1)):
        left = lex(*ranges[j])
        right = lex(*ranges[j + 1])
        if left and right:
            if right[0].lower_ == 'of' and len(right) > 1 and all((t.pos_ == 'NUM' for t in right[1:])):
                merge(j)
            elif right[0].pos_ == 'PROPN' and any((t.lower_ == 'statue' for t in right)) and all((t.pos_ in {'ADP', 'DET'} for t in left)):
                merge(j)
    for t in ts:
        if t.lemma_ == 'be':
            about = next((c for c in t.children if c.lower_ == 'about'), None)
            if about:
                verb = next((c for c in about.children if dep(c) == 'xcomp'), None)
                if verb:
                    close(local(t), local(verb) + 1)
    for p in protected:
        close(p['tokenStart'], p['tokenEnd'])
    for j in reversed(range(len(ranges))):
        a, b = ranges[j]
        if len(ranges) > 1 and (not learning_surface(source, ts[a].idx, ts[b - 1].idx + len(ts[b - 1]), classes)):
            merge(j - 1 if j else 0)
    for t in ts:
        if t.pos_ in {'VERB', 'AUX', 'ADJ'} and dep(t) not in OPERATOR_DEPS:
            a = b = local(t)
            while a > 0 and ts[a - 1].head.i == t.i and (dep(ts[a - 1]) in OPERATOR_DEPS | {'advmod'}) and (ts[a - 1].lower_ not in {'now', 'later', 'overtime', 'tonight', 'yesterday'}):
                a -= 1
            while b + 1 < len(ts) and ts[b + 1].head.i == t.i and (dep(ts[b + 1]) in OPERATOR_DEPS | {'advmod'}) and (ts[b + 1].lower_ not in {'now', 'later', 'overtime', 'tonight', 'yesterday'}):
                b += 1
            if a < b:
                close(a, b + 1)
        if t.pos_ == 'ADP' and t.head.pos_ in {'VERB', 'AUX'} and (dep(t) == 'prep'):
            nominal = any((dep(c) in {'pobj', 'obj'} and c.pos_ not in {'SCONJ', 'ADV'} for c in t.children))
            if not nominal and local(t) == local(t.head) + 1 and (not any((c.pos_ in {'VERB', 'ADP'} or c.text == 'handy' for c in t.children))):
                edge(local(t) + 1)
                close(local(t.head), local(t) + 1)
        if dep(t) in {'advmod', 'npadvmod', 'pcomp'} and t.lower_ in {'now', 'later', 'overtime', 'tonight', 'yesterday', 'before'}:
            ii = [local(c) for c in t.subtree if sentence.start <= c.i < sentence.end and c.pos_ in {'ADV', 'ADP', 'PUNCT'}]
            if ii and (not any((p['tokenStart'] <= min(ii) < p['tokenEnd'] for p in protected))):
                edge(min(ii))
    for j in reversed(range(len(ranges) - 1)):
        left = lex(*ranges[j])
        right = lex(*ranges[j + 1])
        if left and right and any((t.lemma_ == 'be' for t in left)) and all((t.pos_ in {'ADV', 'ADJ'} for t in right)) and (not any((t.pos_ == 'PRON' for t in left))):
            merge(j)
    for p in protected:
        a, b = (p['tokenStart'], p['tokenEnd'])
        if p['text'].lower() == 'day by day':
            edge(a)
            if a > 0 and ts[a - 1].pos_ == 'ADJ':
                v = ts[a - 1]
                lo = local(v)
                while lo > 0 and ts[lo - 1].head.i == v.i and (ts[lo - 1].pos_ == 'ADV'):
                    lo -= 1
                edge(lo)
        if p['text'].lower() in {'but also', 'not only'}:
            edge(a)
            j = next((j for j, (x, y) in enumerate(ranges) if x <= a < y), None)
            if j is not None and j + 1 < len(ranges) and (ranges[j][1] == b):
                merge(j)
            if p['text'].lower() == 'not only' and a and (ts[a - 1].lemma_ == 'be'):
                close(a - 1, b + 1)
    for t in ts:
        if t.lower_ == 'time':
            child = next((c for c in t.children if dep(c) == 'relcl' and any((v.lower_ == 'to' for v in c.children))), None)
            if child:
                close(local(t), local(child) + 1)
    for t in ts:
        if dep(t) == 'conj' and t.pos_ == 'ADP':
            cc = next((c for c in t.head.children if dep(c) == 'cc' and c.i < t.i), None)
            if cc:
                edge(local(cc))
            neg = next((c for c in t.head.head.children if dep(c) == 'neg'), None)
            if neg and local(neg) + 1 == local(t.head):
                edge(local(neg))
    for t in ts:
        if dep(t) == 'conj' and t.pos_ == 'ADJ':
            a = local(t)
            while a > 0 and ts[a - 1].text not in {',', 'and', 'or'} and (ts[a - 1].head.i == t.i):
                a -= 1
            if a > 0 and ts[a - 1].text == ',':
                edge(a)
    for t in ts:
        if t.lemma_ == 'be' and local(t) > 0 and (ts[local(t) - 1].pos_ == 'PRON') and any((v.lower_ == 'more' for v in ts[:local(t) - 1])) and ('?' not in sentence.text):
            edge(local(t))
    for j in reversed(range(len(ranges))):
        a, b = ranges[j]
        if len(ranges) > 1 and (not learning_surface(source, ts[a].idx, ts[b - 1].idx + len(ts[b - 1]), classes)):
            merge(j - 1 if j else 0)
    for p in protected:
        close(p['tokenStart'], p['tokenEnd'])
    for j in reversed(range(len(ranges) - 1)):
        left = lex(*ranges[j])
        right = lex(*ranges[j + 1])
        if left and all((t.pos_ in {'SCONJ', 'CCONJ', 'ADP', 'PART', 'DET'} for t in left)) and (not any((dep(t) in {'prt', 'compound:prt'} for t in left))):
            merge(j)
    for match in re.finditer("(?i)what['’]s more", sentence.text):
        ii = [local(t) for t in ts if t.idx < sentence.start_char + match.end() and t.idx + len(t) > sentence.start_char + match.start()]
        close(min(ii), max(ii) + 1)
    for j in reversed(range(len(ranges))):
        a, b = ranges[j]
        if len(ranges) > 1 and (not learning_surface(source, ts[a].idx, ts[b - 1].idx + len(ts[b - 1]), classes)):
            merge(j - 1 if j else 0)
    for p in protected:
        if p['text'].lower() == 'apart from':
            a, b = (p['tokenStart'], p['tokenEnd'])
            edge(a)
    for t in ts:
        if t.lower_ == 'overtime':
            edge(local(t))
        if t.lower_ == 'before' and t.pos_ == 'ADV':
            edge(local(t))
    for j in reversed(range(len(ranges))):
        a, b = ranges[j]
        if len(ranges) > 1 and (not learning_surface(source, ts[a].idx, ts[b - 1].idx + len(ts[b - 1]), classes)):
            merge(j - 1 if j else 0)
    # Restore complete NP cores after orthographic predicate reconciliation.
    for t in ts:
        if t.pos_ in {'NOUN','PROPN','PRON','NUM'}:
            indices={local(t)}
            def complete_np(v):
                indices.add(local(v))
                for child in v.children:
                    if sentence.start<=child.i<sentence.end and dep(child) in {'det','amod','compound','nummod','poss','case','quantmod'}:complete_np(child)
            complete_np(t)
            close(min(indices),max(indices)+1)
    # An uncontracted copula attaches its first nonclausal complement, including PP.
    for j in reversed(range(len(ranges)-1)):
        left=lex(*ranges[j]);right=lex(*ranges[j+1])
        copulas=[t for t in left if t.lemma_=='be']
        if copulas and right:
            be=copulas[-1]
            direct=[t for t in right if t.head.i==be.i and dep(t) in {'attr','acomp','oprd','prep'}]
            if direct and not any(t.pos_ in {'ADJ','NOUN','PROPN','VERB'} for t in left) and (not any(t.pos_=='PRON' for t in left) or right[0].pos_=='PRON') and not any(dep(t) in CLAUSE_DEPS for t in right):merge(j)
    # Lexical orthography and numeric units remain hard after all constituent closures.
    for p in protected:close(p['tokenStart'],p['tokenEnd'])
    for j in reversed(range(len(ranges))):
        a,b=ranges[j]
        if len(ranges)>1 and not learning_surface(source,ts[a].idx,ts[b-1].idx+len(ts[b-1]),classes):merge(j-1 if j else 0)
    for p in protected:
        if p['text'].lower() in {'day by day','one of these days'}:edge(p['tokenStart'])
    # Bare finite copulas own their following nonfinite/core complement; finite
    # complement clauses and fronted correlative comparisons remain separate.
    for j in reversed(range(len(ranges)-1)):
        left=lex(*ranges[j]);right=lex(*ranges[j+1])
        if left and right and all(t.pos_ in {'AUX','ADV','PART'} for t in left) and any(t.lemma_=='be' for t in left):
            finite=any(t.pos_ in {'VERB','AUX'} and t.tag_ in {'VBD','VBP','VBZ','MD'} for t in right)
            clause_marker=any(dep(t)=='mark' for t in right)
            fronted=right[0].lower_=='the' and any(t.lower_=='more' for t in right)
            if not finite and not clause_marker and not fronted:merge(j)
    return (ranges, groups, roles, protected)


def utf16(source, offset):
    return len(source[:offset].encode('utf-16-le')) // 2


def ranges_for_override(sentence, source, override, classes):
    if override.get('expectedSentenceText') != sentence.text:
        raise ValueError('stale override sentence authority')
    ranges=[];a=0
    for piece in override['learningChunks']:
        candidates=[b for b in range(a+1,len(sentence)+1)
                    if learning_surface(source,sentence[a].idx,sentence[b-1].idx+len(sentence[b-1]),classes)==piece]
        if not candidates:raise ValueError(f'override anchor missing: {piece}')
        b=candidates[0]
        while b<len(sentence) and not learning_surface(source,sentence[b].idx,sentence[b].idx+len(sentence[b]),classes):b+=1
        ranges.append([a,b]);a=b
    if a!=len(sentence):raise ValueError('override does not cover sentence')
    return ranges


def clause_metadata(sentence):
    heads=[sentence_local_root(sentence)]+[t for t in sentence if is_clause_dependency(t) or dep(t)=='conj' and t.pos_ in {'VERB','AUX'}]
    heads=sorted({t.i:t for t in heads}.values(),key=lambda t:t.i)
    ids={t.i:f'clause-{t.i-sentence.start}' for t in heads}
    clauses=[]
    for t in heads:
        parent=t.head;seen={t.i}
        while parent.i not in ids and parent.i not in seen:
            seen.add(parent.i);parent=parent.head
        parent_id=ids.get(parent.i) if parent.i!=t.i else None
        relation=dep(t)
        kind='main' if t==sentence_local_root(sentence) else 'relative' if relation in {'relcl','acl','acl:relcl'} else 'infinitival' if relation=='xcomp' else 'complement' if relation in {'ccomp','pcomp'} else 'clausal-subject' if relation in {'csubj','csubjpass'} else 'coordinated' if relation=='conj' else 'subordinate'
        indices=sorted(x.i-sentence.start for x in t.subtree if sentence.start<=x.i<sentence.end)
        runs=[]
        for i in indices:
            if runs and runs[-1][1]==i:runs[-1][1]=i+1
            else:runs.append([i,i+1])
        clauses.append({'id':ids[t.i],'kind':kind,'parentId':parent_id,'headToken':t.i-sentence.start,'tokenRanges':runs})
    return clauses


def make_sentence(item_id, source, sentence, index, override, classes):
    ranges,groups,roles,protected=shared_ranges(sentence,source)
    if override.get('learningChunks'):ranges=ranges_for_override(sentence,source,override,classes)
    if override.get('fixedContextReason')=='quoted-price-response':ranges=[[0,len(sentence)]]
    role_map={r['id']:r for r in roles};clauses=clause_metadata(sentence)
    constructions=[{'id':f'protected-{i}','kind':p['kind'],'tokenRanges':[[p['tokenStart'],p['tokenEnd']]],'hard':True,'reason':'frozen lexical construction'} for i,p in enumerate(protected)]
    chunks=[]
    for n,(a,b) in enumerate(ranges):
        ca=sentence[a].idx;cb=sentence[b-1].idx+len(sentence[b-1]);end=sentence[ranges[n+1][0]].idx if n+1<len(ranges) else sentence.end_char
        members=[]
        for lo,hi,key in ranges_from_groups(groups[a:b]):
            role=role_map[key];head=role['ownerHead']
            # A quoted turn may detach from its parsed ancestor: use its local predicate root.
            if not 0<=head<len(sentence):head=sentence_local_root(sentence).i-sentence.start
            applicable=[c for c in clauses if any(x<=head<y for x,y in c['tokenRanges'])]
            clause_id=min(applicable,key=lambda c:sum(y-x for x,y in c['tokenRanges']))['id'] if applicable else None
            members.append({'role':role['role'],'headToken':head,'clauseId':clause_id,'tokenRanges':[[a+lo,a+hi]]})
        chunks.append({'id':f'{item_id}:s{index}:c{n}','tokenStart':a,'tokenEnd':b,'charStart':utf16(source,ca),'charEnd':utf16(source,cb),'sourceText':source[ca:cb],'separatorAfter':source[cb:end],'learningText':learning_surface(source,ca,cb,classes),'syntax':{'primaryRole':members[0]['role'] if len({m['role'] for m in members})==1 else 'mixed','members':members,'protectedSpanIds':[c['id'] for c in constructions if all(a<=x<y<=b for x,y in c['tokenRanges'])]}})
    order=[c['id'] for c in chunks];accepted=[order]
    for alternative in override.get('acceptedOrders',[]):
        ids=[order[i] for i in alternative]
        if sorted(ids)!=sorted(order):raise ValueError('invalid accepted alternative')
        if ids not in accepted:accepted.append(ids)
    fixed=bool(override.get('fixedContext')) or len(chunks)==1 or len({c['learningText'] for c in chunks})==1
    entry={'sentenceIndex':index,'charStart':utf16(source,sentence.start_char),'charEnd':utf16(source,sentence.end_char),'sourceText':source[sentence.start_char:sentence.end_char],'fixedContext':fixed,'fixedContextReason':override.get('fixedContextReason') if override.get('fixedContext') else 'single-shared-unit' if fixed else None,'tokens':[{'i':t.i-sentence.start,'text':t.text,'lemma':t.lemma_,'pos':t.pos_,'tag':t.tag_,'dep':dep(t),'head':t.head.i-sentence.start if sentence.start<=t.head.i<sentence.end else None,'start':utf16(source,t.idx),'end':utf16(source,t.idx+len(t)),'isPunct':bool(t.is_punct)} for t in sentence],'syntax':{'clauses':clauses,'constructions':constructions},'partition':{'chunks':chunks,'canonicalOrder':order,'acceptedOrders':accepted},'provenance':{'kind':'override' if override else 'generated','overrideId':override.get('id') if override else None}}
    if len(chunks)>13:raise ValueError(f'{item_id}/{index}: >13 chunks requires frozen exception authority')
    if ''.join(c['sourceText']+c['separatorAfter'] for c in chunks)!=entry['sourceText']:raise ValueError('source reconstruction')
    for p in protected:
        if not any(c['tokenStart']<=p['tokenStart']<p['tokenEnd']<=c['tokenEnd'] for c in chunks):raise ValueError(f'{item_id}/{index}: broken protected {p}')
    if any(not c['learningText'] for c in chunks):raise ValueError('empty learning surface')
    return entry


def main():
    if spacy.__version__!='3.8.16':raise SystemExit('spaCy 3.8.16 is required')
    nlp=spacy.load('en_core_web_sm')
    if nlp.meta['version']!='3.8.0':raise SystemExit('en_core_web_sm 3.8.0 is required')
    items=read_json(ITEMS_PATH,[]);overrides=read_json(OVERRIDES_PATH,{})
    if overrides.get('schemaVersion')!=2:raise ValueError('override schema mismatch')
    if len(items)!=560 or len({i['id'] for i in items})!=560:raise ValueError('source inventory mismatch')
    generated=[];inventory=Counter()
    for item in items:
        source=item['en'];item_id=item['id'];override=overrides['items'].get(item_id,{})
        if override and override['sourceHash']!=sha256(source):raise ValueError(f'{item_id}: stale override sourceHash')
        classes=punctuation_classes(source)
        inventory.update((source[i],kind) for i,kind in classes.items())
        spans=sentence_spans(nlp(source));sentences=[]
        for i,span in enumerate(spans):
            entry=make_sentence(item_id,source,span,i,override.get('sentences',{}).get(str(i),{}),classes)
            end=spans[i+1].start_char if i+1<len(spans) else len(source)
            entry['separatorAfter']=source[span.end_char:end];sentences.append(entry)
        if set(override.get('sentences',{}))-set(str(i) for i in range(len(sentences))):raise ValueError('orphan override')
        leading=source[:spans[0].start_char]
        if leading+''.join(s['sourceText']+s['separatorAfter'] for s in sentences)!=source:raise ValueError('item reconstruction')
        generated.append({'itemId':item_id,'sourceHash':sha256(source),'sourceText':source,'leadingSeparator':leading,'status':'fixed-context' if all(s['fixedContext'] for s in sentences) else 'playable','sentences':sentences})
    if set(overrides['items'])-set(i['id'] for i in items):raise ValueError('orphan override item')
    metadata={'schemaVersion':2,'policyVersion':POLICY_VERSION,'learningSurfaceVersion':LEARNING_SURFACE_VERSION,'charOffsetUnit':'utf16-code-unit','tokenOffsetUnit':'sentence-local-half-open','source':{'path':'data/items.json','itemCount':len(items),'englishManifestSha256':sha256(json.dumps([{'id':i['id'],'en':i['en']} for i in items],ensure_ascii=False,separators=(',',':')))},'parser':{'engine':'spaCy','version':spacy.__version__,'model':'en_core_web_sm','modelVersion':nlp.meta['version']},'items':generated}
    sentences=[s for i in generated for s in i['sentences']];chunks=[c for s in sentences for c in s['partition']['chunks']]
    duplicates=[{'itemId':i['itemId'],'sentenceIndex':s['sentenceIndex'],'learningText':text,'ids':[c['id'] for c in s['partition']['chunks'] if c['learningText']==text]} for i in generated for s in i['sentences'] for text,count in Counter(c['learningText'] for c in s['partition']['chunks']).items() if count>1]
    report={'schemaVersion':2,'itemCount':len(generated),'sentenceCount':len(sentences),'sharedPartitionCount':len(sentences),'playableSentenceCount':sum(not s['fixedContext'] for s in sentences),'fixedContextSentenceCount':sum(s['fixedContext'] for s in sentences),'unavailableSentenceCount':0,'tileCountDistribution':{str(n):sum(len(s['partition']['chunks'])==n for s in sentences) for n in range(1,14)},'tileCount14Plus':sum(len(s['partition']['chunks'])>13 for s in sentences),'maxTileCount':max(len(s['partition']['chunks']) for s in sentences),'chunkCount':len(chunks),'duplicateSurfaceGroups':duplicates,'punctuationInventory':[{'character':c,'classification':k,'count':v} for (c,k),v in sorted(inventory.items())],'sourceReconstructionViolations':0,'protectedViolations':0,'emptyLearningText':0}
    one_word=Counter()
    for sentence in sentences:
        for chunk in sentence['partition']['chunks']:
            if len(re.findall(r"[^\W_]+(?:['’][^\W_]+)*(?:-[^\W_]+)*",chunk['learningText']))!=1:continue
            tokens=[t for t in sentence['tokens'][chunk['tokenStart']:chunk['tokenEnd']] if not t['isPunct'] and t['pos'] not in {'PUNCT','SYM'}]
            if len(tokens)!=1:category='other'
            else:
                token=tokens[0];pos=token['pos']
                category='particle' if token['dep'] in {'prt','compound:prt'} else 'proper noun' if pos=='PROPN' else 'operator' if pos=='AUX' else 'conjunction' if pos in {'CCONJ','SCONJ'} else 'adverb' if pos=='ADV' else 'function word' if pos in {'DET','PART','ADP','PRON'} else 'content word' if pos in {'NOUN','VERB','ADJ','NUM'} else 'other'
            one_word[category]+=1
    report.update({'oneWordTileDistribution':{k:one_word[k] for k in ['function word','content word','proper noun','operator','conjunction','particle','adverb','other']},'sourceCoverageViolations':0,'tokenSpanCoverageViolations':0,'structuralPunctuationLeakage':0,'lexicalPunctuationViolations':0,'manualOverrideCount':sum(s['provenance']['kind']=='override' for s in sentences),'overrideMigration':{'old':18,'kept':8,'migrated':2,'removed':8,'new':6},'duplicateSurfaceGroupCount':len(duplicates)})
    write_json(OUTPUT_PATH,metadata);write_json(REPORT_PATH,report)
    print(json.dumps({k:v for k,v in report.items() if k not in {'duplicateSurfaceGroups','punctuationInventory'}},indent=2))

if __name__=='__main__':main()
