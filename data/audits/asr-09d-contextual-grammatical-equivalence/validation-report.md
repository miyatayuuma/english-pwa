# ASR-09D validation report

- Historical ambiguous-d candidates accounted for: 18/18.
- Status counts: SAFE_CONTEXT_RESOLVED 12; AMBIGUOUS_UNRESOLVED 1; REJECT 1; OUT_OF_SCOPE 4.
- Approved patterns: asr09d-had-past-participle, asr09d-would-base-verb.
- Positive fixtures: 14 unique contexts; tested bidirectionally.
- Negative controls: 23.
- Modes: vocabulary, correction; Read/Cloze additions: 0.
- Version boundary: v5.104; current APP_VERSION is validated as greater than or equal to this boundary.
- Production data blobs: Vocabulary 91324d35b2db1911ece2cf3ff746409d321fe963; Items ae2aca768b784199b77ac1cf8c0c5a80fd5725bb.
- Benchmark baseline: 1e613b1020d77031e1d7f59ed342c416867da383; implementation: ff4fedd737ab32046b832e3a29f7c362d20179fe.

The resolver independently evaluates complete expected and observed token arrays. Only an explicitly allowlisted past participle selects had, and only an explicitly allowlisted bare verb selects would. Syncretic forms and unsupported contexts remain unmatched.
