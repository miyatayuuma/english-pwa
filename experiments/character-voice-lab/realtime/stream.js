const sentences = new Intl.Segmenter("en", { granularity: "sentence" });
const abbreviation = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|[A-Z])\.$/i;
const ending = /[.!?]["'’”)]*$/;
const clause = /[,;:—]\s+/g;
const limit = 155;
export const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export class UtteranceBuffer {
  pending = "";

  push(token, done = false) {
    this.pending += token;
    const output = [];
    while (this.pending.trim()) {
      const parts = [...sentences.segment(this.pending)];
      let cut = 0;
      for (const { index, segment } of parts) {
        const text = this.pending.slice(0, index + segment.length).trim();
        if (text.length > limit) break;
        if ((index + segment.length < this.pending.length || /\s$/.test(this.pending) || done)
          && ending.test(text) && !abbreviation.test(text)) {
          cut = index + segment.length;
          break;
        }
      }
      if (!cut && this.pending.trim().length > limit) {
        const prefix = this.pending.slice(0, limit);
        cut = [...prefix.matchAll(clause)].map(match => match.index + 1).filter(i => i >= 45).at(-1)
          ?? prefix.lastIndexOf(" ");
        if (cut < 1) cut = limit;
      }
      if (!cut && done) cut = this.pending.length;
      if (!cut) break;
      output.push(this.pending.slice(0, cut).trim());
      this.pending = this.pending.slice(cut).trimStart();
    }
    return output;
  }
}

export async function* simulate(turns, signal, tokenMs = 45) {
  for (const turn of turns) {
    if (signal.aborted) return;
    // An approved phoneme sequence covers the whole utterance.
    if (turn.kokoroPhonemes) {
      yield { ...turn, receivedAt: performance.now() };
      continue;
    }
    const buffer = new UtteranceBuffer();
    for (const token of turn.text.match(/\S+\s*/g)) {
      await pause(tokenMs);
      if (signal.aborted) return;
      for (const text of buffer.push(token)) yield { ...turn, text, receivedAt: performance.now() };
    }
    for (const text of buffer.push("", true)) yield { ...turn, text, receivedAt: performance.now() };
  }
}

export function distribution(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted[Math.ceil(p * sorted.length) - 1];
  return { count: sorted.length, p50: percentile(0.50), p95: percentile(0.95), max: sorted.at(-1) };
}
