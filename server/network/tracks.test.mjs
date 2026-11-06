import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAircraft, normalizeLocalAircraft, normalizeVessels, parseCatalog, satelliteTracks, selectTracks, mergeTracks, toReadsb, parseLocalAisUrl } from './tracks.js';

const now = Date.UTC(2026, 10, 6, 12);
test('aircraft preserve observation time, units and reject missing coordinates', () => {
  const rows = normalizeAircraft({ states: [['abc123', 'TEST1 ', 'US', now / 1000 - 20, now / 1000, -71, 42, 1000, false, 120, 90, 0, null, 1050], ['null', '', '', now / 1000, now / 1000, null, null]] }, 'OpenSky', now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'aircraft:abc123');
  assert.equal(rows[0].observedAt, now - 20000);
  assert.equal(rows[0].speedMps, 120);
  assert.equal(rows[0].altitudeM, 1050);
});
test('newest aircraft observation wins across local and global feeds', () => {
  const old = {id:'aircraft:abc123', observedAt:now-100, source:'OpenSky'};
  const fresh = {...old, observedAt:now, source:'tar1090'};
  assert.deepEqual(mergeTracks([old], [fresh]), [fresh]);
});
test('native receiver records use ICAO and convert feet and knots without losing source age', () => {
  const [row]=normalizeLocalAircraft({records:[{icao:'abc123',callsign:'LOCAL',lat:42,lon:-71,altitudeFt:10000,groundSpeedKt:100,trackDeg:90,lastPositionAt:now-2000,onGround:false}]},now);
  assert.equal(row.id,'aircraft:abc123');assert.equal(row.altitudeM,3048);assert.ok(Math.abs(row.speedMps-51.4444)<.001);assert.equal(row.observedAt,now-2000);
});
test('AIS-catcher GeoJSON keeps MMSI and unavailable sentinels honest', () => {
  const rows = normalizeVessels({type:'FeatureCollection',features:[{geometry:{type:'Point',coordinates:[-70,43]},properties:{mmsi:123456789,shipname:'TEST SHIP',speed:102.3,cog:360,last_position_epoch:now/1000-30}}]}, 'AIS-catcher', now);
  assert.equal(rows[0].id, 'vessel:123456789');
  assert.equal(rows[0].name, 'TEST SHIP');
  assert.equal(rows[0].speedMps, null);
  assert.equal(rows[0].headingDeg, null);
  assert.equal(rows[0].observedAt, now-30000);
});
test('missing AIS observation time stays unknown rather than becoming fresh', () => {
  const [row] = normalizeVessels({rows:[{mmsi:'123456789',lat:43,lon:-70,name:'Vessel'}]}, 'AISStream', now);
  assert.equal(row.observedAt, null);
  assert.equal(row.freshness, 'unknown');
});
test('AIS signal receipt does not restamp an old or unknown position fix',()=>{
  const [row]=normalizeVessels({features:[{geometry:{type:'Point',coordinates:[-70,43]},properties:{mmsi:123456789,shipname:'Test',last_signal:now/1000}}]},'AIS-catcher',now);
  assert.equal(row.observedAt,null);assert.equal(row.lastSignalAt,now);assert.equal(row.freshness,'unknown');
});
test('satellite positions are predictions with an orbital epoch', () => {
  const tle = 'ISS (ZARYA)\n1 25544U 98067A   26309.85320381  .00006629  00000+0  12749-3 0  9998\n2 25544  51.6327 319.0560 0007195 352.5747   7.5134 15.49194530593711\n';
  const catalog = parseCatalog(tle);
  const [row] = satelliteTracks(catalog, now);
  assert.equal(row.id, 'satellite:25544');
  assert.equal(row.positionKind, 'predicted');
  assert.ok(Number.isFinite(row.orbitEpoch));
  assert.ok(row.altitudeM > 300000 && row.altitudeM < 500000);
});
test('search preserves exact identity, antimeridian filtering and bounded output', () => {
  const rows=[{id:'vessel:123',name:'A',kind:'vessel',lat:20,lon:179},{id:'vessel:234',name:'B',kind:'vessel',lat:20,lon:-179},{id:'aircraft:123',name:'C',kind:'aircraft',lat:20,lon:0}];
  assert.equal(selectTracks(rows,{q:'vessel:123'}).total,1);
  assert.equal(selectTracks(rows,{bbox:'170,-30,-170,30',limit:'1'}).total,2);
  assert.equal(selectTracks(rows,{bbox:'170,-30,-170,30',limit:'1'}).items.length,1);
  assert.throws(()=>selectTracks(rows,{limit:'NaN'}),/limit/);
  assert.throws(()=>selectTracks(rows,{bbox:'garbage'}),/bbox/);
});
test('tar1090 projection preserves age and translates metres to feet', () => {
  const payload=toReadsb([{kind:'aircraft',reference:'abc123',name:'TEST1',lat:42,lon:-71,altitudeM:3100,baroAltitudeM:3048,ellipsoidAltitudeM:3100,positionSource:2,speedMps:51.4444,headingDeg:90,observedAt:now-20000}],now);
  assert.equal(payload.aircraft[0].alt_baro,10000);
  assert.equal(payload.aircraft[0].seen_pos,20);
  assert.ok(Math.abs(payload.aircraft[0].gs-100)<.01);
  assert.equal(payload.aircraft[0].type,'mlat');
  assert.equal(payload.aircraft[0].alt_geom,Math.round(3100/.3048));
});
test('AIS-catcher address is configured locally and cannot target public or metadata hosts', () => {
  assert.equal(parseLocalAisUrl('http://127.0.0.1:8100/geojson').hostname,'127.0.0.1');
  for(const u of ['http://169.254.169.254/geojson','https://example.com/geojson','http://10.0.0.1/other','http://user:pass@10.0.0.1/geojson','file:///geojson']) assert.throws(()=>parseLocalAisUrl(u));
});
