import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const secret=()=>randomBytes(32).toString('hex');
const content=`DATABASE_URL=postgres://carelink:${secret()}@127.0.0.1:55432/postgres\nAPP_MODE=sample\nPORT=3001\nSAMPLE_API_TOKEN=${secret()}\nOPERATOR_API_TOKEN=${secret()}\nOPERATOR_2_API_TOKEN=${secret()}\nEVENT_HMAC_KEY=${secret()}\nRETENTION_DAYS=7\n`;
try{await writeFile('.env',content,{flag:'wx',mode:0o600});console.log('Local sample configuration created. Secrets were not printed.');}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')console.log('Existing .env retained.');else throw e;}
