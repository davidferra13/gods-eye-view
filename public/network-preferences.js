const KEY='homeWorldPreferences.v1',DAY=86400000;
const KINDS=['aircraft','satellite','vessel'];
const ACTIONS=['search','selection','focus','dwell'];
const count=v=>Number.isFinite(v)&&v>0?Math.min(10000,Math.floor(v)):0;
/** Device-local aggregate counters only: no query text, track IDs or positions. */
export class LocalPreferences {
  constructor(storage,now=Date.now){
    this.storage=storage;this.now=now;this.enabled=true;this.cells=[];this.persistent=Boolean(storage);
    try{const raw=storage?.getItem(KEY);if(raw&&raw.length<=524288){const value=JSON.parse(raw);if(value?.schemaVersion===1){this.enabled=value.enabled!==false;this.cells=Array.isArray(value.cells)?value.cells.slice(0,10000):[];}}}catch{this.persistent=false;}
    this.save();
  }
  prune(){
    const today=Math.floor(this.now()/DAY)*DAY,rows=new Map();
    for(const c of this.cells){
      if(!c||!Number.isInteger(c.day)||c.day%DAY!==0||c.day<today-29*DAY||c.day>today||!Number.isInteger(c.hour)||c.hour<0||c.hour>23||!KINDS.includes(c.kind))continue;
      const key=`${c.day}/${c.hour}/${c.kind}`,old=rows.get(key);
      const row={day:c.day,hour:c.hour,kind:c.kind};
      for(const a of ACTIONS)row[a]=Math.max(count(c[a]),old?.[a]||0);
      rows.set(key,row);
    }
    this.cells=[...rows.values()].sort((a,b)=>b.day-a.day||a.hour-b.hour||a.kind.localeCompare(b.kind)).slice(0,2160);
  }
  save(){this.prune();if(!this.persistent)return;try{const body=JSON.stringify(this.snapshot());if(body!==this.lastSaved){this.storage.setItem(KEY,body);this.lastSaved=body;}}catch{this.persistent=false;}}
  record(kind,action,amount=1){
    if(!this.enabled||!KINDS.includes(kind)||!ACTIONS.includes(action)||!Number.isFinite(amount)||amount<=0)return false;
    this.prune();const at=this.now(),day=Math.floor(at/DAY)*DAY,hour=new Date(at).getHours();
    let row=this.cells.find(c=>c.day===day&&c.hour===hour&&c.kind===kind);
    if(!row){row={day,hour,kind,search:0,selection:0,focus:0,dwell:0};this.cells.push(row);}
    row[action]=Math.min(10000,row[action]+Math.min(action==='dwell'?30:10000,Math.floor(amount)));
    this.save();return true;
  }
  suggest(){
    this.save();const at=this.now(),today=Math.floor(at/DAY)*DAY,hour=new Date(at).getHours();
    const scores=new Map(KINDS.map(k=>[k,0]));
    for(const c of this.cells){const distance=Math.min(Math.abs(c.hour-hour),24-Math.abs(c.hour-hour));const timeWeight=distance===0?3:distance===1?1.5:1;const weight=Math.pow(.9,(today-c.day)/DAY)*timeWeight;scores.set(c.kind,scores.get(c.kind)+(c.focus*4+c.search*2+c.selection+c.dwell/60)*weight);}
    const kind=[...KINDS].sort((a,b)=>scores.get(b)-scores.get(a)||a.localeCompare(b))[0];
    return scores.get(kind)>0?{kind,score:scores.get(kind)}:null;
  }
  snapshot(){this.prune();return {schemaVersion:1,enabled:this.enabled,cells:this.cells.map(c=>({...c}))};}
  setEnabled(enabled){this.enabled=enabled===true;this.save();}
  reset(){this.cells=[];this.save();}
}
