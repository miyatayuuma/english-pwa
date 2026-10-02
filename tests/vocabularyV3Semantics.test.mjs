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
  ];
  for(const [canonical,sense,paraphrase] of fixtures){
    const value=entry(canonical,sense);
    assert.ok(value,`${canonical}/${sense} is present`);
    assert.deepEqual(value.paraphrases,[paraphrase]);
  }
});
