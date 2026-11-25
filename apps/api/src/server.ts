import { createApp } from './app.js';
import { fromEnv } from './config.js';
const config=fromEnv();const app=createApp(config.store,config);
await app.listen({port:Number(process.env.PORT??3001),host:'127.0.0.1'});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await app.close();await config.store.pool.end();});
