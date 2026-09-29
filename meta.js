(function (root) {
  // meta.json 的读取辅助：按精灵查社区投稿的配招，供引擎做技能对位；再补几个展示用的小函数。
  // 这里的数据是玩家向 BWIKI 投稿的阵容，只能表述为“社区推荐”，不能当作对局使用率。

  function createIndex(meta, data) {
    const known = new Set(data.spirits.map(spirit => spirit.name));
    const perSpirit = new Map();
    for (const lineup of meta.lineups) {
      for (const member of lineup.members) {
        if (!member.ref || !known.has(member.ref)) continue;
        const skills = member.skills.filter(name => meta.skills[name]);
        if (!skills.length) continue;
        const builds = perSpirit.get(member.ref) || new Map();
        const signature = [...skills].sort().join('|');
        const build = builds.get(signature) || {
          skills: skills.map(name => ({ name, ...meta.skills[name] })),
          authorSet: new Set(), title: lineup.title, date: lineup.date, page: lineup.page
        };
        build.authorSet.add(lineup.author);
        if (lineup.date >= build.date) { build.date = lineup.date; build.title = lineup.title; build.page = lineup.page; }
        builds.set(signature, build);
        perSpirit.set(member.ref, builds);
      }
    }
    const kits = new Map();
    for (const [name, builds] of perSpirit) {
      const list = [...builds.values()].map(({ authorSet, ...build }) => ({ ...build, authors: authorSet.size }));
      kits.set(name, {
        builds: list,
        authors: new Set([...builds.values()].flatMap(build => [...build.authorSet])).size
      });
    }
    return { kitFor: (spirit) => kits.get(spirit.name) || null, kitCount: kits.size };
  }

  // 标题为空或只有数字/符号的投稿没有信息量，用前几只精灵代替。
  function lineupTitle(lineup) {
    const title = String(lineup.title || '').trim();
    if (/[\p{L}]{2,}/u.test(title)) return title;
    return `${lineup.members.slice(0, 3).map(member => member.name.replace(/（.*）$/, '')).join('、')} 等`;
  }

  function ageInDays(isoDate, now = new Date()) {
    const then = Date.parse(`${isoDate}T00:00:00Z`);
    return Number.isNaN(then) ? null : Math.max(0, Math.floor((now.getTime() - then) / 86400000));
  }

  // “热门”只在按当前赛季统计时才可信：meta.hot 记录了它统计的赛季，和 season.json 的当前赛季对不上就不能用
  // （比如换了赛季但刷新任务还没重新统计）。返回 { status: 'ok' | 'empty' | 'stale', hot, small }。
  const SMALL_SAMPLE = 10;
  function currentHot(meta, season) {
    const hot = meta && meta.hot;
    if (!hot || !hot.season || !hot.sample) return { status: 'stale', hot: null, small: false };
    if (season && season.season && hot.season.startsOn !== season.season.startsOn) return { status: 'stale', hot: null, small: false };
    const empty = !hot.lineups.length && !hot.spirits.length && !hot.skills.length;
    return { status: empty ? 'empty' : 'ok', hot, small: !empty && hot.sample.lineups < SMALL_SAMPLE };
  }

  const api = { createIndex, lineupTitle, ageInDays, currentHot, SMALL_SAMPLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RocoMeta = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
