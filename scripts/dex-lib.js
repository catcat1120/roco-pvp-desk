const { parseLuaTable } = require('./lua-table');
const { normalizeSkills } = require('./meta-lib');
const STAT_KEYS = { hp: 'hp', pa: 'atk', ma: 'spa', pd: 'def', md: 'spd', sp: 'spe' };
const clean = value => String(value || '').replace(/<[^>]*>/g, '').trim();

// Preserve saved-team IDs. Match complete form titles first; never guess a form from its base name.
function buildDex({ data, catalogLua, learnsetsLua, skillsLua, source, today }) {
  const catalog = parseLuaTable(catalogLua), learnsets = parseLuaTable(learnsetsLua);
  const rawSkills = parseLuaTable(skillsLua), normalized = normalizeSkills(skillsLua);
  const skills = Object.fromEntries(Object.entries(rawSkills).map(([id, raw]) => [id,
    { name: raw.name, ...(raw.category === '特性' ? { category: '特性', desc: clean(raw.desc) } : normalized[raw.name]) }
  ]));
  const available = Object.values(catalog).filter(p => !p.release?.date || p.release.date <= today);
  const upcoming = Object.values(catalog).filter(p => p.release?.date > today).map(p => ({ name: p.title || p.name, date: p.release.date }));
  const used = new Set(), pets = {}, missing = [], updated = [];
  const spirits = data.spirits.map(old => {
    let matches = old.wikiId ? available.filter(p => p.id === old.wikiId) : available.filter(p => p.title === old.name);
    if (!matches.length && !old.wikiId) {
      matches = available.filter(p => p.name === old.name);
      if (matches.length > 1) matches = matches.filter(p => Object.entries(STAT_KEYS).every(([a,b]) => old.stats[a] === p.stats[b]));
    }
    if (matches.length !== 1) { missing.push(old.name); return { ...old }; }
    const pet = matches[0];
    if (used.has(pet.id)) throw new Error(`重复形态对应：${old.name}`);
    used.add(pet.id);
    return enrich(old, pet);
  });
  function enrich(old, pet) {
    const kit = learnsets[pet.learnset_id];
    if (!kit) throw new Error(`技能池缺失：${pet.title}`);
    const feature = pet.feature_skill_id || kit.feature_skill;
    if (skills[feature]?.category !== '特性') throw new Error(`特性缺失：${pet.title}`);
    const stats = Object.fromEntries(Object.entries(STAT_KEYS).map(([a,b]) => [a, pet.stats[b]]));
    if (Object.values(stats).some(v => !Number.isFinite(v) || v <= 0)) throw new Error(`种族值无效：${pet.title}`);
    const types = pet.types.map(t => t.replace(/系$/, ''));
    if (types.some(t => !data.types[t])) throw new Error(`未知属性：${pet.title}`);
    if (Object.entries(stats).some(([k,v]) => old.stats && old.stats[k] !== v)) updated.push(old.name);
    const refs = [...(kit.native_skills || []).map(s=>s.skill), ...(kit.blood_skills || []).map(s=>s.skill), ...(kit.skill_stones || []), ...(kit.legendary ? [kit.legendary.skill] : [])];
    if (refs.some(id => !skills[id] || skills[id].category === '特性')) throw new Error(`技能引用缺失：${pet.title}`);
    pets[old.id] = { wikiId: pet.id, title: pet.title || pet.name, learnset: pet.learnset_id, feature, released: pet.release?.date || null };
    return { ...old, wikiId: pet.id, types, stats, trait: skills[feature].name };
  }
  const added = [];
  for (const pet of available) {
    if (used.has(pet.id)) continue;
    const name = pet.title || pet.name;
    if (spirits.some(s => s.name === name)) throw new Error(`无法唯一添加：${name}`);
    spirits.push(enrich({ id: `nrc:${pet.id}`, no: pet.number, name, form: pet.stage === 4 ? '首领' : '' }, pet));
    added.push(name);
  }
  if (Object.keys(pets).length < data.spirits.length * .9) throw new Error('图鉴覆盖骤减，拒绝覆盖');
  const usedLearnsets = new Set(Object.values(pets).map(p=>p.learnset));
  return { data: { ...data, source: { ...data.source, enrichment: { name: source.name, url: source.url, modules: source.modules } }, spirits }, dex: { schema: 1, source, pets, skills,
    learnsets: Object.fromEntries(Object.entries(learnsets).filter(([id])=>usedLearnsets.has(id))),
    coverage: { total: spirits.length, linked: Object.keys(pets).length, missing, upcoming },
  }, report: { added, updated, missing } };
}
module.exports = { buildDex };
