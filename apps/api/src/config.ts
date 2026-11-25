import { Pool } from 'pg';
import { Store } from './store.js';
export function fromEnv(){
 if(process.env.APP_MODE!=='sample')throw new Error('Only explicit APP_MODE=sample is supported in this increment');
 const url=process.env.DATABASE_URL;if(!url)throw new Error('DATABASE_URL required');
 const keys=['SAMPLE_API_TOKEN','OPERATOR_API_TOKEN','EVENT_HMAC_KEY'] as const;
 for(const key of keys)if(!process.env[key]||process.env[key]!.length<32||process.env[key]!.startsWith('replace-'))throw new Error(`${key} must be independently configured`);
 if(new Set(keys.map(k=>process.env[k])).size!==keys.length)throw new Error('Secrets must be distinct');
 const days=Number(process.env.RETENTION_DAYS??7);if(!Number.isInteger(days)||days<1||days>365)throw new Error('Invalid retention period');
 const store=new Store(new Pool({connectionString:url,max:12}),process.env.EVENT_HMAC_KEY!,()=>new Date(),days);
 store.pool.on('error',()=>console.error(JSON.stringify({event:'database_connection_error'})));
 const operators:Record<string,string>={'officer-one':process.env.OPERATOR_API_TOKEN!};
 if(process.env.OPERATOR_2_API_TOKEN){if(process.env.OPERATOR_2_API_TOKEN.length<32||keys.some(k=>process.env[k]===process.env.OPERATOR_2_API_TOKEN))throw new Error('Invalid second operator secret');operators['officer-two']=process.env.OPERATOR_2_API_TOKEN;}
 return {store,sampleToken:process.env.SAMPLE_API_TOKEN!,operators};
}
