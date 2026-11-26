import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { simulate, UtteranceBuffer } from "./stream.js";

const scenarios = JSON.parse(await readFile(new URL("./scenarios.json", import.meta.url)));
const collect = async stream => {
  const output = [];
  for await (const row of stream) output.push(row);
  return output;
};

test("streaming retains contractions, a title and a decimal across token boundaries", async () => {
  const rows = await collect(simulate(scenarios.dialogue, new AbortController().signal, 0));
  assert.deepEqual(rows.map(({ speaker, text }) => [speaker, text]), [
    ["jennifer", "I found it."],
    ["jennifer", "The key was under the blue cup."],
    ["bob", "That explains it, but I still don't know who moved the cup."],
    ["jennifer", "Let's ask Dr. Moss."],
    ["jennifer", "She was here at 3.15, just before the rain started."],
    ["ted", "Give me a minute."],
    ["ted", "I'll check the note by the window."],
  ]);
});

test("long clauses are bounded and text is preserved", () => {
  const original = "The view from the new bridge was lovely, " + "and the little white boat was moving slowly ".repeat(8);
  const buffer = new UtteranceBuffer();
  const chunks = buffer.push(original, true);
  assert(chunks.every(chunk => chunk.length <= 155));
  assert.equal(chunks.join(" "), original.trim());
});

test("phoneme overrides remain indivisible and abort drops unplayed input", async () => {
  const controller = new AbortController();
  const turn = { speaker: "bob", text: "I read it. I read it again.", kokoroPhonemes: "aɪ ɹɛd ɪt." };
  const generator = simulate([turn, ...scenarios.dialogue], controller.signal, 0);
  const { value } = await generator.next();
  assert.equal(value.kokoroPhonemes, turn.kokoroPhonemes);
  assert.equal(value.text, turn.text);
  controller.abort();
  assert.deepEqual(await generator.next(), { done: true, value: undefined });
});
