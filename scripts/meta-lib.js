// 把 BWIKI 的原始内容整理成 meta.json。这里只有纯函数，不做网络请求，方便离线测试。
// 口径提醒：这里统计的是“玩家向 BWIKI 投稿的阵容里出现了多少次”，是社区推荐样本，不是对局使用率。
const { parseLuaTable } = require('./lua-table.js');

const LIMITS = { lineups: 12, spirits: 24, skills: 30, intro: 140 };
// 两份阵容至少共有 4 只精灵才算“相近”；共有 5 只以上视为同一套的小改，只保留一份。
const SIMILAR = 4;
const NEAR_CLONE = 5;
const SEASON_NOTE = '数据来自玩家投稿，不代表对局使用率；赛季更新后的强度请以游戏内为准。';

const clean = (text) => String(text ?? '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]*>/g, '')
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();
const norm = (text) => String(text ?? '').normalize('NFKC').trim();
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function isoDate(value) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(value ?? '').trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

// ---- 技能 ----

// 技能自带的回能：只认“固定数值、无条件、回给自己”的写法。有条件（若/每有/应对/击败后）、
// 回给别人（场下/替换入场/敌方）、数值随场面变化（回复值等于…、回复该技能能耗）的一律不算，宁可少算。
// 条件写在前一个分句时（“若…击败敌方，回复6能量”），同一句里后面的分句都受它约束。
const CONDITION = /若|每有|应对|使用后|击败/;
const NOT_SELF = /场下|替换|敌方|偷取|失去|回复值|该技能/;
function parseSelfRefund(desc) {
  let total = 0;
  for (const sentence of String(desc || '').split('。')) {
    let conditional = false;
    for (const clause of sentence.split(/[，；]/)) {
      if (CONDITION.test(clause)) conditional = true;
      if (conditional || NOT_SELF.test(clause)) continue;
      const match = /回复[^，；]*?(\d+)能量/.exec(clause);
      if (match) total += Number(match[1]);
    }
  }
  return total;
}

function normalizeSkills(luaSource) {
  const table = parseLuaTable(luaSource);
  const skills = {};
  for (const raw of Object.values(table)) {
    if (!raw || raw.category === '特性' || !raw.name) continue; // 特性不是可携带的技能
    const attack = raw.category === '攻击';
    const hits = attack ? Number(/(\d+)连击/.exec(raw.desc || '')?.[1]) || 1 : 1;
    skills[raw.name] = {
      element: raw.element && raw.element !== '无系别' ? String(raw.element).replace(/系$/, '') : null,
      category: raw.category,
      damageClass: raw.damage_class || null,
      power: Number(raw.power) || 0,
      hits,
      energy: Number(raw.energy) || 0,
      refund: parseSelfRefund(raw.desc),
      target: raw.target || '',
      desc: clean(raw.desc)
    };
  }
  return skills;
}

// ---- 阵容 ----

// 模板参数：`|键=值` 一行一个，值可以跨行。
function parseTemplateFields(body) {
  const fields = {};
  let current = null;
  for (const line of body.split('\n')) {
    const field = /^\|([^=]+)=(.*)$/.exec(line);
    if (field) { current = field[1].trim(); fields[current] = field[2]; }
    else if (current) fields[current] += `\n${line}`;
  }
  return fields;
}

function parseLineupPage(title, wikitext, revisedAt) {
  const block = /\{\{精灵阵容\s*\n([\s\S]*?)\n\}\}/.exec(wikitext || '');
  if (!block) return null;
  const fields = parseTemplateFields(block[1]);
  const members = [];
  for (let i = 1; i <= 6; i++) {
    const name = clean(fields[`阵容精灵${i}`]);
    if (!name) continue;
    const skills = [];
    for (let j = 1; j <= 4; j++) {
      const skill = clean(fields[`阵容精灵${i}技能${j}`]);
      if (skill && !/[:\[\]{}|]/.test(skill)) skills.push(skill); // 丢弃误贴的图片标记等
    }
    members.push({ name, bloodline: clean(fields[`阵容精灵${i}血脉`]) || null, skills });
  }
  if (!members.length) return null;
  const revised = isoDate(revisedAt);
  return {
    title: clean(fields['阵容标题']) || title,
    author: clean(fields['阵容作者']),
    date: isoDate(fields['阵容上传日期']) || revised,
    type: clean(fields['阵容类型']).toLowerCase(),
    magic: clean(fields['阵容血脉魔法']) || null,
    intro: clean(fields['阵容介绍']).slice(0, LIMITS.intro),
    page: title,
    members
  };
}

// ---- BWIKI 新投稿系统监控 ----
// 2026-07 BWIKI 改版投稿：导入官方阵容码（B~…），带“适用版本”，页面名为 `阵容:<id>-<名称>`；
// 单只精灵的培养方案存为 `精灵培养方案/…`（先进“待审核”）。目前还没有真实投稿，这里只负责数数，
// 出现真实投稿时由定时任务提醒，再去接入阵容码解码。
const NEW_LINEUP_PREFIX = '阵容:';
const NEW_BUILD_PREFIX = '精灵培养方案/';
const NEW_BUILD_INDEX = new Set(['待审核', '投稿']);
const TEST_MARK = /测试|\btest\b/i;

function summarizeNewSystem({ lineupPages = [], buildTitles = [] }) {
  const versions = {};
  let pages = 0, real = 0;
  for (const page of lineupPages) {
    if (!page.title.startsWith(NEW_LINEUP_PREFIX)) continue;
    const block = /\{\{阵容\s*\n([\s\S]*?)\n\}\}/.exec(page.text || '');
    if (!block) continue;
    pages += 1;
    const fields = parseTemplateFields(block[1]);
    const marked = [fields.name, fields.game_version, fields.tags, fields.summary].some(value => TEST_MARK.test(value || ''));
    if (!fields.code || marked) continue; // 没有阵容码或明显是测试
    real += 1;
    const version = clean(fields.game_version) || '未填';
    versions[version] = (versions[version] || 0) + 1;
  }
  const builds = buildTitles.filter(title => title.startsWith(NEW_BUILD_PREFIX) && !NEW_BUILD_INDEX.has(title.slice(NEW_BUILD_PREFIX.length))).length;
  return { lineups: { pages, real, versions }, builds: { pages: builds, real: builds } };
}

// ---- 精灵名对应 ----

// BWIKI 的名称与 data.json 有细微差异：默认形态写成“（本来的样子）”、罗马数字写法、
// 口味/饰品等只影响外观的形态。逐级放宽，但只在结果唯一或外观等价时才采用。
// 注意 data.json 里带括号的形态名（如“化蝶（平常的样子）”）本身就写在 name 里，name 是唯一的。
const DEFAULT_FORM = /[（(]本来的样子[）)]$/;
const familyName = (name) => norm(name).replace(/[（(][^（）()]*[）)]$/, '');

function createResolver(data) {
  const byName = new Map(data.spirits.map(spirit => [norm(spirit.name), spirit]));
  const families = new Map();
  for (const spirit of data.spirits) {
    const key = familyName(spirit.name);
    families.set(key, [...(families.get(key) || []), spirit]);
  }
  const sameBuild = (a, b) => a.no === b.no && a.types.join() === b.types.join()
    && Object.keys(a.stats).every(stat => a.stats[stat] === b.stats[stat]);

  return function resolve(wikiName) {
    const name = norm(wikiName);
    const exact = byName.get(name);
    if (exact) return { spirit: exact, approx: false };
    const family = families.get(familyName(name)) || [];
    const plain = DEFAULT_FORM.test(name) && byName.get(familyName(name));
    if (plain) return { spirit: plain, approx: false };
    if (family.length && family.every(spirit => sameBuild(spirit, family[0]))) return { spirit: family[0], approx: true };
    return null;
  };
}

// ---- 聚合 ----

// 每个条目记录“哪些作者、哪些阵容收录了它”；同一份阵容里重复出现只算一次。
function tally(map, key, author, lineupId, extra) {
  let entry = map.get(key);
  if (!entry) { entry = { authors: new Set(), ids: new Set(), extra: extra ? extra() : null }; map.set(key, entry); }
  entry.authors.add(author);
  entry.ids.add(lineupId);
  return entry;
}
const byPopularity = (a, b) => b.authors - a.authors || b.lineups - a.lineups || compare(a.name, b.name);
const topCounts = (map, limit) => [...map.entries()]
  .map(([name, entry]) => ({ name, authors: entry.authors.size, lineups: entry.ids.size }))
  .sort(byPopularity).slice(0, limit);

// 热门配队：一份阵容被多少位不同作者“独立投出了相近阵容”。逐对比较、不做传递合并，
// 避免把不同打法链成一个大组。数字是投稿作者数，不是对局使用率。
function rankLineups(unique, indexOf) {
  const sets = unique.map(lineup => new Set(lineup.members.map(member => member.key)));
  const overlap = (a, b) => [...sets[a]].filter(key => sets[b].has(key)).length;
  const rows = unique.map((lineup, i) => {
    const similar = unique.filter((other, j) => j === i || (other.author !== lineup.author && overlap(i, j) >= SIMILAR));
    const dates = similar.map(other => other.date).sort();
    return {
      i, authors: new Set(similar.map(other => other.author)).size, submissions: similar.length,
      firstSubmitted: dates[0], lastSubmitted: dates.at(-1), date: lineup.date
    };
  }).sort((a, b) => b.authors - a.authors || b.submissions - a.submissions || compare(b.date, a.date) || a.i - b.i);

  const picked = [];
  for (const row of rows) {
    if (picked.length >= LIMITS.lineups) break;
    if (picked.some(other => overlap(row.i, other.i) >= NEAR_CLONE)) continue;
    picked.push(row);
  }
  return picked.map((row, n) => ({
    rank: n + 1, authors: row.authors, submissions: row.submissions,
    firstSubmitted: row.firstSubmitted, lastSubmitted: row.lastSubmitted, lineup: indexOf(unique[row.i])
  }));
}

// lineups：参与统计的投稿；indexOf：某份投稿在 meta.lineups（全部投稿）里的下标，热门配队用它指回原投稿。
function aggregate(lineups, indexOf = (lineup) => lineups.indexOf(lineup)) {
  // 同一作者反复保存同一套阵容，只算一次投稿，避免刷高数字。
  const seen = new Set();
  const unique = lineups.filter(lineup => {
    const id = `${lineup.author}|${lineup.members.map(m => m.key).sort().join('+')}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const spirits = new Map();
  const skills = new Map();
  unique.forEach((lineup, id) => {
    for (const member of lineup.members) {
      const spirit = tally(spirits, member.key, lineup.author, id, () => ({ names: new Map(), ref: member.ref, skills: new Map() }));
      spirit.extra.names.set(member.name, (spirit.extra.names.get(member.name) || 0) + 1);
      for (const name of new Set(member.skills)) {
        tally(spirit.extra.skills, name, lineup.author, id);
        const skill = tally(skills, name, lineup.author, id, () => ({ carriers: new Map() }));
        tally(skill.extra.carriers, member.name, lineup.author, id);
      }
    }
  });

  return {
    lineups: rankLineups(unique, indexOf),
    spirits: [...spirits.values()]
      .map(entry => ({
        name: [...entry.extra.names.entries()].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))[0][0],
        ref: entry.extra.ref, authors: entry.authors.size, lineups: entry.ids.size,
        topSkills: topCounts(entry.extra.skills, 4).map(({ name, authors }) => ({ name, authors }))
      }))
      .sort(byPopularity).slice(0, LIMITS.spirits),
    skills: [...skills.entries()]
      .map(([name, entry]) => ({
        name, authors: entry.authors.size, lineups: entry.ids.size,
        carriers: topCounts(entry.extra.carriers, 3).map(({ name, authors }) => ({ name, authors }))
      }))
      .sort(byPopularity).slice(0, LIMITS.skills),
    uniqueSubmissions: unique.length
  };
}

// ---- 组装 ----

// season：{ id, startsOn }。热门配队/精灵/技能只统计 startsOn 当天及之后的投稿，即“当下”的数据；
// 更早赛季的投稿仍保留在 lineups 里（对阵速查用它们估算配招，并标注日期），但不参与任何“热门”。
function buildMeta({ skillsLua, skillsRevised, lineupPages, data, now, urls, newSystem, season }) {
  if (!season || !isoDate(season.startsOn) || !season.id) throw new Error('buildMeta 需要 season: { id, startsOn }');
  const skills = normalizeSkills(skillsLua);
  const resolve = createResolver(data);
  const parsed = lineupPages
    .map(page => parseLineupPage(page.title, page.text, page.revised))
    .filter(Boolean);
  const pvp = parsed.filter(lineup => lineup.type === 'pvp');

  let anonymous = 0;
  const today = isoDate(now);
  const lineups = pvp.map(lineup => {
    const members = lineup.members.map(member => {
      const hit = resolve(member.name);
      return {
        name: member.name,
        ref: hit ? hit.spirit.name : null, // data.json 里 name 唯一，用它作为对应键
        ...(hit?.approx ? { approx: true } : {}),
        bloodline: member.bloodline,
        skills: member.skills
      };
    });
    return {
      title: lineup.title, author: lineup.author || `匿名#${++anonymous}`, date: lineup.date && lineup.date <= today ? lineup.date : isoDate(now),
      intro: lineup.intro, magic: lineup.magic, page: lineup.page, members
    };
  }).sort((a, b) => compare(b.date, a.date) || compare(a.page, b.page));

  const keyed = lineups.map(lineup => ({
    ...lineup,
    members: lineup.members.map(member => ({ ...member, key: member.ref ?? `?${member.name}` }))
  }));
  const position = new Map(keyed.map((lineup, i) => [lineup, i]));
  const current = keyed.filter(lineup => lineup.date >= season.startsOn);
  const hot = aggregate(current, (lineup) => position.get(lineup));
  const dates = lineups.map(lineup => lineup.date).sort();
  const unresolved = [...new Set(lineups.flatMap(lineup => lineup.members.filter(m => !m.ref).map(m => m.name)))].sort();
  const unknownSkills = [...new Set(lineups.flatMap(lineup => lineup.members.flatMap(m => m.skills)).filter(name => !skills[name]))].sort();

  return {
    schema: 1,
    generatedAt: now,
    label: '社区推荐',
    notice: SEASON_NOTE,
    source: {
      name: '洛克王国 BWIKI',
      url: urls.site,
      lineups: {
        url: urls.lineups,
        category: '分类:精灵阵容',
        pages: parsed.length,
        pvp: lineups.length,
        submissions: hot.uniqueSubmissions,
        authors: new Set(lineups.map(lineup => lineup.author)).size,
        firstSubmitted: dates[0] || null,
        lastSubmitted: dates.at(-1) || null,
        unresolvedSpirits: unresolved,
        unknownSkills
      },
      skills: {
        url: urls.skills,
        module: '模块:PetDexData/Skills',
        revised: isoDate(skillsRevised),
        count: Object.keys(skills).length
      },
      ...(newSystem ? { newSystem } : {})
    },
    skills,
    lineups,
    hot: {
      season: { id: season.id, startsOn: season.startsOn },
      sample: { lineups: current.length, submissions: hot.uniqueSubmissions, authors: new Set(current.map(lineup => lineup.author)).size },
      lineups: hot.lineups, spirits: hot.spirits, skills: hot.skills
    }
  };
}

// 定时任务的两道保险：BWIKI 故障、被破坏或改版时，不让明显缺失的数据覆盖掉现有的 meta.json。
const SHRINK_LIMIT = 0.9;
function checkRegression(previous, next) {
  if (!previous) return [];
  const problems = [];
  const drop = (label, before, after) => {
    if (before > 0 && after < before * SHRINK_LIMIT) problems.push(`${label}从 ${before} 降到 ${after}（超过 ${Math.round((1 - SHRINK_LIMIT) * 100)}%）`);
  };
  drop('技能数', previous.source.skills.count, next.source.skills.count);
  drop('PvP 阵容数', previous.source.lineups.pvp, next.source.lineups.pvp);
  drop('投稿作者数', previous.source.lineups.authors, next.source.lineups.authors);
  if (previous.source.lineups.lastSubmitted && next.source.lineups.lastSubmitted < previous.source.lineups.lastSubmitted) {
    problems.push(`最近投稿日期倒退：${previous.source.lineups.lastSubmitted} → ${next.source.lineups.lastSubmitted}`);
  }
  return problems;
}

// 只有抓取时间不同不算变化，避免每次定时任务都产生一个空提交。
function sameContent(a, b) {
  if (!a || !b) return false;
  const strip = ({ generatedAt, ...rest }) => JSON.stringify(rest);
  return strip(a) === strip(b);
}

// 顶层与列表逐行展开，其余压成一行：既保持文件不大，又让每次刷新的 diff 可读。
function serialize(value, depth = 0) {
  const expand = (Array.isArray(value) && depth <= 2) || (value && typeof value === 'object' && !Array.isArray(value) && depth <= 1);
  if (!expand || value === null) return JSON.stringify(value);
  const pad = ' '.repeat(depth + 1);
  const items = Array.isArray(value)
    ? value.map(item => pad + serialize(item, depth + 1))
    : Object.entries(value).map(([key, item]) => `${pad}${JSON.stringify(key)}: ${serialize(item, depth + 1)}`);
  return items.length ? `${Array.isArray(value) ? '[' : '{'}\n${items.join(',\n')}\n${' '.repeat(depth)}${Array.isArray(value) ? ']' : '}'}` : (Array.isArray(value) ? '[]' : '{}');
}

module.exports = { parseSelfRefund, summarizeNewSystem, parseTemplateFields, buildMeta, parseLineupPage, normalizeSkills, createResolver, aggregate, serialize, isoDate, clean, checkRegression, sameContent };
