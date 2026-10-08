// Post-audit production override for vocab:00139. Frozen audit snapshots remain unchanged.
// Exact before/after surfaces are pinned so unrelated drift cannot be accepted.
export const VOCAB_00139_ASR_REMEDIATION = Object.freeze({
  id: 'vocab:00139',
  before: Object.freeze({
    "meaning_ja": "座るとすぐに電話が鳴った",
    "canonical": "no sooner had I sat down than the phone rang",
    "paraphrases": [
      "the phone rang as soon as I sat down",
      "hardly had I sat down when the phone rang"
    ]
  }),
  after: Object.freeze({
    "meaning_ja": "私が到着するとすぐに、電話が鳴った",
    "canonical": "no sooner had I arrived than the phone rang",
    "paraphrases": [
      "the phone rang as soon as I arrived",
      "hardly had I arrived when the phone rang"
    ]
  }),
});
