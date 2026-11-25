import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Conflict, Store } from './store.js';

function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function createApp(store:Store, config:{sampleToken:string; operators:Record<string,string>}){
 const app=Fastify({logger:false,bodyLimit:16384});
 app.setErrorHandler((error,req,reply)=>{
  if(error instanceof Conflict)return reply.code(error.status).send({error:error.code});
  if(error instanceof z.ZodError||(error as {statusCode?:number}).statusCode===400)return reply.code(400).send({error:'invalid_input'});
  return reply.code(500).send({error:'request_failed'});
 });
 function authorize(header:string|undefined,mode:'sample'|'operator'){
  const token=header?.startsWith('Bearer ')?header.slice(7):'';
  if(mode==='sample'&&equal(token,config.sampleToken))return 'sample';
  if(mode==='operator')for(const [id,key] of Object.entries(config.operators))if(equal(token,key))return id;
  throw new Conflict('unauthorized',401);
 }
 app.get('/health',async()=>({status:'ok',mode:'sample',liveChannel:false}));
 app.post('/sample/messages',async(req,reply)=>{
  authorize(req.headers.authorization,'sample');
  const data=z.object({contact:z.string().regex(/^sample-[a-z0-9-]{1,60}$/),eventId:z.string().min(1).max(128),text:z.string().min(1).max(4096)}).strict().parse(req.body);
  const result=await store.ingest(data.contact,data.eventId,data.text);return reply.code(202).send(result);
 });
 app.get('/sample/conversations/:id',async req=>{
  authorize(req.headers.authorization,'sample');
  const {id}=z.object({id:z.uuid()}).parse(req.params);
  const {contact}=z.object({contact:z.string().regex(/^sample-[a-z0-9-]{1,60}$/)}).parse(req.query);
  const row=(await store.pool.query('SELECT * FROM conversations WHERE id=$1 AND contact_key=$2',[id,store.hash('sample:contact:'+contact)])).rows[0];
  if(!row)throw new Conflict('not_found',404);store.alive(row);
  return {id:row.id,state:row.state,stateVersion:row.state_version,context:row.context,outbound:(await store.pool.query('SELECT id,body,status,kind,action_id,action_revision FROM outbox WHERE conversation_id=$1 AND retention_expires_at>$2 ORDER BY created_at,id',[id,store.now()])).rows};
 });
 app.get('/operator/inbox',async req=>{
  const officer=authorize(req.headers.authorization,'operator');
  const query=z.object({cursor:z.coerce.number().int().nonnegative().default(0)}).parse(req.query);
  const changes=(await store.pool.query(`SELECT i.revision,i.conversation_id,i.tombstone,c.state,c.state_version,c.officer_id,
    CASE WHEN c.retention_expires_at<=$2 THEN true ELSE false END AS expired
    FROM inbox_changes i JOIN conversations c ON c.id=i.conversation_id
    WHERE i.revision>$1 ORDER BY i.revision LIMIT 100`,[query.cursor,store.now()])).rows;
  // Send an ID-only removal when a previously visible item is claimed by a different officer.
  const items=changes.map(x=>x.tombstone||x.expired||x.officer_id&&x.officer_id!==officer?{revision:x.revision,conversation_id:x.conversation_id,tombstone:true}:x);
  return {items,cursor:changes.at(-1)?.revision??String(query.cursor)};
 });
 app.get('/operator/conversations/:id',async req=>{
  const officer=authorize(req.headers.authorization,'operator');const {id}=z.object({id:z.uuid()}).parse(req.params);return store.detail(id,officer);
 });
 app.post('/operator/conversations/:id/claim',async req=>{
  const officer=authorize(req.headers.authorization,'operator');const {id}=z.object({id:z.uuid()}).parse(req.params);
  const {commandId,expectedVersion}=z.object({commandId:z.uuid(),expectedVersion:z.number().int().positive()}).strict().parse(req.body);
  return store.claim(id,officer,commandId,expectedVersion);
 });
 app.post('/operator/conversations/:id/:action',async req=>{
  const officer=authorize(req.headers.authorization,'operator');const {id,action}=z.object({id:z.uuid(),action:z.enum(['reply','resolve','resume'])}).parse(req.params);
  const body=action==='reply'?z.object({text:z.string().min(1).max(4096)}).strict().parse(req.body).text:undefined;
  return store.operatorAction(id,officer,action,body);
 });
 return app;
}
