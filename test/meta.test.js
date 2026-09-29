const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLuaTable } = require('../scripts/lua-table.js');
const lib = require('../scripts/meta-lib.js');
const RocoMeta = require('../meta.js');
const data = require('../data.json');
const meta = require('../meta.json');

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
  assert.deepEqual(skills['连环火'], { element: '火', category: '攻击', damageClass: '物攻', power: 30, hits: 3, energy: 2, target: '敌方随机单体', desc: '造成物伤，3连击。' });
  assert.equal(skills['毒雾'].element, null);
  assert.equal(skills['毒雾'].desc, '敌方获得 中毒。');
  assert.equal(skills['防御'].hits, 1);
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

// ---- 已提交的 meta.json ----

test('meta.json describes its source, dates and community-recommendation label', () => {
  assert.equal(meta.schema, 1);
  assert.equal(meta.label, '社区推荐');
  assert.match(meta.notice, /不代表对局使用率/);
  assert.equal(meta.source.name, '洛克王国 BWIKI');
  for (const url of [meta.source.url, meta.source.lineups.url, meta.source.skills.url]) assert.match(url, /^https:\/\/wiki\.biligame\.com\/rocom\//);
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
  for (const list of Object.values(meta.hot)) for (const row of list) for (const value of Object.values(row)) assert.ok(typeof value !== 'number' || Number.isInteger(value), 'counts are whole numbers, not ratios');
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
  for (const row of hot.lineups) {
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
