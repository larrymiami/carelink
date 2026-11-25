import { fromEnv } from '../apps/api/src/config.js';
const {store}=fromEnv();try{console.log(JSON.stringify(await store.purge(process.argv.includes('--dry-run'))));}finally{await store.pool.end();}
