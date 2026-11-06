import { createView,viewUrl } from '/src/view/index.js';
import { createWorldTrackerClient } from './world-tracker-client.js';
import { mountLocalPreferences } from './network-preference-controls.js';
import { mountPlanetaryEvents } from './network-planetary.js';
const api=createWorldTrackerClient(),$=id=>document.getElementById(id),frame=$('globe');
const layers=['flights','vessels','satellites','earthquakes'];
$('native-weather').href=viewUrl(location.origin+'/',createView({camera:{lat:25,lon:-35,altitude_m:18000000},layers:[...layers,'wind'],map:'esri-imagery',style:'normal'}));
frame.src=viewUrl(location.origin+'/?embed=1',createView({camera:{lat:25,lon:-35,altitude_m:18000000},layers,map:'esri-imagery',style:'normal'}));
let queryAbort,healthBusy=false,searchBusy=false,debounce,selected=null,disposed=false,pins=[];
let preferenceStorage;try{preferenceStorage=localStorage;}catch{}
const learning=mountLocalPreferences({document,storage:preferenceStorage,onSuggested:kind=>{
  $('kind').value=kind;learning.capture(kind,'selection');learning.setActive(kind);selected=null;$('selection').hidden=true;
  frame.src=viewUrl(location.origin+'/?embed=1',createView({camera:{lat:25,lon:-35,altitude_m:18000000},layers:[{aircraft:'flights',vessel:'vessels',satellite:'satellites'}[kind],'earthquakes'],map:'esri-imagery',style:'normal'}));
  void search();
}});
const planetary=mountPlanetaryEvents({windowRef:window,document,frame,origin:location.origin,storage:preferenceStorage,makeView:createView,isTracking:()=>Boolean(selected),onNavigate:()=>{selected=null;$('selection').hidden=true;learning.setActive(null);}});
try{pins=JSON.parse(localStorage.getItem('homeWorldWatchlist')||'[]').filter(p=>typeof p.id==='string').slice(0,25);}catch{}
const fmt=n=>new Intl.NumberFormat().format(n||0);
const age=at=>!Number.isFinite(at)?'time unknown':Math.max(0,Math.round((Date.now()-at)/1000))<60?`${Math.max(0,Math.round((Date.now()-at)/1000))}s ago`:`${Math.round((Date.now()-at)/60000)}m ago`;
function element(tag,cls,value){const el=document.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=value;return el;}
function focus(row){
  selected=row;learning.capture(row.kind,'focus');learning.setActive(row.kind);
  const follow=['aircraft','satellite'].includes(row.kind)?{kind:row.kind,id:row.reference}:null;
  frame.src=viewUrl(location.origin+'/?embed=1',createView({camera:{lat:row.lat,lon:row.lon,altitude_m:row.kind==='satellite'?Math.max(2000000,row.altitudeM*3):200000},layers,map:'esri-imagery',style:'normal',follow}));
  showSelection(row);
  if(innerWidth<800)setPanel(false);
}
function showSelection(row){$('selection').hidden=false;$('selection').textContent=`${row.name} · ${row.source} · ${row.positionKind==='predicted'?`Predicted position; orbital elements ${age(row.orbitEpoch)}`:`${row.freshness}; reported ${age(row.observedAt)}`}`;}
async function resolveFocus(id,kind){
  try{const data=await api.search({q:id,kind,limit:20});const row=data.items.find(r=>r.id===id);if(row)focus(row);else{$('search-status').textContent='No current position for this identity in connected feeds.';setPanel(true);}}
  catch{$('search-status').textContent='Tracking layer unavailable; retry shortly.';setPanel(true);}
}
function setPanel(open){$('panel').hidden=!open;$('toggle-panel').setAttribute('aria-expanded',String(open));document.body.classList.toggle('panel-hidden',!open);}
$('toggle-panel').onclick=()=>setPanel($('panel').hidden);
function savePins(){try{localStorage.setItem('homeWorldWatchlist',JSON.stringify(pins));}catch{}renderPins();}
function renderPins(){
  const root=$('pins');root.replaceChildren();
  if(!pins.length){root.append(element('p','empty','Pin a result to keep its identity here.'));return;}
  for(const p of pins){const row=element('div','pin-row'),go=element('button','',p.name),remove=element('button','','×');go.type=remove.type='button';remove.setAttribute('aria-label',`Remove ${p.name}`);
    go.onclick=()=>resolveFocus(p.id,p.kind);
    remove.onclick=()=>{pins=pins.filter(x=>x.id!==p.id);savePins();};row.append(go,remove);root.append(row);}
}
async function search(background=false){
  if(background&&searchBusy)return;
  searchBusy=true;
  queryAbort?.abort();queryAbort=new AbortController();
  const q=$('query').value.trim(),kind=$('kind').value;
  if(!background)$('search-status').textContent='Searching connected feeds…';
  try{const data=await api.search({q,kind,limit:40},queryAbort.signal);if(disposed)return;
    if(!background&&q&&data.items.length){const domain=kind==='all'&&data.items.every(r=>r.kind===data.items[0].kind)?data.items[0].kind:kind;learning.capture(domain,'search');}
    $('results').replaceChildren();$('search-status').textContent=data.total?`${fmt(data.total)} matches${data.total>40?' · showing 40; narrow your search':''}`:'No matching position in connected feeds. Try an exact identifier or check source health.';
    for(const r of data.items){const item=element('div','result'),go=element('button'),pin=element('button','pin',pins.some(p=>p.id===r.id)?'★':'☆');go.type=pin.type='button';pin.setAttribute('aria-label',`Pin ${r.name}`);
      go.append(element('span','tag'+(r.freshness==='stale'?' stale':''),`${r.kind} / ${r.freshness}`),element('strong','',r.name),element('small','',`${r.reference} · ${r.positionKind==='predicted'?'Predicted · TLE '+age(r.orbitEpoch):age(r.observedAt)}`));
      go.onclick=()=>resolveFocus(r.id,r.kind);pin.onclick=()=>{if(pins.some(p=>p.id===r.id))pins=pins.filter(p=>p.id!==r.id);else if(pins.length<25)pins.push({id:r.id,name:r.name,kind:r.kind});savePins();pin.textContent=pins.some(p=>p.id===r.id)?'★':'☆';};item.append(go,pin);$('results').append(item);}
  }catch(e){if(e.name!=='AbortError'){$('search-status').textContent='Tracking layer unavailable; last displayed results may be stale.';for(const badge of $('results').querySelectorAll('.tag'))badge.textContent=badge.textContent.split('/')[0]+'/ freshness unavailable';}}finally{searchBusy=false;}
}
async function health(){
  if(healthBusy||disposed)return;healthBusy=true;
  planetary.request();
  try{const data=await api.status();$('feeds').replaceChildren();
    for(const [key,f] of Object.entries(data.feeds)){const root=element('div','feed'),line=element('div','feed-line'),name=element('span','feed-name');name.append(element('i','dot '+f.status),document.createTextNode(({aircraft:'Aircraft',localAircraft:'Local receiver',vessels:'Vessels',satellites:'Orbital catalog'})[key]||key));line.append(name,element('span','feed-count',fmt(f.count)));root.append(line,element('small','',`${f.source} · ${f.status}${f.lastSuccessAt?' · request '+age(f.lastSuccessAt):''}`));if(Number.isFinite(f.snapshotAt))root.append(element('small','','Source snapshot '+age(f.snapshotAt)));if(f.sourceProblem)root.append(element('small','',f.sourceProblem));if(f.status==='unconfigured')root.append(element('small','','Receiver or feed credential needed'));$('feeds').append(root);}
    $('updated').textContent=new Date(data.generatedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    if(!document.hidden)void search(true);
    if(selected){const d=await api.search({q:selected.id,kind:selected.kind,limit:20});const fresh=d.items.find(r=>r.id===selected.id);if(fresh){selected=fresh;showSelection(fresh);}else $('selection').textContent=`${selected.name} · current position unavailable; map may show a last known position.`;}
  }catch{$('updated').textContent='OFFLINE';$('feeds').replaceChildren(element('p','empty','Tracking service unavailable. Cached map positions may be stale.'));if(selected)$('selection').textContent=`${selected.name} · tracking service unavailable; map may show a last known position.`;}finally{learning.tick();healthBusy=false;}
}
$('search-form').onsubmit=e=>{e.preventDefault();clearTimeout(debounce);void search();};$('kind').onchange=()=>{learning.capture($('kind').value,'selection');void search();};$('query').oninput=()=>{clearTimeout(debounce);debounce=setTimeout(search,350);};
renderPins();void health();const healthTimer=setInterval(health,15000);const clockTimer=setInterval(()=>{$('clock').textContent=new Date().toISOString().slice(11,19)+' UTC';},1000);
window.addEventListener('pagehide',event=>{clearTimeout(debounce);queryAbort?.abort();if(event.persisted)return;disposed=true;learning.dispose();planetary.dispose();clearInterval(healthTimer);clearInterval(clockTimer);});
window.addEventListener('pageshow',event=>{if(event.persisted&&!disposed){learning.resume();planetary.resume();void health();}});
