import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js';
import { normalizeOpenSkyAircraft } from '../../src/sources/live/aircraft.js';

const number = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const coords = (lat, lon) => number(lat) !== null && number(lon) !== null && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180;
const text = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160);
const epoch = v => {
  const n = number(v);
  if (n !== null && n > 0) return n > 1e12 ? n : n * 1000;
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};
export function freshness(at, now, maxAge = 120000) {
  if (!Number.isFinite(at) || at > now + 30000) return 'unknown';
  return now - at <= maxAge ? 'live' : 'stale';
}
export function normalizeAircraft(payload, source, now) {
  return (payload?.states || []).slice(0, 50000).map(row=>({record:normalizeOpenSkyAircraft(row),positionSource:number(row?.[16])})).filter(x=>x.record).map(({record:r,positionSource}) => ({
    id: `aircraft:${r.id}`, reference: r.id, kind: 'aircraft', name: r.callsign || r.id,
    callsign: r.callsign || null, country: r.originCountry, lat: r.latitude, lon: r.longitude,
    altitudeM: r.ellipsoidAltitudeM ?? r.baroAltitudeM, baroAltitudeM:r.baroAltitudeM,ellipsoidAltitudeM:r.ellipsoidAltitudeM,positionSource,speedMps: r.speedMps, headingDeg: r.courseDeg,
    observedAt: r.positionTimeMs, receivedAt: now, source, positionKind: 'observed',
    freshness: freshness(r.positionTimeMs, now), onGround: r.onGround,
  }));
}
export function normalizeLocalAircraft(payload, now) {
  return (payload?.records || []).filter(r => /^[0-9a-f]{6}$/i.test(r.icao)&&coords(r.lat, r.lon)).map(r => ({
    id: `aircraft:${r.icao.toLowerCase()}`, reference: r.icao.toLowerCase(), kind: 'aircraft', name: r.callsign || r.icao,
    callsign: r.callsign || null, registration: r.registration || null,
    lat: r.lat, lon: r.lon, altitudeM: number(r.altitudeFt)===null?null:r.altitudeFt*.3048,baroAltitudeM:number(r.altitudeFt)===null?null:r.altitudeFt*.3048,ellipsoidAltitudeM:null,positionSource:0,onGround:r.onGround,
    speedMps: number(r.groundSpeedKt)===null?null:r.groundSpeedKt*.514444, headingDeg: number(r.trackDeg), observedAt: r.lastPositionAt??null,
    receivedAt: now, source: 'Local readsb/tar1090', positionKind: 'observed', freshness: freshness(r.lastPositionAt, now, 10000),
  }));
}
export function normalizeVessels(payload, source, now) {
  const raw = Array.isArray(payload?.features) ? payload.features.map(f => ({
    ...f.properties, lat: f.geometry?.type === 'Point' ? f.geometry.coordinates?.[1] : null,
    lon: f.geometry?.type === 'Point' ? f.geometry.coordinates?.[0] : null,
  })) : payload?.rows || [];
  return raw.slice(0, 50000).filter(r => coords(r.lat, r.lon) && /^\d{5,10}$/.test(String(r.mmsi ?? r.MMSI))).map(r => {
    const reference = String(r.mmsi ?? r.MMSI);
    const at = epoch(r.last_position_epoch ?? r.last_position_UTC);
    const knots = number(r.speed ?? r.sog);
    const heading = number(r.course ?? r.cog ?? r.heading);
    return {id: `vessel:${reference}`, reference, kind: 'vessel', name: text(r.name || r.shipname || r.ship_name || reference),
      lat: Number(r.lat), lon: Number(r.lon), altitudeM: 0,
      speedMps: knots !== null && knots >= 0 && knots < 102.3 ? knots * .514444 : null,
      headingDeg: heading !== null && heading >= 0 && heading < 360 ? heading : null,
      observedAt: at, lastSignalAt:epoch(r.last_signal??r.received),receivedAt: now, source, positionKind: 'observed',timestampKind:at===null?'unknown-position-time':'position',freshness: freshness(at, now),
    };
  });
}
export function parseCatalog(body) {
  const lines = String(body).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length - 1 && out.length < 30000; i++) {
    if (!lines[i].startsWith('1 ') || !lines[i+1]?.startsWith('2 ')) continue;
    try {
      const satrec = twoline2satrec(lines[i], lines[i+1]);
      const reference = String(satrec.satnum).trim();
      const orbitEpoch = (satrec.jdsatepoch - 2440587.5) * 86400000;
      if (!reference || !Number.isFinite(orbitEpoch) || satrec.error) continue;
      out.push({reference, name: text(i > 0 && !lines[i-1].startsWith('2 ') ? lines[i-1].replace(/^0 /, '') : reference), satrec, orbitEpoch});
    } catch { /* malformed orbital records never become positions */ }
    i++;
  }
  return out;
}
export function satelliteTracks(catalog, now) {
  const date = new Date(now), gmst = gstime(date), out = [];
  for (const entry of catalog) {
    try {
      const p = propagate(entry.satrec, date);
      if (!p?.position || entry.satrec.error) continue;
      const geo = eciToGeodetic(p.position, gmst);
      const lat = degreesLat(geo.latitude), lon = degreesLong(geo.longitude);
      if (!coords(lat, lon) || !Number.isFinite(geo.height) || geo.height < 0) continue;
      out.push({id:`satellite:${entry.reference}`, reference:entry.reference, kind:'satellite', name:entry.name,
        lat, lon, altitudeM:geo.height*1000, speedMps:p.velocity ? Math.hypot(p.velocity.x,p.velocity.y,p.velocity.z)*1000 : null,
        headingDeg:null, observedAt:null, predictedAt:now, orbitEpoch:entry.orbitEpoch, source:'CelesTrak / satellite.js SGP4',
        positionKind:'predicted', freshness:Math.abs(now-entry.orbitEpoch)>7*86400000?'stale-elements':'predicted',
      });
    } catch { /* decayed/invalid satellite */ }
  }
  return out;
}
export function mergeTracks(...groups) {
  const map = new Map();
  for (const group of groups) for (const row of group) {
    const previous = map.get(row.id);
    if (!previous || (row.observedAt ?? -Infinity) > (previous.observedAt ?? -Infinity)) map.set(row.id, row);
  }
  return [...map.values()];
}
export function selectTracks(rows, query = {}) {
  const limit = query.limit === undefined ? 200 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new TypeError('limit must be 1..5000');
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new TypeError('offset must be 0..100000');
  const q = text(query.q).toLowerCase();
  const kind = query.kind || 'all';
  if (!['all','aircraft','vessel','satellite'].includes(kind)) throw new TypeError('invalid kind');
  let box;
  if (query.bbox !== undefined) {
    box = String(query.bbox).split(',').map(v => v.trim() === '' ? NaN : Number(v));
    if (box.length !== 4 || !box.every(Number.isFinite) || Math.abs(box[0])>180 || Math.abs(box[2])>180 || Math.abs(box[1])>90 || Math.abs(box[3])>90 || box[1]>box[3]) throw new TypeError('bbox must be west,south,east,north');
  }
  const filtered = rows.filter(r => (kind === 'all' || r.kind === kind) && (!q || [r.id,r.reference,r.name,r.callsign,r.registration].some(v => String(v || '').toLowerCase().includes(q))) && (!box || (r.lat>=box[1] && r.lat<=box[3] && (box[0]<=box[2] ? r.lon>=box[0]&&r.lon<=box[2] : r.lon>=box[0]||r.lon<=box[2]))));
  filtered.sort((a,b) => Number(b.id===q || b.reference===q)-Number(a.id===q || a.reference===q) || a.id.localeCompare(b.id));
  return {items:filtered.slice(offset,offset+limit),total:filtered.length,offset,limit,nextOffset:offset+limit<filtered.length?offset+limit:null};
}
export function toReadsb(rows, now) {
  return {now:now/1000,messages:0,aircraft:rows.filter(r=>r.kind==='aircraft'&&Number.isFinite(r.observedAt)).map(r=>({
    hex:r.reference,flight:r.callsign||r.name,lat:r.lat,lon:r.lon,alt_baro:r.onGround?'ground':number(r.baroAltitudeM)===null?null:Math.round(r.baroAltitudeM/.3048),alt_geom:number(r.ellipsoidAltitudeM)===null?null:Math.round(r.ellipsoidAltitudeM/.3048),
    gs:r.speedMps===null?null:r.speedMps/.514444,track:r.headingDeg,seen:Math.max(0,(now-r.observedAt)/1000),seen_pos:Math.max(0,(now-r.observedAt)/1000),type:({0:'adsb_icao',2:'mlat'})[r.positionSource]||'other',
  }))};
}
export function parseLocalAisUrl(raw) {
  const u = new URL(raw);
  const a = u.hostname.split('.').map(Number);
  const local = a.length===4 && a.every(n=>Number.isInteger(n)&&n>=0&&n<=255) && (a[0]===127 || a[0]===10 || a[0]===192&&a[1]===168 || a[0]===172&&a[1]>=16&&a[1]<=31);
  if (!['http:','https:'].includes(u.protocol) || !local || u.username || u.password || u.search || u.hash || u.pathname!=='/geojson') throw new TypeError('AIS_CATCHER_URL requires private IPv4 /geojson, without credentials or query');
  return u;
}
