import { readResponseTextCapped } from '../providers/common/http.js';
import { mkdir,writeFile,rename } from 'node:fs/promises';
import path from 'node:path';
import { normalizeAircraft, normalizeLocalAircraft, normalizeVessels, parseCatalog, satelliteTracks, mergeTracks, selectTracks, freshness, parseLocalAisUrl } from './tracks.js';

/** A single server-owned polling/cache instance. Browsers never choose upstream URLs. */
export function createTracker({baseUrl, fetchImpl = fetch, now = Date.now, aisUrl = process.env.AIS_CATCHER_URL, cacheDirectory=null} = {}) {
  let localAis=null,aisConfigError=null;
  try{localAis=aisUrl?parseLocalAisUrl(aisUrl).href:null;}catch{aisConfigError='Invalid AIS_CATCHER_URL; private IPv4 /geojson required';}
  const feeds = {
    aircraft: {interval:120000, url:'/api/flights', source:'OpenSky Network', rows:[]},
    localAircraft: {interval:process.env.LOCAL_RECEIVER_FEEDS?5000:300000, url:'/api/local-receivers/aircraft', source:'Local readsb/tar1090', rows:[]},
    vessels: {interval:localAis||process.env.AISSTREAM_API_KEY?15000:300000, url:localAis||'/api/vessels', source:aisUrl?'AIS-catcher':'AISStream', rows:[],...(aisConfigError?{disabled:true,status:'invalid',error:aisConfigError}:{})},
    satellites: {interval:6*3600000, url:'/api/celestrak/active', source:'CelesTrak', rows:[]},
  };
  let catalog=[], predicted=[], predictedAt=0, disposed=false;
  async function refreshFeed(key, force) {
    const f=feeds[key], t=now();
    if(disposed || f.disabled || f.pending || !force&&t<(f.nextAttemptAt||0)) return f.pending;
    f.lastAttemptAt=t;
    f.pending=(async()=>{
      try {
        const signal=AbortSignal.timeout(25000);
        let r=await fetchImpl(new URL(f.url,baseUrl),{signal,redirect:'error',headers:{Accept:key==='satellites'?'text/plain':'application/json'}});
        let body=await readResponseTextCapped(r,16*1024*1024,signal);
        f.partialCatalog=false;
        if(key==='satellites'&&!r.ok){
          // A bulk-group denial must not erase the separately available stations feed.
          const fallbackSignal=AbortSignal.timeout(15000);
          r=await fetchImpl(new URL('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle'),{signal:fallbackSignal,redirect:'error',headers:{Accept:'text/plain','User-Agent':'Home-World-Tracker/1.0'}});
          body=await readResponseTextCapped(r,16*1024*1024,fallbackSignal);f.partialCatalog=true;
          if(r.ok&&parseCatalog(body).length&&cacheDirectory){
            try{await mkdir(cacheDirectory,{recursive:true});const target=path.join(cacheDirectory,'celestrak-stations.json'),tmp=target+'.network-tmp';await writeFile(tmp,JSON.stringify({at:now(),body}));await rename(tmp,target);}catch{/* prediction still works if durable cache is unavailable */}
          }
        }
        let data;
        if(key!=='satellites') { try{data=JSON.parse(body);}catch{throw new Error('invalid payload');} }
        if(!r.ok) {f.status=data?.status==='missing-key'?'unconfigured':'unavailable';throw new Error(`HTTP ${r.status}`);}
        if(key==='satellites') {
          const next=parseCatalog(body);if(!next.length)throw new Error('empty orbital catalog');catalog=next;predictedAt=0;
          f.status=f.partialCatalog?'partial-catalog':'predicted';f.count=catalog.length;f.source=f.partialCatalog?'CelesTrak · stations fallback':'CelesTrak · active catalog';
        } else if(key==='aircraft') {
          if(!Array.isArray(data.states))throw new Error('invalid aircraft payload');
          f.source=r.headers.get('X-Feed-Source')||f.source;
          f.rows=normalizeAircraft(data,f.source,t);
          f.status=r.headers.get('X-OpenSky-Stale')?'stale':f.rows.some(x=>x.freshness==='live')?'live':'stale';
        } else if(key==='localAircraft') {
          f.rows=normalizeLocalAircraft(data,t);f.status=data.configured?(f.rows.length?'live':data.feeds?.some(x=>x.status==='unreachable')?'unavailable':'waiting'):'unconfigured';
        } else {
          if(!Array.isArray(data.features)&&!Array.isArray(data.rows))throw new Error('invalid vessel payload');
          f.rows=normalizeVessels(data,f.source,t);
          f.status=localAis?(f.rows.length?'live':'waiting'):(data.status||'waiting');
        }
        f.lastSuccessAt=t;f.error=null;f.failures=0;
      } catch(e) {
        f.status=f.status==='unconfigured'?'unconfigured':f.rows.length||key==='satellites'&&catalog.length?'stale':'unavailable';
        f.error=String(e.message).slice(0,100);f.failures=(f.failures||0)+1;
      } finally {
        f.rows=f.rows.filter(r=>!Number.isFinite(r.observedAt)||now()-r.observedAt<1800000);
        f.nextAttemptAt=now()+(f.failures?Math.min(1800000,Math.max(key==='satellites'?600000:f.interval,15000)*2**Math.min(f.failures-1,4)):f.interval);
        f.pending=null;
      }
    })();
    return f.pending;
  }
  async function refresh(force=false) { await Promise.all(Object.keys(feeds).map(key=>refreshFeed(key,force))); }
  function retained(rows) {return rows.filter(r=>now()-(r.observedAt??r.receivedAt)<1800000).map(r=>({...r,freshness:freshness(r.observedAt,now())}));}
  function dataStatus(f) {
    if(['unconfigured','invalid','unavailable'].includes(f.status))return f.status;
    const rows=retained(f.rows);
    if(rows.length)return rows.some(r=>r.freshness==='live')?'live':rows.some(r=>r.freshness==='stale')?'stale':'unknown-position-time';
    return f.rows.length?'stale':f.status||'starting';
  }
  function status() {
    const t=now();
    return {schemaVersion:1,service:'home-world-tracker',generatedAt:t,coverage:'Available public and configured receiver feeds; not universal tracking',prediction:'Satellites are SGP4 predictions, not live telemetry',feeds:Object.fromEntries(Object.entries(feeds).map(([key,f])=>[key,{
      source:f.source,status:key==='satellites'?(f.status||'starting'):dataStatus(f),count:key==='satellites'?catalog.length:retained(f.rows).length,
      lastAttemptAt:f.lastAttemptAt||null,lastSuccessAt:f.lastSuccessAt||null,nextAttemptAt:f.nextAttemptAt||null,error:f.error||null,
      intervalMs:f.interval,coverage:key==='localAircraft'?'regional receiver':key==='vessels'?(localAis?'regional AIS-catcher receiver':'AISStream coverage only'):'provider coverage only',
    }]))};
  }
  function aircraft() {
    return retained(mergeTracks(feeds.aircraft.rows,feeds.localAircraft.rows));
  }
  function query(params={}) {
    let sats=[];
    if(!params.kind||params.kind==='all'||params.kind==='satellite') {
      if(!predictedAt||now()-predictedAt>=15000) {predicted=satelliteTracks(catalog,now());predictedAt=now();}
      sats=predicted;
    }
    const ships=retained(feeds.vessels.rows);
    return {schemaVersion:1,generatedAt:now(),...selectTracks([...aircraft(),...ships,...sats],params)};
  }
  function vesselPayload() {
    const f=feeds.vessels;
    return {source:f.source,status:dataStatus(f),error:f.error||null,refreshing:dataStatus(f)!=='live',rows:retained(f.rows).map(r=>({mmsi:r.reference,name:r.name,lat:r.lat,lon:r.lon,speed:r.speedMps===null?null:r.speedMps/.514444,course:r.headingDeg,last_position_epoch:r.observedAt===null?null:r.observedAt/1000,last_position_UTC:r.observedAt===null?'':new Date(r.observedAt).toISOString()}))};
  }
  return {refresh,status,query,aircraft,vesselPayload,hasLocalAis:Boolean(aisUrl),dispose(){disposed=true;}};
}
