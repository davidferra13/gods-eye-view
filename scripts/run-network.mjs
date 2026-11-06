import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync,openSync,statSync,renameSync,closeSync } from 'node:fs';
const root=fileURLToPath(new URL('../',import.meta.url));
const logs=path.join(root,'.gev-logs');mkdirSync(logs,{recursive:true});const log=path.join(logs,'network-service.log');
try{if(statSync(log).size>10*1024*1024)renameSync(log,log+'.previous');}catch{}
const fd=openSync(log,'a');
const child=spawn(process.execPath,['--max-old-space-size=768',path.join(root,'node_modules/vite/bin/vite.js'),...(process.platform==='win32'?['--configLoader','native']:[]),'--host',process.env.HOST||'0.0.0.0','--port',process.env.PORT||'4175','--strictPort'],{
  cwd:root,stdio:['ignore',fd,fd],env:{...process.env,TAR1090_ROOT:process.env.TAR1090_ROOT||path.join(root,'vendor/tar1090/html'),GEV_EMBED_FRAME_ANCESTORS:"'self'",GEV_KEY_SETUP_TRUSTED_PEERS:'none',OPENSKY_AUTH_MODE:process.env.OPENSKY_AUTH_MODE||'anon'},
});
closeSync(fd);
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>child.kill(event));
child.on('error',()=>{process.exitCode=1;});
child.on('exit',(code)=>{process.exitCode=code??1;});
