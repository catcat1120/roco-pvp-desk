#!/usr/bin/env node
// One public MediaWiki request; retry with backoff, never bypass a challenge.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildDex } = require('./dex-lib');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name)+1] : null;
const MODULES = ['Catalog', 'Learnsets', 'Skills'];
async function main() {
  let response;
  if (option('--from-cache')) response = JSON.parse(fs.readFileSync(option('--from-cache'), 'utf8'));
  else {
    const params = new URLSearchParams({action:'query',format:'json',prop:'revisions',rvprop:'content|timestamp',rvslots:'main',titles:MODULES.map(x=>'模块:Pets/data/'+x).join('|')});
    for (let attempt=0; attempt<4; attempt++) {
      try {
        const url='https://wiki.biligame.com/nrc/api.php?'+params;
        try {
          const r=await fetch(url, {headers:{'user-agent':'roco-pvp-desk/1.0 (+https://github.com/catcat1120/roco-pvp-desk; non-commercial fan tool)'},signal:AbortSignal.timeout(45000)});
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          response=await r.json();
        } catch(error) {
          if(error.cause?.code!=='SELF_SIGNED_CERT_IN_CHAIN')throw error;
          // Some local macOS networks use a trusted system proxy CA not known to Node.
          // curl uses the OS trust store; never disable certificate verification.
          response=JSON.parse(execFileSync('curl',['--fail','--silent','--show-error','--location','--max-time','45','--user-agent','roco-pvp-desk/1.0 (+https://github.com/catcat1120/roco-pvp-desk; non-commercial fan tool)',url],{encoding:'utf8',maxBuffer:20*1024*1024}));
        }
        if (response.error) throw new Error(response.error.code);
        break;
      } catch(e) {
        if(attempt===3) throw e;
        console.error(`图鉴请求失败（${e.message}），退避重试`);
        await new Promise(resolve=>setTimeout(resolve,[8000,30000,90000][attempt]));
      }
    }
    if (option('--cache')) fs.writeFileSync(option('--cache'),JSON.stringify(response));
  }
  const pages=Object.values(response.query.pages);
  const modules=Object.fromEntries(MODULES.map(name=>{
    const page=pages.find(p=>p.title==='模块:Pets/data/'+name);
    if(!page?.revisions?.[0]?.slots?.main?.['*']) throw new Error(`缺少 ${name} 模块`);
    return [name,{text:page.revisions[0].slots.main['*'],revised:page.revisions[0].timestamp}];
  }));
  const data=JSON.parse(fs.readFileSync(path.join(ROOT,'data.json'),'utf8'));
  const source={name:'洛克王国世界 BWIKI',url:'https://wiki.biligame.com/nrc/精灵图鉴',modules:Object.fromEntries(MODULES.map(name=>[name,{url:'https://wiki.biligame.com/nrc/'+encodeURIComponent('模块:Pets/data/'+name),revised:modules[name].revised}]))};
  const result=buildDex({data,catalogLua:modules.Catalog.text,learnsetsLua:modules.Learnsets.text,skillsLua:modules.Skills.text,source,today:new Date().toISOString().slice(0,10)});
  const previousPath=path.join(ROOT,'dex.json');
  if(fs.existsSync(previousPath)) {
    const old=JSON.parse(fs.readFileSync(previousPath,'utf8'));
    for(const name of MODULES) if(old.source.modules[name].revised>source.modules[name].revised) throw new Error(`来源 ${name} 版本倒退，拒绝覆盖`);
    if(Object.keys(result.dex.skills).length<Object.keys(old.skills).length*.9) throw new Error('技能数量骤减，拒绝覆盖');
  }
  // Validate all references before touching either output. Content-only output makes repeat refreshes idempotent.
  for(const [file,value] of [['data.json',result.data],['dex.json',result.dex]]) {
    const target=path.join(ROOT,file),text=JSON.stringify(value)+'\n';
    if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==text)fs.writeFileSync(target,text);
  }
  console.log(JSON.stringify({coverage:result.dex.coverage,...result.report},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
