const STORAGE_KEY = 'roco-pvp-desk-v1';
const state = { data: null, meta: null, season: null, metaIndex: null, byName: new Map(), skillAuthors: new Map(), team: [], opponents: [], size: 6, tab: 'team', selected: null };
const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const allTypes = () => Object.keys(state.data.types);
const getSpirit = (id) => state.data.spirits.find(s => s.id === id);

const effect = (attack, targets) => RocoEngine.effect(state.data.types, attack, targets);
const kitOf = (spirit) => state.metaIndex ? state.metaIndex.kitFor(spirit) : null;
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({team:state.team,opponents:state.opponents,size:state.size})); } catch (_) {}
}
function announce(message, error = false) {
  const el = $('#status'); el.textContent = message; el.classList.toggle('error', error); el.hidden = false;
  clearTimeout(announce.timer); announce.timer = setTimeout(() => el.hidden = true, 4200);
}
function typesText(spirit) { return spirit.types.join(' · '); }
function renderRoster(kind) {
  const ids = kind === 'team' ? state.team : state.opponents;
  const list = $(kind === 'team' ? '#team-list' : '#opponent-list');
  $(kind === 'team' ? '#team-count' : '#opponent-count').textContent = `${ids.length} / ${state.size}`;
  list.innerHTML = ids.length ? ids.map((id,index) => { const s=getSpirit(id); return `<div class="roster-item"><div class="roster-main"><div class="roster-name">${escapeHTML(s.name)}</div><div class="roster-meta">No.${escapeHTML(s.no)} · ${escapeHTML(typesText(s))}${s.form ? ' · '+escapeHTML(s.form):''}</div></div><button type="button" class="remove-button" data-kind="${kind}" data-index="${index}" aria-label="移除${escapeHTML(s.name)}">×</button></div>`; }).join('') : `<div class="empty">${kind === 'team' ? '搜索并加入精灵，开始检查阵容。' : '搜索并加入对手精灵，查看逐只对位。'}</div>`;
}
function renderCoverage() {
  const members = state.team.map(getSpirit);
  const covered = allTypes().filter(target => members.some(s => s.types.some(t => effect(t,[target]) > 1)));
  $('#coverage-summary').innerHTML = members.length ? `<strong>${covered.length}<span style="font-size:22px;color:#91a6bc"> / 18</span></strong><span>种属性可被队内精灵本系克制</span>` : `<span>加入精灵后显示属性覆盖。</span>`;
  $('#coverage-grid').innerHTML = allTypes().map(type => `<div class="type-cell ${covered.includes(type)?'active':''}"><b>${type}</b><span>${covered.includes(type)?'有克制':'未覆盖'}</span></div>`).join('');
  const weaknesses = allTypes().map(type => ({type, names:members.filter(s=>effect(type,s.types)>1).map(s=>s.name)})).filter(row=>row.names.length).sort((a,b)=>b.names.length-a.names.length || allTypes().indexOf(a.type)-allTypes().indexOf(b.type));
  $('#weakness-list').innerHTML = members.length ? weaknesses.length ? weaknesses.map(row=>`<div class="weakness-card ${row.names.length>=2?'high':''}"><strong>${row.type}系</strong><span>${row.names.length} 只弱点：${escapeHTML(row.names.join('、'))}</span></div>`).join('') : '<div class="empty">当前没有明显属性弱点。</div>' : '<div class="empty">加入精灵后显示共同弱点。</div>';
}
const fmt = (value) => value >= 10 ? value.toFixed(0) : value.toFixed(2);
const firstText = (duel) => duel.first === 'ours' ? '先手' : duel.first === 'theirs' ? '后手' : '同速';
function statLine(spirit) {
  const st = spirit.stats;
  return `生命 ${st.hp} · 物攻 ${st.pa} · 魔攻 ${st.ma} · 物防 ${st.pd} · 魔防 ${st.md} · 速度 ${st.sp}`;
}
function renderThreats(team, foes) {
  const rows = RocoEngine.analyzeTeam(state.data.types, team, foes, kitOf);
  const risky = rows.filter(row => row.threat);
  $('#match-threats').innerHTML = risky.length
    ? risky.map(row => `<div class="weakness-card ${row.threat === 'severe' ? 'high' : ''}"><strong>${escapeHTML(row.foe.name)}</strong><span>${row.threat === 'severe' ? '全队都处于劣势' : '队内没有占优的应对'}；最佳应对 ${escapeHTML(row.best.spirit.name)}（${row.best.duel.label} ${fmt(row.best.duel.score)}×）</span></div>`).join('')
    : '<div class="empty threat-clear">每个对手都至少有一只我方精灵占优。</div>';
}
const BASIS_TEXT = { skill: '双方都按社区投稿配招里的真实技能估算', mixed: '只有一方有社区投稿配招，另一方按属性估算', type: '双方都没有投稿配招，只按属性与种族值估算' };
function planText(plan) {
  const groups = new Map();
  for (const step of plan) { const group = groups.get(step.name) || { step, count: 0 }; group.count += 1; groups.set(step.name, group); }
  return [...groups.values()].map(({ step, count }) => `${step.name}（能耗 ${step.energy}${step.refund ? `，回 ${step.refund}` : ''}）${count > 1 ? `×${count}` : ''}`).join('、');
}
function attackText(side) {
  const energy = `能量 ${RocoEngine.ENERGY_START} → ${side.energyLeft}`;
  if (side.basis !== 'skill') return `${escapeHTML(side.type)}系 ${side.mult}× · 使用${side.kind}（无投稿配招，按威力 ${RocoEngine.ASSUMED_POWER}、能耗 ${RocoEngine.ASSUMED_ENERGY} 的本系技能估算，${RocoEngine.WINDOW} 回合内${energy}）`;
  const skill = side.skill, build = side.build;
  return `<b>${escapeHTML(skill.name)}</b>（主力）· ${escapeHTML(side.type || '无')}系 ${side.mult}× · ${side.kind}威力 ${skill.power}${skill.hits > 1 ? `×${skill.hits}连击` : ''}`
    + `<small class="cite">${RocoEngine.WINDOW} 回合内按能量限制的最优出招：${escapeHTML(planText(side.plan))}（${energy}）</small>`
    + `<small class="cite">来自 BWIKI 玩家投稿的配招：${escapeHTML(build.skills.map(item => item.name).join('、'))}（${build.authors} 位作者 · 最近 ${escapeHTML(build.date)}）</small>`;
}
function renderDetail(team, foes) {
  const box = $('#match-detail');
  const ours = state.selected && team.find(s => s.id === state.selected.o);
  const theirs = state.selected && foes.find(s => s.id === state.selected.f);
  if (!ours || !theirs) { state.selected = null; box.innerHTML = '<p class="detail-hint">点击表格中的任意一格，查看这组对位的判断依据。</p>'; return; }
  const d = RocoEngine.analyzeDuel(state.data.types, ours, theirs, kitOf);
  const line = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  box.innerHTML = `<h3>${escapeHTML(ours.name)} <span>对</span> ${escapeHTML(theirs.name)} <b class="${d.className}">${d.label} · 综合 ${fmt(d.score)}×</b></h3><dl>`
    + line('速度', `${d.speed.ours} 对 ${d.speed.theirs}，我方${firstText(d)}${d.first === 'tie' ? '' : `（估算给先手方 ${Math.round((RocoEngine.SPEED_EDGE - 1) * 100)}% 加成）`}`)
    + line('我方输出', attackText(d.out))
    + line('对方输出', attackText(d.back))
    + line('攻防对比', `压制力比 ${fmt(d.race)}×（${RocoEngine.WINDOW} 回合内的累计输出比，已计入技能威力、属性克制、攻防种族值、生命与能量）`)
    + line('判断依据', BASIS_TEXT[d.basis])
    + line('我方种族值', escapeHTML(statLine(ours)))
    + line('对方种族值', escapeHTML(statLine(theirs)))
    + line('未计入', '本系加成、减耗与追加效果、特性、个体值与血脉；能量按初始 10、上限 10、不自动回复估算')
    + line('特性',  `${escapeHTML(ours.trait || '—')} ／ ${escapeHTML(theirs.trait || '—')}`)
    + '</dl>';
}
function renderMatch() {
  const team=state.team.map(getSpirit), foes=state.opponents.map(getSpirit);
  if (!team.length || !foes.length) {
    $('#match-summary').textContent = !team.length ? '先在“配队分析”中加入我方精灵。' : '加入对手精灵后，这里会显示逐只对位判断。';
    $('#match-table').innerHTML = ''; $('#match-threats').innerHTML = ''; $('#match-detail').innerHTML = ''; return;
  }
  $('#match-summary').textContent = `${team.length} 只我方精灵 × ${foes.length} 只对手精灵；综合技能威力与能耗、属性克制、先后手与物魔攻防，估算各自 ${RocoEngine.WINDOW} 回合内的输出，绿色表示较有利，红色表示需谨慎。◆ 双方按社区投稿配招估算，◇ 仅一方有配招，无标记为按属性估算。未计特性、个体与场地。`;
  $('#match-basis').textContent = state.metaIndex ? '种族值与社区配招估算 · 不含特性' : '种族值估算 · 不含技能与特性';
  renderThreats(team, foes);
  $('#match-table').innerHTML = `<table class="match-table"><thead><tr><th scope="col">我方 ↓ / 对手 →</th>${foes.map(f=>`<th scope="col" title="${escapeHTML(f.name)}">${escapeHTML(f.name)}</th>`).join('')}</tr></thead><tbody>${team.map(o=>`<tr><th scope="row" title="${escapeHTML(o.name)}">${escapeHTML(o.name)}</th>${foes.map(f=>{const d=RocoEngine.analyzeDuel(state.data.types,o,f,kitOf);const mark=d.basis==='skill'?'◆ ':d.basis==='mixed'?'◇ ':'';const on=state.selected&&state.selected.o===o.id&&state.selected.f===f.id;return `<td class="${d.className}${on?' selected':''}"><button type="button" class="cell-button" data-o="${o.id}" data-f="${f.id}" aria-pressed="${on}" title="${escapeHTML(o.name)} 对 ${escapeHTML(f.name)}：${firstText(d)}，综合 ${fmt(d.score)}×（${BASIS_TEXT[d.basis]}）">${d.label}<small>${mark}${firstText(d)} · ${fmt(d.score)}×</small></button></td>`}).join('')}</tr>`).join('')}</tbody></table>`;
  renderDetail(team, foes);
}
function render() { renderRoster('team'); renderRoster('opponent'); renderCoverage(); renderMatch(); }
function setTab(tab) {
  state.tab=tab;
  for (const name of ['team','match','meta']) {
    $(`#${name}-view`).hidden=tab!==name; $(`#tab-${name}`).setAttribute('aria-selected',tab===name);
  }
}
function search(kind) {
  const input=$(kind==='team'?'#team-search':'#opponent-search');
  const results=$(kind==='team'?'#team-results':'#opponent-results');
  const query=input.value.trim().toLowerCase();
  if (!query) {results.hidden=true;results.innerHTML='';return;}
  const ids=kind==='team'?state.team:state.opponents;
  const hits=state.data.spirits.filter(s=>!ids.includes(s.id) && (s.name.toLowerCase().includes(query)||String(s.no).includes(query))).slice(0,12);
  results.innerHTML=hits.length?hits.map(s=>`<button type="button" role="option" data-id="${s.id}"><span>${escapeHTML(s.name)}${s.form?` <small>${escapeHTML(s.form)}</small>`:''}</span><small>${escapeHTML(typesText(s))}</small></button>`).join(''):'<div class="empty">没有找到精灵</div>';
  results.hidden=false;
}
function pushSpirit(kind,id) {
  const ids=kind==='team'?state.team:state.opponents;
  if (ids.length>=state.size) {announce(`当前模式最多选择 ${state.size} 只精灵。`,true);return false;}
  if (!getSpirit(id) || ids.includes(id)) return false;
  ids.push(id); save(); render();
  return true;
}
function addSpirit(kind,id) {
  if (!pushSpirit(kind,id)) return;
  const input=$(kind==='team'?'#team-search':'#opponent-search'); input.value='';
  const results=$(kind==='team'?'#team-results':'#opponent-results');results.hidden=true;input.focus();
}
function attachPicker(kind) {
  const input=$(kind==='team'?'#team-search':'#opponent-search');
  const results=$(kind==='team'?'#team-results':'#opponent-results');
  input.addEventListener('input',()=>search(kind));
  input.addEventListener('focus',()=>search(kind));
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){const first=results.querySelector('button[data-id]');if(first){event.preventDefault();addSpirit(kind,first.dataset.id)}}if(event.key==='Escape')results.hidden=true});
  results.addEventListener('click',event=>{const button=event.target.closest('button[data-id]');if(button)addSpirit(kind,button.dataset.id)});
}

// ---- 社区推荐：来源是玩家向 BWIKI 投稿的阵容，只能说“多少位作者收录”，不是使用率 ----
const STALE_DAYS = 60;
const plural = (n) => `${n} 位作者`;
const safeUrl = (url) => /^https:\/\//.test(url) ? url : '#';
const metaSpirit = (name) => name && state.byName.get(name);
const KIND_CLASS = { '官方': 'official', '工具站': 'tool', '媒体': 'media' };
function renderSeason() {
  const box=$('#season-notes'), data=state.season;
  if (!data) { box.hidden=true; box.innerHTML=''; return; }
  const s=data.season;
  const items=data.items.map(item=>`<li><span class="kind ${KIND_CLASS[item.kind]||''}">${escapeHTML(item.kind)}</span><time>${escapeHTML(item.date)}</time><span class="what">${escapeHTML(item.text)}<a href="${escapeHTML(safeUrl(item.source.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.source.name)}</a></span></li>`).join('');
  const gaps=data.gaps.map(text=>`<li>${escapeHTML(text)}</li>`).join('');
  const pointers=data.pointers.map(p=>`<li><a href="${escapeHTML(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(p.title)}</a><span class="card-meta">${escapeHTML(p.site)} · ${escapeHTML(p.note)}</span></li>`).join('');
  box.innerHTML=`<div class="panel-heading"><div><p class="section-kicker">当前赛季</p><h2>${escapeHTML(s.id)}「${escapeHTML(s.name)}」动向</h2></div><span class="mini-label">${escapeHTML(s.startsOn)} 开赛 · 人工整理于 ${escapeHTML(data.curatedOn)}</span></div>`
    +`<ul class="season-list">${items}</ul>`
    +`<div class="season-gaps"><h3>暂未收录</h3><ul>${gaps}</ul>${pointers?`<h3>可自行查看（未能自动读取）</h3><ul class="pointer-list">${pointers}</ul>`:''}</div>`
    +`<p class="provenance-note">${escapeHTML(data.note)}</p>`;
  box.hidden=false;
}
function renderProvenance() {
  const m=state.meta, l=m.source.lineups, k=m.source.skills, age=RocoMeta.ageInDays(l.lastSubmitted);
  const stale=age!==null && age>STALE_DAYS;
  const season=state.season&&state.season.season;
  const beforeSeason=season&&l.lastSubmitted<season.startsOn;
  const skillsBefore=season&&k.revised<season.startsOn;
  const fresh=m.source.newSystem;
  $('#meta-source').innerHTML=`<div class="provenance-head"><span class="badge">社区推荐</span><strong>来源：<a href="${escapeHTML(safeUrl(m.source.lineups.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(m.source.name)}</a> 玩家阵容投稿</strong></div>`
    +`<dl class="provenance-list">`
    +`<div><dt>投稿样本</dt><dd>${l.pvp} 份 PvP 阵容 · ${plural(l.authors)}（同一作者重复保存的同一套阵容只算一次，去重后 ${l.submissions} 份）</dd></div>`
    +`<div><dt>投稿日期</dt><dd>${escapeHTML(l.firstSubmitted)} 至 ${escapeHTML(l.lastSubmitted)}${age!==null?`（最近一份距今 ${age} 天）`:''}</dd></div>`
    +`<div><dt>技能数据</dt><dd><a href="${escapeHTML(safeUrl(k.url))}" target="_blank" rel="noopener noreferrer">BWIKI 技能图鉴</a>数据模块 · 修订于 ${escapeHTML(k.revised)} · 共 ${k.count} 个技能${skillsBefore?`（早于 ${escapeHTML(season.id)} 开赛，${escapeHTML(season.id)} 新增的技能未收录）`:''}</dd></div>`
    +(fresh?`<div><dt>新版投稿</dt><dd>${fresh.lineups.real+fresh.builds.real>0?`BWIKI 新投稿系统（含适用版本）已有 ${fresh.lineups.real} 份阵容、${fresh.builds.real} 份培养方案，尚未接入`:'BWIKI 新投稿系统（含适用版本）暂无真实投稿，所以没有新赛季的阵容数据'}</dd></div>`:'')
    +`<div><dt>数据生成</dt><dd>${escapeHTML(m.generatedAt.slice(0,10))}（定时抓取，内容有变化才更新）</dd></div></dl>`
    +`<p class="provenance-note${stale?' stale':''}">${escapeHTML(m.notice)} 下面的数字表示“有多少位作者的投稿里出现了它”，不是使用率或胜率。${beforeSeason?` 这些投稿全部早于 ${escapeHTML(season.id)} 开赛（${escapeHTML(season.startsOn)}），不反映当前赛季的环境。`:stale?' 最近一份投稿已是数月前，新赛季的调整不会体现在这里。':''}</p>`;
}
function spiritChip(member) {
  const spirit=metaSpirit(member.ref);
  return `<span class="chip${spirit?'':' unknown'}" title="${spirit?escapeHTML(typesText(spirit)):'资料库中没有这只精灵'}">${escapeHTML(member.name)}</span>`;
}
function renderHotLineups() {
  const m=state.meta;
  $('#hot-lineups').innerHTML=m.hot.lineups.map(row=>{
    const lineup=m.lineups[row.lineup], title=RocoMeta.lineupTitle(lineup);
    const support=row.authors>1?`${plural(row.authors)}投稿了相近阵容（至少 4 只精灵相同）`:'仅 1 位作者投稿';
    const skills=lineup.members.map(member=>`<li><b>${escapeHTML(member.name)}</b>${member.skills.length?escapeHTML(member.skills.join('、')):'<em>未填写配招</em>'}</li>`).join('');
    return `<article class="hot-card"><header><span class="rank">${row.rank}</span><div><h3>${escapeHTML(title)}</h3><p class="card-meta">${support} · 最近投稿 ${escapeHTML(row.lastSubmitted)}</p></div></header>`
      +`<div class="chips">${lineup.members.map(spiritChip).join('')}</div>`
      +`<details><summary>配招与来源</summary><ul class="skill-lines">${skills}</ul>${lineup.intro?`<p class="intro">${escapeHTML(lineup.intro)}</p>`:''}<p class="cite">代表投稿：${escapeHTML(lineup.author)} · ${escapeHTML(lineup.date)}（相近投稿 ${escapeHTML(row.firstSubmitted)} 至 ${escapeHTML(row.lastSubmitted)}）</p></details>`
      +`<div class="card-actions"><button type="button" class="ghost-button small" data-load="team" data-lineup="${row.lineup}">设为我方阵容</button><button type="button" class="ghost-button small" data-load="opponent" data-lineup="${row.lineup}">设为对手阵容</button></div></article>`;
  }).join('');
}
function renderHotSpirits() {
  const list=state.meta.hot.spirits, top=Math.max(...list.map(row=>row.authors),1);
  $('#hot-spirits').innerHTML=list.map((row,index)=>{
    const spirit=metaSpirit(row.ref);
    const common=row.topSkills.length?`常见配招：${escapeHTML(row.topSkills.map(skill=>`${skill.name}（${skill.authors}）`).join('、'))}`:'';
    const buttons=spirit?`<div class="card-actions"><button type="button" class="ghost-button small" data-add="team" data-id="${spirit.id}">加入我方</button><button type="button" class="ghost-button small" data-add="opponent" data-id="${spirit.id}">加入对手</button></div>`:'';
    return `<article class="hot-row"><header><span class="rank">${index+1}</span><div><h3>${escapeHTML(row.name)}</h3><p class="card-meta">${spirit?escapeHTML(typesText(spirit)):'资料库中没有这只精灵'}</p></div><span class="count">${plural(row.authors)}</span></header>`
      +`<div class="bar" aria-hidden="true"><i style="width:${Math.round(row.authors/top*100)}%"></i></div><p class="card-meta">${common}</p>${buttons}</article>`;
  }).join('');
}
function skillRow(name, skill, extra) {
  const cls=skill.category==='攻击'?skill.damageClass:skill.category;
  const power=skill.power?`威力 ${skill.power}${skill.hits>1?`×${skill.hits}`:''} · `:'';
  const count=state.skillAuthors.get(name);
  const carriers=extra&&extra.carriers.length?`<p class="card-meta">常见携带：${escapeHTML(extra.carriers.map(item=>`${item.name}（${item.authors}）`).join('、'))}</p>`:'';
  return `<article class="skill-row"><header><h3>${escapeHTML(name)}</h3><span class="type-tag">${escapeHTML(skill.element?skill.element+'系':'无系')}</span><span class="type-tag plain">${escapeHTML(cls)}</span></header>`
    +`<p class="card-meta">${power}能耗 ${skill.energy}${skill.refund?` · 自带回能 ${skill.refund}`:''}${count?` · ${plural(count)}收录`:''}</p><p class="skill-desc">${escapeHTML(skill.desc)}</p>${carriers}</article>`;
}
function renderSkills() {
  const m=state.meta, query=$('#skill-search').value.trim().toLowerCase();
  const box=$('#hot-skills');
  if (!query) {
    box.innerHTML=m.hot.skills.filter(row=>m.skills[row.name]).map(row=>skillRow(row.name,m.skills[row.name],row)).join('');
    return;
  }
  const hits=Object.entries(m.skills).filter(([name,skill])=>{
    const element=skill.element?skill.element:'';
    return name.toLowerCase().includes(query)||skill.desc.toLowerCase().includes(query)||(element&&(query===element||query===element+'系'))||skill.category===query||skill.damageClass===query;
  }).sort((a,b)=>(state.skillAuthors.get(b[0])||0)-(state.skillAuthors.get(a[0])||0)||a[0].localeCompare(b[0],'zh'));
  const hot=new Map(m.hot.skills.map(row=>[row.name,row]));
  box.innerHTML=hits.length?`<p class="card-meta result-note">共 ${hits.length} 个技能${hits.length>30?'，显示前 30 个':''}，按投稿收录数排序。</p>`+hits.slice(0,30).map(([name,skill])=>skillRow(name,skill,hot.get(name))).join(''):'<div class="empty">没有找到匹配的技能。</div>';
}
function renderMeta() {
  renderSeason();
  if (!state.meta) {
    $('#meta-source').innerHTML='<div class="empty">社区推荐数据暂时无法载入，其余功能不受影响。</div>';
    for (const id of ['#hot-lineups','#hot-spirits','#hot-skills']) $(id).innerHTML='';
    return;
  }
  const l=state.meta.source.lineups, span=`BWIKI 投稿 ${l.firstSubmitted} 至 ${l.lastSubmitted}`;
  $('#label-lineups').textContent=`${span} · 按投稿作者数排序`;
  $('#label-spirits').textContent=`${span} · 按收录作者数排序`;
  $('#label-skills').textContent=`${span} · 技能数据修订于 ${state.meta.source.skills.revised}`;
  renderProvenance(); renderHotLineups(); renderHotSpirits(); renderSkills();
}
function loadLineup(kind,index) {
  const lineup=state.meta.lineups[index]; if(!lineup)return;
  const spirits=[...new Map(lineup.members.map(member=>metaSpirit(member.ref)).filter(Boolean).map(spirit=>[spirit.id,spirit])).values()];
  const label=kind==='team'?'我方':'对手';
  if (!spirits.length) {announce('这套阵容里的精灵都不在资料库中。',true);return;}
  const current=kind==='team'?state.team:state.opponents;
  if (current.length && !confirm(`用「${RocoMeta.lineupTitle(lineup)}」替换当前${label}阵容？`)) return;
  if (spirits.length>state.size) {state.size=6;$('#team-size').value='6';}
  const ids=spirits.map(spirit=>spirit.id);
  if (kind==='team') state.team=ids; else state.opponents=ids;
  state.selected=null; save(); render(); setTab(kind==='team'?'team':'match');
  const skipped=lineup.members.length-spirits.length;
  announce(`已载入为${label}阵容：${RocoMeta.lineupTitle(lineup)}${skipped?`（${skipped} 只不在资料库中，已跳过）`:''}`);
}
async function loadSeason() {
  try {
    const response=await fetch('./season.json'); if(!response.ok)throw new Error('season unavailable');
    const season=await response.json(); if(season.schema!==1||!season.season||!Array.isArray(season.items))throw new Error('season schema');
    state.season={ gaps: [], pointers: [], ...season };
  } catch(_) { state.season=null; }
}
async function loadMeta() {
  try {
    const response=await fetch('./meta.json'); if(!response.ok)throw new Error('meta unavailable');
    const meta=await response.json(); if(meta.schema!==1)throw new Error('meta schema');
    state.meta=meta; state.metaIndex=RocoMeta.createIndex(meta,state.data);
    const authors=new Map();
    for (const lineup of meta.lineups) for (const member of lineup.members) for (const name of new Set(member.skills)) { if(!authors.has(name))authors.set(name,new Set()); authors.get(name).add(lineup.author); }
    state.skillAuthors=new Map([...authors].map(([name,set])=>[name,set.size]));
  } catch(_) { state.meta=null; state.metaIndex=null; }
}
async function init() {
  try {
    const response=await fetch('./data.json'); if(!response.ok)throw new Error('资料无法载入');
    state.data=await response.json();
    state.byName=new Map(state.data.spirits.map(s=>[s.name,s]));
    await Promise.all([loadMeta(),loadSeason()]);
    const stored=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
    state.size=stored.size===3?3:6; $('#team-size').value=state.size;
    state.team=Array.isArray(stored.team)?stored.team.filter(id=>getSpirit(id)).slice(0,state.size):[];
    state.opponents=Array.isArray(stored.opponents)?stored.opponents.filter(id=>getSpirit(id)).slice(0,state.size):[];
    $('#data-tag').textContent=`${state.data.spirits.length} 条精灵资料 · 2026.09`;
    attachPicker('team');attachPicker('opponent');render();renderMeta();
  } catch(error) {announce('精灵资料加载失败，请刷新页面重试。',true);return;}
}
document.addEventListener('click',event=>{
  const remove=event.target.closest('.remove-button');
  if(remove){const ids=remove.dataset.kind==='team'?state.team:state.opponents;ids.splice(Number(remove.dataset.index),1);save();render()}
  const load=event.target.closest('[data-load]');
  if(load)loadLineup(load.dataset.load,Number(load.dataset.lineup));
  const add=event.target.closest('[data-add]');
  if(add&&pushSpirit(add.dataset.add,add.dataset.id))announce(`已加入${add.dataset.add==='team'?'我方':'对手'}阵容。`);
  const cell=event.target.closest('.cell-button');
  if(cell){state.selected={o:cell.dataset.o,f:cell.dataset.f};renderMatch();document.querySelector(`.cell-button[data-o="${cell.dataset.o}"][data-f="${cell.dataset.f}"]`)?.focus()}
  if(!event.target.closest('.picker'))document.querySelectorAll('.search-results').forEach(el=>el.hidden=true);
});
$('#tab-team').addEventListener('click',()=>setTab('team'));
$('#tab-match').addEventListener('click',()=>setTab('match'));
$('#tab-meta').addEventListener('click',()=>setTab('meta'));
$('#skill-search').addEventListener('input',()=>{if(state.meta)renderSkills()});
$('#team-size').addEventListener('change',event=>{
  const next=Number(event.target.value);
  if(state.team.length>next || state.opponents.length>next){event.target.value=state.size;announce(`先将双方队伍各缩减到 ${next} 只，再切换规模。`,true);return;}
  state.size=next;save();render();
});
$('#export-button').addEventListener('click',()=>{
  if(!state.data){announce('资料仍在加载中。',true);return;}
  const content=JSON.stringify({title:'洛克 PvP 配队备份',date:new Date().toISOString(),teamSize:state.size,team:state.team.map(getSpirit).map(s=>({name:s.name,no:s.no,types:s.types,form:s.form})),opponents:state.opponents.map(getSpirit).map(s=>({name:s.name,no:s.no,types:s.types,form:s.form}))},null,2);
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([content],{type:'application/json'}));link.download='洛克PVP队伍备份.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);announce('队伍备份已导出。');
});
$('#import-button').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    if(!state.data)throw new Error('资料仍在加载');
    if(file.size>1024*1024)throw new Error('文件过大');
    const backup=JSON.parse(await file.text());
    if(![3,6].includes(backup.teamSize)||!Array.isArray(backup.team)||!Array.isArray(backup.opponents))throw new Error('备份格式不正确');
    if(backup.team.length>backup.teamSize||backup.opponents.length>backup.teamSize)throw new Error('备份中的队伍数量超限');
    function resolve(items){return items.map(item=>{const match=state.data.spirits.find(s=>s.name===item?.name&&s.no===item?.no&&s.form===item?.form);if(!match)throw new Error(`找不到精灵：${item?.name||'未知'}`);return match.id})}
    const team=resolve(backup.team),opponents=resolve(backup.opponents);
    if(new Set(team).size!==team.length||new Set(opponents).size!==opponents.length)throw new Error('备份中有重复精灵');
    state.size=backup.teamSize;state.team=team;state.opponents=opponents;$('#team-size').value=String(state.size);save();render();setTab('team');announce('队伍已恢复。');
  }catch(error){announce(`导入失败：${error.message}`,true)}finally{event.target.value=''}
});
function registerWebMCP() {
  const context=document.modelContext;
  if(!context?.registerTool || !state.data)return;
  const tool={
    name:'set_pvp_lineups',title:'设置 PvP 阵容',
    description:'按精灵准确名称设置我方与对手阵容，并更新页面上的配队和对阵结果。',
    inputSchema:{type:'object',properties:{team:{type:'array',items:{type:'string'},maxItems:6},opponents:{type:'array',items:{type:'string'},maxItems:6},size:{type:'integer',enum:[3,6]}},required:['team','opponents','size'],additionalProperties:false},
    annotations:{readOnlyHint:false,untrustedContentHint:false},
    async execute(input){
      if(!input || ![3,6].includes(input.size) || !Array.isArray(input.team) || !Array.isArray(input.opponents))throw new Error('阵容格式无效');
      if(input.team.length>input.size || input.opponents.length>input.size)throw new Error('精灵数量超过队伍规模');
      function resolve(names){return names.map(name=>{if(typeof name!=='string')throw new Error('精灵名称必须是文字');const found=state.data.spirits.filter(s=>s.name===name);if(found.length!==1)throw new Error(`精灵名称“${name}”未找到或有多个同名形态`);return found[0].id})}
      const team=resolve(input.team),opponents=resolve(input.opponents);
      if(new Set(team).size!==team.length || new Set(opponents).size!==opponents.length)throw new Error('同一阵容不能重复添加精灵');
      state.size=input.size;state.team=team;state.opponents=opponents;$('#team-size').value=String(input.size);save();render();setTab(opponents.length?'match':'team');
      return {team:input.team,opponents:input.opponents,size:input.size,matchups:team.length*opponents.length};
    }
  };
  try{Promise.resolve(context.registerTool(tool)).catch(()=>{});}catch(_){}
}
init().then(registerWebMCP);
