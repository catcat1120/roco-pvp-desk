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
// 只使用 MediaWiki API（robots.txt 未禁止），请求约 7 次。BWIKI 的 CDN 在请求过密时会返回
// HTTP 567 的挑战页，所以这里固定间隔、失败退避，不要调小间隔或绕过。
// 在需要走代理的环境里运行时加 NODE_USE_ENV_PROXY=1。
const fs = require('node:fs');
const path = require('node:path');
const { buildMeta, serialize, checkRegression, sameContent } = require('./meta-lib.js');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://wiki.biligame.com/rocom/';
const API = `${SITE}api.php`;
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

async function call(params) {
  const cachePath = (dir) => path.join(dir, `${String(++counter).padStart(2, '0')}.json`);
  if (fromCache) return JSON.parse(fs.readFileSync(cachePath(fromCache), 'utf8'));
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
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

async function revisions(titles) {
  const json = await call({
    action: 'query', prop: 'revisions', rvprop: 'content|timestamp', rvslots: 'main', titles: titles.join('|')
  });
  return Object.values(json.query.pages)
    .filter(page => page.revisions)
    .map(page => ({ title: page.title, text: page.revisions[0].slots.main['*'], revised: page.revisions[0].timestamp }));
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));

  console.error('技能数据…');
  const [skillsPage] = await revisions(['模块:PetDexData/Skills']);
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

  const meta = buildMeta({
    skillsLua: skillsPage.text,
    skillsRevised: skillsPage.revised,
    lineupPages,
    data,
    now: new Date().toISOString(),
    urls: {
      site: SITE,
      lineups: `${SITE}${encodeURIComponent('阵容一览')}`,
      skills: `${SITE}${encodeURIComponent('技能图鉴')}`
    }
  });
  const target = path.join(ROOT, 'meta.json');
  const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
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
  console.error(`已写入 meta.json：${lineups.pvp} 份 PvP 阵容（${lineups.authors} 位作者，投稿 ${lineups.firstSubmitted} ~ ${lineups.lastSubmitted}），${skills.count} 个技能（修订于 ${skills.revised}）`);
  if (lineups.unresolvedSpirits.length) console.error(`  未在 data.json 中找到的精灵：${lineups.unresolvedSpirits.join('、')}`);
  if (lineups.unknownSkills.length) console.error(`  技能表中没有的技能：${lineups.unknownSkills.join('、')}`);
}

main().catch(error => { console.error(error.message); process.exit(1); });
