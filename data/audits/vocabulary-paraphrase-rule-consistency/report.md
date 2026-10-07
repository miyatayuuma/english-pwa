# Vocabulary Paraphrase Rule-Consistency Audit

- Repository: `miyatayuuma/english-pwa`
- Dedicated branch: `audit/vocabulary-paraphrase-rule-consistency`
- Base SHA: `dff23a3d92895c9db621ced662734fee76e395c9`
- Production vocabulary blob: `ca87f516a6304e41db2354b4db969590b1572eb5`
- Source example blob: `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`
- Population: 2478
- Scanned: 2478
- Candidate count: 137
- Statuses: CONFIRMED 56; REVIEW 0; FALSE_POSITIVE 81; unclassified 0
- Starting audit commit: `08908d275e65e769cedaee751802ef425bccbdc6`
- Current remote main at resolution: `dff23a3d92895c9db621ced662734fee76e395c9`
- Production vocabulary, prompts, paraphrases, tests, UI, and service worker: unchanged.

## Method

The scan read every entry in the base-SHA `data/vocabulary-v3.json` directly. It compared canonical TARGET and every `paraphrases[]` surface for explicit person/thing/place placeholders, answer-to-prompt slot presence, internal paraphrase slot profiles, clause/complement-frame signals (including clause introducers, `that`-clause surfaces, to-infinitive and gerund forms), incomplete multiword complements, and illegal metalinguistic placeholders. Candidate signals were then checked against the current Japanese prompt, lexicalized expressions, optional/contextually supplied arguments, source occurrence, and the same-prompt replacement test. Broad substring signals were retained when useful and classified FALSE_POSITIVE where the apparent frame difference was only lexicalized or a surface-form alternation.

Existing meaning/paraphrase audit artifacts were read-only references. Their semantic audits were not repeated. The current `main` production blob was the audit authority because it differs from the earlier paraphrase-audit snapshot.

## Rule counts

Rule counts overlap: one candidate can carry multiple rules.

### A. All candidates (137)

| Rule | Count |
|---|---:|
| PLACEHOLDER_ASYMMETRY | 67 |
| PROMPT_SLOT_MISMATCH | 61 |
| SYNTACTIC_FRAME_MISMATCH | 77 |
| INCOMPLETE_SURFACE | 11 |
| ILLEGAL_META_PLACEHOLDER | 0 |
| INTERNAL_PARAPHRASE_INCONSISTENCY | 21 |

### B. CONFIRMED only (56)

| Rule | Count |
|---|---:|
| PLACEHOLDER_ASYMMETRY | 55 |
| PROMPT_SLOT_MISMATCH | 52 |
| SYNTACTIC_FRAME_MISMATCH | 5 |
| INCOMPLETE_SURFACE | 10 |
| ILLEGAL_META_PLACEHOLDER | 0 |
| INTERNAL_PARAPHRASE_INCONSISTENCY | 16 |


## CONFIRMED candidates


### vocab:00121

- Prompt: 〜にもかかわらず
- TARGET: `despite`
- Current paraphrases: `in spite of something`, `although`, `even though`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, SYNTACTIC_FRAME_MISMATCH, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "despite"=no explicit slot / "in spite of something"=THING:1 / "although"=no explicit slot / "even though"=no explicit slot. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: Japanese promptを「somethingにもかかわらず」（または「何かにもかかわらず」）へ明示化し、TARGETを「despite something」に揃える。paraphrasesは「in spite of something」だけを同一slot候補に残し、「although / even though」は節slotを要求するためこのpromptから除外候補にする。`+ clause`は使わない。
- Source example (E0088): “Ironically, despite their best endeavors, their mission resulted in complete failure.” / 皮肉なことだが、彼らの最善の努力にもかかわらず、任務は完全な失敗に終わった。

### vocab:00217

- Prompt: 見せびらかす
- TARGET: `show off`
- Current paraphrases: `flaunt something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "show off"=no explicit slot / "flaunt something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: Promptを「somethingを見せびらかす」にし、TARGETを「show something off」、paraphraseを「flaunt something」に揃える。自然な目的語slotを置けない回答形は除外する。
- Source example (E0177): “"Naomi likes to show off her perfect figure. I wish I were thin like her. I envy her." "You could go on a diet."” / 「ナオミは自分の完璧なスタイルをひけらかしたがる。私も彼女みたいに痩せていればなあ。彼女が羨ましいわ。」 「ダイエットすれば。」

### vocab:00219

- Prompt: 〜をうらやむ
- TARGET: `envy`
- Current paraphrases: `be envious of someone`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "envy"=no explicit slot / "be envious of someone"=PERSON:1. The Japanese prompt does not explicitly identify someone (person).
- Recommended direction: promptの目的語が人限定か物事も含むかを決める。person限定なら「someoneをうらやむ / envy someone / be envious of someone」に揃え、thingも許すならその対象型のparaphraseを追加し、「someone」だけの回答を単独追加しない。
- Source example (E0177): “"Naomi likes to show off her perfect figure. I wish I were thin like her. I envy her." "You could go on a diet."” / 「ナオミは自分の完璧なスタイルをひけらかしたがる。私も彼女みたいに痩せていればなあ。彼女が羨ましいわ。」 「ダイエットすれば。」

### vocab:00266

- Prompt: 仕返しをする
- TARGET: `get even`
- Current paraphrases: `get revenge`, `get back at someone`, `take revenge`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "get even"=no explicit slot / "get revenge"=no explicit slot / "get back at someone"=PERSON:1 / "take revenge"=no explicit slot. The Japanese prompt does not explicitly identify someone (person).
- Recommended direction: promptを「someoneに仕返しをする」にし、TARGETを「get even with someone」、他の回答を「get revenge on someone / get back at someone / take revenge on someone」に揃える。
- Source example (E0207): “"You betrayed me!" "Please forgive me. How can I make it up to you?" "I'll get even!"” / 「私を裏切ったわね！」 「許してくれよ。どうしたら埋め合わせができるかなあ？」 「仕返ししてやるっ！」

### vocab:00328

- Prompt: somethingはsomething elseと関係がある
- TARGET: `have something to do with something else`
- Current paraphrases: `be related to something else`
- Rules: PLACEHOLDER_ASYMMETRY, SYNTACTIC_FRAME_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "have something to do with something else"=THING:2 / "be related to something else"=THING:1.
- Recommended direction: Japanese promptの主語slotと対象slotを明示したまま、全回答に同じ2つのNP役割を持たせる。例: targetを「something has something to do with something else」、paraphraseを「something is related to something else」に揃え、2番目のsomethingは同一slot名に統一する。
- Source example (E0265): “Innovation has something to do with the ability to notice unusual phenomena.” / 革新的なものを生み出すこと、それは変わった現象を見逃さない能力と何らかの関係がある。

### vocab:00552

- Prompt: 今にも
- TARGET: `at any moment`
- Current paraphrases: `be about to do something`, `any minute now`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, SYNTACTIC_FRAME_MISMATCH, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "at any moment"=no explicit slot / "be about to do something"=THING:1 / "any minute now"=no explicit slot. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: 「今にも」の副詞promptを維持するなら「be about to do something」をparaphraseから除外し、「at any moment / any minute now」に揃える。行為を答えさせるなら行為slotを含む日本語promptとpredicate型TARGETを別に立てる。
- Source example (E0452): “Trade friction might arise between the two nations at any moment.” / 両国の間では貿易摩擦がいつ生じてもおかしくない。

### vocab:00689

- Prompt: 〜に加えて
- TARGET: `besides`
- Current paraphrases: `in addition to something`, `as well as something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "besides"=no explicit slot / "in addition to something"=THING:1 / "as well as something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingに加えて」にし、TARGETを「besides something」に揃える。`in addition to something / as well as something`は維持候補。
- Source example (E0553): “Besides attending the funeral, she needs to make all the arrangements.” / 彼女は葬儀に参列するだけでなく、すべての段取りをつけなければならない。

### vocab:00690

- Prompt: 手配する
- TARGET: `make arrangements`
- Current paraphrases: `arrange something`, `set something up`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "make arrangements"=no explicit slot / "arrange something"=THING:1 / "set something up"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingを手配する」にし、TARGETを「make arrangements for something」にする。`arrange something / set something up`は同じ対象slotとして残す候補。
- Source example (E0553): “Besides attending the funeral, she needs to make all the arrangements.” / 彼女は葬儀に参列するだけでなく、すべての段取りをつけなければならない。

### vocab:00707

- Prompt: 軽蔑する
- TARGET: `despise`
- Current paraphrases: `look down on someone`, `scorn`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "despise"=no explicit slot / "look down on someone"=PERSON:1 / "scorn"=no explicit slot. The Japanese prompt does not explicitly identify someone (person).
- Recommended direction: promptを「someoneを軽蔑する」に限定し、TARGETと全paraphraseを「despise someone / look down on someone / scorn someone」にそろえる。物事も対象に含めるpromptならperson限定のparaphraseは除外候補。
- Source example (E0375): “"You despise Nick, don't you?" "On the contrary! I look up to him."” / 「ニックを軽蔑しているんだろう？」 「とんでもない！尊敬しているわ。」

### vocab:00747

- Prompt: 精通している
- TARGET: `familiar`
- Current paraphrases: `know something well`, `be well versed in`, `be knowledgeable about`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "familiar"=no explicit slot / "know something well"=THING:1 / "be well versed in"=no explicit slot / "be knowledgeable about"=no explicit slot. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingに精通している」にし、TARGETを「be familiar with something」にする。`know something well / be well versed in something / be knowledgeable about something`へ同じ対象slotを明示する。
- Source example (E0015): “"Are you familiar with contemporary literature?" "I know next to nothing about it."” / 「現代文学に詳しいですか？」 「ほとんど知りません。」

### vocab:00760

- Prompt: 妥協する
- TARGET: `compromise`
- Current paraphrases: `meet someone halfway`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "compromise"=no explicit slot / "meet someone halfway"=PERSON:1. The Japanese prompt does not explicitly identify someone (person).
- Recommended direction: promptを「someoneと妥協する」にし、TARGETを「compromise with someone」、paraphraseを「meet someone halfway」に揃える。
- Source example (E0027): “In any case, the union has to compromise to a certain extent.” / いずれにせよ、組合側はある程度妥協しなければならない

### vocab:00778

- Prompt: さらす
- TARGET: `expose`
- Current paraphrases: `subject someone to something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "expose"=no explicit slot / "subject someone to something"=PERSON:1,THING:1. The Japanese prompt does not explicitly identify someone (person) and something (thing/event).
- Recommended direction: promptを「someoneをsomethingにさらす」にし、TARGETを「expose someone to something」、paraphrase「subject someone to something」と2slotをそろえる。
- Source example (E0038): “In fact, the inhabitants have been exposed to radiation.” / 実は、住民たちは放射能にさらされてきた。

### vocab:00853

- Prompt: 投資する
- TARGET: `invest`
- Current paraphrases: `put money into something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "invest"=no explicit slot / "put money into something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingに投資する」にし、TARGETを「invest in something」、paraphraseを「put money into something」に揃える。
- Source example (E0131): “There are a number of factors discouraging us from investing in stocks.” / 私たちの株式投資への意欲をそぐような要因がかなりある。

### vocab:00863

- Prompt: 切望している
- TARGET: `anxious`
- Current paraphrases: `eager`, `long for something`, `yearn for something`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "anxious"=no explicit slot / "eager"=no explicit slot / "long for something"=THING:1 / "yearn for something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptに「something/to do somethingを切望する」を明示し、TARGETを「be anxious to do something」など一つの補語型へそろえる。`eager`は同型に拡張し、`long for/yearn for something`は同じslot・語義に揃わなければ除外する。
- Source example (E0143): “The slaves were anxious to alter their destinies.” / 奴隷たちは自分たちの運命を変えたいと切望していた。

### vocab:00933

- Prompt: 寄与する
- TARGET: `contribute`
- Current paraphrases: `help`, `play a part in something`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "contribute"=no explicit slot / "help"=no explicit slot / "play a part in something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingに寄与する」にし、TARGETを「contribute to something」、`play a part in something`を同じ対象slotに揃える。`help`は同じslotで回答できる形のみ残す。
- Source example (E0326): “Our hypothesis is that eating excessive amounts of junk food contributes to early mortality.” / ジャンクフードの過剰な摂取は早死にの一因になる、というのが我々の仮説だ。

### vocab:00951

- Prompt: 値する
- TARGET: `deserve`
- Current paraphrases: `be worth something`, `be worthy of something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "deserve"=no explicit slot / "be worth something"=THING:1 / "be worthy of something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingに値する」にし、TARGETを「deserve something」、`be worth something / be worthy of something`と同じ対象slotにする。
- Source example (E0349): “In the face of adversity, Mike accomplished an extraordinary feat. He deserves praise.” / 逆境をものともせず、マイクはすばらしい偉業を成し遂げた。称賛を受けるのは当然だ。

### vocab:00967

- Prompt: 搾取する
- TARGET: `exploit`
- Current paraphrases: `take advantage of someone`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "exploit"=no explicit slot / "take advantage of someone"=PERSON:1. The Japanese prompt does not explicitly identify someone (person).
- Recommended direction: 対象を人に限定してpromptを「someoneを搾取する」にし、TARGETを「exploit someone」、paraphraseを「take advantage of someone」にそろえる。対象を物事まで含むならperson限定案を除外。
- Source example (E0394): “They are primarily concerned with exploiting us, not with enhancing our living standards.” / 彼らの一番の関心事は、私たちの生活水準を高めることではなく、私たちから搾取することだ。

### vocab:00985

- Prompt: 我慢する
- TARGET: `tolerate`
- Current paraphrases: `put up with something`, `endure`, `bear`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "tolerate"=no explicit slot / "put up with something"=THING:1 / "endure"=no explicit slot / "bear"=no explicit slot. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingを我慢する」にし、TARGETと全paraphraseを「tolerate/endure/bear something」「put up with something」にそろえる。
- Source example (E0419): “We will not tolerate anyone who engages in terrorism.” / 我々は、誰であろうとテロ活動に携わる者に寛容でいるつもりはない。

### vocab:00988

- Prompt: 奪う
- TARGET: `deprive`
- Current paraphrases: `take something away`, `seize something`, `rob someone of something`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "deprive"=no explicit slot / "take something away"=THING:1 / "seize something"=THING:1 / "rob someone of something"=PERSON:1,THING:1. The Japanese prompt does not explicitly identify someone (person) and something (thing/event).
- Recommended direction: TARGETを「deprive someone of something」に具体化し、日本語promptも「someoneからsomethingを奪う」にする。各paraphraseも同じperson+thingの2slotに揃え、「take something away / seize something」のようにperson slotを落とす候補は除外または補完する。
- Source example (E0427): “Under the reign of tyranny, innocent people were deprived of their citizenship.” / 専制政治による支配のもとで、罪のない人々が市民権を剥奪された。

### vocab:01007

- Prompt: 告発する
- TARGET: `accuse`
- Current paraphrases: `charge someone with something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "accuse"=no explicit slot / "charge someone with something"=PERSON:1,THING:1. The Japanese prompt does not explicitly identify someone (person) and something (thing/event).
- Recommended direction: Japanese promptへ告発対象者と告発内容の2slotを提示し、TARGETを「accuse someone of something」へ正規化する。paraphrase「charge someone with something」は対応する同一slotとして保持候補。
- Source example (E0460): “It took us all by surprise when the noted psychologist was accused of kidnapping.” / その著名な心理学者が誘拐罪で訴えられたことに、私たちはみな驚いた。

### vocab:01057

- Prompt: 後悔する
- TARGET: `regret`
- Current paraphrases: `be sorry about something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "regret"=no explicit slot / "be sorry about something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingを後悔する」にし、TARGETを「regret something」、paraphraseを「be sorry about something」にそろえる。
- Source example (E0532): “Tom regretted having wasted a great deal of his life.” / トムは自分の人生の多くを無駄にしてきたことを後悔した。

### vocab:01067

- Prompt: 延期する
- TARGET: `postpone`
- Current paraphrases: `delay`, `put something off`, `defer`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "postpone"=no explicit slot / "delay"=no explicit slot / "put something off"=THING:1 / "defer"=no explicit slot. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingを延期する」にし、TARGETを「postpone something」。`delay/defer something`と`put something off`も同じ対象slotを表す形にする。
- Source example (E0549): “The sacred ritual took place after being postponed twice.” / 2度の延期の後、その神聖な儀式は執り行われた。

### vocab:01088

- Prompt: 組み合わせる
- TARGET: `combine`
- Current paraphrases: `put something together`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "combine"=no explicit slot / "put something together"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingを組み合わせる」にし、TARGETを「combine something」、paraphraseを「put something together」にする。複数材料が必須の語義なら日本語promptと全回答に2つの入力slotを出す。
- Source example (E0011): “His new novel, which combines prose with his gift for poetry, is going to be published.” / まもなく出版になる彼の小説は、散文に彼の詩の才能を融合させたものだ。

### vocab:01110

- Prompt: 気づく
- TARGET: `realize`
- Current paraphrases: `notice`, `become aware of something`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "realize"=no explicit slot / "notice"=no explicit slot / "become aware of something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingに気づく」にし、TARGETを「realize something」。`notice something / become aware of something`も同じ対象slotでそろえる。
- Source example (E0020): “"Could you move over a little?" "Oh, sorry. I didn't realize I was taking up so much space."” / 「少し詰めていただけませんか？」「あ、ごめんなさい。こんなに場所を取っていたなんて気付きませんでした。」

### vocab:01240

- Prompt: お世辞を言う
- TARGET: `flatter`
- Current paraphrases: `butter someone up`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "flatter"=no explicit slot / "butter someone up"=PERSON:1. The Japanese prompt does not explicitly identify someone (person).
- Recommended direction: promptを「someoneにお世辞を言う」にし、TARGETを「flatter someone」、paraphraseを「butter someone up」にそろえる。
- Source example (E0082): “"I admire your perseverance, courage and wisdom." "You flatter me!"” / 「君の不屈の努力、勇気、そして知恵には感心するよ。」「お世辞でもうれしいわ！」

### vocab:01293

- Prompt: somethingではなくsomething else
- TARGET: `not something but something else`
- Current paraphrases: `rather than`, `instead of`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "not something but something else"=THING:2 / "rather than"=no explicit slot / "instead of"=no explicit slot.
- Recommended direction: TARGETが示す対比2slotを日本語promptに残し、paraphrasesを「not X but Y」相当の2slot構文へ揃える。「rather than / instead of」はこのままでは二つの項を示さないため、現promptからは除外候補。
- Source example (E0083): “In making a decision, I rely not on logic but on instinct.” / どうするかを決めるとき、僕は論理ではなく本能を当てにする。

### vocab:01513

- Prompt: 間違える
- TARGET: `make a mistake`
- Current paraphrases: `get something wrong`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "make a mistake"=no explicit slot / "get something wrong"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: 誤りの対象をpromptに出すなら「somethingを間違える / get something wrong」にそろえる。TARGET「make a mistake」を残す場合は対象slotを要求しない共通promptとしてparaphrasesも見直す。
- Source example (E0187): “I can't help laughing at him because he keeps on making stupid mistakes. He'd be the last person to learn his lesson.” / 彼のことを笑わずにはいられない。ばかな間違いを繰り返すからね。きっと彼は懲りないんだろうな。

### vocab:01538

- Prompt: 向かう
- TARGET: `head`
- Current paraphrases: `make for somewhere`
- Rules: PLACEHOLDER_ASYMMETRY
- Problem: Answer surfaces do not use a consistent explicit slot profile: "head"=no explicit slot / "make for somewhere"=PLACE:1.
- Recommended direction: promptを「somewhereへ向かう」にし、TARGETを「head somewhere」、paraphraseを「make for somewhere」にそろえる。
- Source example (E0218): “"Jane, where are we heading?" "I think we're lost. We went in the wrong direction." "Damn! Pull over!"” / 「ジェーン、俺たちはどこに向かってるんだ？」 「迷ったみたい。違う方向に来ちゃったわ。」 「何だよ。車を止めてくれ！」

### vocab:01645

- Prompt: 〜の至る所に
- TARGET: `all over`
- Current paraphrases: `throughout something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "all over"=no explicit slot / "throughout something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptの場所slotを「somethingの至る所に」と明示し、TARGETを「all over something」、paraphraseを「throughout something」にする。
- Source example (E0215): “A truck driving ahead of me skidded, turned over, and scattered its load all over the road.” / 私の前を走っていたトラックがスリップして横転し、積み荷を路面いっぱいに散乱させた。

### vocab:01651

- Prompt: 一連の〜
- TARGET: `a series of`
- Current paraphrases: `a sequence of something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH, INCOMPLETE_SURFACE
- Problem: Answer surfaces do not use a consistent explicit slot profile: "a series of"=no explicit slot / "a sequence of something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event). The target also ends at a complement-taking preposition/conjunction without its argument.
- Recommended direction: TARGETを「a series of something」にし、paraphraseを「a sequence of something」に揃える。promptの「一連の〜」は対象slotを明示し、単独の「a series of」で止めない。
- Source example (E0226): “They conducted a series of experiments under zero gravity.” / 彼らは無重力状態で一連の実験をおこなった。

### vocab:01656

- Prompt: 〜で役割を果たす
- TARGET: `play a role in`
- Current paraphrases: `play a part in something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH, INCOMPLETE_SURFACE
- Problem: Answer surfaces do not use a consistent explicit slot profile: "play a role in"=no explicit slot / "play a part in something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event). The target also ends at a complement-taking preposition/conjunction without its argument.
- Recommended direction: TARGETを「play a role in something」、paraphraseを「play a part in something」にし、日本語promptの「〜で」を活動/領域slotとして明示する。
- Source example (E0233): “The organization plays a principal role in wildlife conservation.” / その団体は野生動物の保護において、最も重要な役割を果たしている。

### vocab:01657

- Prompt: 〜の瀬戸際に
- TARGET: `on the verge of`
- Current paraphrases: `on the brink of something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH, INCOMPLETE_SURFACE
- Problem: Answer surfaces do not use a consistent explicit slot profile: "on the verge of"=no explicit slot / "on the brink of something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event). The target also ends at a complement-taking preposition/conjunction without its argument.
- Recommended direction: TARGETとparaphraseを「on the verge of something / on the brink of something」に揃え、Japanese promptに瀬戸際となる出来事slotを明記する。
- Source example (E0234): “Many fragile species are on the verge of extinction.” / 多くの弱い生物種が絶滅の危機に瀕している。

### vocab:01658

- Prompt: 〜に損害を与える
- TARGET: `do damage to`
- Current paraphrases: `damage something`, `cause damage to something`, `harm something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH, INCOMPLETE_SURFACE
- Problem: Answer surfaces do not use a consistent explicit slot profile: "do damage to"=no explicit slot / "damage something"=THING:1 / "cause damage to something"=THING:1 / "harm something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event). The target also ends at a complement-taking preposition/conjunction without its argument.
- Recommended direction: TARGETを「do damage to something」とし、paraphraseの「damage/harm something」「cause damage to something」と同じ被害対象slotを日本語promptにも明示する。
- Source example (E0235): “The prolonged drought did severe damage to the crops.” / 長引く干ばつが収穫に甚大な被害をもたらした。

### vocab:01662

- Prompt: 〜が原因である
- TARGET: `be due to`
- Current paraphrases: `be caused by something`, `result from something`, `stem from something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH, INCOMPLETE_SURFACE
- Problem: Answer surfaces do not use a consistent explicit slot profile: "be due to"=no explicit slot / "be caused by something"=THING:1 / "result from something"=THING:1 / "stem from something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event). The target also ends at a complement-taking preposition/conjunction without its argument.
- Recommended direction: TARGETを「be due to something」にし、全paraphraseを原因slotが明示された形に揃える。日本語promptも「somethingが原因である」とする。
- Source example (E0236): “Tropical rain forests are quickly disappearing on a global scale. In part, it's due to acid rain.” / 熱帯雨林の消滅が地球規模で急速に進んでいます。その原因の一つは酸性雨です。

### vocab:01665

- Prompt: 〜と関係がある
- TARGET: `be related to`
- Current paraphrases: `have something to do with something`, `be connected with something`, `be associated with something`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, SYNTACTIC_FRAME_MISMATCH, PROMPT_SLOT_MISMATCH, INCOMPLETE_SURFACE
- Problem: Answer surfaces do not use a consistent explicit slot profile: "be related to"=no explicit slot / "have something to do with something"=THING:2 / "be connected with something"=THING:1 / "be associated with something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event). The target also ends at a complement-taking preposition/conjunction without its argument.
- Recommended direction: TARGETを「be related to something」にし、他paraphrasesも同じ一つの関連対象slotで揃える。「have something to do with something」の最初のsomethingは自由slotか固定idiom要素かを個別に分離して確認する。
- Source example (E0237): “It is said that global warming is directly related to carbon dioxide emissions.” / 地球温暖化は、二酸化炭素の排出と直接の関係があると言われている。

### vocab:01673

- Prompt: 〜が豊富である
- TARGET: `be rich in`
- Current paraphrases: `abound in something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH, INCOMPLETE_SURFACE
- Problem: Answer surfaces do not use a consistent explicit slot profile: "be rich in"=no explicit slot / "abound in something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event). The target also ends at a complement-taking preposition/conjunction without its argument.
- Recommended direction: TARGETを「be rich in something」、paraphraseを「abound in something」に揃え、日本語promptへ豊富さの対象slotを明示する。
- Source example (E0243): “The region is relatively rich in mineral resources.” / その地域は鉱物資源が比較的豊かだ。

### vocab:01674

- Prompt: 〜に特有である
- TARGET: `be characteristic of`
- Current paraphrases: `be unique to something`, `be peculiar to something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH, INCOMPLETE_SURFACE
- Problem: Answer surfaces do not use a consistent explicit slot profile: "be characteristic of"=no explicit slot / "be unique to something"=THING:1 / "be peculiar to something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event). The target also ends at a complement-taking preposition/conjunction without its argument.
- Recommended direction: TARGETに「something」を補って「be characteristic of something」にし、`be unique to something / be peculiar to something`と同じ対象slotに揃える。
- Source example (E0246): “A humid climate is characteristic of the peninsula.” / 湿気の多い気候はその半島の特色です。

### vocab:01676

- Prompt: 〜に似ている
- TARGET: `be similar to`
- Current paraphrases: `resemble something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH, INCOMPLETE_SURFACE
- Problem: Answer surfaces do not use a consistent explicit slot profile: "be similar to"=no explicit slot / "resemble something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event). The target also ends at a complement-taking preposition/conjunction without its argument.
- Recommended direction: TARGETを「be similar to something」にし、paraphrase「resemble something」と同じ一つの類似対象slotで揃える。
- Source example (E0249): “The geographical features here are similar to those of our prefecture.” / ここの地理的特徴は、私たちの県のそれと似ている。

### vocab:01708

- Prompt: 気づく
- TARGET: `notice`
- Current paraphrases: `realize`, `become aware of something`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "notice"=no explicit slot / "realize"=no explicit slot / "become aware of something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingに気づく」にし、TARGET「notice something」と「realize something / become aware of something」の対象slotを統一する。
- Source example (E0265): “Innovation has something to do with the ability to notice unusual phenomena.” / 革新的なものを生み出すこと、それは変わった現象を見逃さない能力と何らかの関係がある。

### vocab:01731

- Prompt: 組み立てる
- TARGET: `assemble`
- Current paraphrases: `put something together`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "assemble"=no explicit slot / "put something together"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingを組み立てる」にし、TARGETを「assemble something」、paraphraseを「put something together」にそろえる。
- Source example (E0274): “The factory now under construction will assemble 1,000 VCR units per day.” / 現在建設中のその工場は、一日当たり1000台のビデオデッキを組立てることになる。

### vocab:01734

- Prompt: 取って代わる
- TARGET: `replace`
- Current paraphrases: `take the place of something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "replace"=no explicit slot / "take the place of something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingに取って代わる」にし、TARGETを「replace something」、paraphraseを「take the place of something」にそろえる。
- Source example (E0275): “Efficient machinery replaced manual labor.” / 効率的な機械が、肉体労働に取って代わった。

### vocab:01741

- Prompt: 取り去る
- TARGET: `remove`
- Current paraphrases: `take something away`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "remove"=no explicit slot / "take something away"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingを取り去る」にし、TARGETを「remove something」、paraphraseを「take something away」にそろえる。
- Source example (E0277): “With restrictions removed, thousands of new enterprises have come into being.” / 制限が解除され、数千の新しい企業が誕生した。

### vocab:01754

- Prompt: なんとか成し遂げる
- TARGET: `manage`
- Current paraphrases: `pull something off`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "manage"=no explicit slot / "pull something off"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptに達成対象を明示し、TARGETを「manage to do something」、paraphraseを「pull something off」にする。両回答を同じaction slotにそろえる。
- Source example (E0284): “"Please estimate the losses by Friday at the latest." "I'll manage it somehow."” / 「遅くとも金曜日までには損失の見積りを出して下さい。」 「何とかやってみましょう。」

### vocab:01762

- Prompt: 責任を負っている
- TARGET: `responsible`
- Current paraphrases: `be accountable for something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "responsible"=no explicit slot / "be accountable for something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingについて責任を負っている」にし、TARGETを「be responsible for something」、paraphraseを「be accountable for something」にそろえる。
- Source example (E0289): “Nowadays, many people are out of work against their will. Who is responsible for that?” / 最近では、多くの人々が職に就きたくても就けないでいる。誰の責任だろう？

### vocab:01773

- Prompt: 配布する
- TARGET: `distribute`
- Current paraphrases: `hand something out`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "distribute"=no explicit slot / "hand something out"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingを配布する」にし、TARGETを「distribute something」、paraphraseを「hand something out」にそろえる。
- Source example (E0294): “The questionnaires were distributed at random.” / アンケート用紙が無作為に配布された。

### vocab:01786

- Prompt: つける
- TARGET: `attach`
- Current paraphrases: `put on something`, `turn something on`, `apply something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "attach"=no explicit slot / "put on something"=THING:1 / "turn something on"=THING:1 / "apply something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptに何を「つける」かを明記し、TARGETを「attach something」にする。各paraphraseにも同じthing slotを置き、slotを自然にそろえられない候補は除外する。
- Source example (E0300): “I attached my name tag to my baggage, but it soon came off.” / 自分の荷物に名札を付けたけれども、すぐに取れてしまった。

### vocab:01948

- Prompt: 借りがある
- TARGET: `owe`
- Current paraphrases: `be indebted to someone`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "owe"=no explicit slot / "be indebted to someone"=PERSON:1. The Japanese prompt does not explicitly identify someone (person).
- Recommended direction: promptを「someoneに借りがある」にし、TARGETを「owe someone」、paraphraseを「be indebted to someone」にそろえる。
- Source example (E0355): “"You owe me $200 altogether, Bob. When are you going to pay me back?" "I'm sorry. I'm hard up." "There you go again!"” / 「全部で200ドル貸してるの、ボブ。いつ返すつもりなの？」 「ごめん、金欠なんだ。」 「またなの？」

### vocab:01977

- Prompt: 邪魔する
- TARGET: `disturb`
- Current paraphrases: `bother`, `interrupt`, `interfere with something`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "disturb"=no explicit slot / "bother"=no explicit slot / "interrupt"=no explicit slot / "interfere with something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: 邪魔される対象slotを明示して、TARGETを「disturb something」、`bother/interrupt something`、`interfere with something`へそろえる。人に限定するならprompt側でsomeoneを指定する。
- Source example (E0369): “"Bob, don't disturb her. Mind your own business", he whispered.” / 「ボブ、彼女の邪魔をしちゃだめだぞ。ちょっかいを出すなよ。」と彼は小声で言った。

### vocab:01979

- Prompt: 粘り強く続ける
- TARGET: `persist`
- Current paraphrases: `persevere`, `keep at it`, `stick with something`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "persist"=no explicit slot / "persevere"=no explicit slot / "keep at it"=no explicit slot / "stick with something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: 続ける行為をpromptに明示し、TARGETを「persist in doing something」、`persevere/keep at something/stick with something`を同じaction slotにそろえる。
- Source example (E0370): “If you persist in bothering her like that, she'll lose her temper.” / そうやってしつこく彼女を困らせると、彼女も怒り出すぞ。

### vocab:02138

- Prompt: 従う
- TARGET: `obey`
- Current paraphrases: `follow`, `comply with something`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "obey"=no explicit slot / "follow"=no explicit slot / "comply with something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingに従う」にし、TARGETを「obey something」、paraphrasesを「follow something / comply with something」にそろえる。
- Source example (E0428): “Some soldiers were reluctant to obey the commands.” / その命令にいやいや従う兵士もいた。

### vocab:02158

- Prompt: 抗議する
- TARGET: `protest`
- Current paraphrases: `object to something`, `demonstrate against something`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "protest"=no explicit slot / "object to something"=THING:1 / "demonstrate against something"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingに抗議する」にし、TARGETを「protest something」、paraphrasesを「object to something / demonstrate against something」にそろえる。
- Source example (E0436): “The pro-choice group protested against a ban on abortion.” / 中絶合法賛成派グループが中絶の禁止に対して抗議した。

### vocab:02362

- Prompt: 制裁を科す
- TARGET: `impose sanctions`
- Current paraphrases: `sanction someone`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "impose sanctions"=no explicit slot / "sanction someone"=PERSON:1. The Japanese prompt does not explicitly identify someone (person).
- Recommended direction: 制裁対象者をpromptに明記し、TARGETを「impose sanctions on someone」、paraphraseを「sanction someone」にそろえる。
- Source example (E0451): “Unless Japan eliminates its unfair tariffs, the U.S. will impose sanctions.” / 日本が不公平な関税を撤廃しなければ、米国は制裁措置を取るだろう。

### vocab:02376

- Prompt: 〜行きである・〜へ向かっている
- TARGET: `be bound for`
- Current paraphrases: `be headed for somewhere`, `be on one's way to somewhere`
- Rules: PLACEHOLDER_ASYMMETRY, INCOMPLETE_SURFACE
- Problem: Answer surfaces do not use a consistent explicit slot profile: "be bound for"=no explicit slot / "be headed for somewhere"=PLACE:1 / "be on one's way to somewhere"=PLACE:1. The target also ends at a complement-taking preposition/conjunction without its argument.
- Recommended direction: TARGETを「be bound for somewhere」にし、他paraphrasesのsomewhere/location slotと一致させる。日本語promptのdestination slotは維持し、`one's`が独立slotでないことを確認する。
- Source example (E0474): “A cargo vessel, bound for Athens, sank in the Mediterranean without a trace.” / アテネへ向かう一隻の貨物船が、何の痕跡も残さずに地中海で沈没した。


### vocab:02408

- Prompt: 話し合う
- TARGET: `discuss`
- Current paraphrases: `talk about something`, `talk something over`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "discuss"=no explicit slot / "talk about something"=THING:1 / "talk something over"=THING:1. The Japanese prompt does not explicitly identify something (thing/event).
- Recommended direction: promptを「somethingについて話し合う」にし、TARGETを「discuss something」、paraphrasesを「talk about something / talk something over」にそろえる。
- Source example (E0518): “Can you spare a minute? I'd like to discuss something of importance to both of us.” / ちょっと時間を割いてくれませんか？二人にとって大事なことを話し合いたいんです。

### vocab:02417

- Prompt: 信頼する
- TARGET: `trust`
- Current paraphrases: `have confidence in someone`, `rely on someone`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Problem: The prompt「信頼する」allows a person or a thing as its object, and TARGET `trust` likewise accepts both. Both paraphrases explicitly restrict that object to `someone`. A person-only answer therefore requires a narrower object type than the Japanese prompt supplies. The source example (`trust her`) confirms a person use but does not narrow the prompt's broader meaning.
- Recommended direction: Promptを「someoneを信頼する」にし、TARGETを「trust someone」に揃える。既存paraphrasesの「have confidence in someone」「rely on someone」は同じperson slotの候補として残す。
- Source example (E0531): “"Jennifer deceived me!" "You should have known better than to trust her."” / 「ジェニファーにだまされた！」「彼女を信じないくらいの分別があっても良かったのに。」

### vocab:02456

- Prompt: 〜であるにもかかわらず
- TARGET: `even though`
- Current paraphrases: `although`, `though`, `despite`, `in spite of`
- Rules: SYNTACTIC_FRAME_MISMATCH
- Problem: Answer surfaces do not use a consistent explicit slot profile: "even though"=no explicit slot / "although"=no explicit slot / "though"=no explicit slot / "despite"=no explicit slot / "in spite of"=no explicit slot.
- Recommended direction: このpromptは「〜であるにもかかわらず」という命題/節型なので、TARGET「even though」と「although / though」を維持し、「despite / in spite of」はNP型の別prompt（例:「somethingにもかかわらず」）へ分離する候補とする。`+ clause`は使わない。
- Source example (E0540): “Even though she is seeing someone else, I won't give her up.” / 実際、彼女は誰かと付き合っているけれども、僕は彼女を諦めない。

## Final resolution of the 8 former REVIEW candidates

### vocab:01010 — FALSE_POSITIVE

- Prompt: 判決を言い渡す
- TARGET: `sentence`
- Current paraphrases: `pass sentence on someone`, `hand down a sentence`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Decision reason: The person receiving the sentence is inherent in 判決を言い渡す and is naturally omitted in Japanese. In the source example, he is the person sentenced. `pass sentence on someone` makes that same recipient explicit; it does not add a different answer slot that the prompt cannot support. The bare TARGET `sentence` and `hand down a sentence` are valid vocabulary/action surfaces with the recipient left implicit.
- Recommended direction: このslot整合性監査では変更不要。受け手を明示する別カードにする場合だけ、promptを「someoneに判決を言い渡す」とし、TARGET/paraphrasesにも同じ受け手slotを付ける。
- Confidence: HIGH
- Source example (E0462): “The man pleaded for mercy, but he was sentenced to twenty years in prison for his crime.” / 男は情状酌量を求めたが、犯した罪に対して20年の懲役刑が言い渡された。

### vocab:01063 — FALSE_POSITIVE

- Prompt: 熟考する
- TARGET: `reflect`
- Current paraphrases: `contemplate`, `ponder`, `deliberate`, `think over something`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Decision reason: The topic being considered is a shared, naturally implicit object. Japanese「熟考する」can omit it, and the source example explicitly supplies the topic for `reflect on it`. `think over something` names that same generic topic; it does not add a different slot type or information absent from the prompt.
- Recommended direction: 現promptと回答形を維持する。対象が文脈から分かるときに省略可能な思考対象の表出差であり、slot追加・paraphrase除外は不要。
- Confidence: HIGH
- Source example (E0546): “Take your time. I know you need a couple of days to reflect on it.” / 慌てなくていいですよ。そのことをじっくり考えるには、2、3日必要でしょうから。

### vocab:01399 — FALSE_POSITIVE

- Prompt: 〜する見込みがほとんどない
- TARGET: `there is little prospect that`
- Current paraphrases: `be unlikely to do something`, `have little chance of doing something`
- Rules: PLACEHOLDER_ASYMMETRY, SYNTACTIC_FRAME_MISMATCH, INCOMPLETE_SURFACE
- Decision reason: The Japanese pattern「〜する見込みがほとんどない」provides an event/proposition slot. The TARGET's that-clause and the paraphrases' infinitive or gerund patterns express that same event; the source example supplies the two countries and their progress as the proposition. Their clause shapes differ, but the required event slot is shared. These are actual answer patterns, not a `+ clause` metalinguistic placeholder.
- Recommended direction: 「〜する」のevent slotを維持し、各回答surfaceは現状のままとする。`+ clause`を回答文字列へ追加しない。
- Confidence: HIGH
- Source example (E0141): “There's little prospect that the two countries will make significant progress in disarmament.” / 軍縮において、両国が大きな進展を遂げる見込みはほとんどない。

### vocab:02098 — FALSE_POSITIVE

- Prompt: 付きまとう
- TARGET: `haunt`
- Current paraphrases: `follow someone around`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Decision reason: The affected person in `follow someone around` is the same implicit target of「付きまとう」and the person haunted in the source example (`I'm still haunted ...`). The Japanese prompt naturally leaves that affected person unspoken; the paraphrase only surfaces the same participant, not a new person slot.
- Recommended direction: 人の対象を含意する現promptを維持する。今回の例では人slotの追加や `follow someone around` の除外は不要。
- Confidence: HIGH
- Source example (E0412): “I'm still haunted by a vivid nightmare I had last night.” / 昨日の夜に見た生々しい悪夢がまだ頭から離れない。

### vocab:02287 — FALSE_POSITIVE

- Prompt: 知らせる
- TARGET: `inform`
- Current paraphrases: `let someone know`, `notify`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Decision reason: `inform`, `notify`, and `let someone know` share the recipient role; the first two are bare verb headwords while the last spells out that same role. Japanese「知らせる」also entails a recipient that is routinely omitted. The source example uses a passive (`he was informed`) and its Japanese translation likewise omits the recipient, confirming natural ellipsis rather than a prompt/answer mismatch.
- Recommended direction: 現promptと3つの回答形を維持する。受け手は共通の省略可能な役割であり、person slotを新たにpromptへ追加する必要はない。
- Confidence: HIGH
- Source example (E0468): “Informed of her safety, he breathed a sigh of relief.” / 彼女の無事を知らされて、彼は安堵のため息をついた。

### vocab:02417 — CONFIRMED

- Prompt: 信頼する
- TARGET: `trust`
- Current paraphrases: `have confidence in someone`, `rely on someone`
- Rules: PLACEHOLDER_ASYMMETRY, PROMPT_SLOT_MISMATCH
- Decision reason: The prompt「信頼する」allows a person or a thing as its object, and TARGET `trust` likewise accepts both. Both paraphrases explicitly restrict that object to `someone`. A person-only answer therefore requires a narrower object type than the Japanese prompt supplies. The source example (`trust her`) confirms a person use but does not narrow the prompt's broader meaning.
- Recommended direction: Promptを「someoneを信頼する」にし、TARGETを「trust someone」に揃える。既存paraphrasesの「have confidence in someone」「rely on someone」は同じperson slotの候補として残す。
- Confidence: HIGH
- Source example (E0531): “"Jennifer deceived me!" "You should have known better than to trust her."” / 「ジェニファーにだまされた！」「彼女を信じないくらいの分別があっても良かったのに。」

### vocab:02443 — FALSE_POSITIVE

- Prompt: 恋愛感情
- TARGET: `romantic interest`
- Current paraphrases: `romantic feelings`, `feelings for someone`
- Rules: PLACEHOLDER_ASYMMETRY, INTERNAL_PARAPHRASE_INCONSISTENCY, PROMPT_SLOT_MISMATCH
- Decision reason: In this entry,「恋愛感情」and `romantic interest` / `romantic feelings` inherently describe a relation to a person. `feelings for someone` spells out that same naturally understood target; it does not add an independent slot the learner must infer. The source example also identifies Bill as the person Monica's romantic interest concerns.
- Recommended direction: 現promptとparaphrasesを維持する。恋愛感情の関係対象は語義に内在しており、person slotの追加や `feelings for someone` の除外は不要。
- Confidence: HIGH
- Source example (E0522): “Bill just wanted to comfort Monica, but she interpreted it as romantic interest.” / ビルはただモニカを慰めたかっただけなのに、彼女は彼が自分に気があるのだと解釈した。

### vocab:02451 — FALSE_POSITIVE

- Prompt: somethingすることを恐れている
- TARGET: `be afraid of doing something`
- Current paraphrases: `be afraid to do something`, `be scared to do something`, `fear doing something`
- Rules: SYNTACTIC_FRAME_MISMATCH
- Decision reason: The prompt explicitly supplies the action slot with「somethingすること」. Every answer form takes that same action as its complement; `of + gerund` and `to-infinitive` are different surface frames but do not change the slot count or type. The source example's `taking risks` is the same kind of action slot. Possible nuance differences do not establish a structural rule violation.
- Recommended direction: 「somethingすること」のprompt slotを維持し、現行のgerund/to-infinitive answer surfacesを構造不整合として除外しない。
- Confidence: HIGH
- Source example (E0537): “"To be honest, I'm crazy about Ken because he's brave, self-confident, and never afraid of taking risks." "If I were you, I'd ask him out!"” / 「正直言うと私、ケンに夢中なの。だって、勇敢で自分に自信を持っていて、それに危険を冒すことを決して恐れないでしょ。」「私ならデートに誘うわ。」

## FALSE_POSITIVE review

### vocab:02454 — FALSE_POSITIVE

- Canonical: `it's about time`
- Accepted paraphrases: neutral `it's time to do something`; overdue/admonishing `it's high time someone did something`
- Decision: The different syntactic frames are intentional related constructions, not a slot-authority inconsistency. Source E0538, “Isn't it about time you settled down?”, demonstrates `it's about time + subject + past`.
- Production direction: Preserve the canonical and both paraphrases; no production remediation.

All 81 records are retained in `false-positive.json` with the triggering signal and exclusion reason. Seven former REVIEW candidates moved to FALSE_POSITIVE: vocab:01010, vocab:01063, vocab:01399, vocab:02098, vocab:02287, vocab:02443, and vocab:02451. One former CONFIRMED candidate, vocab:02393, was reclassified after upstream Meaning / Canonical authority confirmed an intentional multi-sense card: `be someone's` expresses its ownership sense, while E0508 means fitting in / belonging to a place. Corrected contextual gloss: 「その場所に属する／なじめる」. Preserve canonical `belong`; no production remediation is needed. Repeated examples include clause-word substring matches where the expression is actually NP-taking (`because of`), fixed idioms (`something of a surprise`, `just in case`), anaphoric `it/that`, and matched event/person slots expressed through different but equivalent frames.


## Resolution closure

- REVIEW candidates resolved: 8 / 8; final REVIEW count: 0.
- Candidate population remains 137; CONFIRMED 56 + FALSE_POSITIVE 81 = 137; unclassified 0.
- The resolution read current `main` at the same SHA as the audit base. The eight former REVIEW candidates and the single targeted vocab:02454 reclassification were resolved without a broader re-audit.
- Production data, tests, UI, ASR, grammar-role data, and service worker remain unchanged. No merge was performed.
