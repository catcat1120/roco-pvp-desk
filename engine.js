(function (root) {
  // 估算参数：种族值不等于实战能力值，这两个系数只用于给出方向性的判断。
  const SPEED_EDGE = 1.15; // 速度更快的一方视为多出 15% 的有效输出
  const VERDICT_GAP = 1.2; // 综合比值超过 1.2 倍才判定占优或谨慎
  // 没有配招资料的一方，按“一个威力 75 的本系攻击技能”估算；75 是 BWIKI 全部攻击技能威力的中位数。
  const ASSUMED_POWER = 75;
  // 双属性同时被克制时按 3 倍而不是 4 倍结算：BWIKI 的 TypeRelation 模块（2026-06-08）与玩家实测文章（2026-04-02）一致。
  const DUAL_WEAKNESS = 3;

  function effect(types, attack, targets) {
    const rule = types[attack];
    if (!rule) return 1;
    const value = targets.reduce((mult, target) => mult * (rule.strong.includes(target) ? 2 : rule.resist.includes(target) ? .5 : 1), 1);
    return targets.length === 2 && value >= 4 ? DUAL_WEAKNESS : value;
  }

  function bestAttack(types, attacker, defender) {
    return attacker.types.reduce((best, type) => {
      const mult = effect(types, type, defender.types);
      return mult > best.mult ? { type, mult } : best;
    }, { type: attacker.types[0], mult: -1 });
  }

  // 没有配招资料时：假设攻击方带了对应类别的本系技能，取物攻/魔攻中更划算的一边。
  function pressure(attacker, defender, mult) {
    const physical = attacker.stats.pa / defender.stats.pd;
    const magical = attacker.stats.ma / defender.stats.md;
    return {
      kind: physical >= magical ? '物攻' : '魔攻',
      share: ASSUMED_POWER * Math.max(physical, magical) * mult / defender.stats.hp
    };
  }

  // 有配招资料时：在社区投稿的每套配招里逐个攻击技能估算，取单次出手占对方生命比例最高的一招。
  // 伤害 ≈ 威力 × 连击数 × 属性克制 × 攻防种族值比 / 对方生命；不含本系加成、能耗、特性与追加效果。
  function skillAttack(types, attacker, defender, kit) {
    let best = null;
    for (const build of (kit && kit.builds) || []) {
      for (const skill of build.skills) {
        if (skill.category !== '攻击' || !(skill.power > 0)) continue;
        const physical = skill.damageClass === '物攻';
        if (!physical && skill.damageClass !== '魔攻') continue;
        const mult = skill.element ? effect(types, skill.element, defender.types) : 1;
        const ratio = physical ? attacker.stats.pa / defender.stats.pd : attacker.stats.ma / defender.stats.md;
        const share = skill.power * (skill.hits || 1) * mult * ratio / defender.stats.hp;
        if (!best || share > best.share) best = { basis: 'skill', type: skill.element, mult, kind: skill.damageClass, share, skill, build };
      }
    }
    return best;
  }

  function side(types, attacker, defender, kit) {
    const bySkill = skillAttack(types, attacker, defender, kit);
    if (bySkill) return bySkill;
    const best = bestAttack(types, attacker, defender);
    return { ...best, ...pressure(attacker, defender, best.mult), basis: 'type' };
  }

  // kitOf(spirit) 返回 { builds: [{ skills: [...] }] } 或 null；不传则全部按属性估算。
  function analyzeDuel(types, ours, theirs, kitOf) {
    const out = side(types, ours, theirs, kitOf && kitOf(ours));
    const back = side(types, theirs, ours, kitOf && kitOf(theirs));
    const race = out.share / back.share;
    const first = ours.stats.sp > theirs.stats.sp ? 'ours' : ours.stats.sp < theirs.stats.sp ? 'theirs' : 'tie';
    const score = race * (first === 'ours' ? SPEED_EDGE : first === 'theirs' ? 1 / SPEED_EDGE : 1);
    const verdict = score >= VERDICT_GAP ? { label: '占优', className: 'good' }
      : score <= 1 / VERDICT_GAP ? { label: '谨慎', className: 'bad' }
      : { label: '均势', className: 'even' };
    const skilled = (out.basis === 'skill') + (back.basis === 'skill');
    const basis = skilled === 2 ? 'skill' : skilled === 1 ? 'mixed' : 'type';
    return { out, back, race, score, first, basis, speed: { ours: ours.stats.sp, theirs: theirs.stats.sp }, ...verdict };
  }

  // 逐个对手找出我方最合适的应对者；没有任何占优选择的对手就是队伍缺口。
  function analyzeTeam(types, team, foes, kitOf) {
    return foes.map(foe => {
      const duels = team.map(spirit => ({ spirit, duel: analyzeDuel(types, spirit, foe, kitOf) }));
      const best = duels.reduce((top, item) => item.duel.score > top.duel.score ? item : top);
      const answers = duels.filter(item => item.duel.label === '占优').length;
      return { foe, best, answers, threat: answers === 0 ? (best.duel.label === '谨慎' ? 'severe' : 'open') : null };
    });
  }

  const api = { SPEED_EDGE, VERDICT_GAP, ASSUMED_POWER, DUAL_WEAKNESS, effect, bestAttack, analyzeDuel, analyzeTeam };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RocoEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
