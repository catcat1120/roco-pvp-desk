#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const {buildScout}=require('./scout-lib');
const root=path.join(__dirname,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const now=new Date().toISOString().slice(0,10);
const result=buildScout({sources:read('lineup-sources.json'),data:read('data.json'),season:read('season.json'),now});
const target=path.join(root,'scout.json');
if(fs.existsSync(target)) {
  const old=JSON.parse(fs.readFileSync(target,'utf8'));
  const content=({updatedAt,...rest})=>rest;
  if(JSON.stringify(content(old))===JSON.stringify(content(result)))result.updatedAt=old.updatedAt;
}
const text=JSON.stringify(result)+'\n';
if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==text)fs.writeFileSync(target,text);
console.log(`当季线索 ${result.leads.length} 条；经完整阵容和独立作者核实的热门配队 ${result.confirmed.length} 套`);
