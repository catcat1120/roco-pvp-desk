(function (root) {
  // 估算参数：种族值不等于实战能力值，这两个系数只用于给出方向性的判断。
  const SPEED_EDGE = 1.15; // 速度更快的一方视为多出 15% 的有效输出
  const VERDICT_GAP = 1.2; // 综合比值超过 1.2 倍才判定占优或谨慎

  function effect(types, attack, targets) {
    const rule = types[attack];
    if (!rule) return 1;
    return targets.reduce((value, target) => value * (rule.strong.includes(target) ? 2 : rule.resist.includes(target) ? .5 : 1), 1);
  }

  function bestAttack(types, attacker, defender) {
    return attacker.types.reduce((best, type) => {
      const mult = effect(types, type, defender.types);
      return mult > best.mult ? { type, mult } : best;
    }, { type: attacker.types[0], mult: -1 });
  }

  // 单次攻击相对对手生命的压制力：假设攻击方带了对应类别的技能，取物攻/魔攻中更划算的一边。
  function pressure(attacker, defender, mult) {
    const physical = attacker.stats.pa / defender.stats.pd;
    const magical = attacker.stats.ma / defender.stats.md;
    return {
      kind: physical >= magical ? '物攻' : '魔攻',
      share: Math.max(physical, magical) * mult / defender.stats.hp
    };
  }

  function side(types, attacker, defender) {
    const best = bestAttack(types, attacker, defender);
    return { ...best, ...pressure(attacker, defender, best.mult) };
  }

  function analyzeDuel(types, ours, theirs) {
    const out = side(types, ours, theirs);
    const back = side(types, theirs, ours);
    const race = out.share / back.share;
    const first = ours.stats.sp > theirs.stats.sp ? 'ours' : ours.stats.sp < theirs.stats.sp ? 'theirs' : 'tie';
    const score = race * (first === 'ours' ? SPEED_EDGE : first === 'theirs' ? 1 / SPEED_EDGE : 1);
    const verdict = score >= VERDICT_GAP ? { label: '占优', className: 'good' }
      : score <= 1 / VERDICT_GAP ? { label: '谨慎', className: 'bad' }
      : { label: '均势', className: 'even' };
    return { out, back, race, score, first, speed: { ours: ours.stats.sp, theirs: theirs.stats.sp }, ...verdict };
  }

  // 逐个对手找出我方最合适的应对者；没有任何占优选择的对手就是队伍缺口。
  function analyzeTeam(types, team, foes) {
    return foes.map(foe => {
      const duels = team.map(spirit => ({ spirit, duel: analyzeDuel(types, spirit, foe) }));
      const best = duels.reduce((top, item) => item.duel.score > top.duel.score ? item : top);
      const answers = duels.filter(item => item.duel.label === '占优').length;
      return { foe, best, answers, threat: answers === 0 ? (best.duel.label === '谨慎' ? 'severe' : 'open') : null };
    });
  }

  const api = { SPEED_EDGE, VERDICT_GAP, effect, bestAttack, analyzeDuel, analyzeTeam };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RocoEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
