import EmbeddedPostgres from 'embedded-postgres';
import { access } from 'node:fs/promises';
const url=new URL(process.env.DATABASE_URL??'');
if(process.env.APP_MODE!=='sample'||!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Local database requires sample mode and a loopback URL');
const db=new EmbeddedPostgres({databaseDir:'.pg-data',port:Number(url.port),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),persistent:true,autoRehydrateSymlinks:true,initdbFlags:['--no-sync'],postgresFlags:['-c','unix_socket_directories=','-c','listen_addresses=127.0.0.1'],onLog:()=>{},onError:()=>{}});
try{await access('.pg-data/PG_VERSION');}catch{await db.initialise();}
await db.start();console.log('Local sample PostgreSQL is ready. Keep this terminal open.');
let stopped=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{if(stopped)return;stopped=true;await db.stop();});
