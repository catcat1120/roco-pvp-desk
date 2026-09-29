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

test('effect multiplies over dual types', () => {
  assert.equal(engine.effect(data.types, '草', ['水']), 2);
  assert.equal(engine.effect(data.types, '草', ['火']), .5);
  assert.equal(engine.effect(data.types, '草', ['水', '火']), 1);
  assert.equal(engine.effect(data.types, '草', ['水', '地']), 4);
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
