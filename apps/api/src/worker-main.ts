import { setTimeout } from 'node:timers/promises';
import { fromEnv } from './config.js';
import { tick, sampleTransport } from './worker.js';
const {store}=fromEnv();let stop=false;
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stop=true;});
try{while(!stop){try{await tick(store,sampleTransport);}catch{console.error(JSON.stringify({event:'worker_cycle_failed'}));}await setTimeout(500);}}finally{await store.pool.end();}
