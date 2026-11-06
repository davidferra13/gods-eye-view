/** Internal apps can proxy /api/world-tracker/v1 through their own authenticated backend. */
export function createWorldTrackerClient(base='/api/world-tracker/v1',fetchImpl=fetch) {
  async function read(route,query={},signal) {
    const url=new URL(base.replace(/\/$/,'')+'/'+route,globalThis.location?.href||'http://localhost');
    for(const [key,value] of Object.entries(query))if(value!==undefined)url.searchParams.set(key,String(value));
    const r=await fetchImpl(url,{signal,credentials:'same-origin'});
    const data=await r.json();if(!r.ok)throw new Error(data.error||`Tracker HTTP ${r.status}`);return data;
  }
  return {status:signal=>read('status',{},signal),search:(query,signal)=>read('search',query,signal),tracks:(query,signal)=>read('tracks',query,signal)};
}
