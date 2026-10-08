# Vocabulary Near-Synonym Prompt Differentiation Audit

Base main: `f448394e3052c686d8cad97912c3b779345b758e`
Population: 2478 Vocabulary entries.
Exact duplicate prompt groups: 115.
Near-equivalent prompt pairs surfaced through same-sense or accepted-paraphrase overlap: 70.
Candidate groups reviewed: 178; affected entries: 104.
KEEP: 136; PROMPT_QUALIFIER: 0; PROMPT_AND_PARAPHRASE: 42; UPSTREAM_AUTHORITY_REVIEW: 0.
Recommended paraphrase removals: 162; additions: 4.
Cross-entry canonical/accepted-paraphrase pairs scanned: 467; shared-paraphrase pairs scanned: 385.

## Authority and scope

The remote main at audit start was `f448394e3052c686d8cad97912c3b779345b758e`. The source snapshot is tied to the recorded production and audit authority file hashes. Existing Meaning/Canonical, Paraphrase, Grammar Role, and Final Admission authorities are inputs; this task does not rewrite them. Production changes: 0.

## Representative family: terrific / marvelous

Candidate group: `NSD-01030-01246` (PROMPT_AND_PARAPHRASE, MEDIUM).
- **splendid** `vocab:01030`: `素晴らしい` → `すばらしい（見事で印象に残る）`; current paraphrases: great, wonderful, excellent, fantastic, awesome, terrific.
  - Recommended paraphrases: magnificent; remove: great, wonderful, excellent, fantastic, awesome, terrific.
- **terrific** `vocab:01084`: `すばらしい` → `すばらしい（口語的で勢いのある強い称賛）`; current paraphrases: great, wonderful, excellent, fantastic, awesome, splendid.
  - Recommended paraphrases: awesome, fantastic; remove: great, wonderful, excellent, splendid.
- **fabulous** `vocab:01109`: `素晴らしい` → `素晴らしい（非常に優れていて魅力的）`; current paraphrases: great, excellent, wonderful, fantastic.
  - Recommended paraphrases: fantastic; remove: great, excellent, wonderful.
- **marvelous** `vocab:01246`: `すばらしい` → `すばらしい（良さに感嘆する評価）`; current paraphrases: great, wonderful, excellent, amazing, fantastic.
  - Recommended paraphrases: wonderful, splendid; remove: great, excellent, amazing, fantastic.
- Reason: terrificは口語的で勢いのある強い称賛、marvelousは「extremely good」で感嘆を伴う評価、fabulousは非常に優れ魅力的、splendidは見事・印象的な称賛に寄せる。genericなgreat/excellentなどを整理する。ただしmarvelousを古風・上品と固定する根拠は確認できず、その断定は採用しない。
- Spelling: `marvellous` is a spelling variant, not a paraphrase. Runtime answer normalization does not convert British/American spelling; it remains a separate spelling-authority follow-up, outside this audit’s paraphrase recommendations.

## Classifications

- `NSD-00003-00095` — **KEEP** — come across someone (someoneに偶然出会う); run into someone (someoneに偶然出会う) — 共通の日本語promptは複数canonicalに共通する中心義を簡潔に表している。現行sense_keyとgrammarRoleも同じで、括弧補足を加えても安定した実用差を作れず、accepted paraphraseも日常的な代替として成立するため現状維持。
- `NSD-00016-00603` — **PROMPT_AND_PARAPHRASE** — at first sight (一目で); at a glance (一目で) — at first sightは初めて見た時点・第一印象を表し、at a glanceは短く見る動作を表す。共通の「一目で」だけでは時点と視線の方法が混同される。相互accepted paraphraseを外し、主訳は維持して補足で区別する。
- `NSD-00017-00434` — **PROMPT_AND_PARAPHRASE** — take a chance (思い切ってやってみる); go for it (思い切ってやってみる) — take a chanceは結果が不確実でも機会を試すこと、go for itは迷わず実行する・相手に実行を促す言い方。共有していたtake the plungeは両promptで成立するが、go for it側の代替としては境界を薄めるため、リスク側に残す。
- `NSD-00029-00089` — **PROMPT_AND_PARAPHRASE** — in a hurry (急いで); in haste (急いで) — in a hurryは日常会話で広く使う表現、in hasteはより改まった・文章寄りの言い方。現行paraphraseが相互canonicalを同じ答えとして吸収しているため、補足でregisterを示し相互受理を除く。
- `NSD-00031-00570` — **KEEP** — by mistake (間違えて); by accident (意図せずに) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00044-00863` — **KEEP** — be eager to do something (somethingすることを強く望む); be anxious to do something (somethingするのを切望している) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00055-01237` — **KEEP** — to a certain extent (ある程度); somewhat (いくらか) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00057-02470` — **KEEP** — no doubt (きっと); for sure (確かに); necessarily (必ず) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00063-00313` — **KEEP** — in all likelihood (おそらく); chances are (おそらく) — 両方の中心義は「おそらく」で自然に表せる。in all likelihoodは副詞句として文全体の確からしさを示し、chances areは節を導く構文として使われるため、grammarRoleと表現構造で区別できる。語感補足を重ねる必要はなく、probablyも両方の自然な言い換えとして維持する。
- `NSD-00068-00569` — **PROMPT_AND_PARAPHRASE** — so far (今のところ); for the time being (当分の間); for the moment (今のところ); at present (現在のところ) — so farは過去から現在までの到達点、for the moment/for the time beingは一時的な状態、at presentは基準時点での現在状態を表す。for nowをso farのaccepted paraphraseから外し、他の句は現在の時点・暫定性に合わせて狭める。
- `NSD-00069-00381` — **KEEP** — no less than (（数量が）〜も); as many as (（数が）〜もの、〜も) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00072-00559` — **KEEP** — bring about something (somethingを引き起こす); result in something (somethingという結果をもたらす); give rise to something (somethingを引き起こす) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00073-00521` — **KEEP** — as a whole (全体として); on the whole (全体として) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00079-00126` — **KEEP** — owing to (〜が原因で); on account of (〜が原因で) — 共通の日本語promptは複数canonicalに共通する中心義を簡潔に表している。現行sense_keyとgrammarRoleも同じで、括弧補足を加えても安定した実用差を作れず、accepted paraphraseも日常的な代替として成立するため現状維持。
- `NSD-00082-00693` — **KEEP** — recover from something (somethingから回復する); get over something (somethingを乗り越える) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00094-00389` — **KEEP** — hang out (ぶらぶら過ごす); hang around (ぶらぶらする) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00096-02231` — **KEEP** — rob someone of something (someoneからsomethingを奪う); deprive someone of something (someoneからsomethingを奪う); deprive someone of something (someoneからsomethingを奪う) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00099-00352` — **KEEP** — turn to someone (someoneに頼る); count on someone (someoneを頼りにする) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00106-00812` — **KEEP** — differ from something (somethingと異なる); differ (異なる) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00108-00228` — **KEEP** — make something out (somethingを見分ける・理解する); figure something out (somethingを理解する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00110-00671` — **KEEP** — back someone up (someoneを支持する); stand by someone (someoneのそばにいて支える); be there for someone (someoneのそばにいて支える) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。 kind/grammarRoleにも差がある候補は、Vocabulary上の品詞・表現構造の区別を維持する。
- `NSD-00111-01918` — **KEEP** — talk someone into doing something (someoneを説得してsomethingさせる); persuade someone to do something (someoneを説得してsomethingさせる) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00118-02058` — **PROMPT_AND_PARAPHRASE** — in practice (実際には); as a matter of fact (実際のところ); in fact (実のところ); actually (実際には); in reality (実際には) — これらは日本語では近い訳になるが、in practiceは実運用、actuallyは予想の訂正、in realityは見かけとの対比、in fact/as a matter of factは事実の補足・強調に寄る。汎用的な相互paraphraseを残すとこの学習境界が消えるため、各promptに短い用途補足を付け、補足と両立するものだけ残す。
- `NSD-00121-00182` — **KEEP** — despite something (somethingにもかかわらず); in spite of something (somethingにもかかわらず) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00130-02210` — **KEEP** — be to blame for something (somethingについて責任がある); be responsible for something (somethingに責任がある); be responsible for something (somethingについて責任を負っている); be in charge of something (somethingを担当している) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00132-00643` — **KEEP** — get rid of something (somethingを処分する); do away with something (somethingをなくす); throw something away (somethingを捨てる) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00145-01755` — **KEEP** — make believe (〜のふりをする); pretend (ふりをする) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00152-01802` — **KEEP** — as a rule (一般に); by and large (概して); generally (一般に); in general (一般に) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00165-00366` — **KEEP** — be faced with something (somethingに直面している); be confronted with something (somethingに直面している) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00169-01702` — **KEEP** — make progress (進歩する); advance (進歩する) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00189-00198` — **KEEP** — hand something in (somethingを提出する); turn something in (somethingを提出する) — 共通の日本語promptは複数canonicalに共通する中心義を簡潔に表している。現行sense_keyとgrammarRoleも同じで、括弧補足を加えても安定した実用差を作れず、accepted paraphraseも日常的な代替として成立するため現状維持。
- `NSD-00190-00350` — **KEEP** — no later than (遅くとも〜までに); at the latest (遅くとも) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00191-01632` — **KEEP** — anything but (決して〜ではない); by no means (決して〜ない); not at all (少しも〜ない) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00193-01502` — **KEEP** — to begin with (まず第一に); first of all (まず第一に) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00195-00540` — **KEEP** — deal with something (somethingに対処する); see to something (somethingをきちんと処理する); cope with something (somethingに対処する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00199-00279` — **KEEP** — I have my hands full (手が離せない); be tied up (手が離せない) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。 kind/grammarRoleにも差がある候補は、Vocabulary上の品詞・表現構造の区別を維持する。
- `NSD-00201-01340` — **KEEP** — get mad at someone (someoneに腹を立てる); lose your temper (腹を立てる); resent (腹を立てる) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00203-01063` — **KEEP** — think something over (somethingをよく考える); look back on something (somethingを振り返る); reflect on something (somethingについてじっくり考える); reflect (熟考する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00207-02065` — **KEEP** — focus on something (somethingに焦点を当てる); concentrate on something (somethingに集中する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00213-02254` — **PROMPT_AND_PARAPHRASE** — barely (かろうじて); narrowly (かろうじて) — barelyは基準をぎりぎり満たすこと、narrowlyは僅差・小さな余裕での成立に寄る。narrowlyからbarely/only justを除き、境界を明示する自然な句by a narrow marginを1件追加する。
- `NSD-00215-00216` — **KEEP** — consist of something (somethingから成る); be composed of something (somethingで構成されている) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00231-00474` — **KEEP** — keep on doing something (somethingし続ける); persist in doing something (somethingし続ける) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00249-01633` — **KEEP** — every now and then (時々); once in a while (時々); at times (時々); from time to time (時々) — 共通の日本語promptは複数canonicalに共通する中心義を簡潔に表している。現行sense_keyとgrammarRoleも同じで、括弧補足を加えても安定した実用差を作れず、accepted paraphraseも日常的な代替として成立するため現状維持。
- `NSD-00263-02408` — **KEEP** — talk something over (somethingについてじっくり話し合う); discuss something (somethingについて話し合う) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00264-01811` — **KEEP** — mean to do something (somethingするつもりである); intend to do something (somethingするつもりである) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00276-01962` — **KEEP** — start over (最初からやり直す); resume (再開する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00277-00295` — **KEEP** — do someone a favor (someoneのために手を貸す); give someone a hand (someoneを手伝う) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00280-02340` — **PROMPT_AND_PARAPHRASE** — turn up (現れる); show up (現れる); emerge (現れる) — turn up/show upは人・物が来る／姿を見せる、emergeは隠れたものが見えるようになる・存在が現れる側に寄る。emergeのshow upを外し、汎用性を保つappearだけを残す。
- `NSD-00286-01506` — **KEEP** — right away (すぐに); immediately (すぐに); at once (すぐに) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00290-00478` — **KEEP** — there's no use doing something (somethingしても無駄だ); there's no point in doing something (somethingしても無駄だ) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00292-00660` — **PROMPT_AND_PARAPHRASE** — chill out (落ち着く); calm down (落ち着く); settle down (身を落ち着ける) — chill outは緊張をゆるめてくつろぐ口語表現、calm downは興奮・怒りを静める表現、settle downは別の代表義として生活を安定させる。chill out/calm downの相互境界とsettle downへの広すぎる受理を除く。
- `NSD-00299-00518` — **KEEP** — time and again (何度も繰り返し); over and over again (何度も何度も) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00301-01673` — **KEEP** — be abundant in something (somethingが豊富である); be rich in something (somethingが豊富である) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00303-02442` — **PROMPT_AND_PARAPHRASE** — be indispensable for something (somethingに不可欠である); be a must (欠かせない); significant (重要な); crucial (極めて重要な); indispensable (不可欠な); vital (不可欠な); essential (不可欠な); of importance (重要な) — significant/of importance/crucialは重要度を、essential/vital/indispensableは必要性を中心にする。共通prompt「不可欠な」の3語だけを代替不能性・成功への重要性・必須条件に分ける。現在の相互paraphraseはこの差を消すため3語の相互accepted setを除去し、他の重要度語は現行promptのまま維持する。
- `NSD-00311-00698` — **KEEP** — call something off (somethingを中止する); break something off (somethingを打ち切る) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00315-01457` — **KEEP** — for the most part (大部分は); mostly (大部分は) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00317-01861` — **KEEP** — in particular (特に); especially (特に) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00322-02226` — **KEEP** — depend on something (something次第である); rely (頼る); rely on something (somethingを頼りにする); resort to something (somethingに頼る) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00323-00326` — **KEEP** — keep up with something (somethingについていく); keep pace with something (somethingと同じペースで進む) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00330-01380` — **KEEP** — in every respect (あらゆる点で); in every way (あらゆる点で) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00354-02437` — **KEEP** — don't mention it (どういたしまして); you're welcome. (どういたしまして) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00359-02085` — **KEEP** — lay someone off (someoneを一時解雇する); fire (解雇する); dismiss (解雇する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00364-00365` — **PROMPT_AND_PARAPHRASE** — be worried about something (somethingを心配している); be concerned about something (somethingを心配している) — worriedは不安・心配の感情、concernedは不安を含み得るが関心や気遣いも表す。現行の相互canonical paraphraseだけではこの広がりが埋もれるため、両promptに短く示し相互受理を外す。
- `NSD-00372-01183` — **KEEP** — in addition to something (somethingに加えて); besides something (somethingに加えて); as well as (〜に加えて) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00402-01169` — **KEEP** — refrain from something (somethingを控える); cut down on something (somethingを減らす) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00408-02062` — **KEEP** — look after someone (someoneの面倒を見る); care for someone (someoneの世話をする) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00412-00528` — **PROMPT_AND_PARAPHRASE** — be obliged to do something (somethingせざるを得ない); be forced to do something (somethingせざるを得ない); have no choice but to do something (somethingせざるを得ない) — be obligedは義務・必要、be forcedは外部からの強制、have no choiceは選択肢の欠如を前面に出す。現行の相互受理は構造的な違いをなくすため除き、no choiceのentryに現行のbe compelledだけを残す。
- `NSD-00413-02060` — **KEEP** — regard something as something else (somethingをsomething elseと見なす); think of something as something else (somethingをsomething elseと考える) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00432-00948` — **KEEP** — give in (屈する); yield (屈する) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00442-02417` — **KEEP** — have faith in someone (someoneを信頼する); trust someone (someoneを信頼する) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00443-02055` — **KEEP** — make it (うまくやる); do well (うまくやる) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00459-00606` — **KEEP** — adapt to something (somethingに順応する); adjust to something (somethingに順応する) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00461-00530` — **KEEP** — one of these days (いつかそのうち); sooner or later (遅かれ早かれ) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00466-01817` — **KEEP** — free of charge (無料で); for free (無料で) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00470-02167` — **KEEP** — at one time (同時に); simultaneously (同時に) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00480-00597` — **PROMPT_AND_PARAPHRASE** — in someone's presence (someoneの前で); in front of someone (someoneの前で) — in someone’s presenceはその人がいる場・同席を表し、in front of someoneは主に物理的位置を表す。相互paraphraseでは場面の区別を失うため双方から除き、中心訳は維持する。
- `NSD-00484-00490` — **KEEP** — be fed up with something (somethingにうんざりしている); be sick of something (somethingにうんざりしている) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00502-00634` — **PROMPT_AND_PARAPHRASE** — tend to do something (somethingする傾向がある); be inclined to do something (somethingする傾向がある) — tend toは一般的・反復的な傾向、be inclined toは本人の気持ちや意向に寄りやすい。共有のhave a tendencyは両方で自然なため維持し、相互canonical paraphraseだけ外す。
- `NSD-00503-01675` — **KEEP** — associate something with something else (somethingをsomething elseと結び付ける); connect something with something else (somethingをsomething elseとつなぐ) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00513-01186` — **KEEP** — take something down (somethingを書き留める); write something down (somethingを書き留める) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00516-00820` — **KEEP** — way out (解決策); solution (解決策) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00522-01882` — **KEEP** — all but (ほとんど); nearly (ほとんど) — 共通の日本語promptは複数canonicalに共通する中心義を簡潔に表している。現行sense_keyとgrammarRoleも同じで、括弧補足を加えても安定した実用差を作れず、accepted paraphraseも日常的な代替として成立するため現状維持。
- `NSD-00526-01754` — **PROMPT_AND_PARAPHRASE** — succeed in doing something (somethingすることに成功する); manage to do something (somethingをなんとか成し遂げる) — succeed in doing somethingは結果として成功したこと、manage to do somethingは困難や工夫を乗り越えて何とか達成したことを含みやすい。相互canonical paraphraseを除き、両方に自然なpull something offは残す。
- `NSD-00532-01818` — **KEEP** — be bound to do something (きっとsomethingする); be sure to do something (必ずsomethingする) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00537-00669` — **KEEP** — be in a difficult situation (困難な状況にある); be in trouble (困った状況にある) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00541-01495` — **KEEP** — be to do something (somethingすることになっている); be supposed to do something (somethingすることになっている) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00553-02039` — **KEEP** — once and for all (きっぱりと); flatly (きっぱりと) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00554-00760` — **KEEP** — meet someone halfway (someoneと歩み寄る); compromise with someone (someoneと妥協する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00573-00685` — **KEEP** — all of a sudden (突然); all at once (突然) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00582-02368` — **KEEP** — in search of something (somethingを求めて); look for something (somethingを探す); search for something (somethingを探す) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。 kind/grammarRoleにも差がある候補は、Vocabulary上の品詞・表現構造の区別を維持する。
- `NSD-00599-01511` — **KEEP** — look down on someone (someoneを見下す); despise someone (someoneを軽蔑する); feel contempt for someone (someoneを軽蔑する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00608-00654` — **KEEP** — to tell the truth (正直に言うと); to be honest (正直に言うと) — 共通の日本語promptは複数canonicalに共通する中心義を簡潔に表している。現行sense_keyとgrammarRoleも同じで、括弧補足を加えても安定した実用差を作れず、accepted paraphraseも日常的な代替として成立するため現状維持。
- `NSD-00613-01810` — **PROMPT_AND_PARAPHRASE** — be up for something (somethingをする気がある); be willing to do something (進んでsomethingする気がある) — be up for somethingは口語的に「やりたい・乗り気」、be willing to do somethingは行為をする意思・受諾に寄る。前者のaccepted paraphrase be willing toを外し、後者はprepared toを維持する。
- `NSD-00635-01512` — **KEEP** — make fun of someone (someoneをからかう); laugh at someone (someoneを笑う) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00676-00985` — **KEEP** — put up with something (somethingに我慢する); tolerate something (somethingを我慢する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00677-00967` — **KEEP** — take advantage of someone (someoneを利用する); exploit someone (someoneを搾取する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00683-01977` — **KEEP** — interfere with something (somethingの邪魔をする); disturb something (somethingを邪魔する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00687-02109` — **KEEP** — spoil (雰囲気などを台無しにする); ruin (台無しにする) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00690-01653` — **KEEP** — make arrangements for something (somethingを手配する); set something up (somethingを設立する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00692-02464` — **KEEP** — fade away (徐々に消えていく); fade (次第に消える) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00711-01359` — **KEEP** — pursue (追い求める); seek (探し求める) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00714-00767` — **KEEP** — outcome (結果); consequence (結果) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00715-01460` — **PROMPT_AND_PARAPHRASE** — accurate (正確な); precise (正確な); exact (正確な) — accurateは誤りのなさ、preciseは細部の明確さ、exactは一致・厳密な対応を表す。現在の相互paraphraseを絞り、accurateのcorrectだけ残す。
- `NSD-00717-00870` — **KEEP** — vague (曖昧な); ambiguous (曖昧な); obscure (不明瞭な) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00719-00902` — **PROMPT_AND_PARAPHRASE** — sufficient (十分な); adequate (十分な) — sufficientは目的に必要な量・条件を満たすこと、adequateはその用途で受け入れられる基準を満たすことを表す。相互canonicalとadequate側のgeneric enoughを外し、それぞれのpromptに自然な代替だけを残す。
- `NSD-00725-01890` — **KEEP** — stubborn (頑固な); obstinate (頑固な) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00734-01060` — **KEEP** — grief (深い悲しみ); sorrow (悲しみ) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00736-00891` — **PROMPT_AND_PARAPHRASE** — maintain (保つ); preserve (保つ) — maintainは状態や水準を維持すること、preserveは損傷・劣化・消失から保つことに寄る。どちらにも自然なkeep/retainを残し、相互canonicalだけを除く。
- `NSD-00739-00974` — **KEEP** — regardless (それでも・かまわず); nevertheless (それにもかかわらず) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00743-02360` — **KEEP** — scarcely (ほとんど〜ない); hardly (ほとんど〜ない) — 共通の日本語promptは複数canonicalに共通する中心義を簡潔に表している。現行sense_keyとgrammarRoleも同じで、括弧補足を加えても安定した実用差を作れず、accepted paraphraseも日常的な代替として成立するため現状維持。
- `NSD-00749-01163` — **KEEP** — confuse (混同する); confuse something with something else (somethingをsomething elseと混同する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00768-01830` — **KEEP** — dismal (暗い); dim (薄暗い) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00773-02029` — **PROMPT_AND_PARAPHRASE** — decline (減少する); decrease (減少する); diminish (減少する) — decreaseは量・数の中立的な減少、declineは数値・水準の下落や衰え、diminishは強さ・重要性などが弱まる用法と相性がよい。共有のdecrease/decline/fall/dropを整理し、固有の用法差をpromptに残す。
- `NSD-00774-02143` — **KEEP** — likelihood (起こる可能性); prospect (見込み); possibility (可能性) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00775-02004` — **KEEP** — remote (遠く離れた); distant (遠い) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00784-02270` — **KEEP** — prominent (著名な); prestigious (名声のある); noted (著名な) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00805-01421` — **PROMPT_AND_PARAPHRASE** — complex (複雑な); complicated (複雑な) — complexは多くの要素・関係を含む構造、complicatedは理解や処理が難しいことに寄る。現行の相互paraphraseだけでは二つの見方を区別できないため、どちらも外しpromptで説明する。
- `NSD-00813-02116` — **PROMPT_AND_PARAPHRASE** — eventually (最終的に); after all (結局); in the end (結局); ultimately (最終的に) — eventuallyは時間が経った後の実現、ultimatelyは最終判断・結論、in the endは過程の末、after allは考え直した結果・事実の補足に寄る。重なるin the end/ultimately/eventuallyを必要な範囲で除き、finallyは時系列・最終結果に合うentryに残す。
- `NSD-00825-02186` — **KEEP** — endeavor (努力); effort (努力) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00830-01893` — **KEEP** — overcome (克服する); conquer (克服する) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-00864-00971` — **PROMPT_AND_PARAPHRASE** — destiny (運命); fate (運命) — destinyは将来の行く末・実現する可能性、fateは本人の制御を超えた成り行きに寄る。現行の相互paraphraseが同じ語への置換を許すため外し、中心訳を保ったまま対比する。
- `NSD-00869-02147` — **PROMPT_AND_PARAPHRASE** — enormous (莫大な); vast (広大な); massive (巨大な); gigantic (巨大な); huge (巨大な); immense (巨大な) — hugeは一般的な口語の大きさ、giganticは桁外れの大きさ、massiveは重厚・大量、vastは範囲、immenseは計り知れない規模、enormousは量・程度の大きさに寄る。相互generic paraphraseを外し、vastにはextentを表すextensiveを残す。
- `NSD-00878-02125` — **PROMPT_AND_PARAPHRASE** — propose (提案する); suggest (提案する) — proposeは計画・案を提示する、suggestは考えや選択肢を提案する傾向がある。相互paraphraseを外し、広い中心訳を保ったまま対象を補足する。
- `NSD-00893-02309` — **KEEP** — species (種); seed (種) — 「種」は日本語側の多義による一致で、species（分類上の種）と seed（植物の種）は英語では近義語ではない。現行の日本語promptは各entryの代表義として維持し、近義語用の括弧補足やparaphrase移動はしない。
- `NSD-00895-01016` — **KEEP** — severe (深刻な); critical (重篤な) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00912-01736` — **PROMPT_AND_PARAPHRASE** — enterprise (企業); corporation (企業) — enterpriseは事業・企業活動や事業体を広く指し、corporationは法律上の会社組織を指す。current accepted setの相互canonical/companyの重なりを減らし、promptに対象を明記する。
- `NSD-00944-01243` — **KEEP** — perspective (視点); view (見方); viewpoint (観点) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00955-01413` — **PROMPT_AND_PARAPHRASE** — fortune (財産); property (財産) — fortuneは大きな富・資産の総体、propertyは所有している財産・資産を指す。相互に広すぎるproperty/wealthを外し、双方で自然なassetsを残す。
- `NSD-00957-01044` — **KEEP** — adapt (適応する); adjust (順応する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00966-01107` — **KEEP** — enhance (高める); increase (増やす) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-00999-02165` — **PROMPT_AND_PARAPHRASE** — dispute (論争); controversy (論争) — disputeは深刻な意見の対立、controversyは公の注目・議論を集める争点に寄る。相互canonicalを除き、両者に自然なdebateは残す。
- `NSD-01001-01697` — **PROMPT_AND_PARAPHRASE** — revenue (収入); income (収入) — revenueは企業・政府の活動で生じる売上・収入、incomeは人や組織が受け取る所得全般。revenueのincomeを除き、両promptに自然なearningsだけを残す。
- `NSD-01013-02351` — **PROMPT_AND_PARAPHRASE** — weird (奇妙な); odd (奇妙な); peculiar (奇妙な) — weirdは強い違和感・不気味さ、oddは普通と違う・意外、peculiarは独特で珍しいという傾向がある。strangeは広い上位語として維持できるが、相互canonical paraphraseは狭める。
- `NSD-01018-01404` — **KEEP** — deliberately (故意に); on purpose (故意に) — 共通の日本語promptは複数canonicalに共通する中心義を簡潔に表している。現行sense_keyとgrammarRoleも同じで、括弧補足を加えても安定した実用差を作れず、accepted paraphraseも日常的な代替として成立するため現状維持。
- `NSD-01019-01298` — **KEEP** — explode (爆発する); blow up (爆発する) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-01030-01246` — **PROMPT_AND_PARAPHRASE** — splendid (素晴らしい); terrific (すばらしい); fabulous (素晴らしい); marvelous (すばらしい) — terrificは口語的で勢いのある強い称賛、marvelousは「extremely good」で感嘆を伴う評価、fabulousは非常に優れ魅力的、splendidは見事・印象的な称賛に寄せる。genericなgreat/excellentなどを整理する。ただしmarvelousを古風・上品と固定する根拠は確認できず、その断定は採用しない。
- `NSD-01051-01152` — **KEEP** — embrace (抱きしめる); hug (抱きしめる) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-01064-01765` — **KEEP** — ordeal (苦難); hardship (苦難) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-01093-01094` — **PROMPT_AND_PARAPHRASE** — latest (最新の); up-to-date (最新の) — latestは時系列で最も新しいもの、up-to-dateは古くなく現在の状態・情報に合っているもの。相互canonical/newest/most recentを整理し、up-to-dateにはcurrentを1件追加する。
- `NSD-01110-02373` — **PROMPT_AND_PARAPHRASE** — realize something (somethingに気づく); notice something (somethingに気づく); become aware of something (somethingに気づく) — realizeは事実・意味を理解する、noticeは知覚・注意で変化を見つける、become aware ofは認識するようになることに寄る。現行の相互受理はこの学習差を消すため外し、代表義は維持する。
- `NSD-01123-02112` — **KEEP** — policy (方針); scheme (計画); program (計画) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-01128-01897` — **PROMPT_AND_PARAPHRASE** — indicate (示す); demonstrate (示す) — indicateは兆候や情報で示唆・指示する、demonstrateは証拠や実演で明らかに示すことに寄る。互いと汎用showを外し、補足promptで示し方を区別する。
- `NSD-01137-01679` — **KEEP** — inhabitant (住民); resident (住民) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-01143-01145` — **KEEP** — attorney (弁護士); lawyer (弁護士) — 共通の日本語promptは複数canonicalに共通する中心義を簡潔に表している。現行sense_keyとgrammarRoleも同じで、括弧補足を加えても安定した実用差を作れず、accepted paraphraseも日常的な代替として成立するため現状維持。
- `NSD-01156-02374` — **KEEP** — gaze at something (somethingをじっと見つめる); stare at something (somethingをじっと見る) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-01176-01395` — **KEEP** — supply something with something else (somethingにsomething elseを供給する); provide something with something else (somethingにsomething elseを提供する) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-01192-02435` — **KEEP** — why don't you do something (somethingしたらどうですか); how about doing something (somethingするのはどうですか) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-01208-01210` — **PROMPT_AND_PARAPHRASE** — disease (病気); illness (病気) — diseaseは特定の疾患・医学的な状態、illnessは病気である状態や体調不良に寄る。相互canonicalを外し、双方で自然なsicknessだけ残す。
- `NSD-01223-01835` — **PROMPT_AND_PARAPHRASE** — customer (客); guest (客) — customerは商品・サービスを買う顧客、guestは招待された人や宿泊客。current paraphraseのguest/customer/client重複を外し、顧客側に自然なclientだけ残す。
- `NSD-01235-01406` — **KEEP** — regarding (〜に関して); as for (〜については) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-01247-01723` — **KEEP** — work (機能する); function (機能する) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-01250-01415` — **KEEP** — mission (任務); assignment (課題) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-01255-02094` — **PROMPT_AND_PARAPHRASE** — deal (取引); transaction (取引) — dealは合意・契約・商談、transactionは商品や金銭の売買・処理に寄る。相互canonicalを除き、両方に自然なtradeを残す。
- `NSD-01268-02177` — **PROMPT_AND_PARAPHRASE** — expert (専門家); specialist (専門家) — expertは知識・技能に詳しい人全般、specialistは特定分野に専門化した人。相互canonical paraphraseを外し、promptで専門性の幅を区別する。
- `NSD-01269-01965` — **KEEP** — staff (職員); personnel (職員) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-01304-01845` — **KEEP** — amazed (驚いている); astonished (驚いている) — 共通の日本語promptは複数canonicalに共通する中心義を簡潔に表している。現行sense_keyとgrammarRoleも同じで、括弧補足を加えても安定した実用差を作れず、accepted paraphraseも日常的な代替として成立するため現状維持。
- `NSD-01306-01984` — **PROMPT_AND_PARAPHRASE** — yell (大声で叫ぶ); exclaim (叫ぶ); shout (叫ぶ) — yellは大声、shoutは大声で言う発話、exclaimは驚き・喜びなどを突然声に出すことに寄る。相互のyell/shout/scream paraphraseを整理し、感情表出のexclaimにcry outだけを残す。
- `NSD-01354-02274` — **KEEP** — sweeping (広範囲に及ぶ); widespread (広範囲に及ぶ) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-01356-02018` — **KEEP** — parliament (議会); council (議会) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-01386-01499` — **KEEP** — except for (〜を除いて); apart from (〜を除けば) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-01412-02256` — **PROMPT_AND_PARAPHRASE** — claim (主張する); contend (主張する); argue (主張する) — claimは事実だとして述べる、contendは論点として主張する、argueは理由を挙げて論じる傾向がある。交差するclaim/argue/assertを整理し、各prompt全体に自然な回答を残す。
- `NSD-01443-01444` — **PROMPT_AND_PARAPHRASE** — repair (修理する); fix (修理する) — repairは故障・損傷を修理して正常な状態へ戻す標準的表現、fixはより会話的で広く「直す」。相互canonicalはprompt境界を消すため外し、両方で自然なmendを残す。
- `NSD-01453-01578` — **KEEP** — tissue (生体組織); organization (組織) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-01558-01650` — **KEEP** — universe (宇宙); outer space (宇宙) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-01592-02397` — **PROMPT_AND_PARAPHRASE** — environment (環境); surroundings (周囲の環境) — environmentは生活・活動を取り巻く条件全体、surroundingsは場所の周囲にある物・環境を指しやすい。相互paraphraseを外して中心訳の違いを補足で示す。
- `NSD-01628-02329` — **KEEP** — prefecture (県); province (州) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-01689-02017` — **KEEP** — urban (都市の); municipal (市の) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-01701-02121` — **KEEP** — rapidly (急速に); swiftly (素早く) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-01725-01873` — **KEEP** — quantity (量); amount (量) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-01799-02381` — **KEEP** — transform something into something else (somethingをsomething elseに変える); turn something into something else (somethingをsomething elseに変える) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-01874-01957` — **KEEP** — appropriate (適切な); proper (適切な) — 共通の日本語promptは複数canonicalに共通する中心義を簡潔に表している。現行sense_keyとgrammarRoleも同じで、括弧補足を加えても安定した実用差を作れず、accepted paraphraseも日常的な代替として成立するため現状維持。
- `NSD-02090-02293` — **KEEP** — pile (山積み); heap (山積み) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-02119-02277` — **KEEP** — jail (刑務所); prison (刑務所) — 共通の日本語promptは複数canonicalに共通する中心義を簡潔に表している。現行sense_keyとgrammarRoleも同じで、括弧補足を加えても安定した実用差を作れず、accepted paraphraseも日常的な代替として成立するため現状維持。
- `NSD-02158-02235` — **KEEP** — protest something (somethingに抗議する); protest against something (somethingに抗議する) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-02200-02288` — **PROMPT_AND_PARAPHRASE** — security (安全); safety (安全) — securityは脅威からの保護・防護、safetyは事故や危険がない状態に寄る。共通の「安全」は維持し、相互accepted paraphraseを外して学習上の違いを補足する。
- `NSD-02262-02279` — **KEEP** — cop (警官); officer (警官) — 日本語promptは同じだが、現行sense_keyには異なる代表義が含まれる。共通訳だけから英語同士が同義とは結論せず、広い日本語訳だけで近義語扱いすると誤学習を招くため、prompt/paraphraseは変更しない。
- `NSD-02282-02371` — **KEEP** — attempt (試みる); attempt to do something (somethingしようと試みる) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。
- `NSD-02401-02427` — **KEEP** — pleasure (喜び); delight (大喜び) — 候補はsame sense_keyまたはaccepted surfaceの重なりから抽出されたが、現行の日本語promptはそれぞれの代表義・構文を既に区別している。近い英語表現でもprompt差が学習上の境界を保っており、括弧補足やparaphrase除去は不要。

## Validation

Run `node scripts/vocabulary/validate-near-synonym-prompt-differentiation.mjs`. It checks source snapshot drift, candidate regeneration determinism, authority references, classifications, and production non-mutation.
