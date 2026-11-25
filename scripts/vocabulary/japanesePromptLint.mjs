const META_HINT = /(倒置|構文|文型|語順|文法|時制|不定詞|動名詞|分詞構文|関係代名詞|受動態|能動態|比較級|最上級|可算|不可算|countability|register|dialect|方言|口語|文語|米語|英語圏|アメリカ英語|イギリス英語|敬語|丁寧語|古風|発音|強勢|語形|スペリング|表現法|構文上)/i;

export function lintRecommendedPrompt(prompt, canonical = "") {
  if (typeof prompt !== "string" || !prompt.trim()) return { targetLeakage: true, metaHint: false, leakedTokens: ["<missing>"] };
  const allowed = new Set(["someone", "somebody", "something", "somewhere", "someplace", "one", "ones"]);
  const leakedTokens = (prompt.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).filter((token) => {
    const normalized = token.toLowerCase();
    if (allowed.has(normalized)) return false;
    if (normalized === "else" && /\b(?:someone|somebody|something|somewhere|someplace|one|ones)\s+else\b/i.test(prompt)) return false;
    return true;
  });
  const canonicalTextLeaked = canonical && prompt.toLowerCase().includes(canonical.toLowerCase());
  return { targetLeakage: leakedTokens.length > 0 || Boolean(canonicalTextLeaked), metaHint: META_HINT.test(prompt), leakedTokens };
}
