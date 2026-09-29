const STORAGE_KEY = 'roco-pvp-desk-v1';
const state = { data: null, team: [], opponents: [], size: 6, tab: 'team', selected: null };
const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const allTypes = () => Object.keys(state.data.types);
const getSpirit = (id) => state.data.spirits.find(s => s.id === id);

const effect = (attack, targets) => RocoEngine.effect(state.data.types, attack, targets);
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
  const rows = RocoEngine.analyzeTeam(state.data.types, team, foes);
  const risky = rows.filter(row => row.threat);
  $('#match-threats').innerHTML = risky.length
    ? risky.map(row => `<div class="weakness-card ${row.threat === 'severe' ? 'high' : ''}"><strong>${escapeHTML(row.foe.name)}</strong><span>${row.threat === 'severe' ? '全队都处于劣势' : '队内没有占优的应对'}；最佳应对 ${escapeHTML(row.best.spirit.name)}（${row.best.duel.label} ${fmt(row.best.duel.score)}×）</span></div>`).join('')
    : '<div class="empty threat-clear">每个对手都至少有一只我方精灵占优。</div>';
}
function renderDetail(team, foes) {
  const box = $('#match-detail');
  const ours = state.selected && team.find(s => s.id === state.selected.o);
  const theirs = state.selected && foes.find(s => s.id === state.selected.f);
  if (!ours || !theirs) { state.selected = null; box.innerHTML = '<p class="detail-hint">点击表格中的任意一格，查看这组对位的判断依据。</p>'; return; }
  const d = RocoEngine.analyzeDuel(state.data.types, ours, theirs);
  const line = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  box.innerHTML = `<h3>${escapeHTML(ours.name)} <span>对</span> ${escapeHTML(theirs.name)} <b class="${d.className}">${d.label} · 综合 ${fmt(d.score)}×</b></h3><dl>`
    + line('速度', `${d.speed.ours} 对 ${d.speed.theirs}，我方${firstText(d)}${d.first === 'tie' ? '' : `（估算给先手方 ${Math.round((RocoEngine.SPEED_EDGE - 1) * 100)}% 加成）`}`)
    + line('我方输出', `${escapeHTML(d.out.type)}系 ${d.out.mult}× · 使用${d.out.kind}`)
    + line('对方输出', `${escapeHTML(d.back.type)}系 ${d.back.mult}× · 使用${d.back.kind}`)
    + line('攻防对比', `压制力比 ${fmt(d.race)}×（已计入属性克制、攻防种族值与生命）`)
    + line('我方种族值', escapeHTML(statLine(ours)))
    + line('对方种族值', escapeHTML(statLine(theirs)))
    + line('特性（未计入）', `${escapeHTML(ours.trait || '—')} ／ ${escapeHTML(theirs.trait || '—')}`)
    + '</dl>';
}
function renderMatch() {
  const team=state.team.map(getSpirit), foes=state.opponents.map(getSpirit);
  if (!team.length || !foes.length) {
    $('#match-summary').textContent = !team.length ? '先在“配队分析”中加入我方精灵。' : '加入对手精灵后，这里会显示逐只对位判断。';
    $('#match-table').innerHTML = ''; $('#match-threats').innerHTML = ''; $('#match-detail').innerHTML = ''; return;
  }
  $('#match-summary').textContent = `${team.length} 只我方精灵 × ${foes.length} 只对手精灵；综合属性克制、先后手与物魔攻防估算，绿色表示较有利，红色表示需谨慎。未计技能、特性、个体与场地。`;
  renderThreats(team, foes);
  $('#match-table').innerHTML = `<table class="match-table"><thead><tr><th scope="col">我方 ↓ / 对手 →</th>${foes.map(f=>`<th scope="col" title="${escapeHTML(f.name)}">${escapeHTML(f.name)}</th>`).join('')}</tr></thead><tbody>${team.map(o=>`<tr><th scope="row" title="${escapeHTML(o.name)}">${escapeHTML(o.name)}</th>${foes.map(f=>{const d=RocoEngine.analyzeDuel(state.data.types,o,f);const on=state.selected&&state.selected.o===o.id&&state.selected.f===f.id;return `<td class="${d.className}${on?' selected':''}"><button type="button" class="cell-button" data-o="${o.id}" data-f="${f.id}" aria-pressed="${on}" title="${escapeHTML(o.name)} 对 ${escapeHTML(f.name)}：${firstText(d)}，综合 ${fmt(d.score)}×">${d.label}<small>${firstText(d)} · ${fmt(d.score)}×</small></button></td>`}).join('')}</tr>`).join('')}</tbody></table>`;
  renderDetail(team, foes);
}
function render() { renderRoster('team'); renderRoster('opponent'); renderCoverage(); renderMatch(); }
function setTab(tab) {
  state.tab=tab;
  $('#team-view').hidden=tab!=='team'; $('#match-view').hidden=tab!=='match';
  $('#tab-team').setAttribute('aria-selected',tab==='team'); $('#tab-match').setAttribute('aria-selected',tab==='match');
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
function addSpirit(kind,id) {
  const ids=kind==='team'?state.team:state.opponents;
  if (ids.length>=state.size) {announce(`当前模式最多选择 ${state.size} 只精灵。`,true);return;}
  if (!getSpirit(id) || ids.includes(id)) return;
  ids.push(id); save(); render();
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
async function init() {
  try {
    const response=await fetch('./data.json'); if(!response.ok)throw new Error('资料无法载入');
    state.data=await response.json();
    const stored=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
    state.size=stored.size===3?3:6; $('#team-size').value=state.size;
    state.team=Array.isArray(stored.team)?stored.team.filter(id=>getSpirit(id)).slice(0,state.size):[];
    state.opponents=Array.isArray(stored.opponents)?stored.opponents.filter(id=>getSpirit(id)).slice(0,state.size):[];
    $('#data-tag').textContent=`${state.data.spirits.length} 条精灵资料 · 2026.09`;
    attachPicker('team');attachPicker('opponent');render();
  } catch(error) {announce('精灵资料加载失败，请刷新页面重试。',true);return;}
}
document.addEventListener('click',event=>{
  const remove=event.target.closest('.remove-button');
  if(remove){const ids=remove.dataset.kind==='team'?state.team:state.opponents;ids.splice(Number(remove.dataset.index),1);save();render()}
  const cell=event.target.closest('.cell-button');
  if(cell){state.selected={o:cell.dataset.o,f:cell.dataset.f};renderMatch();document.querySelector(`.cell-button[data-o="${cell.dataset.o}"][data-f="${cell.dataset.f}"]`)?.focus()}
  if(!event.target.closest('.picker'))document.querySelectorAll('.search-results').forEach(el=>el.hidden=true);
});
$('#tab-team').addEventListener('click',()=>setTab('team'));
$('#tab-match').addEventListener('click',()=>setTab('match'));
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
