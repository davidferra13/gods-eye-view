import {MajorEventPolicy} from './network-event-policy.js';
export function mountPlanetaryEvents({windowRef,document,frame,origin,storage,makeView,now=Date.now,isTracking=()=>false,onNavigate=()=>{}}){
  const policy=new MajorEventPolicy({storage,now}),el=id=>document.getElementById(id);
  let sequence=0,requestId=null,snapshot=null,previous=null,pending=null,disposed=false,manualUntil=-Infinity,ready=false,note='';
  const pointers=new Set();
  const manual=()=>{manualUntil=now()+120000;};
  const down=e=>{pointers.add(e.pointerId??0);manual();};
  const up=e=>{pointers.delete(e.pointerId??0);manual();};
  const recover=()=>{pointers.clear();manual();};
  const priorAuthority=windowRef.gevPlanetaryCanAutoFocus;
  const authority=()=>!disposed&&!document.hidden&&!policy.paused&&!isTracking()&&pointers.size===0&&now()>=manualUntil;
  windowRef.gevPlanetaryCanAutoFocus=authority;
  const post=data=>frame.contentWindow?.postMessage?.(data,origin);
  function render(){
    el('planetary-pause').textContent=policy.paused?'Resume automatic focus':'Pause automatic focus';el('planetary-pause').setAttribute('aria-pressed',String(policy.paused));
    el('planetary-status').textContent=note||(!policy.available?'USGS snapshot unavailable or stale':policy.paused?'Automatic focus paused':'USGS M6+ watch · fresh events only');
    const row=policy.current[0];el('planetary-event').textContent=row?`M${row.magnitude.toFixed(1)} · ${row.place||row.id} · ${new Date(row.timeMs).toISOString()}`:'No fresh M6+ event in the current snapshot';
    el('planetary-focus').disabled=!policy.available||!row||!snapshot?.camera||Boolean(pending);el('planetary-return').disabled=!previous||Boolean(pending);
  }
  function move(row,automatic){
    if(!snapshot?.camera||pending||!policy.available||document.hidden)return false;
    try{
      const view=makeView({camera:{lat:row.lat,lon:row.lon,altitude_m:1500000},layers:[...new Set([...snapshot.layers,'earthquakes'])]});
      pending={id:`planetary-view-${++sequence}`,returning:false,rowId:row.id,sentAt:now()};onNavigate();post({type:'gev:view',id:pending.id,view,automatic,planetary:true});note='Requesting earthquake focus';render();return true;
    }catch{note='Globe camera unavailable';render();return false;}
  }
  function unknown(){if(pending?.rowId)policy.acknowledge(pending.rowId,false);pending=null;policy.setPaused(true);note='Focus acknowledgment unavailable; automatic focus paused';}
  function request(){if(disposed||document.hidden)return;if(pending&&now()-pending.sentAt>10000)unknown();render();requestId=`planetary-snapshot-${++sequence}`;post({type:'gev:planetary-request',id:requestId});}
  const onMessage=event=>{
    if(disposed||event.source!==frame.contentWindow||event.origin!==origin)return;
    const data=event.data;
    if(data?.type==='gev:planetary-interaction'){manual();return;}
    if(data?.type==='gev:ready'){ready=true;request();return;}
    if(data?.type==='gev:view-applied'&&pending&&data.id===pending.id){
      if(pending.rowId)policy.acknowledge(pending.rowId,data.ok===true);
      if(data.ok){if(pending.returning)previous=null;else if(!previous&&data.previousView?.camera){try{previous=makeView(data.previousView);}catch{}}note='';}
      else if(data.authorityDenied){manual();note='Automatic focus deferred during manual control';}
      else{policy.setPaused(true);note='Focus could not be fully applied; automatic focus paused';}
      pending=null;render();return;
    }
    if(data?.type!=='gev:planetary-snapshot'||data.id!==requestId)return;
    snapshot=data;ready=true;note='';policy.ingest(data);
    const row=policy.next({hidden:document.hidden,tracking:isTracking(),manual:pointers.size>0||now()<manualUntil,ready:ready&&Boolean(snapshot.camera)&&!pending});if(row)move(row,true);render();
  };
  const onLoad=()=>{if(pending)unknown();ready=false;snapshot=null;request();};
  windowRef.addEventListener('message',onMessage);frame.addEventListener?.('load',onLoad);
  document.addEventListener('pointerdown',down,true);for(const type of ['pointerup','pointercancel'])document.addEventListener(type,up,true);for(const type of ['wheel','keydown'])document.addEventListener(type,manual,true);for(const type of ['blur','pagehide','lostpointercapture'])windowRef.addEventListener(type,recover,true);
  el('planetary-pause').onclick=()=>{manual();policy.setPaused(!policy.paused);render();};
  el('planetary-focus').onclick=()=>{manual();const row=policy.current[0];if(row)move(row,false);};
  el('planetary-return').onclick=()=>{if(!previous||pending)return;manual();pending={id:`planetary-return-${++sequence}`,returning:true,sentAt:now()};onNavigate();post({type:'gev:view',id:pending.id,view:previous,automatic:false,planetary:true});render();};
  render();
  return {request,resume(){manual();request();},dispose(){disposed=true;if(windowRef.gevPlanetaryCanAutoFocus===authority){if(priorAuthority===undefined)delete windowRef.gevPlanetaryCanAutoFocus;else windowRef.gevPlanetaryCanAutoFocus=priorAuthority;}windowRef.removeEventListener('message',onMessage);frame.removeEventListener?.('load',onLoad);document.removeEventListener('pointerdown',down,true);for(const type of ['pointerup','pointercancel'])document.removeEventListener(type,up,true);for(const type of ['wheel','keydown'])document.removeEventListener(type,manual,true);for(const type of ['blur','pagehide','lostpointercapture'])windowRef.removeEventListener(type,recover,true);pointers.clear();for(const id of ['planetary-pause','planetary-focus','planetary-return'])el(id).onclick=null;}};
}
