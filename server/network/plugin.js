import { createReadStream } from 'node:fs';
import { stat,readFile } from 'node:fs/promises';
import path from 'node:path';
import { createTracker } from './service.js';
import { toReadsb } from './tracks.js';
import { admitSameSiteKeyless } from '../providers/common/same-site.js';

const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg','.woff2':'font/woff2','.wasm':'application/wasm'};
const send=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
/** Private-network read API. Install BEFORE the existing provider/fallback plugins. */
export function networkTrackerPlugin() {
  function install(server) {
    let tracker,timer;
    const start=()=>{
      const address=server.httpServer?.address();
      if(!address||typeof address==='string'||tracker)return;
      try{tracker=createTracker({baseUrl:`http://127.0.0.1:${address.port}`,cacheDirectory:path.join(process.cwd(),'.gev-cache')});}
      catch {console.error('[world-tracker] Invalid AIS_CATCHER_URL; refusing unsafe receiver configuration');return;}
      void tracker.refresh();timer=setInterval(()=>void tracker.refresh(),15000);timer.unref();
    };
    server.httpServer?.once('listening',start);
    server.httpServer?.once('close',()=>{clearInterval(timer);tracker?.dispose();});
    server.middlewares.use(async(req,res,next)=>{
      const u=new URL(req.url||'/','http://localhost');
      if(u.pathname==='/tar1090'){res.writeHead(302,{Location:'/tar1090/'});res.end();return;}
      const api=u.pathname.startsWith('/api/world-tracker/v1/');
      const tar=u.pathname.startsWith('/tar1090/');
      const ais=tracker?.hasLocalAis&&u.pathname==='/api/vessels';
      if(!api&&!tar&&!ais)return next();
      if(admitSameSiteKeyless(req,res))return;
      if(req.method!=='GET'){res.setHeader('Allow','GET');send(res,405,{error:'GET required'});return;}
      if(!tracker){send(res,503,{error:'tracker starting or receiver configuration invalid'});return;}
      try{
        if(ais){res.setHeader('X-Feed-Source','AIS-catcher');send(res,200,tracker.vesselPayload());return;}
        if(api){
          if(u.pathname.endsWith('/status')||u.pathname.endsWith('/health')){send(res,200,tracker.status());return;}
          if(u.pathname.endsWith('/tracks')||u.pathname.endsWith('/search')){send(res,200,tracker.query(Object.fromEntries(u.searchParams)));return;}
          send(res,404,{error:'Unknown tracker route'});return;
        }
        if(u.pathname==='/tar1090/data/aircraft.json'){send(res,200,toReadsb(tracker.aircraft(),Date.now()));return;}
        if(u.pathname==='/tar1090/data/receiver.json'){send(res,200,{version:'Home World Tracker · public feed',refresh:30000,history:0,binCraft:false});return;}
        const root=process.env.TAR1090_ROOT;
        if(!root){send(res,503,{error:'tar1090 viewer not installed'});return;}
        const relative=decodeURIComponent(u.pathname.slice('/tar1090/'.length))||'index.html';
        const file=path.resolve(root,relative);
        if(!file.startsWith(path.resolve(root)+path.sep)||relative.includes('\\')){send(res,403,{error:'invalid path'});return;}
        try {const info=await stat(file);if(!info.isFile()||info.size>16*1024*1024)throw new Error();}
        catch{send(res,404,{error:'asset not found'});return;}
        if(relative==='config.js'){
          // Public snapshots arrive slower than a physical 1 Hz receiver. Keep
          // original seen ages, but allow a bounded window so the viewer stays useful.
          res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
          res.end(await readFile(file,'utf8')+'\nPageName = "HOME AIR / reported positions";\nseenTimeout = 600;\nseenTimeoutMlat = 600;\n');return;
        }
        res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
        const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
      }catch(error){send(res,error instanceof TypeError?400:502,{error:error instanceof TypeError?error.message:'Tracker request failed'});}
    });
  }
  return {name:'home-network-tracker',configureServer:install,configurePreviewServer:install};
}
