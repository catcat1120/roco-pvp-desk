(function (root) {
  // 估算参数：种族值不等于实战能力值，这两个系数只用于给出方向性的判断。
  const SPEED_EDGE = 1.15; // 速度更快的一方视为多出 15% 的有效输出
  const VERDICT_GAP = 1.2; // 综合比值超过 1.2 倍才判定占优或谨慎
  // 能量规则（玩家确认）：每只精灵初始 10 点能量、上限 10、不会自动回复；只有技能自带的回能才能补充。
  const ENERGY_START = 10;
  const ENERGY_CAP = 10;
  // 比较双方各自在接下来 WINDOW 个回合里、受能量限制的最大累计输出。
  const WINDOW = 3;
  // 没有配招资料的一方，按“一个威力 75、能耗 3 的本系攻击技能”估算；两个数都是 BWIKI 全部攻击技能的中位数。
  const ASSUMED_POWER = 75;
  const ASSUMED_ENERGY = 3;
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
  function assumedHit(attacker, defender, mult) {
    const physical = attacker.stats.pa / defender.stats.pd;
    const magical = attacker.stats.ma / defender.stats.md;
    return {
      kind: physical >= magical ? '物攻' : '魔攻',
      damage: ASSUMED_POWER * Math.max(physical, magical) * mult / defender.stats.hp
    };
  }

  // 在能量约束下安排接下来 rounds 个回合的出招，使累计输出最大。actions: [{ damage, energy, refund }]。
  // 每回合只能出一招，能量不够就不能出；出招后能量 = min(上限, 能量 - 能耗 + 自带回能)。
  // 同样的输出下优先留下更多能量。
  function bestPlan(actions, rounds) {
    let states = new Array(ENERGY_CAP + 1).fill(null);
    states[ENERGY_START] = { damage: 0, plan: [] };
    for (let round = 0; round < rounds; round++) {
      const next = states.slice(); // 也允许提前收手，不强迫出招
      states.forEach((state, energy) => {
        if (!state) return;
        for (const action of actions) {
          if (energy < action.energy) continue;
          const left = Math.min(ENERGY_CAP, energy - action.energy + action.refund);
          const damage = state.damage + action.damage;
          if (!next[left] || damage > next[left].damage) next[left] = { damage, plan: [...state.plan, action] };
        }
      });
      states = next;
    }
    let best = null;
    states.forEach((state, energy) => {
      if (state && (!best || state.damage > best.damage || (state.damage === best.damage && energy > best.energy))) best = { ...state, energy };
    });
    return best;
  }

  // 有配招资料时：把社区投稿的每套配招各自排一遍出招计划，取累计输出最高的一套。
  // 单次伤害 ≈ 威力 × 连击数 × 属性克制 × 攻防种族值比 ÷ 对方生命；带回能的技能（如“徒长”）也会被考虑进计划。
  // 不含本系加成、减耗/追加效果、特性与个体值。
  function skillAttack(types, attacker, defender, kit) {
    let best = null;
    for (const build of (kit && kit.builds) || []) {
      const actions = [];
      for (const skill of build.skills) {
        const refund = skill.refund || 0;
        let damage = 0, mult = 1;
        const physical = skill.damageClass === '物攻';
        if (skill.category === '攻击' && skill.power > 0 && (physical || skill.damageClass === '魔攻')) {
          mult = skill.element ? effect(types, skill.element, defender.types) : 1;
          const ratio = physical ? attacker.stats.pa / defender.stats.pd : attacker.stats.ma / defender.stats.md;
          damage = skill.power * (skill.hits || 1) * mult * ratio / defender.stats.hp;
        }
        if (damage > 0 || refund > 0) actions.push({ skill, damage, mult, energy: skill.energy || 0, refund });
      }
      if (!actions.some(action => action.damage > 0)) continue;
      const result = bestPlan(actions, WINDOW);
      if (!result || !(result.damage > 0) || (best && result.damage <= best.share)) continue;
      const totals = new Map();
      for (const action of result.plan) totals.set(action, (totals.get(action) || 0) + action.damage);
      const main = [...totals.entries()].sort((a, b) => b[1] - a[1])[0][0];
      best = {
        basis: 'skill', type: main.skill.element, mult: main.mult, kind: main.skill.damageClass, share: result.damage,
        skill: main.skill, build, energyLeft: result.energy,
        plan: result.plan.map(action => ({ name: action.skill.name, energy: action.energy, refund: action.refund, attack: action.damage > 0 }))
      };
    }
    return best;
  }

  function side(types, attacker, defender, kit) {
    const bySkill = skillAttack(types, attacker, defender, kit);
    if (bySkill) return bySkill;
    const best = bestAttack(types, attacker, defender);
    const hit = assumedHit(attacker, defender, best.mult);
    const result = bestPlan([{ damage: hit.damage, energy: ASSUMED_ENERGY, refund: 0 }], WINDOW);
    return { ...best, kind: hit.kind, share: result.damage, basis: 'type', energyLeft: result.energy };
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

  const api = { SPEED_EDGE, VERDICT_GAP, ENERGY_START, ENERGY_CAP, WINDOW, ASSUMED_POWER, ASSUMED_ENERGY, DUAL_WEAKNESS, effect, bestAttack, analyzeDuel, analyzeTeam };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RocoEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
