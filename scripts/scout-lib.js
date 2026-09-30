const NO_USE = /使用率|胜率|对局占比/;
function buildScout({ sources, data, season, now }) {
  if(sources.schema!==1 || !Array.isArray(sources.sources))throw new Error('来源清单无效');
  const known=new Set(data.spirits.map(s=>s.name));
  const seen=new Set(),leads=[];
  for(const s of sources.sources){
    const url=new URL(s.url);
    if(url.protocol!=='https:')throw new Error(`只接受 HTTPS 来源：${s.url}`);
    url.hash='';url.search='';
    if(seen.has(url.href))continue;seen.add(url.href);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||s.date<season.season.startsOn||s.date>now)continue;
    if(!s.creator||!s.publisher||!s.theme||!s.title||NO_USE.test(s.note||''))throw new Error(`来源信息不完整：${s.url}`);
    if(!['article-text','title-only'].includes(s.evidence))throw new Error(`证据类型无效：${s.url}`);
    if(!Array.isArray(s.members)||s.members.length>6||new Set(s.members).size!==s.members.length)throw new Error(`队伍人数无效：${s.url}`);
    // Partial articles can use a base name without specifying its form; keep that ambiguity visible.
    if(s.members.length===6&&s.members.some(name=>!known.has(name)))throw new Error(`完整阵容里有无法唯一对应的精灵：${s.url}`);
    if(s.evidence==='title-only'&&s.members.length)throw new Error(`标题来源不能声称核实成员：${s.url}`);
    leads.push({url:url.href,title:s.title,date:s.date,creator:s.creator,publisher:s.publisher,theme:s.theme,evidence:s.evidence,members:s.members,note:s.note});
  }
  leads.sort((a,b)=>b.date.localeCompare(a.date)||a.url.localeCompare(b.url));
  const groups=new Map();
  for(const s of leads){
    if(s.evidence!=='article-text'||s.members.length!==6)continue;
    const key=[...s.members].sort().join('|');
    const group=groups.get(key)||{members:s.members,creators:new Set(),sources:[]};
    if(group.creators.has(s.creator))continue;
    group.creators.add(s.creator);group.sources.push(s);groups.set(key,group);
  }
  const confirmed=[...groups.values()].filter(g=>g.creators.size>=2).map(g=>({members:g.members,authors:g.creators.size,sources:g.sources.map(s=>({url:s.url,creator:s.creator,date:s.date}))})).sort((a,b)=>b.authors-a.authors);
  return {schema:1,season:season.season,updatedAt:now,method:'人工核对来源 → 完整六只 → 独立作者去重；不代表对局使用率或胜率',leads,confirmed};
}
module.exports={buildScout};
