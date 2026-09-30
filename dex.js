(function(root) {
  let data, dex, selected, limit=30;
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const href=v=>/^https:\/\//.test(v||'')?esc(v):'#';
  const kitOf=id=>dex?.learnsets[dex.pets[id]?.learnset];
  const entries=kit=>[
    ...(kit.native_skills||[]).map(s=>({...s,method:`升级 · Lv.${s.level}`})),
    ...(kit.blood_skills||[]).map(s=>({...s,method:`${s.blood}系血脉 · Lv.${s.level}`})),
    ...(kit.skill_stones||[]).map(skill=>({skill,method:'技能石'})),
    ...(kit.legendary?[{...kit.legendary,method:`传说技能 · 需${kit.legendary.requires}`}]:[])
  ];
  function renderList() {
    if(!data||!dex)return;
    const q=$('#dex-search').value.trim().toLowerCase();
    const hits=data.spirits.filter(s=>{
      const pet=dex.pets[s.id],kit=kitOf(s.id),feature=dex.skills[pet?.feature];
      return !q||[s.name,s.no,...s.types,s.trait,feature?.desc,...(kit?entries(kit).map(e=>dex.skills[e.skill]?.name):[])].some(v=>String(v||'').toLowerCase().includes(q));
    });
    $('#dex-count').textContent=`找到 ${hits.length} 条精灵／形态资料 · 显示 ${Math.min(limit,hits.length)} 条`;
    $('#dex-results').innerHTML=hits.slice(0,limit).map(s=>`<button type="button" class="dex-choice${selected===s.id?' selected':''}" data-spirit="${esc(s.id)}" aria-pressed="${selected===s.id}"><strong>${esc(s.name)}</strong><span>No.${esc(s.no)} · ${esc(s.types.join(' / '))} · ${esc(s.trait)}</span>${!dex.pets[s.id]?'<small>技能池待补充</small>':''}</button>`).join('')||'<p class="empty">没有找到匹配资料。</p>';
    $('#dex-more').hidden=hits.length<=limit;
  }
  function table(rows) {
    return rows.length?`<div class="dex-table-wrap"><table class="dex-table"><thead><tr><th>技能／途径</th><th>属性与数值</th><th>效果</th></tr></thead><tbody>${rows.map(row=>{
      const s=dex.skills[row.skill];
      return `<tr><td><b>${esc(s.name)}</b><small>${esc(row.method)}</small></td><td>${esc(s.element||'无系别')} · ${esc(s.damageClass||s.category)}<small>能耗 ${esc(s.energy)}${s.category==='攻击'?` · 威力 ${esc(s.power)}${s.hits>1?' ×'+s.hits:''}`:''}</small></td><td>${esc(s.desc||'来源暂无说明')}</td></tr>`;
    }).join('')}</tbody></table></div>`:'<p class="card-meta">来源未列出此类技能。</p>';
  }
  function renderDetail() {
    if(!data||!dex||!selected)return;
    const s=data.spirits.find(x=>x.id===selected);if(!s)return;
    const pet=dex.pets[s.id],kit=kitOf(s.id),feature=dex.skills[pet?.feature];
    const stats=Object.entries({hp:'生命',pa:'物攻',ma:'魔攻',pd:'物防',md:'魔防',sp:'速度'}).map(([k,label])=>`<span>${label}<b>${s.stats[k]}</b></span>`).join('');
    let html=`<h2>${esc(s.name)}</h2><p class="card-meta">No.${esc(s.no)} · ${esc(s.types.join(' / '))}${s.form?' · '+esc(s.form):''}</p><div class="dex-stats">${stats}</div><h3>特性 · ${esc(feature?.name||s.trait)}</h3><p>${esc(feature?.desc||'该形态的特性说明尚未找到可核对来源。')}</p>`;
    if(!pet||!kit){$('#dex-detail').innerHTML=html+'<p class="empty">此形态暂未和来源资料准确对应，未套用其他形态的技能池。</p>';return;}
    const rows=entries(kit),groups=[['升级技能',rows.filter(r=>r.method.startsWith('升级'))],['血脉技能',rows.filter(r=>r.blood)],['技能石',rows.filter(r=>r.method==='技能石')],['传说技能',rows.filter(r=>r.requires)]];
    html+=`<p class="provenance-note">以下是可学习范围。血脉技能需满足对应血脉条件，技能池不等于实战携带的四个技能，也不代表推荐配招。</p>`;
    html+=groups.filter(([name,rows])=>name!=='传说技能'||rows.length).map(([name,rows],i)=>`<details class="dex-group"${i===0?' open':''}><summary>${name}（${rows.length} 项）</summary>${table(rows)}</details>`).join('');
    html+=`<p class="card-meta">来源：<a href="${href(dex.source.url)}" target="_blank" rel="noopener noreferrer">${esc(dex.source.name)}</a> · 技能池修订 ${esc(dex.source.modules.Learnsets.revised.slice(0,10))} · 技能说明修订 ${esc(dex.source.modules.Skills.revised.slice(0,10))}</p>`;
    $('#dex-detail').innerHTML=html;
  }
  function show(id) {selected=id;renderList();renderDetail();}
  async function mount(spiritData) {
    data=spiritData;
    $('#dex-search').addEventListener('input',()=>{limit=30;renderList();});
    $('#dex-more').addEventListener('click',()=>{limit+=30;renderList();});
    $('#dex-results').addEventListener('click',event=>{const b=event.target.closest('[data-spirit]');if(b){show(b.dataset.spirit);$('#dex-detail').scrollIntoView({behavior:'smooth',block:'start'});}});
    try {
      const r=await fetch('./dex.json');if(!r.ok)throw new Error('unavailable');
      dex=await r.json();if(dex.schema!==1||!dex.pets||!dex.skills||!dex.learnsets)throw new Error('schema');
      const values=Object.values(dex.skills),count=values.filter(s=>s.category!=='特性').length,traits=values.length-count;
      const {coverage:c}=dex;
      $('#dex-coverage').innerHTML=`<p><strong>${c.linked} / ${c.total}</strong> 条精灵／形态已接入技能池 · <strong>${count}</strong> 个战斗技能 · <strong>${traits}</strong> 项特性</p><p class="card-meta">资料来自 <a href="${href(dex.source.url)}" target="_blank" rel="noopener noreferrer">${esc(dex.source.name)}</a>，精灵目录修订于 ${esc(dex.source.modules.Catalog.revised.slice(0,10))}。${c.missing.length?'尚缺：'+esc(c.missing.join('、'))+'。':''}</p>${c.upcoming.length?`<details><summary>来源中另有 ${c.upcoming.length} 条待上线记录</summary><p class="card-meta">${c.upcoming.map(s=>esc(s.name)+'（'+esc(s.date)+'）').join('、')}。到期刷新后才加入可选精灵。</p></details>`:''}`;
      renderList();renderDetail();
    } catch(e) {dex=null;$('#dex-coverage').textContent='图鉴资料暂时未能加载，请刷新重试。配队功能仍可使用。';}
  }
  root.RocoDex={mount,show};
})(globalThis);
