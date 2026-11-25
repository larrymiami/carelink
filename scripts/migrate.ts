import { fromEnv } from '../apps/api/src/config.js';
const {store}=fromEnv();const c=await store.pool.connect();
try{
 await c.query('SELECT pg_advisory_lock(6324147001)');
 await c.query('CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
 if(!(await c.query('SELECT version FROM schema_migrations WHERE version=1')).rowCount){
  await c.query('BEGIN');
  try{const {readFile}=await import('node:fs/promises');await c.query(await readFile(new URL('../db/migrations/001_core.sql',import.meta.url),'utf8'));await c.query('INSERT INTO schema_migrations(version) VALUES(1)');await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}
 }
 console.log('Migrations applied.');
}finally{await c.query('SELECT pg_advisory_unlock(6324147001)');c.release();await store.pool.end();}
