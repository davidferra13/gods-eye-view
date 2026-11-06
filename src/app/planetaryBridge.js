/** Same-origin read seam for the earthquake layer's existing in-memory snapshot. */
export function installPlanetaryBridge({windowRef,peer,origin,viewer,dataManager,now=Date.now}){
  let lastInteraction=-Infinity,disposed=false;const pointers=new Set();const allowed=typeof origin==='string'&&/^https?:\/\//.test(origin);
  const post=data=>{if(!disposed&&allowed&&peer?.postMessage)peer.postMessage(data,origin);};
  const interact=()=>{lastInteraction=now();post({type:'gev:planetary-interaction'});};
  const down=event=>{pointers.add(event.pointerId??0);interact();};
  const up=event=>{pointers.delete(event.pointerId??0);interact();};
  function capture(){
    const c=viewer.camera?.positionCartographic;let camera=null;
    if(c&&[c.latitude,c.longitude,c.height].every(Number.isFinite)&&Math.abs(c.latitude)<=Math.PI/2&&Math.abs(c.longitude)<=Math.PI&&c.height>=0)camera={lat:c.latitude*180/Math.PI,lon:c.longitude*180/Math.PI,altitude_m:Math.max(100,c.height),heading_deg:Number.isFinite(viewer.camera.heading)?viewer.camera.heading*180/Math.PI:0,pitch_deg:Number.isFinite(viewer.camera.pitch)?viewer.camera.pitch*180/Math.PI:-90};
    return {camera,layers:dataManager.getAll().filter(l=>l.enabled&&typeof l.id==='string'&&/^[a-z0-9-]{1,80}$/.test(l.id)).slice(0,64).map(l=>l.id)};
  }
  const recover=()=>{pointers.clear();interact();};
  const onMessage=event=>{
    if(disposed||!allowed||event.source!==peer||event.origin!==origin||event.data?.type!=='gev:planetary-request'||typeof event.data.id!=='string'||event.data.id.length>120)return;
    const layers=dataManager.getAll(),layer=layers.find(l=>l.id==='earthquakes');let rows=[],stats={};
    try{if(layer?.enabled){rows=layer.getAnalystRecords(2048).slice(0,2048).map(r=>({id:r.id,magnitude:r.magnitude,lat:r.lat,lon:r.lon,timeMs:r.timeMs,place:typeof r.place==='string'?r.place.slice(0,160):null}));stats=layer.getStats();}}catch{stats={error:true};}
    const camera=capture().camera;
    post({type:'gev:planetary-snapshot',id:event.data.id,schemaVersion:1,source:'USGS',capturedAt:now(),updatedAt:stats.lastUpdate??null,error:Boolean(stats.error),rows,camera,layers:layers.filter(l=>l.enabled&&typeof l.id==='string'&&/^[a-z0-9-]{1,80}$/.test(l.id)).slice(0,64).map(l=>l.id)});
  };
  windowRef.addEventListener('message',onMessage);for(const type of ['blur','pagehide','lostpointercapture'])windowRef.addEventListener(type,recover,true);windowRef.addEventListener('pointerdown',down,true);windowRef.addEventListener('pointerup',up,true);windowRef.addEventListener('pointercancel',up,true);for(const type of ['wheel','keydown'])windowRef.addEventListener(type,interact,true);
  return {capture,canAutoFocus:()=>{try{return !disposed&&allowed&&pointers.size===0&&now()-lastInteraction>=120000&&peer?.gevPlanetaryCanAutoFocus?.()===true;}catch{return false;}},dispose(){disposed=true;windowRef.removeEventListener('message',onMessage);for(const type of ['blur','pagehide','lostpointercapture'])windowRef.removeEventListener(type,recover,true);windowRef.removeEventListener('pointerdown',down,true);windowRef.removeEventListener('pointerup',up,true);windowRef.removeEventListener('pointercancel',up,true);pointers.clear();for(const type of ['wheel','keydown'])windowRef.removeEventListener(type,interact,true);}};
}
