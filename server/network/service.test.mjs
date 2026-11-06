import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker } from './service.js';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const initial=Date.UTC(2026,10,6,12);
test('one polling owner coalesces clients, retains last good records and ages them on failure',async()=>{
  let now=initial,calls=0,fail=false;
  const fetchImpl=async url=>{calls++;await new Promise(r=>setTimeout(r,5));const p=new URL(url).pathname;
    if(fail)throw new Error('offline');
    if(p==='/api/flights')return new Response(JSON.stringify({states:[['abc123','TEST','US',initial/1000,initial/1000,-71,42,1000,false,100,90]]}),{headers:{'X-Feed-Source':'OpenSky'}});
    if(p.includes('local-receivers'))return Response.json({configured:false,records:[]});
    if(p==='/api/vessels')return Response.json({status:'missing-key',rows:[]},{status:503});
    return new Response('');
  };
  const s=createTracker({baseUrl:'http://127.0.0.1:9999',fetchImpl,now:()=>now});
  await Promise.all([s.refresh(),s.refresh(),s.refresh()]);assert.equal(calls,4);
  assert.equal(s.query({kind:'aircraft'}).items[0].freshness,'live');
  assert.equal(s.status().feeds.vessels.status,'unconfigured');
  fail=true;now+=180000;await s.refresh(true);
  assert.equal(s.query({kind:'aircraft'}).items[0].freshness,'stale');
  assert.equal(s.status().feeds.aircraft.status,'stale');
  const after=calls;await s.refresh();assert.equal(calls,after);
  now+=1800000;assert.equal(s.query({kind:'aircraft'}).items.length,0);
  s.dispose();await s.refresh(true);assert.equal(calls,after);
});
test('AIS-catcher updates the same vessel contract the globe consumes',async()=>{
  const fetchImpl=async url=>new URL(url).pathname==='/geojson'?Response.json({features:[{geometry:{type:'Point',coordinates:[-70,43]},properties:{mmsi:123456789,shipname:'Test',last_position_epoch:initial/1000,speed:10,cog:45}}]}):new Response('',{status:503});
  const s=createTracker({baseUrl:'http://127.0.0.1:9999',fetchImpl,now:()=>initial,aisUrl:'http://127.0.0.1:8100/geojson'});
  await s.refresh();assert.equal(s.vesselPayload().rows[0].mmsi,'123456789');
  assert.equal(s.vesselPayload().status,'live');assert.equal(s.query({q:'Test',kind:'vessel'}).total,1);s.dispose();
});
test('source health and native vessel payload age without a successful next poll',async()=>{
  let now=initial;
  const fetchImpl=async url=>new URL(url).pathname==='/geojson'?Response.json({features:[{geometry:{type:'Point',coordinates:[-70,43]},properties:{mmsi:123456789,shipname:'Test',last_position_epoch:initial/1000}}]}):new Response('',{status:503});
  const s=createTracker({baseUrl:'http://127.0.0.1:9999',fetchImpl,now:()=>now,aisUrl:'http://127.0.0.1:8100/geojson'});
  await s.refresh();now+=180000;assert.equal(s.status().feeds.vessels.status,'stale');assert.equal(s.vesselPayload().status,'stale');
  now+=1800000;assert.equal(s.vesselPayload().rows.length,0);s.dispose();
});
test('invalid AIS configuration is isolated and cannot disable aircraft tracking',async()=>{
  let touchedUnsafe=false;
  const fetchImpl=async url=>{const u=new URL(url);if(u.hostname==='169.254.169.254')touchedUnsafe=true;return u.pathname==='/api/flights'?Response.json({states:[['abc123','TEST','US',initial/1000,initial/1000,-71,42,1000,false,100,90]]}):new Response('',{status:503});};
  const s=createTracker({baseUrl:'http://127.0.0.1:9999',fetchImpl,now:()=>initial,aisUrl:'http://169.254.169.254/geojson'});
  await s.refresh();assert.equal(s.status().feeds.vessels.status,'invalid');assert.equal(s.query({kind:'aircraft'}).total,1);assert.equal(touchedUnsafe,false);s.dispose();
});
test('an unavailable bulk orbital catalog falls back to stations and reports partial coverage',async()=>{
  const tle='ISS (ZARYA)\n1 25544U 98067A   26309.85320381  .00006629  00000+0  12749-3 0  9998\n2 25544  51.6327 319.0560 0007195 352.5747   7.5134 15.49194530593711\n';
  const fetchImpl=async url=>new URL(url).searchParams.get('GROUP')==='stations'?new Response(tle):new Response('',{status:503});
  const s=createTracker({baseUrl:'http://127.0.0.1:9999',fetchImpl,now:()=>initial});await s.refresh();
  assert.equal(s.status().feeds.satellites.status,'partial-catalog');assert.equal(s.query({q:'ISS',kind:'satellite'}).total,1);s.dispose();
});
test('a restarted collector restores source times and orbital catalog while upstream is unavailable',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'gev-network-cache-'));
  const tle='ISS (ZARYA)\n1 25544U 98067A   26309.85320381  .00006629  00000+0  12749-3 0  9998\n2 25544  51.6327 319.0560 0007195 352.5747   7.5134 15.49194530593711\n';
  const fetchImpl=async url=>new URL(url).pathname==='/api/flights'?Response.json({states:[['abc123','TEST','US',initial/1000,initial/1000,-71,42,1000,false,100,90]]}):new URL(url).pathname==='/api/celestrak/active'?new Response(tle):new Response('',{status:503});
  try{const first=createTracker({baseUrl:'http://127.0.0.1:9999',fetchImpl,now:()=>initial,cacheDirectory:dir});await first.refresh();first.dispose();
    const next=createTracker({baseUrl:'http://127.0.0.1:9999',fetchImpl:async()=>{throw new Error('offline')},now:()=>initial+60000,cacheDirectory:dir});await next.refresh();
    assert.equal(next.query({kind:'aircraft'}).items[0].observedAt,initial);assert.equal(next.query({q:'ISS',kind:'satellite'}).total,1);next.dispose();
  }finally{await rm(dir,{recursive:true,force:true});}
});
