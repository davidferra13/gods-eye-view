import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {mountLocalPreferences} from '../../public/network-preference-controls.js';
import {mountPlanetaryEvents} from '../../public/network-planetary.js';
const source=fs.readFileSync(new URL('../../public/network-console.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
function fixture(){
  const elements=new Map(),storage=new Map(),intervals=new Map();let time=Date.now(),sequence=0;
  const element=()=>({hidden:false,value:'',children:[],classList:{toggle(){}},setAttribute(k,v){this[k]=v;},append(...values){this.children.push(...values);},replaceChildren(...values){this.children=values;},querySelectorAll(){return [];}});
  const document=new EventTarget();document.hidden=false;document.body=element();document.createElement=element;document.createTextNode=s=>s;document.getElementById=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  document.getElementById('kind').value='all';document.getElementById('panel').hidden=false;
  const localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
  const api={status:async()=>({feeds:{},generatedAt:time}),search:async()=>({items:[],total:0})};
  const window=new EventTarget();
  const context=vm.createContext({document,window,location:{origin:'http://fixture'},localStorage,innerWidth:1200,AbortController,Intl,Date,console,createView:v=>v,viewUrl:(base,v)=>JSON.stringify(v),createWorldTrackerClient:()=>api,mountPlanetaryEvents,mountLocalPreferences:opts=>mountLocalPreferences({...opts,now:()=>time}),setInterval:fn=>{intervals.set(++sequence,fn);return sequence;},clearInterval:id=>intervals.delete(id),setTimeout:()=>++sequence,clearTimeout(){}});
  vm.runInContext(source,context);
  return {context,document,window,api,intervals,el:id=>document.getElementById(id),advance:n=>{time+=n;},data:()=>JSON.parse(storage.get('homeWorldPreferences.v1'))};
}
const satellite={id:'satellite:25544',reference:'25544',kind:'satellite',lat:1,lon:2,altitudeM:400000,name:'ISS',source:'fixture',positionKind:'predicted'};
test('changing the search filter cannot relabel dwell over an unchanged satellite view',async()=>{
  const f=fixture();await f.context.health();f.context.focus(satellite);const prior=f.el('globe').src;f.el('kind').value='aircraft';f.el('kind').onchange();await Promise.resolve();f.advance(15000);await f.context.health();assert.equal(f.el('globe').src,prior);assert.equal(f.data().cells.find(c=>c.kind==='satellite').dwell,15);assert.equal(f.data().cells.find(c=>c.kind==='aircraft')?.dwell||0,0);
});
test('back-forward cache restoration keeps controls and refresh polling usable',async()=>{
  const f=fixture();await f.context.health();f.context.focus(satellite);f.window.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:true}));f.advance(120000);f.window.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true}));await Promise.resolve();assert.equal(typeof f.el('learning-pause').onclick,'function');assert.equal(f.intervals.size,2);f.el('learning-pause').onclick();assert.equal(f.data().enabled,false);f.window.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:false}));assert.equal(f.intervals.size,0);
});
test('zero-result explicit queries cannot train a suggested layer',async()=>{
  const f=fixture();await f.context.health();f.el('kind').value='vessel';f.el('query').value='missing ship';await f.context.search();assert.deepEqual(f.data().cells,[]);
});

test('source age and stale reason remain visible after a successful HTTP health check',async()=>{const f=fixture();await new Promise(resolve=>setImmediate(resolve));f.api.status=async()=>({generatedAt:Date.now(),feeds:{aircraft:{source:'OpenSky',status:'stale',count:0,lastSuccessAt:Date.now(),snapshotAt:Date.now()-3600000,sourceProblem:'Upstream aircraft snapshot stale'}}});await f.context.health();const text=node=>typeof node==='string'?node:[node.textContent||'',...(node.children||[]).map(text)].join(' ');const shown=text(f.el('feeds'));assert.match(shown,/Source snapshot/);assert.match(shown,/Upstream aircraft snapshot stale/);assert.match(shown,/request/);});
