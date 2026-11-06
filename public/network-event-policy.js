const KEY='homeWorldPlanetaryWatch.v1',MAX_AGE=3600000,TTL=86400000;
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=120&&!id.startsWith('QUAKE-')&&!/[\x00-\x1f]/.test(id);
export class MajorEventPolicy {
  constructor({storage,now=Date.now}={}){this.storage=storage;this.now=now;this.paused=false;this.seen=new Map();this.pending=new Map();this.current=[];this.initialized=false;this._available=false;this.lastFocus=-Infinity;this.inFlight=null;try{const raw=storage?.getItem(KEY);if(raw&&raw.length<131072){const d=JSON.parse(raw);if(d?.schemaVersion===1){this.paused=d.paused===true;for(const row of (Array.isArray(d.seen)?d.seen:[]).slice(-512))if(Array.isArray(row)&&validId(row[0])&&Number.isFinite(row[1]))this.seen.set(row[0],row[1]);}}}catch{}this.save();}
  save(){const now=this.now();this.seen=new Map([...this.seen].filter(([id,at])=>validId(id)&&at<=now+5000&&now-at<=TTL).slice(-512));try{const body=JSON.stringify({schemaVersion:1,paused:this.paused,seen:[...this.seen]});if(body!==this.saved){this.storage?.setItem(KEY,body);this.saved=body;}}catch{}}
  get available(){const now=this.now();return this._available&&now-this.updatedAt<=90000&&now-this.capturedAt<=30000;}
  setPaused(value){this.paused=value===true;this.save();}
  ingest(snapshot){
    const now=this.now();this._available=false;
    if(snapshot?.schemaVersion!==1||snapshot.source!=='USGS'||!Number.isFinite(snapshot.capturedAt)||Math.abs(now-snapshot.capturedAt)>10000||!Number.isFinite(snapshot.updatedAt)||snapshot.updatedAt>now+5000||now-snapshot.updatedAt>90000||snapshot.error||!Array.isArray(snapshot.rows)||snapshot.rows.length>2048)return [];
    this._available=true;this.updatedAt=snapshot.updatedAt;this.capturedAt=snapshot.capturedAt;
    const rows=new Map();for(const r of snapshot.rows){if(!r||!validId(r.id)||!Number.isFinite(r.magnitude)||r.magnitude<6||r.magnitude>10||!Number.isFinite(r.lat)||Math.abs(r.lat)>90||!Number.isFinite(r.lon)||Math.abs(r.lon)>180||!Number.isFinite(r.timeMs)||r.timeMs>now+5000||now-r.timeMs>MAX_AGE)continue;rows.set(r.id,{id:r.id,magnitude:r.magnitude,lat:r.lat,lon:r.lon,timeMs:r.timeMs,place:typeof r.place==='string'?r.place.slice(0,160):'',source:'USGS',severity:r.magnitude>=7?'critical':'high'});}
    this.current=[...rows.values()].sort((a,b)=>b.magnitude-a.magnitude||b.timeMs-a.timeMs||a.id.localeCompare(b.id)).slice(0,32);
    const fresh=[];for(const row of rows.values()){if(!this.seen.has(row.id)){this.seen.set(row.id,now);if(this.initialized){fresh.push(row);this.pending.set(row.id,row);}}}
    this.initialized=true;for(const id of this.pending.keys()){if(!rows.has(id))this.pending.delete(id);else this.pending.set(id,rows.get(id));}if(this.inFlight&&!this.pending.has(this.inFlight))this.inFlight=null;this.save();return fresh;
  }
  acknowledge(id,applied){if(this.inFlight&&this.inFlight!==id)return;this.inFlight=null;if(applied){this.pending.delete(id);this.lastFocus=this.now();}}
  next({hidden=false,tracking=false,manual=false,ready=true}={}){const now=this.now();if(this.inFlight||this.paused||hidden||tracking||manual||!ready||!this.available||now-this.updatedAt>90000||now-this.capturedAt>30000||now-this.lastFocus<300000)return null;const row=[...this.pending.values()].filter(r=>now-r.timeMs<=MAX_AGE).sort((a,b)=>b.magnitude-a.magnitude||b.timeMs-a.timeMs)[0];if(!row)return null;this.inFlight=row.id;return {...row};}
}
