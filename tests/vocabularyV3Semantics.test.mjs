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
    ['go wrong','develop_a_problem','E0171','gone wrong',/うまくいか|おかしく/,/正しい/],
    ['be composed of something','be_made_up_of','E0175','composed of hydrogen and oxygen',/構成/,/分解/],
    ['show something off','display_proudly','E0177','show off her perfect figure',/見せびらか/,/隠す/],
    ['keep something in mind','remember_or_consider','E0185','Keep in mind that youth is not eternal',/心に留め/,/忘れる/],
    ['on earth','emphatic_why_or_how','E0186','on earth',/いったい/,/地球/],
    ['be conscious of something','be_aware_of','E0188','conscious of annoying us',/意識/,/無自覚/],
    ['if ever','if_at_all','E0192','if ever',/あるとしても/,/頻繁/],
    ['think much of something','have_high_opinion','E0197','think much of them',/高く評価/,/低く評価/],
    ['give out','come_to_an_end_or_fail','E0199','gave out',/尽きる/,/配る/],
    ['stop by','visit_briefly','E0201','stop by',/立ち寄/,/通り過ぎ/],
    ['for good','permanently','E0205','for good',/永久/,/一時的/],
    ['pay off','bring_a_good_result','E0210','pays off',/報われ/,/損/],
    ['cheer up','become_more_cheerful','E0211','Cheer up',/元気/,/落ち込/],
    ['be tied up','be_busy_unavailable','E0212','tied up',/手が離せない/,/暇/],
    ['turn up','arrive_or_appear','E0213','turned up',/現れ/,/消え/],
    ['run out of something','use_all_of_a_supply','E0214','ran out of gas',/切らす/,/補充/],
    ['out of control','not_under_control','E0223','out of control',/制御/,/安定/],
    ['run someone over','hit_with_vehicle','E0223','running over a pedestrian',/ひく/,/避け/],
    ['give way','collapse_or_fail_structurally','E0252','giving way',/崩れ/,/譲る/],
    ['chances are','probably','E0255','chances are',/おそらく/,/確実/],
    ['clear up','weather_becomes_clear','E0255','clear up',/晴れ/,/曇/],
    ['stand for something','abbreviation_represents','E0258','stands for "artificial intelligence',/表す/,/反対/],
    ['room for improvement','potential_to_improve','E0268','room for improvement',/改善の余地/,/完成/],
    ['catch on','become_popular','E0270','catching on',/人気/,/廃れ/],
    ['come into being','begin_to_exist','E0277','come into being',/誕生|生まれ/,/消滅/],
    ['look up','improve_or_get_better','E0279','looking up',/上向|好転/,/悪化/],
    ['take someone out','take_on_a_date','E0283','take her out',/デート/,/家に留め/],
    ['see to something','take_care_of_a_task','E0285','see to it',/処理|きちんと/,/放置/],
    ['be around','be_nearby_or_present','E0286','is around',/そば|近く/,/不在/],
    ['set in','unpleasant_condition_begins','E0288','set in',/始ま/,/終わ/],
    ['lay someone off','dismiss_from_employment','E0288','were laid off',/解雇/,/雇用/],
    ['be worried about something','feel_anxious_about','E0290','worried about something',/心配/,/安心/],
    ['be concerned about something','feel_anxious_about','E0290','concerned about',/気に|心配/,/無関心/],
    ['in vain','without_success','E0292','in vain',/無駄/,/成功/],
    ['all you have to do is do something','only_required_action','E0295','All you have to do is fill in the blanks below',/だけ|さえ/,/禁止/],
    ['get back to someone','contact_or_respond_later','E0309','get back to you',/返事/,/無視/],
    ['have no idea','not_know_at_all','E0311','have no idea',/分から/,/知っている/],
    ['hang around','stay_in_a_place_without_purpose','E0312','hanging around',/ぶらぶら/,/立ち去/],
    ['sort of','somewhat_or_in_a_way','E0315','sort of',/何だか|多少/,/完全に/],
    ['throw up','vomit','E0315','throwing up',/吐く/,/飲み込/],
    ['refrain from something','avoid_or_abstain_from','E0321','refrain from alcohol',/控える/,/続ける/],
    ['encourage someone to do something','give_someone_confidence_to_act','E0330','encouraged me to fulfill my ambitions',/励ます/,/妨げ/],
    ['as of a date','starting_from_a_date','E0333','as of April 1, 2001',/日付|から/,/以前/],
    ['be cut out for something','be_suited_to','E0336','cut out for the military',/向いて/,/不向き/],
    ['make a living','earn_enough_to_live','E0337','make a living',/生計/,/浪費/],
    ['toil away','work_hard_for_a_long_time','E0340','toil away',/働く/,/休む/],
    ['give in','stop_resisting','E0341','gives in',/折れ/,/抵抗/],
    ['make it','succeed_or_manage','E0346','make it',/うまく/,/失敗/],
    ['from hand to mouth','with_only_enough_to_survive','E0353','from hand to mouth',/その日暮らし/,/裕福/],
    ['by no means','definitely_not','E0354','by no means',/決して/,/確実に/],
    ['be hard up','have_little_money','E0355','hard up',/金欠/,/裕福/],
    ['work out','turn_out_well','E0362','work out',/うまく/,/失敗/],
    ['make heads or tails of something','understand_something','E0367','make heads or tails of them',/理解/,/混乱/],
    ['behind someone\'s back','without_someone_knowing','E0374','behind his back',/隠れて/,/面前/],
    ['on the contrary','introduce_opposite_view','E0375','On the contrary',/それどころか/,/同意/],
    ['make up one\'s mind','decide_firmly','E0377','made up my mind',/決心/,/迷/],
    ['get by','manage_to_survive_or_continue','E0378','get by',/何とか/,/失敗/],
    ['be sick of something','be_tired_of','E0382','sick of it',/うんざり/,/満足/],
    ['in need','needing_help','E0385','in need',/困って/,/裕福/],
    ['sell out','all_goods_are_sold','E0387','sold out',/売り切/,/在庫/],
    ['be referred to as someone or something','be_called_by_a_name','E0388','referred to as a man of integrity',/呼ばれ/,/無名/],
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
