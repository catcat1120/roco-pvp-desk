const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../engine.js');
const data = require('../data.json');

const spirit = (name) => data.spirits.find(s => s.name === name);
const mock = (types, stats) => ({ name: 'x', types, stats: { hp: 100, pa: 100, ma: 100, pd: 100, md: 100, sp: 100, ...stats } });

test('type tables are symmetric between offense and defense', () => {
  for (const attack of Object.keys(data.types)) {
    for (const target of Object.keys(data.types)) {
      const offense = data.types[attack].strong.includes(target) ? 2 : data.types[attack].resist.includes(target) ? .5 : 1;
      const defense = data.types[target].weak.includes(attack) ? 2 : data.types[target].vulnerable.includes(attack) ? .5 : 1;
      assert.equal(offense, defense, `${attack} -> ${target}`);
    }
  }
});

test('effect multiplies over dual types, with double weakness capped at 3x', () => {
  assert.equal(engine.effect(data.types, '草', ['水']), 2);
  assert.equal(engine.effect(data.types, '草', ['火']), .5);
  assert.equal(engine.effect(data.types, '草', ['水', '火']), 1);
  assert.equal(engine.effect(data.types, '草', ['水', '地']), 3, 'BWIKI TypeRelation caps 2x2 at 3x');
  assert.equal(engine.effect(data.types, '草', ['火', '龙']), .25, 'double resist is not capped');
});

test('bestAttack picks the strongest own type', () => {
  const best = engine.bestAttack(data.types, spirit('圣草迪莫'), spirit('迪莫'));
  assert.equal(best.mult, Math.max(...spirit('圣草迪莫').types.map(t => engine.effect(data.types, t, ['光']))));
});

test('equal spirits are an even, tied matchup', () => {
  const a = mock(['普通'], {});
  const duel = engine.analyzeDuel(data.types, a, mock(['普通'], {}));
  assert.equal(duel.first, 'tie');
  assert.equal(duel.race, 1);
  assert.equal(duel.label, '均势');
});

test('faster spirit gets the speed edge, slower spirit loses it', () => {
  const fast = mock(['普通'], { sp: 120 });
  const slow = mock(['普通'], { sp: 60 });
  const ahead = engine.analyzeDuel(data.types, fast, slow);
  const behind = engine.analyzeDuel(data.types, slow, fast);
  assert.equal(ahead.first, 'ours');
  assert.equal(behind.first, 'theirs');
  assert.equal(ahead.score, engine.SPEED_EDGE);
  assert.ok(Math.abs(ahead.score * behind.score - 1) < 1e-12);
});

test('bulk and attack split change the verdict even with neutral types', () => {
  const glass = mock(['普通'], { pa: 160, ma: 40, hp: 60, pd: 60, md: 60 });
  const wall = mock(['普通'], { pa: 60, ma: 60, hp: 160, pd: 140, md: 140 });
  assert.equal(engine.analyzeDuel(data.types, glass, wall).out.kind, '物攻');
  assert.equal(engine.analyzeDuel(data.types, wall, glass).label, '占优');
});

test('attacker uses the category that beats the defender best', () => {
  const mage = mock(['普通'], { pa: 40, ma: 150 });
  const magicWall = mock(['普通'], { pd: 60, md: 300 });
  const duel = engine.analyzeDuel(data.types, mage, magicWall);
  assert.equal(duel.out.kind, '物攻', 'physical still beats a 300 magic defense');
});

test('duels are antisymmetric', () => {
  const a = spirit('武斗酷猫');
  const b = spirit('魔力猫');
  const forward = engine.analyzeDuel(data.types, a, b);
  const reverse = engine.analyzeDuel(data.types, b, a);
  assert.ok(Math.abs(forward.race * reverse.race - 1) < 1e-12);
  assert.ok(Math.abs(forward.score * reverse.score - 1) < 1e-12);
});

test('analyzeTeam flags foes nobody on the team beats', () => {
  const team = [mock(['普通'], { hp: 60, pa: 50, ma: 50, sp: 50 })];
  const strong = mock(['普通'], { hp: 200, pa: 200, ma: 200, pd: 200, md: 200, sp: 200 });
  const [row] = engine.analyzeTeam(data.types, team, [strong]);
  assert.equal(row.answers, 0);
  assert.equal(row.threat, 'severe');
  const [easy] = engine.analyzeTeam(data.types, [strong], [team[0]]);
  assert.equal(easy.threat, null);
  assert.equal(easy.answers, 1);
});

const skill = (element, damageClass, power, extra = {}) => ({ name: `${element}${power}`, element, category: '攻击', damageClass, power, hits: 1, energy: 1, ...extra });
const kit = (...skills) => ({ builds: [{ skills, authors: 1, title: 't', date: '2026-05-01' }] });

test('without kits the duel is estimated from types and says so', () => {
  const duel = engine.analyzeDuel(data.types, mock(['火'], {}), mock(['草'], {}));
  assert.equal(duel.basis, 'type');
  assert.equal(duel.out.basis, 'type');
  assert.equal(duel.out.mult, 2);
});

test('a kit replaces the assumed skill with the real one', () => {
  const ours = mock(['火'], {});
  const theirs = mock(['草'], {});
  const kitOf = (s) => (s === ours ? kit(skill('普通', '物攻', 40), skill('火', '魔攻', 90)) : null);
  const duel = engine.analyzeDuel(data.types, ours, theirs, kitOf);
  assert.equal(duel.out.basis, 'skill');
  assert.equal(duel.out.skill.power, 90);
  assert.equal(duel.out.kind, '魔攻');
  assert.equal(duel.back.basis, 'type');
  assert.equal(duel.basis, 'mixed');
});

test('skill power, hits and type effectiveness all scale damage', () => {
  const ours = mock(['普通'], {});
  const theirs = mock(['草'], {});
  const share = (...skills) => engine.analyzeDuel(data.types, ours, theirs, (s) => (s === ours ? kit(...skills) : null)).out.share;
  const base = share(skill('普通', '物攻', 50));
  assert.equal(share(skill('普通', '物攻', 100)), base * 2);
  assert.equal(share(skill('普通', '物攻', 50, { hits: 3 })), base * 3);
  assert.equal(share(skill('火', '物攻', 50)), base * 2, '火 beats 草');
  assert.equal(share(skill('水', '物攻', 50)), base * .5, '水 is resisted by 草');
});

test('skill category picks the matching attack and defense stats', () => {
  const ours = mock(['普通'], { pa: 200, ma: 50 });
  const theirs = mock(['普通'], { pd: 50, md: 200 });
  const only = (s) => (t) => (t === ours ? kit(s) : null);
  const physical = engine.analyzeDuel(data.types, ours, theirs, only(skill('普通', '物攻', 80))).out.share;
  const magical = engine.analyzeDuel(data.types, ours, theirs, only(skill('普通', '魔攻', 80))).out.share;
  assert.equal(physical / magical, 16, '(200/50) / (50/200)');
});

test('non-attack skills and unusable kits fall back to the type estimate', () => {
  const ours = mock(['火'], {});
  const theirs = mock(['草'], {});
  const status = { name: '冥想', element: '幻', category: '状态', damageClass: null, power: 0, hits: 1, energy: 1 };
  const duel = engine.analyzeDuel(data.types, ours, theirs, (s) => (s === ours ? kit(status) : null));
  assert.equal(duel.out.basis, 'type');
  assert.equal(engine.analyzeDuel(data.types, ours, theirs, () => ({ builds: [] })).out.basis, 'type');
});

test('the best build wins and reports which build it came from', () => {
  const ours = mock(['普通'], {});
  const theirs = mock(['普通'], {});
  const weak = { skills: [skill('普通', '物攻', 30)], title: 'weak' };
  const strong = { skills: [skill('普通', '物攻', 120)], title: 'strong' };
  const duel = engine.analyzeDuel(data.types, ours, theirs, (s) => (s === ours ? { builds: [weak, strong] } : null));
  assert.equal(duel.out.build.title, 'strong');
});

test('skill-based duels stay antisymmetric and give equal kits an even matchup', () => {
  const a = mock(['火'], { pa: 130, hp: 90, sp: 110 });
  const b = mock(['草'], { pa: 80, hp: 140, sp: 60 });
  const kits = new Map([[a, kit(skill('火', '物攻', 90))], [b, kit(skill('草', '物攻', 70, { hits: 2 }))]]);
  const kitOf = (s) => kits.get(s) || null;
  const forward = engine.analyzeDuel(data.types, a, b, kitOf);
  const reverse = engine.analyzeDuel(data.types, b, a, kitOf);
  assert.ok(Math.abs(forward.score * reverse.score - 1) < 1e-12);
  assert.equal(forward.basis, 'skill');
  const twin = mock(['普通'], {});
  const same = engine.analyzeDuel(data.types, twin, mock(['普通'], {}), () => kit(skill('普通', '物攻', 80)));
  assert.equal(same.label, '均势');
});

test('analyzeTeam passes kits through', () => {
  const ours = mock(['普通'], { hp: 100, pa: 100 });
  const foe = mock(['普通'], { hp: 100, pd: 100 });
  const [row] = engine.analyzeTeam(data.types, [ours], [foe], () => kit(skill('普通', '物攻', 80)));
  assert.equal(row.best.duel.basis, 'skill');
});

test('ASSUMED_POWER stays close to the median attack power in meta.json', () => {
  // 只做健全性检查：定时刷新新增技能会让中位数小幅漂移，不应因此卡住刷新；漂移很大才提醒人工调整。
  const meta = require('../meta.json');
  const powers = Object.values(meta.skills).filter(s => s.category === '攻击').map(s => s.power).sort((a, b) => a - b);
  const median = powers[powers.length >> 1];
  assert.ok(Math.abs(median - engine.ASSUMED_POWER) <= 10, `median is now ${median}; update ASSUMED_POWER`);
});
