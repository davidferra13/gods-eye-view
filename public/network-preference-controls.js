import {LocalPreferences} from './network-preferences.js';
const labels={aircraft:'aircraft',satellite:'satellites',vessel:'vessels'};
export function mountLocalPreferences({document,storage,onSuggested,now=Date.now,onExport}={}){
  const model=new LocalPreferences(storage,now),el=id=>document.getElementById(id);
  let activeKind=null,lastAt=now(),disposed=false;
  const update=()=>{
    const suggestion=model.suggest(),button=el('learning-suggestion');
    button.disabled=!suggestion;button.textContent=suggestion?`Suggested view: ${labels[suggestion.kind]}`:'Suggestions appear as you use the tracker';
    el('learning-pause').textContent=model.enabled?'Pause learning':'Resume learning';
    el('learning-pause').setAttribute('aria-pressed',String(!model.enabled));
    el('learning-status').textContent=`${model.enabled?'Learning on':'Learning paused'} · ${model.persistent?'this device':'session only; storage unavailable'} · 30-day aggregates`;
  };
  const resetClock=()=>{lastAt=now();};
  document.addEventListener('visibilitychange',resetClock);
  el('learning-pause').onclick=()=>{model.setEnabled(!model.enabled);resetClock();update();};
  el('learning-reset').onclick=()=>{model.reset();resetClock();update();};
  el('learning-suggestion').onclick=()=>{const suggestion=model.suggest();if(suggestion)onSuggested(suggestion.kind);};
  el('learning-export').onclick=()=>{
    const data=model.snapshot();
    if(onExport){onExport(data);return;}
    const href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=href;a.download='world-tracker-preferences.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  };
  update();
  return {
    capture(kind,action){if(disposed||document.hidden)return false;const changed=model.record(kind,action);if(changed)update();return changed;},
    setActive(kind){activeKind=labels[kind]?kind:null;resetClock();},
    resume(){if(!disposed)resetClock();},
    tick(){if(disposed)return;const at=now(),seconds=Math.max(0,Math.min(30,(at-lastAt)/1000));lastAt=at;if(!document.hidden&&activeKind)model.record(activeKind,'dwell',seconds);update();},
    dispose(){disposed=true;document.removeEventListener('visibilitychange',resetClock);for(const id of ['learning-pause','learning-reset','learning-suggestion','learning-export'])el(id).onclick=null;},
  };
}
