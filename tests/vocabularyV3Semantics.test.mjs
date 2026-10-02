import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const items=JSON.parse(fs.readFileSync(new URL('../data/items.json',import.meta.url),'utf8'));
const db=JSON.parse(fs.readFileSync(new URL('../data/vocabulary-v3.json',import.meta.url),'utf8'));
const itemById=new Map(items.map(item=>[item.id,item]));
const entry=(canonical,senseKey)=>db.entries.find(value=>value.canonical===canonical&&value.sense_key===senseKey);
function surface(value){const occurrence=value.occurrences[0],item=itemById.get(occurrence.item_id);return item.en.slice(occurrence.start,occurrence.end);}

test('known wrong-sense regressions stay pinned to their source expressions and intended meanings',()=>{
  const fixtures=[
    ['take up','occupy_space_or_time','E0020','taking up',/取る/,/再開する/],
    ['turn something off','stop_a_device_or_flow','E0102','Turn the faucet off',/止める|切る/,/解雇する/],
    ['come across someone','meet_by_chance','E0524','came across Nick',/偶然|見かける/,/印象を与える/],
    ['make someone do something','causative_make','E0130','make her sign',/人に.*させる/,/成功/],
    ['be beside oneself','extremely_upset','E0010','beside himself',/取り乱/,/比較/],
    ['sound asleep','sleeping_deeply','E0523','sound asleep',/ぐっすり|熟睡/,/音/],
    ['twist your ankle','injure_ankle_by_twisting','E0190','twisted his ankle',/ひねる/,/捻挫|ツイスト/],
    ['assume that','take_as_true','E0227','assume that',/考える|仮定/,/自分のもの|奪い/],
    ['job interview','employment_interview','E0366','job interview',/就職面接/,/面会/],
    ['turn someone down','reject_a_person_or_offer','E0178','turned me down',/断る/,/弱める/],
    ['put your gloves on','put_on_gloves','E0189','put my gloves on',/手袋をはめる/,/飢え/],
    ['be starved','very_hungry','E0560','starved',/お腹.*ぺこぺこ/,/飢えさせる/],
    ['so childish that','so_adjective_that_result','E0371','so childish that',/子供っぽい/,/目的/],
    ['come out','be_published','E0012','come out',/出る/,/結果が出る/],
    ['take it easy','relax_or_not_worry','E0002','Take it easy',/気楽/,/世話/],
    ['let go of something','stop_holding_or_clinging','E0003','Let go of your negative outlook on life',/手放す/,/許す/],
    ['give off something','emit_smell_or_light','E0007','giving off a subtle scent of perfume',/発する/,/諦め/],
    ['keep track of something','monitor_or_record','E0026','keep track of them',/把握/,/見失/],
    ['in all likelihood','very_probably','E0035','In all likelihood',/ほぼ間違いなく/,/可能性がない/],
    ['have a habit of doing something','repeated_behavior','E0049','has a habit of biting his nails',/癖/,/一度だけ/],
    ['bring about something','cause_to_happen','E0052','brought about great benefits',/引き起こす/,/防ぐ/],
    ['be opposed to something','disagree_with_or_resist','E0057','opposed to so-called gene therapy',/反対/,/賛成/],
    ['no way','strong_disbelief','E0062','No way',/まさか/,/同意/],
    ['rob someone of something','deprive_by_stealing','E0071','was robbed of her purse',/奪う/,/与える/],
    ['turn to someone','seek_help_or_support','E0075','turn to',/頼る/,/無視/],
    ['make something out','understand_or_discern','E0080','make out what you were getting at',/理解|見分け/,/作り上げ/],
    ['talk someone into doing something','persuade_someone_to_do','E0081','talked everyone into going along with my plan',/説得/,/反対/],
    ['come up with something','think_of_an_idea','E0084','came up with an ingenious, sensible solution',/思いつく/,/捨てる/],
    ['result in something','cause_a_result','E0088','resulted in complete failure',/結果/,/防ぐ/],
    ['make up for something','compensate_for_a_lack','E0089','makes up for her lack of firsthand experience',/埋め合わせ|補/,/悪化/],
    ['look into something','investigate','E0095','looking into the cause of the crash',/調べ/,/無視/],
    ['be to blame for something','be_responsible_for_bad_result','E0099','is to blame for the disaster',/責任/,/無関係/],
    ['no sooner did something happen than something else happened','immediate_sequence','E0112','No sooner had I sat back and relaxed than my wife asked me to do the chores',/すぐ|途端/,/同時でない/],
    ['be dying of thirst','very_thirsty','E0124','dying of thirst',/喉.*渇/,/死亡/],
    ['as long as','condition_provided_that','E0127','as long as the rent is low',/でさえあれば/,/期間の長さ/],
    ['be particular about something','care_about_specific_choices','E0127','particular about it',/こだわる/,/無関心/],
    ['be jealous of something','feel_envy_toward','E0150','jealous of his wealth and status',/嫉妬/,/賞賛/],
    ['make sense','be_logical_or_understandable','E0158','make sense',/筋/,/意味不明/],
    ['provoke','make_someone_angry_or_annoyed','E0544','provoked',/怒らせ|挑発/,/反応を引き起こす/],
    ['interfere','disrupt_or_get_in_the_way','E0548','interfered',/邪魔|妨げ/,/干渉/],
    ['perceive','notice_or_become_aware_of','E0463','perceived',/気づく|感じ取る/,/知覚する/],
    ['critical','dangerously_serious','E0469','critical',/危機的|深刻/,/危篤/],
    ['penetrate','go_into_or_through','E0469','penetrated',/入り込む|貫く/,/貫通する/],
    ['cargo','goods_carried_by_transport','E0474','cargo',/貨物/,/旅客/],
    ['inspire','give_someone_desire_or_idea_to_act','E0481','inspired',/刺激|奮い立たせ/,/命令/],
    ['worship','show_deep_religious_respect','E0486','worships',/崇拝/,/神だけ/],
    ['prevail','be_widespread_or_common','E0487','prevail',/広く|行われ/,/成功|勝利/],
    ['intimate','personal_or_private','E0497','intimate',/個人的|私的/,/親密/],
    ['eloquent','fluent_and_persuasive_in_expression','E0350','eloquent',/雄弁|説得力/,/無口/],
    ['devote','give_time_or_effort_to','E0384','devoted',/捧げる/,/専念する/],
    ['tolerate','accept_or_endure_something_unpleasant','E0419','tolerate',/容認|耐える/,/拒絶/],
    ['regime','government_or_ruling_system','E0429','regime',/政権|体制/,/民間企業/],
    ['mortality','death_or_death_rate','E0326','mortality',/死亡/,/死亡率だけ/],
    ['infection','state_or_process_of_being_infected','E0327','infection',/感染/,/感染症だけ/],
    ['discipline','system_of_rules_and_control','E0336','discipline',/規律/,/訓練/],
    ['abuse','misuse_something','E0144','abused',/乱用/,/虐待/],
    ['obscure','unclear_or_difficult_to_understand','E0158','obscure',/曖昧|不明瞭/,/無名/],
    ['thesis','academic_paper_or_dissertation','E0158','thesis',/論文/,/仮説/],
    ['propose','ask_someone_to_marry','E0178','proposed',/結婚|プロポーズ/,/提案/],
    ['neglect','fail_to_do_or_give_proper_attention','E0195','neglects',/怠る|放置/,/世話だけ/],
    ['endangered','in_danger_of_harm_or_destruction','E0229','endangered',/危機/,/絶滅だけ/],
    ['preserve','protect_or_keep_existing','E0229','preserving',/保護|保存/,/放棄/],
    ['emission','release_of_gases_or_pollutants','E0237','emissions',/排出/,/吸収/],
    ['genius','exceptional_ability','E0089','genius',/才能/,/天才$/],
    ['capacity','ability_to_do_something','E0090','capacity',/能力/,/容量/],
    ['dismal','very_bad_or_gloomy','E0030','dismal',/悲惨|暗い/,/明るい/],
    ['expose','subject_to_harmful_influence','E0038','exposed',/さらす/,/公開/],
    ['epidemic','widespread_outbreak_of_disease','E0047','epidemic',/流行/,/慢性/],
    ['despise','feel_contempt_for','E0375','despise',/軽蔑/,/ひどく嫌う/],
    ['gender','gender_category','E0004','gender',/性別|ジェンダー/,/国籍/],
    ['regardless','without_regard_to_circumstances','E0004','regardless',/関係なく/,/性別/],
    ['it dawns on someone that something is true','come_to_realize','E0539','It dawned on me that I had been taken in by Jennifer',/気づく|分かってくる/,/徐々にだけ/],
    ['put up with something','tolerate_something','E0545','put up with her arrogance',/我慢|耐える/,/人に我慢/],
    ['all at once','suddenly','E0550','All at once',/突然/,/一度に/],
    ['be open to something','be_susceptible_to','E0525','is open to misunderstanding',/されやす|可能性/,/受け入れる用意/],
  ];
  for(const [canonical,sense,itemId,expectedSurface,meaning,forbidden] of fixtures){
    const value=entry(canonical,sense);
    assert.ok(value,`${canonical}/${sense} is present`);
    assert.equal(value.occurrences[0].item_id,itemId);
    assert.equal(surface(value),expectedSurface);
    assert.match(value.meaning_ja,meaning);
    assert.doesNotMatch(value.meaning_ja,forbidden);
  }
});

test('retained lexical occurrences are represented once per sense with exact source offsets',()=>{
  const seen=new Set();
  for(const value of db.entries){
    for(const occurrence of value.occurrences){
      const item=itemById.get(occurrence.item_id);
      assert.ok(item,`${value.id} source exists`);
      const actual=item.en.slice(occurrence.start,occurrence.end);
      assert.ok(/[A-Za-z]/.test(actual),`${value.id} target contains English text`);
      assert.equal(actual.trim(),actual,`${value.id} target has no surrounding whitespace`);
      const key=`${value.canonical}:${value.sense_key}:${occurrence.item_id}:${occurrence.start}:${occurrence.end}`;
      assert.equal(seen.has(key),false,`${key} has no duplicate`);
      seen.add(key);
    }
  }
});

test('malformed E0483 wording does not create a guessed cost expression',()=>{
  assert.equal(db.entries.some(value=>value.occurrences.some(occurrence=>occurrence.item_id==='E0483')),false);
});


test('contextual glosses do not absorb surrounding negation or neighboring modifiers',()=>{
  const fixtures=[
    ['favor','support_or_approval','支持',/法案/],
    ['familiar','known_to_someone','なじみのある',/ない/],
    ['pause','brief_stop','間',/気まずい|沈黙/],
    ['humble','lowly_or_modest_in_status_or_background','質素な',/家庭|出身/],
    ['linger','remain_for_a_long_time','残り続ける',/疑い/],
    ['suspect','believe_someone_may_be_guilty_or_involved','疑う',/賄賂|受け取/],
    ['charge','responsibility_or_control','責任',/担当|立場/],
    ['burden','heavy_responsibility','負担',/重荷/],
    ['recession','period_of_economic_decline','景気後退',/set in/],
    ['accommodate','provide_space_for','泊める',/400|宿泊客/],
    ['risk','possibility_of_harm_or_danger','危険',/さらされ|冒す/],
    ['favor','act_of_help','親切',/頼み/],
    ['charge','fee_for_a_service','料金',/追加/],
    ['delay','make_something_happen_later','遅れる',/遅らせる/],
    ['chore','routine_household_task','雑用',/家事/],
    ['shatter','break_into_many_pieces','粉々に割れる',/粉々にする/],
    ['afford','have_enough_money_or_time_for','余裕がある',/購入/],
    ['rate','proportion_or_frequency','率',/失業/],
    ['rate','speed_or_degree_of_change','速度',/増加/],
    ['vacant','not_occupied_or_in_use','空きの',/地/],
    ['legal','connected_with_law','法的な',/措置/],
    ['recommend','advise_that_something_is_good_or_suitable','勧める',/法的|措置/],
    ['benefit','good_effect_or_advantage','恩恵',/人類|大きな|もたら/],
    ['humanity','human_race','人類',/全体/],
    ['absurd','ridiculous_or_unreasonable','ばかげた',/考え/],
    ['pursue','work_toward_or_follow','追い求める',/理想/],
    ['outcome','result_of_an_event_or_process','結果',/選挙/],
    ['vague','unclear_or_indefinite','曖昧な',/噂/],
    ['sufficient','enough_for_a_purpose','十分な',/証拠/],
    ['relevant','closely_connected_to_topic','関連する',/書類/],
    ['vivid','producing_a_clear_strong_image','生々しい',/悪夢/],
    ['hesitate','pause_before_acting','ためらう',/侵害/],
    ['sensitive','easily_affected_or_offended','敏感な',/批判/],
    ['awkward','socially_uncomfortable','気まずい',/沈黙/],
    ['ambiguous','open_to_more_than_one_interpretation','曖昧な',/返事/],
    ['mature','behaving_like_an_adult','大人びた',/年の割/],
    ['sophisticated','socially_polished_or_refined','洗練された',/人たち/],
    ['cautious','careful_to_avoid_danger_or_risk','慎重な',/とても/],
    ['novel','long_work_of_fiction','長編小説',/新しい/],
    ['translate','express_in_another_language','翻訳する',/日本語/],
    ['familiar','knowledgeable_about_a_subject','詳しい',/文学/],
    ['break up','end_a_romantic_relationship','別れる',/二人/],
    ['on and off','intermittently','断続的に',/付き合|別れ|長い/],
    ['be there for someone','support_someone','あなたを支える',/そばにいるだけ/],
    ['feel down','feel_sad_or_low','落ち込んでいる',/たり/],
    ['fade away','gradually_disappear','徐々に消えていく',/すぐ|ない/],
    ['be at a loss for words','not_know_what_to_say','言葉を失う',/あきれて/],
    ['not necessarily','not_always_or_inevitably','必ずしも〜とは限らない',/純粋/],
    ['none of someone\'s business','not_someones_concern','君には関係ないこと',/だ$/],
    ['out of place','not_belonging_in_a_setting','場違い',/洗練|人々/],
    ['go ahead','proceed_or_go_first','お先にどうぞ',/あなた/],
    ['can\'t stand something','be_unable_to_tolerate','我慢できない',/もう/],
    ['come over','visit_someone','そちらに行く',/すぐ/],
    ['go too far','act_beyond_acceptable_limits','やりすぎた',/今回/],
    ['be in a better mood','feel_happier_or_less_angry','彼女の機嫌がよい',/直ったら/],
    ['be kidding','be_joking','冗談を言っている',/だろ/],
    ['know better than to do something','be_sensible_enough_not_to','彼女を信じないだけの分別がある',/よかった/],
    ['show up','arrive_or_appear','現れる',/なかった/],
  ];
  for(const [canonical,sense,expected,forbidden] of fixtures){
    const value=entry(canonical,sense);
    assert.ok(value,`${canonical}/${sense} is present`);
    const gloss=value.occurrences[0].contextual_meaning_ja;
    assert.equal(gloss,expected);
    assert.doesNotMatch(gloss,forbidden);
  }
});


test('reality glosses remain lexical across ordinary and fixed-expression occurrences',()=>{
  const value=entry('reality','actual_conditions_or_facts');
  assert.ok(value);
  assert.deepEqual(value.occurrences.map(row=>row.contextual_meaning_ja),['現実','現実']);
});


test('major word paraphrases remain source-substitutable',()=>{
  const fixtures=[
    ['discourage','reduce_someone_s_confidence_or_willingness','deter'],
    ['significant','important_or_large','substantial'],
    ['alter','change','change'],
    ['obscure','unclear_or_difficult_to_understand','unclear'],
    ['precise','exact_and_accurate','exact'],
    ['conceal','hide','hide'],
    ['preserve','protect_or_keep_existing','protect'],
    ['genuine','real_and_not_fake','authentic'],
    ['frank','direct_and_honest','candid'],
    ['eventually','in_the_end','ultimately'],
    ['sensible','reasonable_and_practical','reasonable'],
    ['defeat','win_against_in_a_contest','beat'],
    ['endeavor','serious_effort','effort'],
    ['exhausted','very_tired','worn out'],
    ['eager','strongly_wanting','keen'],
    ['purchase','buy','buy'],
    ['anticipate','expect_in_advance','expect'],
    ['competent','able_and_skilled','skilled'],
    ['consequence','result_of_an_action','result'],
    ['inevitable','impossible_to_avoid','unavoidable'],
    ['alarming','causing_worry_or_alarm','worrying'],
    ['decline','become_less','decrease'],
    ['remote','far_away','distant'],
    ['emphasize','give_special_importance_to','stress'],
    ['cultivate','grow_crops','grow'],
    ['intense','very_strong','strong'],
    ['remedy','treatment_for_illness','treatment'],
    ['humanity','human_race','humankind'],
    ['technique','method_of_doing_something','method'],
    ['go easy on someone','be_gentle_or_lenient','be gentle with someone'],
    ['go through a rough period','experience_difficult_time','go through a difficult time'],
    ['do you have the time','ask_current_time','what time is it'],
    ['irritated','annoyed_or_impatient','annoyed'],
    ['despise','feel_contempt_for','look down on'],
    ['absurd','ridiculous_or_unreasonable','ridiculous'],
    ['pursue','work_toward_or_follow','seek'],
    ['outcome','result_of_an_event_or_process','result'],
    ['awkward','socially_uncomfortable','uncomfortable'],
    ['sophisticated','socially_polished_or_refined','refined'],
    ['cautious','careful_to_avoid_danger_or_risk','careful'],
    ['grief','deep_sorrow','sorrow'],
    ['maintain','keep_in_a_condition','keep'],
    ['regardless','without_regard_to_circumstances','irrespective'],
    ['subtle','difficult_to_notice','faint'],
    ['scarcely','almost_not','hardly'],
    ['confuse','mistake_one_thing_for_another','mix up'],
    ['break up','end_a_romantic_relationship','split up'],
    ['all by oneself','completely_alone','alone'],
    ['be crazy about someone','be_extremely_enthusiastic_about','be really into someone'],
    ['take risks','do_things_that_may_be_dangerous','take chances'],
    ['ask someone out','invite_on_a_date','ask someone on a date'],
    ['on and off','intermittently','off and on'],
    ['for ages','for_a_very_long_time','for a long time'],
    ['it dawns on someone that something is true','come_to_realize','someone realizes that something is true'],
    ['take someone in','deceive_someone','deceive someone'],
    ['all along','the_entire_time','the whole time'],
    ['be seeing someone','be_dating_someone','be dating someone'],
    ['what\'s up','casual_greeting_or_question','what\'s new'],
    ['not much','nothing_new_or_significant','nothing much'],
    ['get married to someone','marry_someone','marry someone'],
    ['feel down','feel_sad_or_low','feel low'],
    ['be there for someone','support_someone','support someone'],
    ['take something back','retract_a_statement','retract something'],
    ['put up with something','tolerate_something','tolerate something'],
    ['take advantage of someone','exploit_someone','exploit someone'],
    ['take your time','do_not_hurry','don\'t rush'],
    ['reflect on something','think_carefully_about','think carefully about something'],
    ['get through something','successfully_endure','overcome something'],
    ['on one\'s own','without_help_from_others','by oneself'],
    ['interfere with something','disrupt_or_get_in_the_way','get in the way of something'],
    ['all at once','suddenly','suddenly'],
    ['burst into laughter','suddenly_start_laughing','burst out laughing'],
    ['spoil something','ruin_a_mood_or_experience','ruin something'],
    ['besides doing something','in_addition_to','in addition to doing something'],
    ['feel for someone','sympathize_with_someone','sympathize with someone'],
    ['fade away','gradually_disappear','fade'],
    ['get over something','recover_from_difficulty_or_loss','recover from something'],
    ['cherish memories of something','hold_memories_dear','treasure memories of something'],
    ['be at a loss for words','not_know_what_to_say','be speechless'],
    ['get engaged to someone','become_engaged_to_marry','become engaged to someone'],
    ['take someone or something for example','offer_as_an_illustration','take someone or something as an example'],
    ['leave someone alone','stop_bothering_someone','stop bothering someone'],
    ['none of someone\'s business','not_someones_concern','not someone\'s concern'],
    ['have something on backwards','wear_something_back_to_front','wear something backwards'],
    ['adjust to something','become_used_to_new_conditions','adapt to something'],
    ['on the other hand','introduce_contrast','by contrast'],
    ['be into something','be_very_interested_in','be interested in something'],
    ['derive pleasure from something','get_enjoyment_from','enjoy something'],
    ['be up for something','feel_willing_or_interested','be in the mood for something'],
    ['after you','polite_invitation_to_go_first','you first'],
    ['go ahead','proceed_or_go_first','go first'],
    ['say hi to someone','send_a_greeting','say hello to someone'],
    ['pay attention to something','notice_or_focus_on','focus on something'],
    ['as far as someone is concerned','regarding_someone','as for someone'],
    ['anything goes','anything_is_allowed','anything is acceptable'],
    ['by contrast','introduce_a_difference','on the other hand'],
    ['take someone by the hand','hold_someones_hand','take someone\'s hand'],
    ['comfort someone','make_someone_feel_better','console someone'],
    ['interpret something as something else','understand_as_a_different_meaning','take something as something else'],
    ['be open to something','be_susceptible_to','be subject to something'],
    ['can\'t stand something','be_unable_to_tolerate','can\'t tolerate something'],
    ['calm down','become_less_agitated','relax'],
    ['come over','visit_someone','come by'],
    ['as soon as possible','at_the_earliest_opportunity','as quickly as possible'],
    ['take something literally','understand_words_exactly','interpret something literally'],
    ['make fun of someone','mock_someone','mock someone'],
    ['go too far','act_beyond_acceptable_limits','cross the line'],
    ['get along with someone','have_a_good_relationship','be on good terms with someone'],
    ['be kidding','be_joking','be joking'],
    ['tear something up','rip_into_pieces','rip something up'],
    ['throw something away','discard_something','discard something'],
    ['regret doing something','feel_sorry_for_past_action','be sorry for doing something'],
    ['a great deal of something','a_large_amount','a lot of something'],
    ['look back on something','remember_or_reflect_on_past','reflect on something'],
    ['be used to something','be_accustomed_to','be accustomed to something'],
    ['no wonder','not_surprising','it\'s no surprise'],
  ];
  for(const [canonical,sense,paraphrase] of fixtures){
    const value=entry(canonical,sense);
    assert.ok(value,`${canonical}/${sense} is present`);
    assert.deepEqual(value.paraphrases,[paraphrase]);
  }
});


test('audited expression spans exclude unrelated surrounding material',()=>{
  const fixtures=[
    ['break up','end_a_romantic_relationship','broke up'],
    ['on and off','intermittently','on and off'],
    ['be there for someone','support_someone','be there for you'],
    ['feel for someone','sympathize_with_someone','feel for you'],
    ['fade away','gradually_disappear','fade away'],
    ['not necessarily','not_always_or_inevitably','not necessarily'],
    ['none of someone\'s business','not_someones_concern','none of your business'],
    ['out of place','not_belonging_in_a_setting','out of place'],
    ['go ahead','proceed_or_go_first','go ahead'],
    ['say hi to someone','send_a_greeting','say hi to your family'],
    ['can\'t stand something','be_unable_to_tolerate',"can't stand it"],
    ['come over','visit_someone','come over'],
    ['go too far','act_beyond_acceptable_limits','went too far'],
    ['be in a better mood','feel_happier_or_less_angry',"she's in a better mood"],
    ['be kidding','be_joking','be kidding'],
    ['know better than to do something','be_sensible_enough_not_to','known better than to trust her'],
    ['show up','arrive_or_appear','show up'],
  ];
  for(const [canonical,sense,expectedSurface] of fixtures){
    const value=entry(canonical,sense);
    assert.ok(value,`${canonical}/${sense} is present`);
    assert.equal(surface(value),expectedSurface);
  }
});
