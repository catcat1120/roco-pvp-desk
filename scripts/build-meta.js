#!/usr/bin/env node
// 从洛克王国 BWIKI 抓取热门配队/精灵/技能与技能数据，生成 meta.json。
//
//   node scripts/build-meta.js              抓取并写入 meta.json
//   node scripts/build-meta.js --cache DIR  同时把原始响应存到 DIR（便于复查）
//   node scripts/build-meta.js --from-cache DIR  不联网，用 DIR 里的原始响应重新生成
//   node scripts/build-meta.js --force      数据骤减时也覆盖（默认拒绝，见 checkRegression）
//
// 内容与现有 meta.json 相同时不改动文件（只有 generatedAt 不同不算变化），所以 generatedAt 表示
// “内容最近一次变化的抓取时间”。定时刷新见 .github/workflows/refresh-meta.yml。
//
// 只使用 MediaWiki API（robots.txt 未禁止），请求约 12 次。BWIKI 的 CDN 在请求过密时会返回
// HTTP 567 的挑战页，所以这里固定间隔、失败退避，不要调小间隔或绕过。
// 在需要走代理的环境里运行时加 NODE_USE_ENV_PROXY=1。
const fs = require('node:fs');
const path = require('node:path');
const { buildMeta, buildSeasonChanges, normalizeSkills, serialize, checkRegression, sameContent, summarizeNewSystem } = require('./meta-lib.js');

const ROOT = path.join(__dirname, '..');
// 两个 BWIKI：rocom（洛克王国:手游WIKI）有玩家阵容投稿，但战斗数据停在 2026-08；
// nrc（洛克王国世界WIKI）的技能表和数据日志一直同步到当前赛季。技能与赛季调整用 nrc，阵容用 rocom。
const SITE = 'https://wiki.biligame.com/rocom/';
const NRC_SITE = 'https://wiki.biligame.com/nrc/';
const USER_AGENT = 'roco-pvp-desk-meta/1.0 (+https://github.com/catcat1120/roco-pvp-desk; non-commercial fan tool)';
const MIN_INTERVAL_MS = 2500;
const BACKOFF_MS = [8000, 30000, 90000];
const BATCH = 50;

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const cacheDir = option('--cache');
const fromCache = option('--from-cache');
const force = args.includes('--force');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let lastRequest = 0;
let counter = 0;

async function call(params, site = SITE) {
  const cachePath = (dir) => path.join(dir, `${String(++counter).padStart(2, '0')}.json`);
  if (fromCache) return JSON.parse(fs.readFileSync(cachePath(fromCache), 'utf8'));
  const url = `${site}api.php?${new URLSearchParams({ format: 'json', ...params })}`;
  for (let attempt = 0; ; attempt++) {
    await sleep(Math.max(0, lastRequest + MIN_INTERVAL_MS - Date.now()));
    lastRequest = Date.now();
    let failure;
    try {
      const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
      const body = await response.text();
      if (response.ok && /json/.test(response.headers.get('content-type') || '')) {
        const json = JSON.parse(body);
        if (json.error) throw new Error(`API 错误：${json.error.code}`);
        if (cacheDir) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cachePath(cacheDir), body); }
        return json;
      }
      failure = `HTTP ${response.status}（被限流或返回了挑战页）`;
    } catch (error) {
      failure = error.message;
    }
    if (attempt >= BACKOFF_MS.length) throw new Error(`请求失败，已放弃：${failure}`);
    console.error(`  ${failure}，${BACKOFF_MS[attempt] / 1000}s 后重试`);
    await sleep(BACKOFF_MS[attempt]);
  }
}

async function revisions(titles, site = SITE) {
  const json = await call({
    action: 'query', prop: 'revisions', rvprop: 'content|timestamp', rvslots: 'main', titles: titles.join('|')
  }, site);
  return Object.values(json.query.pages)
    .filter(page => page.revisions)
    .map(page => ({ title: page.title, text: page.revisions[0].slots.main['*'], revised: page.revisions[0].timestamp }));
}

async function listPrefix(prefix) {
  const titles = [];
  for (let cont = {}; ;) {
    const json = await call({ action: 'query', list: 'allpages', apprefix: prefix, aplimit: '500', ...cont });
    titles.push(...json.query.allpages.map(page => page.title));
    if (!json.continue) break;
    cont = { apcontinue: json.continue.apcontinue };
  }
  return titles;
}

// BWIKI 2026-07 改版的新投稿系统（含“适用版本”）：只数数，不解析阵容码。见 meta-lib 的 summarizeNewSystem。
async function probeNewSystem() {
  const lineupTitles = await listPrefix('阵容:');
  const buildTitles = await listPrefix('精灵培养方案/');
  const lineupPages = [];
  for (let i = 0; i < lineupTitles.length; i += BATCH) lineupPages.push(...await revisions(lineupTitles.slice(i, i + BATCH)));
  return summarizeNewSystem({ lineupPages, buildTitles });
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  // “当下”以 season.json 的开赛日为界：热门只统计开赛之后的投稿。换赛季时更新 season.json 再刷新。
  const { season } = JSON.parse(fs.readFileSync(path.join(ROOT, 'season.json'), 'utf8'));

  console.error('技能数据（洛克王国世界WIKI）…');
  const [skillsPage] = await revisions(['模块:Pets/data/Skills'], NRC_SITE);
  if (!skillsPage) throw new Error('没有取到技能数据模块');

  console.error('阵容列表…');
  const titles = [];
  for (let cont = {}; ;) {
    const json = await call({ action: 'query', list: 'categorymembers', cmtitle: '分类:精灵阵容', cmnamespace: '0', cmlimit: '500', ...cont });
    titles.push(...json.query.categorymembers.map(member => member.title));
    if (!json.continue) break;
    cont = { cmcontinue: json.continue.cmcontinue };
  }
  console.error(`  ${titles.length} 个阵容页面`);

  const lineupPages = [];
  for (let i = 0; i < titles.length; i += BATCH) {
    console.error(`阵容内容 ${Math.min(i + BATCH, titles.length)}/${titles.length}…`);
    lineupPages.push(...await revisions(titles.slice(i, i + BATCH)));
  }

  const target = path.join(ROOT, 'meta.json');
  const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;

  // 探测失败不影响主数据：沿用上一次的结果，避免无谓的改动。
  let newSystem;
  try {
    console.error('新投稿系统…');
    newSystem = await probeNewSystem();
  } catch (error) {
    console.error(`  探测失败，沿用上次结果：${error.message}`);
    newSystem = previous && previous.source.newSystem;
  }

  // 赛季调整日志：辅助数据，失败时沿用上一次的结果。
  let changes;
  try {
    console.error('赛季调整日志…');
    const [history] = await revisions(['模块:Pets/data/History'], NRC_SITE);
    const [catalog] = await revisions(['模块:Pets/data/Catalog'], NRC_SITE);
    if (!history || !catalog) throw new Error('没有取到数据日志模块');
    changes = buildSeasonChanges({
      historyLua: history.text, catalogLua: catalog.text, skills: normalizeSkills(skillsPage.text), data, season,
      source: { name: '洛克王国世界WIKI · 精灵数据日志', module: '模块:Pets/data/History', url: `${NRC_SITE}${encodeURIComponent('精灵图鉴')}`, revised: history.revised }
    });
  } catch (error) {
    console.error(`  读取失败，沿用上次结果：${error.message}`);
    changes = previous && previous.changes;
  }

  const meta = buildMeta({
    skillsLua: skillsPage.text,
    skillsRevised: skillsPage.revised,
    skillsInfo: { name: '洛克王国世界WIKI', module: '模块:Pets/data/Skills' },
    changes,
    lineupPages,
    data,
    now: new Date().toISOString(),
    newSystem,
    season,
    urls: {
      site: SITE,
      lineups: `${SITE}${encodeURIComponent('阵容一览')}`,
      skills: `${NRC_SITE}${encodeURIComponent('技能图鉴')}`
    }
  });
  const problems = checkRegression(previous, meta);
  if (problems.length && !force) {
    throw new Error(`新数据明显少于现有 meta.json，已拒绝覆盖（确认无误后加 --force）：\n  - ${problems.join('\n  - ')}`);
  }
  if (sameContent(previous, meta)) {
    console.error('内容没有变化，meta.json 保持不动');
    return;
  }
  fs.writeFileSync(target, `${serialize(meta)}\n`);

  const { lineups, skills } = meta.source;
  const { hot } = meta;
  console.error(`热门只统计 ${hot.season.id}（${hot.season.startsOn} 起）的投稿：${hot.sample.lineups} 份阵容，${hot.sample.authors} 位作者${hot.sample.lineups ? '' : '（暂无当下数据，热门面板为空）'}`);
  console.error(`已写入 meta.json：${lineups.pvp} 份 PvP 阵容（${lineups.authors} 位作者，投稿 ${lineups.firstSubmitted} ~ ${lineups.lastSubmitted}），${skills.count} 个技能（修订于 ${skills.revised}）`);
  if (lineups.unresolvedSpirits.length) console.error(`  未在 data.json 中找到的精灵：${lineups.unresolvedSpirits.join('、')}`);
  if (meta.changes) {
    const c = meta.changes;
    console.error(`  ${c.season} 调整日志：种族值 ${c.stats.length} 只、技能数值 ${c.skills.length} 项、特性 ${c.features.length} 项、新增精灵/形态 ${c.newSpirits.length} 个（修订于 ${c.source.revised}）`);
    if (c.dataCheck.mismatched.length) console.error(`  ⚠ data.json 的种族值与 ${c.season} 日志不一致 ${c.dataCheck.mismatched.length}/${c.dataCheck.checked} 项，对阵速查可能在用过期数值：${c.dataCheck.mismatched.slice(0, 5).map(m => `${m.name}${m.field} 应为 ${m.expected}（现 ${m.actual}）`).join('；')}`);
    else console.error(`  data.json 的种族值与 ${c.season} 日志一致（${c.dataCheck.checked}/${c.dataCheck.checked} 项）`);
  }
  if (newSystem) {
    const found = newSystem.lineups.real + newSystem.builds.real;
    console.error(`  新投稿系统：阵容页 ${newSystem.lineups.pages}（真实 ${newSystem.lineups.real}），培养方案 ${newSystem.builds.real}${found ? '  ← 出现真实投稿，需要接入' : '（尚无真实投稿）'}`);
  }
  if (lineups.unknownSkills.length) console.error(`  技能表中没有的技能：${lineups.unknownSkills.join('、')}`);
}

main().catch(error => { console.error(error.message); process.exit(1); });
