const test=require('node:test'),assert=require('node:assert/strict');
const data=require('../data.json'),dex=require('../dex.json'),season=require('../season.json'),scout=require('../scout.json');
const {buildScout}=require('../scripts/scout-lib');

test('each linked spirit has a real feature and resolvable learnset',()=>{
  assert.equal(dex.coverage.linked,621);
  for(const spirit of data.spirits){
    const pet=dex.pets[spirit.id];if(!pet)continue;
    assert.equal(pet.wikiId,spirit.wikiId);
    assert.equal(dex.skills[pet.feature].category,'特性');
    const learnset=dex.learnsets[pet.learnset];assert.ok(learnset,spirit.name);
    for(const id of [...learnset.native_skills.map(x=>x.skill),...learnset.blood_skills.map(x=>x.skill),...learnset.skill_stones])assert.ok(dex.skills[id],`${spirit.name}: ${id}`);
  }
});

test('current scout leads disclose incomplete evidence and have no fabricated popular team',()=>{
  assert.equal(scout.season.startsOn,season.season.startsOn);
  assert.equal(scout.confirmed.length,0);
  assert.ok(scout.leads.length>0);
  for(const lead of scout.leads){assert.ok(lead.date>=season.season.startsOn);assert.ok(lead.members.length<6);}
});

test('only two distinct authors with verified six-spirit lineups produce a recommendation',()=>{
  const members=data.spirits.slice(0,6).map(s=>s.name);
  const base={title:'测试配队',date:season.season.startsOn,creator:'作者甲',publisher:'来源甲',theme:'测试',evidence:'article-text',members,note:''};
  const sources={schema:1,sources:[{...base,url:'https://example.com/one'},{...base,url:'https://example.com/two'},{...base,url:'https://example.org/three',creator:'作者乙'}]};
  const result=buildScout({sources,data,season,now:'2026-09-30'});
  assert.equal(result.confirmed.length,1);
  assert.equal(result.confirmed[0].authors,2);
  assert.equal(result.confirmed[0].sources.length,2);
  assert.throws(()=>buildScout({sources:{schema:1,sources:[{...base,url:'https://example.com/one',evidence:'title-only'}]},data,season,now:'2026-09-30'}));
});
