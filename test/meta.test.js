const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLuaTable } = require('../scripts/lua-table.js');
const lib = require('../scripts/meta-lib.js');
const RocoMeta = require('../meta.js');
const data = require('../data.json');
const meta = require('../meta.json');
const season = require('../season.json');

// ---- Lua 表解析 ----

test('lua parser reads nested tables, strings, numbers, booleans and comments', () => {
  const table = parseLuaTable(`-- 头部注释
    return {
      a={name="迪莫",power=80,ok=true,none=nil,list={"x","y"}}, -- 行尾注释
      ["b c"]={n=-1.5,e=1e2},
      --[[ 块注释 ]] d=[[长
字符串]],
      esc="引号\\"和\\\\和\\n",
    }`);
  assert.deepEqual(table.a, { name: '迪莫', power: 80, ok: true, none: null, list: ['x', 'y'] });
  assert.deepEqual(table['b c'], { n: -1.5, e: 100 });
  assert.equal(table.d, '长\n字符串');
  assert.equal(table.esc, '引号"和\\和\n');
});

test('lua parser rejects malformed input instead of guessing', () => {
  assert.throws(() => parseLuaTable('return {a="未闭合}'), /未闭合/);
  assert.throws(() => parseLuaTable('return {a=@}'), /无法识别/);
});

// ---- 技能 ----

const skillsLua = `return {
  skill_1={category="攻击",damage_class="物攻",desc="造成物伤，3连击。",element="火系",energy=2,name="连环火",power=30,target="敌方随机单体"},
  skill_2={category="状态",desc="敌方获得<br>中毒。",element="无系别",energy=1,name="毒雾",target="敌方随机单体"},
  skill_3={category="特性",desc="回合结束时回复生命。",element="无系别",energy=0,name="生长",target="自身"},
  skill_4={category="防御",desc="减伤70%，应对攻击。",element="普通系",energy=1,name="防御",target="自身"}
}`;

test('normalizeSkills keeps battle skills, drops traits and cleans fields', () => {
  const skills = lib.normalizeSkills(skillsLua);
  assert.deepEqual(Object.keys(skills), ['连环火', '毒雾', '防御']);
  assert.deepEqual(skills['连环火'], { element: '火', category: '攻击', damageClass: '物攻', power: 30, hits: 3, energy: 2, refund: 0, target: '敌方随机单体', desc: '造成物伤，3连击。' });
  assert.equal(skills['毒雾'].element, null);
  assert.equal(skills['毒雾'].desc, '敌方获得 中毒。');
  assert.equal(skills['防御'].hits, 1);
});

test('parseSelfRefund counts only fixed, unconditional, self-directed energy', () => {
  const refund = lib.parseSelfRefund;
  assert.equal(refund('造成物伤，自己回复1能量。'), 1);
  assert.equal(refund('自己回复10能量。'), 10);
  assert.equal(refund('自己回复15%生命和4能量。'), 4, 'life and energy in one clause');
  assert.equal(refund('选择：自己回复25%生命或回复8能量。'), 8);
  assert.equal(refund('自己回复2能量，己方队伍获得1次奉献：能耗-2。'), 2);
  // 条件、他人、随场面变化的一律不算
  assert.equal(refund('造成物伤，若使用本技能击败敌方，回复6能量。'), 0, 'condition in the previous clause');
  assert.equal(refund('造成物伤，敌方每有1层冻结，自己回复1能量。'), 0);
  assert.equal(refund('造成物伤，应对状态：自己回复50%生命和5能量。'), 0);
  assert.equal(refund('减伤80%，应对攻击：回复3能量。'), 0);
  assert.equal(refund('造成魔伤，为场下所有精灵回复1能量。'), 0);
  assert.equal(refund('自己脱离，替换入场的精灵回复8能量。'), 0);
  assert.equal(refund('回复能量，回复值等于敌方技能总能耗的一半。'), 0);
  assert.equal(refund('敌方失去3能量。'), 0);
  assert.equal(refund(''), 0);
});

test('every skill with a refund in meta.json really mentions energy recovery', () => {
  const refunding = Object.entries(meta.skills).filter(([, skill]) => skill.refund > 0);
  assert.ok(refunding.length >= 10);
  for (const [name, skill] of refunding) assert.match(skill.desc, /回复.*能量/, name);
});

// ---- 阵容页面 ----

const page = (extra = '') => `{{精灵阵容
|阵容标题=地刺队
|阵容血脉魔法=愿力冲击
|阵容介绍=第一行<br>第二行 [[波多西|波多]]
第三行
|阵容作者=作者甲
|阵容类型=pvp
|阵容上传日期=2026-5-2
|阵容精灵1=波多西
|阵容精灵1血脉=地
|阵容精灵1技能1=地刺
|阵容精灵1技能2=文件:图标 宠物 属性 .png文件:技能图标 .png
|阵容精灵1技能3=防御
|阵容精灵2=食尘短绒
|阵容精灵2技能1=地刺
${extra}}}`;

test('parseLineupPage reads template fields, multi-line values and junk skills', () => {
  const lineup = lib.parseLineupPage('精灵阵容/x', page(), '2026-05-03T00:00:00Z');
  assert.equal(lineup.title, '地刺队');
  assert.equal(lineup.author, '作者甲');
  assert.equal(lineup.type, 'pvp');
  assert.equal(lineup.date, '2026-05-02', 'non-padded upload date is normalized');
  assert.equal(lineup.intro, '第一行 第二行 波多 第三行');
  assert.equal(lineup.magic, '愿力冲击');
  assert.deepEqual(lineup.members.map(m => m.name), ['波多西', '食尘短绒']);
  assert.deepEqual(lineup.members[0].skills, ['地刺', '防御'], 'image markup is not a skill');
  assert.equal(lineup.members[0].bloodline, '地');
});

test('parseLineupPage falls back to the revision date and ignores non-lineup pages', () => {
  const broken = page().replace('2026-5-2', '2026-13-40');
  assert.equal(lib.parseLineupPage('精灵阵容/x', broken, '2026-06-01T08:00:00Z').date, '2026-06-01');
  assert.equal(lib.parseLineupPage('用户:x', '没有模板', '2026-06-01T08:00:00Z'), null);
  assert.equal(lib.parseLineupPage('精灵阵容/y', '{{精灵阵容\n|阵容标题=空\n}}', '2026-06-01T08:00:00Z'), null);
});

test('isoDate rejects impossible dates', () => {
  assert.equal(lib.isoDate('2026-02-30'), null);
  assert.equal(lib.isoDate('2026-2-3'), '2026-02-03');
  assert.equal(lib.isoDate(undefined), null);
});

// ---- 精灵名对应 ----

const stats = { hp: 1, pa: 1, ma: 1, pd: 1, md: 1, sp: 1 };
const mini = {
  spirits: [
    { id: '0', no: '001', name: '岚鸟', types: ['翼'], stats, form: '' },
    { id: '1', no: '001', name: '岚鸟（春天的样子）', types: ['翼'], stats: { ...stats, hp: 2 }, form: '春天的样子' },
    { id: '2', no: '002', name: '权杖-V', types: ['机械'], stats, form: '' },
    { id: '3', no: '003', name: '甜甜（甲味）', types: ['冰'], stats, form: '甲味' },
    { id: '4', no: '003', name: '甜甜（乙味）', types: ['冰'], stats, form: '乙味' },
    { id: '5', no: '004', name: '雪球（甲）', types: ['冰'], stats, form: '甲' },
    { id: '6', no: '004', name: '雪球（乙）', types: ['水'], stats, form: '乙' }
  ]
};

test('resolver: exact, default-form, numeral and cosmetic-variant names', () => {
  const resolve = lib.createResolver(mini);
  assert.equal(resolve('岚鸟（春天的样子）').spirit.name, '岚鸟（春天的样子）');
  assert.equal(resolve('岚鸟（本来的样子）').spirit.name, '岚鸟');
  assert.equal(resolve('权杖-Ⅴ').spirit.name, '权杖-V', 'NFKC folds the roman numeral');
  const cosmetic = resolve('甜甜');
  assert.equal(cosmetic.spirit.name, '甜甜（甲味）');
  assert.equal(cosmetic.approx, true, 'identical builds resolve, flagged as approximate');
});

test('resolver: refuses ambiguous or unknown names', () => {
  const resolve = lib.createResolver(mini);
  assert.equal(resolve('雪球'), null, 'variants with different types are ambiguous');
  assert.equal(resolve('不存在的精灵'), null);
  assert.equal(resolve('岚鸟（冬天的样子）'), null, 'an unlisted form is not silently mapped when its siblings differ');
});

test('resolver: an unlisted form of a cosmetic-only family is flagged approximate', () => {
  const resolve = lib.createResolver(mini);
  const hit = resolve('甜甜（丙味）');
  assert.equal(hit.spirit.no, '003');
  assert.equal(hit.approx, true);
});

// ---- 聚合 ----

const member = (name, skills = []) => ({ name, ref: name, key: name, skills });
const lineup = (author, date, names, skills = []) => ({ title: `${author}${date}`, author, date, members: names.map(n => member(n, skills)) });

test('aggregate counts distinct authors and ignores repeated saves', () => {
  const rows = [
    lineup('甲', '2026-05-01', ['a', 'b', 'c', 'd', 'e', 'f'], ['x']),
    lineup('甲', '2026-05-02', ['a', 'b', 'c', 'd', 'e', 'f'], ['x']), // 同一作者、同一阵容的重复保存
    lineup('乙', '2026-05-03', ['a', 'g', 'h', 'i', 'j', 'k'], ['x', 'y'])
  ];
  const hot = lib.aggregate(rows);
  assert.equal(hot.uniqueSubmissions, 2);
  const a = hot.spirits.find(s => s.name === 'a');
  assert.equal(a.authors, 2);
  assert.equal(a.lineups, 2);
  const x = hot.skills.find(s => s.name === 'x');
  assert.equal(x.authors, 2);
  assert.equal(x.lineups, 2, 'a skill on two members of one lineup still counts that lineup once');
  assert.equal(hot.skills.find(s => s.name === 'y').authors, 1);
});

test('aggregate ranks lineups by independent authors with a similar roster', () => {
  const core = ['a', 'b', 'c', 'd'];
  const rows = [
    lineup('甲', '2026-05-01', [...core, 'e', 'f']),
    lineup('乙', '2026-05-02', [...core, 'g', 'h']),   // 与甲共 4 只：相近
    lineup('丙', '2026-05-03', [...core, 'i', 'j']),   // 与甲、乙都共 4 只
    lineup('丁', '2026-05-04', ['p', 'q', 'r', 's', 't', 'u']), // 无人相近
    lineup('丙', '2026-05-05', [...core, 'v', 'w'])    // 丙的第二份不应给丙自己加分
  ];
  const { lineups } = lib.aggregate(rows.map((row, i) => ({ ...row, page: String(i) })));
  const top = lineups[0];
  assert.equal(top.authors, 3, '甲乙丙');
  assert.equal(lineups.at(-1).authors, 1);
  assert.deepEqual(lineups.map(row => row.rank), lineups.map((_, i) => i + 1));
});

test('aggregate drops near-clones of an already listed lineup', () => {
  const rows = [
    lineup('甲', '2026-05-01', ['a', 'b', 'c', 'd', 'e', 'f']),
    lineup('乙', '2026-05-02', ['a', 'b', 'c', 'd', 'e', 'g']), // 共 5 只：近似克隆
    lineup('丙', '2026-05-03', ['a', 'b', 'c', 'd', 'x', 'y'])
  ];
  const { lineups } = lib.aggregate(rows.map((row, i) => ({ ...row, page: String(i) })));
  const shown = lineups.map(row => rows[row.lineup].members.map(m => m.name).join(''));
  assert.equal(new Set(shown.filter(names => names.includes('e'))).size, 1, 'only one of the two 5-overlap lineups is listed');
});

// ---- 序列化 ----

test('serialize round-trips and puts list items on separate lines', () => {
  const value = { schema: 1, lineups: [{ a: [1, 2] }, { a: [3] }], empty: [], nested: { k: { deep: [1] } } };
  const text = lib.serialize(value);
  assert.deepEqual(JSON.parse(text), value);
  assert.ok(text.split('\n').length >= 6);
});

// ---- 定时刷新的保护 ----

const snapshot = (over = {}) => ({
  generatedAt: '2026-09-29T00:00:00.000Z',
  source: { skills: { count: 500 }, lineups: { pvp: 100, authors: 60, lastSubmitted: '2026-06-10' } },
  skills: {}, lineups: [], hot: {}, ...over
});

test('checkRegression lets normal changes through and blocks shrinking data', () => {
  assert.deepEqual(lib.checkRegression(null, snapshot()), [], 'first run has nothing to compare');
  assert.deepEqual(lib.checkRegression(snapshot(), snapshot({ source: { skills: { count: 520 }, lineups: { pvp: 101, authors: 61, lastSubmitted: '2026-06-12' } } })), []);
  assert.deepEqual(lib.checkRegression(snapshot(), snapshot({ source: { skills: { count: 460 }, lineups: { pvp: 100, authors: 60, lastSubmitted: '2026-06-10' } } })), [], 'a 8% dip is tolerated');
  const problems = lib.checkRegression(snapshot(), snapshot({ source: { skills: { count: 0 }, lineups: { pvp: 40, authors: 10, lastSubmitted: '2026-05-01' } } }));
  assert.equal(problems.length, 4, 'skills, lineups, authors and a date that moved backwards');
  assert.match(problems.join(' '), /技能数.*500.*0/);
});

test('sameContent ignores only the fetch timestamp', () => {
  const a = snapshot();
  assert.ok(lib.sameContent(a, snapshot({ generatedAt: '2026-10-06T00:00:00.000Z' })));
  assert.ok(!lib.sameContent(a, snapshot({ skills: { 新技能: {} } })));
  assert.ok(!lib.sameContent(null, a));
});

test('the refresh workflow commits only generated data and tests around the fetch', () => {
  const yml = require('node:fs').readFileSync(require('node:path').join(__dirname, '../.github/workflows/refresh-meta.yml'), 'utf8');
  assert.match(yml, /cron: '[^']+'/);
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /permissions:\s*\n\s+contents: write/);
  assert.ok(yml.indexOf('npm test') < yml.indexOf('npm run meta') && yml.indexOf('npm run meta') < yml.lastIndexOf('npm test'));
  assert.match(yml, /issues: write/);
  assert.match(yml, /::warning::data\.json/, 'a stale data.json is announced on the run without failing it');
  assert.match(yml, /gh issue list --state all/, 'searches closed issues too, so it is only ever filed once');
  assert.match(yml, /name: Open an issue[^\n]*\n\s+continue-on-error: true/, 'a failed notification must not fail the refresh');
  assert.ok(yml.indexOf('git push') < yml.indexOf('gh issue create'), 'the data is committed before any notification');
  assert.match(yml, /git add meta\.json data\.json dex\.json scout\.json\n/);
  assert.doesNotMatch(yml, /git add (-A|\.)/);
});

// ---- “当下”：热门只统计当前赛季开赛之后的投稿 ----

const seasonPage = (title, author, date, names, skill = '连环火') => ({
  title: `精灵阵容/${title}`, revised: `${date}T08:00:00Z`,
  text: `{{精灵阵容\n|阵容标题=${title}\n|阵容作者=${author}\n|阵容类型=pvp\n|阵容上传日期=${date}\n${names.map((name, i) => `|阵容精灵${i + 1}=${name}\n|阵容精灵${i + 1}技能1=${skill}`).join('\n')}\n}}`
});
const seasonArgs = (lineupPages, season = { id: 'S4', startsOn: '2026-09-10' }) => ({
  skillsLua, skillsRevised: '2026-08-13T00:00:00Z', lineupPages, data: mini, now: '2026-09-29T00:00:00.000Z',
  urls: { site: 's', lineups: 'l', skills: 'k' }, season
});

test('hot lists only count submissions from the current season onward, but all lineups are kept', () => {
  const built = lib.buildMeta(seasonArgs([
    seasonPage('旧队', '甲', '2026-06-01', ['岚鸟', '权杖-Ⅴ']),
    seasonPage('旧队2', '乙', '2026-09-09', ['岚鸟', '权杖-Ⅴ']),   // 开赛前一天
    seasonPage('新队', '丙', '2026-09-10', ['权杖-Ⅴ', '甜甜']),      // 开赛当天：算
    seasonPage('新队2', '丁', '2026-09-20', ['权杖-Ⅴ', '雪球（甲）'])
  ]));
  assert.equal(built.lineups.length, 4, 'older lineups stay available to the matchup engine');
  assert.deepEqual(built.hot.season, { id: 'S4', startsOn: '2026-09-10' });
  assert.deepEqual(built.hot.sample, { lineups: 2, submissions: 2, authors: 2 });
  const names = built.hot.spirits.map(spirit => spirit.name);
  assert.ok(names.includes('权杖-Ⅴ'));
  assert.ok(!names.includes('岚鸟'), 'a spirit that only appears before the season is not hot');
  const top = built.hot.spirits.find(spirit => spirit.name === '权杖-Ⅴ');
  assert.equal(top.authors, 2, 'only the two current-season authors count, not the older two');
  for (const row of built.hot.lineups) {
    const lineup = built.lineups[row.lineup];
    assert.ok(lineup.date >= '2026-09-10', 'hot lineups point at current-season lineups in the full list');
    assert.ok(row.firstSubmitted >= '2026-09-10');
  }
});

test('with no current-season submissions every hot list is empty and says so', () => {
  const built = lib.buildMeta(seasonArgs([seasonPage('旧队', '甲', '2026-06-01', ['岚鸟']), seasonPage('旧队2', '乙', '2026-08-01', ['岚鸟'])]));
  assert.equal(built.lineups.length, 2);
  assert.deepEqual(built.hot.sample, { lineups: 0, submissions: 0, authors: 0 });
  assert.deepEqual([built.hot.lineups, built.hot.spirits, built.hot.skills], [[], [], []]);
});

test('moving the season start moves the hot window', () => {
  const pages = [seasonPage('a', '甲', '2026-06-01', ['岚鸟']), seasonPage('b', '乙', '2026-09-15', ['岚鸟'])];
  assert.equal(lib.buildMeta(seasonArgs(pages, { id: 'S3', startsOn: '2026-07-16' })).hot.sample.lineups, 1);
  assert.equal(lib.buildMeta(seasonArgs(pages, { id: 'S2', startsOn: '2026-05-01' })).hot.sample.lineups, 2);
});

test('buildMeta refuses to run without a valid season', () => {
  assert.throws(() => lib.buildMeta({ ...seasonArgs([]), season: undefined }), /season/);
  assert.throws(() => lib.buildMeta(seasonArgs([], { id: 'S4', startsOn: '2026-13-40' })), /season/);
  assert.throws(() => lib.buildMeta(seasonArgs([], { startsOn: '2026-09-10' })), /season/);
});

test('currentHot reports ok, empty, or stale, and flags tiny samples', () => {
  const hot = (over = {}) => ({ season: { id: 'S4', startsOn: '2026-09-10' }, sample: { lineups: 30, submissions: 30, authors: 20 }, lineups: [{}], spirits: [{}], skills: [{}], ...over });
  const now = { season: { id: 'S4', startsOn: '2026-09-10' } };
  assert.deepEqual(RocoMeta.currentHot({ hot: hot() }, now), { status: 'ok', hot: hot(), small: false });
  assert.equal(RocoMeta.currentHot({ hot: hot({ sample: { lineups: 3, submissions: 3, authors: 3 } }) }, now).small, true);
  assert.equal(RocoMeta.currentHot({ hot: hot({ lineups: [], spirits: [], skills: [] }) }, now).status, 'empty');
  // 换了赛季但统计还是上个赛季的：不能拿来当“当下”
  const next = { season: { id: 'S5', startsOn: '2026-12-01' } };
  assert.deepEqual(RocoMeta.currentHot({ hot: hot() }, next), { status: 'stale', hot: null, small: false });
  assert.equal(RocoMeta.currentHot({ hot: { lineups: [], spirits: [], skills: [] } }, now).status, 'stale', 'an old meta.json without season info');
  assert.equal(RocoMeta.currentHot({ hot: hot() }, null).status, 'ok', 'without season.json it trusts the season recorded in meta.json');
  assert.equal(RocoMeta.currentHot(null, now).status, 'stale');
});

// ---- 赛季调整日志 ----

const historyLua = `return {
  versions={["s3-2026-08-18"]={date="2026-08-18",label="S3 8月18日",season="S3"},["s4-2026-09-10"]={date="2026-09-10",label="S4 9月10日",season="S4"},["s4-2026-09-24"]={date="2026-09-24",label="S4 9月24日",season="S4"}},
  pets={
    pet_1={{changes={{after=79,before=117,field="物攻",group="stats"},{after=110,before=135,field="物防",group="stats"},{after=90,before=95,field="超导威力",group="skill"},{action="added",group="learnset",name="暖阳",source="技能书"}},kind="changed",version="s4-2026-09-10"},
          {changes={{after=1,before=2,field="生命",group="stats"}},kind="changed",version="s3-2026-08-18"}},
    pet_2={{changes={{after=90,before=95,field="超导威力",group="skill"},{after="新说明",before="旧说明",field="超导说明",group="skill"},{after=60,before=70,field="速度",group="stats"}},kind="changed",version="s4-2026-09-10"}},
    pet_3={{changes={{action="introduced",group="identity",value="新怪"},{after=99,before=0,field="生命",group="stats"}},kind="introduced",version="s4-2026-09-10"}},
    pet_4={{changes={{after="X2",before="X1",field="特性说明",group="feature"}},kind="changed",version="s4-2026-09-10"}},
    pet_5={{changes={{after="X2",before="X1",field="特性说明",group="feature"}},kind="changed",version="s4-2026-09-10"}},
    pet_6={{changes={{after=5,before=4,field="未知技能能耗",group="skill"}},kind="changed",version="s4-2026-09-24"}},
    pet_7={{changes={{after=1,before=2,field="生命",group="stats"}},kind="changed",version="s3-2026-08-18"}}
  }
}`;
const catalogLua = 'return {pet_1={name="岚鸟"},pet_2={name="权杖-V"},pet_3={name="新怪"},pet_4={name="甜甜（甲味）"},pet_5={name="甜甜（乙味）"},pet_6={name="雪球（甲）"},pet_7={name="岚鸟（春天的样子）"}}';
const changeSkills = { 超导: { element: '电', category: '攻击' }, 暖阳: { element: '火', category: '攻击' } };
const changeData = { spirits: mini.spirits.map(spirit => ({ ...spirit, stats: { hp: 10, pa: 79, ma: 1, pd: 110, md: 1, sp: 60 } })) };
const changesOf = (over = {}) => lib.buildSeasonChanges({ historyLua, catalogLua, skills: changeSkills, data: changeData, season: { id: 'S4' }, source: { name: '日志', url: 'u', module: 'm', revised: '2026-09-24T03:07:39Z' }, ...over });

test('buildSeasonChanges keeps only the requested season and separates the kinds of change', () => {
  const changes = changesOf();
  assert.equal(changes.season, 'S4');
  assert.deepEqual(changes.versions.map(version => version.id), ['s4-2026-09-10', 's4-2026-09-24']);
  assert.equal(changes.source.revised, '2026-09-24');
  const names = changes.stats.map(entry => entry.name);
  assert.ok(names.includes('岚鸟') && names.includes('权杖-V'));
  assert.ok(!names.includes('岚鸟（春天的样子）'), 'an S3 stat change is not an S4 change');
  const bird = changes.stats.find(entry => entry.name === '岚鸟');
  assert.deepEqual(bird.changes, [{ field: '物攻', before: 117, after: 79 }, { field: '物防', before: 135, after: 110 }]);
  assert.equal(bird.ref, '岚鸟');
  assert.deepEqual(changes.newSpirits.map(entry => [entry.name, entry.ref]), [['新怪', null]], 'an introduced spirit is new, and its starting values are not listed as changes');
  assert.ok(!changes.stats.some(entry => entry.name === '新怪'));
});

test('buildSeasonChanges groups identical skill and trait changes and splits skill names from what changed', () => {
  const changes = changesOf();
  const power = changes.skills.find(row => row.name === '超导' && row.aspect === '威力');
  assert.deepEqual([power.before, power.after, power.spirits], [95, 90, 2], 'the same change on two spirits is one row');
  assert.ok(changes.skills.some(row => row.name === '超导' && row.aspect === '说明' && row.after === '新说明'));
  const unknown = changes.skills.find(row => row.name === '未知技能能耗');
  assert.equal(unknown.aspect, '', 'a skill missing from the table is kept whole rather than guessed');
  assert.deepEqual(changes.features, [{ names: ['甜甜（乙味）', '甜甜（甲味）'].sort(), before: 'X1', after: 'X2', date: '2026-09-10' }]);
  assert.deepEqual(changes.learned, { skills: 1, spirits: 1 });
});

test('buildSeasonChanges sorts the biggest stat swings first and counts per version', () => {
  const changes = changesOf();
  assert.equal(changes.stats[0].name, '岚鸟', 'a 63-point swing outranks a 10-point one');
  const [opening, patch] = changes.versions;
  assert.equal(opening.spirits, 5);
  assert.equal(opening.introduced, 1);
  assert.equal(patch.stats, 0, 'the later patch changed no stats');
  assert.equal(patch.spirits, 1);
});

test('buildSeasonChanges checks data.json against the newest value in the log', () => {
  assert.deepEqual(changesOf().dataCheck, { checked: 3, matching: 3, mismatched: [] });
  const stale = { spirits: changeData.spirits.map(spirit => (spirit.name === '岚鸟' ? { ...spirit, stats: { ...spirit.stats, pa: 117 } } : spirit)) };
  const check = changesOf({ data: stale }).dataCheck;
  assert.equal(check.matching, 2);
  assert.deepEqual(check.mismatched, [{ name: '岚鸟', field: '物攻', expected: 79, actual: 117 }]);
});

test('buildSeasonChanges returns null when the log has no version for that season', () => {
  assert.equal(changesOf({ season: { id: 'S9' } }), null);
});

test('buildMeta records the change log and the skill source it was given', () => {
  const args = { skillsLua, skillsRevised: '2026-09-26T00:00:00Z', skillsInfo: { name: '洛克王国世界WIKI', module: '模块:Pets/data/Skills' }, lineupPages: [], data: mini, now: '2026-09-29T00:00:00.000Z', urls: { site: 's', lineups: 'l', skills: 'k' }, season: { id: 'S4', startsOn: '2026-09-10' } };
  const built = lib.buildMeta({ ...args, changes: changesOf() });
  assert.equal(built.changes.season, 'S4');
  assert.deepEqual([built.source.skills.name, built.source.skills.module], ['洛克王国世界WIKI', '模块:Pets/data/Skills']);
  assert.equal('changes' in lib.buildMeta(args), false, 'no log, no field');
});

test('meta.json carries a consistent S4 change log that agrees with data.json', () => {
  const changes = meta.changes;
  assert.ok(changes, 'the change log is recorded');
  assert.equal(changes.season, meta.hot.season.id);
  assert.ok(changes.versions.length >= 1);
  for (const version of changes.versions) assert.match(version.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(changes.versions.every(version => version.date >= meta.hot.season.startsOn), 'only versions from the current season');
  assert.match(changes.source.url, /^https:\/\/wiki\.biligame\.com\/nrc\//);
  assert.ok(changes.stats.length > 0 && changes.skills.length > 0);
  const dates = new Set(changes.versions.map(version => version.date));
  const names = new Set(data.spirits.map(spirit => spirit.name));
  for (const entry of changes.stats) {
    assert.ok(dates.has(entry.date));
    assert.ok(entry.ref === null || names.has(entry.ref), `${entry.name} -> ${entry.ref}`);
    for (const change of entry.changes) assert.ok(Number.isInteger(change.before) && Number.isInteger(change.after) && change.before !== change.after, `${entry.name} ${change.field}`);
  }
  for (const row of changes.skills) {
    assert.ok(row.name && dates.has(row.date) && row.spirits >= 1);
    if (row.aspect && row.aspect !== '说明') assert.ok(meta.skills[row.name], `${row.name} is a known skill`);
  }
  // 对阵速查用 data.json 的种族值。这里只检查核对结果自洽；data.json 落后于日志时页面和刷新脚本会醒目警告，
  // 但不让测试失败——否则外部数据文件的滞后会把技能、阵容的每周刷新一起卡住。
  const check = changes.dataCheck;
  assert.ok(check.checked > 100, 'the check covers many stat values');
  assert.equal(check.matching + check.mismatched.length, check.checked, 'every checked value is either matching or listed');
  for (const item of check.mismatched) assert.ok(item.name && item.field && item.expected !== item.actual);
});

// ---- 新投稿系统监控 ----

const newLineup = (fields) => ({ title: `阵容:${fields.id || 'x'}`, text: `{{阵容\n${Object.entries(fields).filter(([k]) => k !== 'id').map(([k, v]) => `|${k}=${v}`).join('\n')}\n}}` });

test('summarizeNewSystem ignores test pages and index pages, and counts real submissions by version', () => {
  const summary = lib.summarizeNewSystem({
    lineupPages: [
      newLineup({ id: 'a1', code: 'B%7Ex', name: '测试2', game_version: '测试', tags: '测试' }),
      newLineup({ id: 'a2', code: 'B%7Ey', name: '雷鸣轮转', game_version: 'S4', tags: '排位' }),
      newLineup({ id: 'a3', code: 'B%7Ez', name: '雪天队', game_version: 'S4' }),
      newLineup({ id: 'a4', code: 'B%7Ew', name: '老队', game_version: 'S3' }),
      newLineup({ id: 'a5', name: '没有阵容码', game_version: 'S4' }),
      newLineup({ id: 'a6', code: 'B%7Ev', name: 'Test lineup', game_version: 'S4' }),
      { title: '阵容:坏页面', text: '没有模板' },
      { title: '阵容一览', text: newLineup({ code: 'B', name: '不该被计入' }).text }
    ],
    buildTitles: ['精灵培养方案/待审核', '精灵培养方案/投稿', '精灵培养方案/12-abcdef-1', '精灵培养方案/13-abcdef-2', '别的页面/1']
  });
  assert.equal(summary.lineups.pages, 6, 'pages with the template under the 阵容: prefix');
  assert.equal(summary.lineups.real, 3);
  assert.deepEqual(summary.lineups.versions, { S4: 2, S3: 1 });
  assert.deepEqual(summary.builds, { pages: 2, real: 2 });
});

test('summarizeNewSystem on an empty system reports zero', () => {
  assert.deepEqual(lib.summarizeNewSystem({}), { lineups: { pages: 0, real: 0, versions: {} }, builds: { pages: 0, real: 0 } });
});

test('buildMeta records the new-system summary only when it is given', () => {
  const args = { skillsLua: skillsLua, skillsRevised: '2026-08-13T00:00:00Z', lineupPages: [], data: mini, now: '2026-09-29T00:00:00.000Z', urls: { site: 's', lineups: 'l', skills: 'k' }, season: { id: 'S4', startsOn: '2026-09-10' } };
  assert.equal('newSystem' in lib.buildMeta(args).source, false);
  const summary = lib.summarizeNewSystem({});
  assert.deepEqual(lib.buildMeta({ ...args, newSystem: summary }).source.newSystem, summary);
});

test('meta.json carries the new-system counts used by the weekly notification', () => {
  const ns = meta.source.newSystem;
  assert.ok(ns, 'source.newSystem is recorded');
  for (const n of [ns.lineups.pages, ns.lineups.real, ns.builds.pages, ns.builds.real]) assert.ok(Number.isInteger(n) && n >= 0);
  assert.ok(ns.lineups.real <= ns.lineups.pages && ns.builds.real <= ns.builds.pages);
  assert.equal(Object.values(ns.lineups.versions).reduce((a, b) => a + b, 0), ns.lineups.real);
});

// ---- season.json：人工整理的当前赛季动向 ----

test('season.json describes exactly one season and only recent, sourced items', () => {
  assert.equal(season.schema, 1);
  assert.match(season.season.startsOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(season.season.id && season.season.name);
  assert.match(season.curatedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(season.items.length >= 3);
  const lead = new Date(Date.parse(season.season.startsOn) - 14 * 86400000).toISOString().slice(0, 10);
  for (const item of season.items) {
    assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(item.date <= season.curatedOn, `${item.text} is dated after it was curated`);
    assert.ok(item.date >= lead, `${item.date} is older than the current season's lead-up: earlier seasons are out of scope`);
    assert.ok(['官方', '工具站', '媒体'].includes(item.kind), item.kind);
    assert.ok(item.text.length >= 8);
    assert.ok(item.source.name && /^https:\/\//.test(item.source.url), `${item.text} needs a named https source`);
    assert.doesNotMatch(item.text, /使用率|胜率|占比|出场率/, 'no usage numbers in curated notes');
  }
  const dates = season.items.map(item => item.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
});

test('season.json is honest about what it could not read', () => {
  assert.ok(season.gaps.length >= 1);
  for (const pointer of season.pointers) {
    assert.ok(/^https:\/\//.test(pointer.url) && pointer.title && pointer.note, 'a pointer says what it is and what could not be read');
  }
});

// ---- 已提交的 meta.json ----

test('meta.json describes its source, dates and community-recommendation label', () => {
  assert.equal(meta.schema, 1);
  assert.equal(meta.label, '社区推荐');
  assert.match(meta.notice, /不代表对局使用率/);
  assert.equal(meta.source.name, '洛克王国 BWIKI');
  for (const url of [meta.source.url, meta.source.lineups.url]) assert.match(url, /^https:\/\/wiki\.biligame\.com\/rocom\//, 'lineups come from the rocom wiki');
  assert.match(meta.source.skills.url, /^https:\/\/wiki\.biligame\.com\/nrc\//, 'skills come from the nrc wiki, which tracks the current season');
  assert.equal(meta.source.skills.module, '模块:Pets/data/Skills');
  const { firstSubmitted, lastSubmitted } = meta.source.lineups;
  assert.match(firstSubmitted, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(firstSubmitted <= lastSubmitted);
  assert.ok(lastSubmitted <= meta.generatedAt.slice(0, 10), 'no submission dated after the fetch');
  assert.match(meta.source.skills.revised, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Date.parse(meta.generatedAt) > 0);
});

test('meta.json never presents popularity as a usage rate', () => {
  const walk = (value, path = '') => {
    if (Array.isArray(value)) return value.forEach((item, i) => walk(item, `${path}[${i}]`));
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        assert.doesNotMatch(key, /rate|usage|percent|pick|win|使用率|胜率/i, `suspicious field ${path}.${key}`);
        walk(item, `${path}.${key}`);
      }
    }
  };
  walk(meta.hot);
  for (const list of [meta.hot.lineups, meta.hot.spirits, meta.hot.skills]) for (const row of list) for (const value of Object.values(row)) assert.ok(typeof value !== 'number' || Number.isInteger(value), 'counts are whole numbers, not ratios');
});

test('meta.json lineups reference real spirits and skills', () => {
  const names = data.spirits.map(spirit => spirit.name);
  assert.equal(new Set(names).size, names.length, 'data.json names are unique, so they can be used as keys');
  const known = new Set(names);
  const unknownSkills = new Set(meta.source.lineups.unknownSkills);
  const unresolved = new Set(meta.source.lineups.unresolvedSpirits);
  assert.equal(meta.lineups.length, meta.source.lineups.pvp);
  for (const lineup of meta.lineups) {
    assert.ok(lineup.members.length >= 1 && lineup.members.length <= 6, lineup.page);
    assert.match(lineup.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(lineup.date <= meta.generatedAt.slice(0, 10));
    assert.ok(lineup.author, 'every lineup has an author for de-duplication');
    for (const m of lineup.members) {
      if (m.ref === null) assert.ok(unresolved.has(m.name), `unlisted unresolved spirit ${m.name}`);
      else assert.ok(known.has(m.ref), `${m.name} -> ${m.ref} not in data.json`);
      for (const skill of m.skills) assert.ok(meta.skills[skill] || unknownSkills.has(skill), `unknown skill ${skill}`);
    }
  }
  assert.equal(new Set(meta.lineups.map(l => l.author)).size, meta.source.lineups.authors);
  const dates = meta.lineups.map(l => l.date).sort();
  assert.equal(dates[0], meta.source.lineups.firstSubmitted);
  assert.equal(dates.at(-1), meta.source.lineups.lastSubmitted);
});

test('meta.json skill table is usable by the engine', () => {
  const skills = Object.values(meta.skills);
  assert.ok(skills.length > 400);
  const types = new Set(Object.keys(data.types));
  for (const [name, skill] of Object.entries(meta.skills)) {
    assert.ok(skill.element === null || types.has(skill.element), `${name} element ${skill.element}`);
    assert.ok(['攻击', '防御', '状态'].includes(skill.category), name);
    assert.ok(Number.isInteger(skill.energy) && skill.energy >= 0, name);
    if (skill.category === '攻击') {
      assert.ok(skill.power > 0, `${name} has no power`);
      assert.ok(['物攻', '魔攻'].includes(skill.damageClass), `${name} damage class`);
      assert.ok(skill.hits >= 1, name);
    }
  }
});

test('meta.json hot lists point at real entries and are sorted by authors', () => {
  const { hot } = meta;
  assert.ok(hot.season && hot.season.id && /^\d{4}-\d{2}-\d{2}$/.test(hot.season.startsOn), 'hot records which season it covers');
  const inSeason = meta.lineups.filter(lineup => lineup.date >= hot.season.startsOn);
  assert.equal(hot.sample.lineups, inSeason.length, 'sample size matches the lineups on or after the season start');
  assert.equal(hot.sample.authors, new Set(inSeason.map(lineup => lineup.author)).size);
  for (const row of hot.lineups) {
    assert.ok(meta.lineups[row.lineup].date >= hot.season.startsOn, 'hot lineups are current-season only');
    assert.ok(meta.lineups[row.lineup], `lineup index ${row.lineup}`);
    assert.ok(row.authors >= 1 && row.authors <= row.submissions);
    assert.ok(row.firstSubmitted <= row.lastSubmitted);
  }
  for (const list of [hot.lineups, hot.spirits, hot.skills]) {
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].authors >= list[i].authors, 'sorted by author count');
  }
  for (const spirit of hot.spirits) {
    if (spirit.ref) assert.ok(data.spirits.some(s => s.name === spirit.ref));
    assert.ok(spirit.authors <= meta.source.lineups.authors);
    for (const skill of spirit.topSkills) assert.ok(skill.authors <= spirit.authors);
  }
  for (const skill of hot.skills) {
    assert.ok(meta.skills[skill.name] || meta.source.lineups.unknownSkills.includes(skill.name));
    assert.ok(skill.authors <= meta.source.lineups.authors);
  }
});

// ---- 前端索引 ----

test('createIndex builds per-spirit kits from lineup skills and skips unknown ones', () => {
  const tiny = {
    skills: { 地刺: { element: '地', category: '攻击', damageClass: '物攻', power: 40, hits: 1, energy: 1 } },
    lineups: [
      { title: 'A', author: '甲', date: '2026-05-01', page: 'p1', members: [{ name: '波', ref: '迪莫', skills: ['地刺', '不存在'] }, { name: '外', ref: null, skills: ['地刺'] }] },
      { title: 'B', author: '乙', date: '2026-05-09', page: 'p2', members: [{ name: '波', ref: '迪莫', skills: ['地刺'] }] }
    ]
  };
  const index = RocoMeta.createIndex(tiny, data);
  const kit = index.kitFor({ name: '迪莫' });
  assert.equal(kit.builds.length, 1, 'identical known-skill sets merge');
  assert.equal(kit.builds[0].authors, 2);
  assert.equal(kit.builds[0].title, 'B', 'newest submission labels the build');
  assert.equal(kit.builds[0].skills[0].power, 40);
  assert.equal(index.kitFor({ name: '喵喵' }), null);
});

test('createIndex on the real meta.json covers many spirits with attack skills', () => {
  const index = RocoMeta.createIndex(meta, data);
  assert.ok(index.kitCount > 100, `only ${index.kitCount} spirits have kits`);
  const kit = index.kitFor(data.spirits.find(s => s.name === '寂灭骨龙'));
  assert.ok(kit && kit.builds.some(build => build.skills.some(skill => skill.category === '攻击')));
});

test('lineupTitle replaces empty titles and ageInDays measures staleness', () => {
  const members = ['甲乙', '丙丁（春天的样子）', '戊己', '庚辛'].map(name => ({ name }));
  assert.equal(RocoMeta.lineupTitle({ title: '地刺队', members }), '地刺队');
  assert.equal(RocoMeta.lineupTitle({ title: '1', members }), '甲乙、丙丁、戊己 等');
  assert.equal(RocoMeta.ageInDays('2026-06-10', new Date('2026-09-29T12:00:00Z')), 111);
  assert.equal(RocoMeta.ageInDays('坏日期'), null);
});
