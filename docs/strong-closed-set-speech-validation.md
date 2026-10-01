# Strong closed-set speech: validation gate

Implementation starts from main `9d9f4315e2c6e81777926ffc95fcadbafaecb7ca` (PR #242, v5.62).

## Authorities

The Vocabulary answer card and expression TTS display/speak `displayAnswer(entry)` (canonical). Strict TARGET accepts canonical, explicit `answers[]`, and the exact active source occurrence. The speech planner uses those same complete accepted utterances, including literal placeholder expressions/constructions; it does not reduce an expression card to its headword. `yield` and `yield to something` are separate entries. No dataset re-curation is included.

The strict lexical classifier remains unchanged. The speech adapter first accepts strict primary TARGET or retrieval PARAPHRASE. For primary MISS, it permits only the five specified fillers and exact target-prefix restart repetitions, or a strict TARGET production in a lower native candidate. Lower PARAPHRASE never rescues a MISS. During correction PARAPHRASE is a practice MISS; native TARGET may complete practice. Raw primary text always remains unchanged.

Native candidates are kept by segment, with defensive copies and actual zero-based ASR rank. A rescued complete TARGET must occur within one native segment; other segments may contain only leading target-prefix restarts/fillers and trailing fillers. A preceding `not` or any substantive extra words veto the rescue. Native primary accumulation is retained. No alternate cross-product, beam, synthetic full transcript, independent phonetic/fuzzy threshold, or confidence acceptance gate exists.

Vocabulary full utterances use 8.0, target chunks 7.0 and overlaps 6.0. Correction uses whole 8.0 and chunks 7.5. Cloze uses target-containing chunks 7.0, target overlaps 6.0 and surrounding chunks 5.0, without a high-boost full-sentence phrase. The speech-only planner uses punctuation, clause/phrase start hints, variable segment lengths, complete MWE target ranges and overlapping context; it does not share Reordering tile ownership. All plans deduplicate case-insensitively and cap at 24 phrases. A deterministic 560-item corpus audit produced at most 16 phrases (zero plans at the cap); this is context coverage, not acoustic evidence.

Vocabulary, Cloze and correction request five native alternatives; other sentence attempts request one. Browser support may still return only one. Contextual capability fallback is independent of alternative support and retains the PR #242 session disable/one pre-transcript retry. Cloze alternatives are captured but deliberately do not alter full-sentence grading in this first stage. Correction counters, SRS/history exact-once, audio/mic settling and stale-event isolation are retained.

## Android real-device gate — NOT RUN

The implementation environment has no connected Android device or live user microphone. Its local browser cannot launch because native socket creation is denied; local browser skips are not counted as passes. Chromium UI/application verification is performed by GitHub Application CI. Mock recognition establishes data flow and grading policy, not recognition quality or human intelligibility.

The observed fixtures `YouTube`/`able to`, `scarcity`, and `confused` are user-reported PWA observations. Tests simulate these native alternatives. No user-observed fixture is invented from ChatGPT transcription.

Use `tests/manual/closed-set-speech.html` over HTTPS (or Android Chrome localhost via local port forwarding). From this branch, serve the repository root; the page imports the actual production controller, planner and speech adapter. Its baseline planner is a frozen PR #242 module with import paths adjusted, uses rank-one strict grading, and requests one candidate. Both arms keep the existing backend; neither changes `processLocally`.

1. Open the page on Android Chrome and grant microphone access. Record device/Chrome version, microphone/headset, noise conditions and network. Check the capability panel. If contextual APIs are unsupported or `phrases-not-supported` occurs, distinguish the fallback arm rather than claiming bias was applied.
2. Alternate baseline and strong groups to limit warm-up/order effects, keeping device position, volume and speaking style comparable. Say each correct expression 10 times per arm: `yield to something`, `scarcely`, `confuse`, `learn one's lesson` (80 correct trials total).
3. Also say each deliberate wrong utterance 10 times per arm: `want to do something`, `carefully`, `refuse`, `forget the answer`. The selected target remains the corresponding correct expression (80 wrong trials total).
4. Stop or allow native auto-end for each attempt. The page records exact primary TARGET, filler/restart primary TARGET, native TARGET rescue, MISS, and technical failure separately, plus primary transcript, native accepted rank, requested alternatives, bias assignment/fallback and user agent. No TTS or mock speech is used. Data stays in memory until explicitly exported as CSV; raw candidate lists are not persisted.
5. Export the CSV before leaving the page. Report TARGET/all-trials and TARGET/non-technical-trials for correct probes, and false-positive rate for wrong probes, separately per arm and fixture. Do not count technical failures as pronunciation MISS.
6. Compare rates and inspect wrong-probe TARGET cases. Strong bias alone can create a native TARGET candidate; its presence is not proof of independent acoustic/human intelligibility. If clearly wrong utterances frequently collapse to TARGET, lower the central boosts and rerun both positive and negative probes. Do not mark CLOSED or merge the release before reviewing this evidence.

| Fixture | Baseline correct /10 | Strong exact /10 | Strong tolerated /10 | Strong rescued /10 | Strong MISS /10 | Technical | Wrong-probe false positives |
|---|---|---|---|---|---|---|---|
| yield to something | not run | not run | not run | not run | not run | not run | not run |
| scarcely | not run | not run | not run | not run | not run | not run | not run |
| confuse | not run | not run | not run | not run | not run | not run | not run |
| learn one's lesson | not run | not run | not run | not run | not run | not run | not run |

Release status: **BLOCKED on Android positive/negative acoustic validation**. The v5.63 version/cache changes belong to the unmerged candidate, not a production release.
