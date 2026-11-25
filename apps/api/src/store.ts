import { Pool, type PoolClient } from 'pg';
import { randomUUID, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { boundary, detectArea, detectService, exactIntent, navigation, parseButton } from '../../../packages/domain/src/conversation.js';

export class Conflict extends Error { constructor(public code:string, public status=409){super(code);} }
export type Transport = { send(input:{id:string; to:string; body:string; signal:AbortSignal}):Promise<{providerId:string}> };
export class Store {
 constructor(public pool:Pool, public secret:string, public now=()=>new Date(), public retentionDays=7) {}
 async migrate(){await this.pool.query(await readFile(new URL('../../../db/migrations/001_core.sql',import.meta.url),'utf8'));}
 hash(s:string){return createHmac('sha256',this.secret).update(s).digest('hex');}
 async tx<T>(client:PoolClient,fn:()=>Promise<T>){await client.query('BEGIN');try{const result=await fn();await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}}
 async locked<T>(id:string,fn:(c:PoolClient,row:any)=>Promise<T>,tryOnly=false):Promise<T>{
  const c=await this.pool.connect();let locked=false, key:string|undefined;let broken=false;
  const onError=()=>{broken=true;};c.on('error',onError);
  try{
   const found=await c.query('SELECT lock_id FROM conversations WHERE id=$1',[id]);
   if(!found.rowCount)throw new Conflict('not_found',404);key=found.rows[0].lock_id;
   const q=await c.query(tryOnly?'SELECT pg_try_advisory_lock($1::bigint) AS acquired':'SELECT pg_advisory_lock($1::bigint)',[key]);
   if(tryOnly&&!q.rows[0].acquired)throw new Conflict('dispatch_in_progress');locked=true;
   const row=(await c.query('SELECT * FROM conversations WHERE id=$1',[id])).rows[0];
   return await fn(c,row);
  }finally{
   if(locked&&!broken){try{await c.query('SELECT pg_advisory_unlock($1::bigint)',[key]);}catch{broken=true;}}
   c.off('error',onError);c.release(broken);
  }
 }
 alive(row:any){if(row.purged_at || new Date(row.retention_expires_at)<=this.now())throw new Conflict('content_expired',410);}
 async touch(c:PoolClient,id:string,tombstone=false){await c.query('INSERT INTO inbox_changes(conversation_id,changed_at,tombstone) VALUES($1,$2,$3)',[id,this.now(),tombstone]);}
 async ingest(contact:string,eventId:string,body:string){
  const c=await this.pool.connect();
  try{return await this.tx(c,async()=>{
   const eventKey=this.hash('sample:message:'+eventId),contactKey=this.hash('sample:contact:'+contact);
   // Contact-level transaction lock prevents concurrent creation of two current conversations.
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[contactKey]);
   const prior=await c.query('SELECT conversation_id FROM inbound_events WHERE event_key=$1',[eventKey]);
   if(prior.rowCount)return {conversationId:prior.rows[0].conversation_id,duplicate:true};
   let row=(await c.query('SELECT * FROM conversations WHERE contact_key=$1 AND retention_expires_at>$2 AND purged_at IS NULL ORDER BY created_at DESC LIMIT 1',[contactKey,this.now()])).rows[0];
   if(!row){const id=randomUUID(),expiry=new Date(this.now().getTime()+this.retentionDays*86400000);row=(await c.query('INSERT INTO conversations(id,contact_key,contact_ref,created_at,retention_expires_at) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,contactKey,contact,this.now(),expiry])).rows[0];}
   // Acquire the same session advisory lock as dispatch/claim; release before transaction connection return.
   await c.query('SELECT pg_advisory_xact_lock($1::bigint)',[row.lock_id]);
   row=(await c.query('UPDATE conversations SET input_seq=input_seq+1,state_version=state_version+1 WHERE id=$1 RETURNING *',[row.id])).rows[0];
   const id=randomUUID();
   await c.query('INSERT INTO inbound_events(id,event_key,conversation_id,sequence,body,created_at,retention_expires_at,tombstone_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,eventKey,row.id,row.input_seq,body,this.now(),row.retention_expires_at,new Date(this.now().getTime()+14*86400000)]);
   await c.query('INSERT INTO jobs(id,job_key,kind,conversation_id,event_id,run_after,retention_expires_at) VALUES($1,$2,\'process\',$3,$4,$5,$6)',[randomUUID(),'process:'+id,row.id,id,this.now(),row.retention_expires_at]);
   await this.touch(c,row.id);return {conversationId:row.id,duplicate:false};
  });}finally{c.release();}
 }
 async claimJob(){
  const c=await this.pool.connect();try{return await this.tx(c,async()=>{
   const result=await c.query(`SELECT j.* FROM jobs j LEFT JOIN inbound_events e ON e.id=j.event_id LEFT JOIN conversations c ON c.id=j.conversation_id
    WHERE j.retention_expires_at>$1 AND j.attempts<5 AND j.run_after<=$1 AND
    (j.status='pending' OR (j.status='running' AND j.lease_until<=$1)) AND
    (j.kind='purge' OR (c.purged_at IS NULL AND e.sequence=c.processed_seq+1))
    ORDER BY j.run_after,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1`,[this.now()]);
   if(!result.rowCount)return null;
   return (await c.query("UPDATE jobs SET status='running',attempts=attempts+1,lease_token=$2,lease_until=$3 WHERE id=$1 RETURNING *",[result.rows[0].id,randomUUID(),new Date(this.now().getTime()+60000)])).rows[0];
  });}finally{c.release();}
 }
 async heartbeat(id:string,token:string){return (await this.pool.query("UPDATE jobs SET lease_until=$3 WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>$4 RETURNING id",[id,token,new Date(this.now().getTime()+60000),this.now()])).rowCount===1;}
 async enqueue(c:PoolClient,row:any,key:string,body:string,kind='fixed',action?:any,officer?:string){
  const id=randomUUID();
  await c.query(`INSERT INTO outbox(id,logical_key,conversation_id,body,kind,expected_version,required_state,action_id,action_revision,officer_id,created_at,retention_expires_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(logical_key) DO NOTHING`,[id,key,row.id,body,kind,row.state_version,row.state,action?.id??null,action?.revision??null,officer??null,this.now(),row.retention_expires_at]);
  return id;
 }
 async process(job:any){
  if(job.kind==='purge'){await this.purge();await this.pool.query("UPDATE jobs SET status='done' WHERE id=$1 AND lease_token=$2 AND lease_until>$3",[job.id,job.lease_token,this.now()]);return;}
  await this.locked(job.conversation_id,async(c,row)=>this.tx(c,async()=>{
   const lease=await c.query("SELECT * FROM jobs WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>$3 FOR UPDATE",[job.id,job.lease_token,this.now()]);
   if(!lease.rowCount)throw new Conflict('stale_lease');this.alive(row);
   const event=(await c.query('SELECT * FROM inbound_events WHERE id=$1',[job.event_id])).rows[0];
   if(event.sequence!==row.processed_seq+1)throw new Conflict('out_of_sequence');
   let reply:string|undefined,kind='fixed',action:any,replyKey='inbound:'+event.id+':reply:0',repeatConfirmed=false;
   const text=event.body ?? '', button=parseButton(text),intent=button?.intent??exactIntent(text);
   if(row.state==='human_active'||row.state==='resolved'){
    // Persisted inbound text is visible to the authorised inbox; no bot reply.
   }else{
    action=(await c.query("SELECT * FROM actions WHERE conversation_id=$1 AND status IN ('pending','confirmed') ORDER BY (status='pending') DESC,expires_at DESC LIMIT 1",[row.id])).rows[0];
    const bound=action && (!button||(button.actionId===action.id&&button.revision===action.revision));
    if(text.startsWith('cb_')&&!button){reply='That action is not valid. Please use the current request.';}
    else if(button&&!bound){reply='That action is no longer available. Please use the current request.';}
    else if(row.state==='queued_for_human'){
     if(intent==='cancel'&&bound){await c.query("UPDATE callbacks SET status='cancelled' WHERE conversation_id=$1 AND status='queued'",[row.id]);await c.query("UPDATE actions SET status='cancelled' WHERE id=$1",[action.id]);row.state='automated';reply='Your callback request has been cancelled.';}
     else if(intent==='confirm'&&bound){repeatConfirmed=true;}
     else {reply="Your request is still queued. An officer hasn't accepted it yet. You can cancel it here.";kind='queue';}
    }else if(row.state==='awaiting_callback_confirmation'){
     if(!action || new Date(action.expires_at)<=this.now()){
      if(action)await c.query("UPDATE actions SET status='expired' WHERE id=$1",[action.id]);row.state='automated';reply='That proposal has expired. Request a new callback to continue.';
     }else if(intent==='cancel'){
      await c.query("UPDATE actions SET status='cancelled' WHERE id=$1",[action.id]);row.state='automated';reply='No callback request has been created.';
     }else if(intent==='confirm'){
      await c.query("UPDATE actions SET status='confirmed' WHERE id=$1",[action.id]);
      const requestId=randomUUID();await c.query("INSERT INTO callbacks(id,conversation_id,action_id,summary,consent_text,consent_version,status,confirmed_at,retention_expires_at) VALUES($1,$2,$3,$4,$5,$6,'queued',$7,$8)",[requestId,row.id,action.id,action.summary,action.consent_text,action.consent_version,this.now(),row.retention_expires_at]);
      row.state='queued_for_human';reply=`Your callback request ${requestId} is queued. A programme officer has not accepted it yet.`;kind='queue';replyKey='callback:'+requestId+':ack';
     }else if(/change|actually|instead/i.test(text)){
      await c.query("UPDATE actions SET status='cancelled' WHERE id=$1",[action.id]);action=await this.proposal(c,row,text,action.revision+1);reply=action.consent_text;kind='prompt';
     }else {reply='Please confirm or cancel the current callback proposal. A mixed or unclear reply does not confirm it.';kind='prompt';}
    }else if(button){reply='That action is no longer available. Request a new callback if needed.';}
    else if(/callback|call me|programme officer|human/i.test(text)){
     action=await this.proposal(c,row,text,1);row.state='awaiting_callback_confirmation';reply=action.consent_text;kind='prompt';
    }else if(intent==='cancel'){reply='No callback request has been created.';}
    else {const answer=navigation(text,row.context,this.now());reply=answer.body;row.context=answer.context;}
   }
   row=(await c.query('UPDATE conversations SET state=$2,context=$3,state_version=state_version+1,processed_seq=$4 WHERE id=$1 RETURNING *',[row.id,row.state,row.context,event.sequence])).rows[0];
   if(reply)await this.enqueue(c,row,replyKey,reply,kind,kind==='prompt'?action:undefined);
   if(repeatConfirmed)await c.query("UPDATE outbox SET expected_version=$2 WHERE conversation_id=$1 AND status='pending' AND logical_key IN (SELECT 'callback:'||id::text||':ack' FROM callbacks WHERE conversation_id=$1 AND status='queued')",[row.id,row.state_version]);
   await c.query("UPDATE inbound_events SET status='done' WHERE id=$1",[event.id]);
   await c.query("UPDATE jobs SET status='done',lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2",[job.id,job.lease_token]);await this.touch(c,row.id);
  }));
 }
 async proposal(c:PoolClient,row:any,text:string,revision:number){
  // Store only allowlisted administrative topics, never copy arbitrary user text into summaries.
  const area=detectArea(text)??row.context.area,service=detectService(text)??row.context.service;
  const topic=/fee|cost|price/i.test(text)?'fees':row.context.topic??'information';
  row.context={...row.context,area,service,topic};
  const summary=[service?.replaceAll('_',' ')??'programme information',area??'area unspecified',topic].join(' / ');
  const consent=`Request a telephone callback from Community Access about ${summary}? An officer would use the WhatsApp number you're messaging from. No callback time is guaranteed. Confirm or cancel.`;
  return (await c.query("INSERT INTO actions(id,conversation_id,revision,summary,consent_text,status,expires_at,retention_expires_at) VALUES($1,$2,$3,$4,$5,'pending',$6,$7) RETURNING *",[randomUUID(),row.id,revision,summary,consent,new Date(this.now().getTime()+600000),row.retention_expires_at])).rows[0];
 }
 async failJob(job:any){
  const update=async(c:PoolClient)=>{
   const result=await c.query("UPDATE jobs SET status=CASE WHEN attempts>=5 THEN 'dead_letter' ELSE 'pending' END,run_after=$3,error_code='processing_failed',lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND lease_until>$4 RETURNING *",[job.id,job.lease_token,new Date(this.now().getTime()+Math.min(60000,1000*2**job.attempts)*(0.5+Math.random()/2)),this.now()]);
   if(result.rows[0]?.status==='dead_letter'&&job.event_id){const e=(await c.query('SELECT sequence FROM inbound_events WHERE id=$1',[job.event_id])).rows[0];await c.query("UPDATE inbound_events SET status='dead_letter' WHERE id=$1",[job.event_id]);await c.query('UPDATE conversations SET processed_seq=$2 WHERE id=$1 AND processed_seq=$2-1',[job.conversation_id,e.sequence]);}
  };
  if(job.conversation_id)await this.locked(job.conversation_id,async(c)=>this.tx(c,()=>update(c)));else {const c=await this.pool.connect();try{await this.tx(c,()=>update(c));}finally{c.release();}}
 }
 async claim(id:string,officer:string,command:string,version:number){
  return this.locked(id,async(c,row)=>this.tx(c,async()=>{
   this.alive(row);
   const prior=(await c.query('SELECT * FROM operator_commands WHERE command_id=$1',[command])).rows[0];
   if(prior){if(prior.officer_id!==officer||prior.conversation_id!==id||prior.kind!=='claim')throw new Conflict('command_mismatch');return prior.result;}
   if(row.state!=='queued_for_human')throw new Conflict('already_claimed');
   if(row.state_version!==version)throw new Conflict('version_conflict');
   const result=(await c.query("UPDATE conversations SET state='human_active',officer_id=$2,state_version=state_version+1 WHERE id=$1 RETURNING id,state,state_version,officer_id",[id,officer])).rows[0];
   await c.query("UPDATE callbacks SET status='claimed' WHERE conversation_id=$1 AND status='queued'",[id]);
   await c.query("UPDATE outbox SET status='suppressed' WHERE conversation_id=$1 AND status='pending' AND kind<>'officer'",[id]);
   await c.query("INSERT INTO operator_commands(command_id,conversation_id,officer_id,kind,result) VALUES($1,$2,$3,'claim',$4)",[command,id,officer,result]);await this.touch(c,id);return result;
  }),true);
 }
 async operatorAction(id:string,officer:string,action:'resolve'|'resume'|'reply',body?:string){
  return this.locked(id,async(c,row)=>this.tx(c,async()=>{
   this.alive(row);if(row.officer_id!==officer)throw new Conflict('not_found',404);
   if(action==='reply'){
    if(row.state!=='human_active')throw new Conflict('not_active');
    const message=await this.enqueue(c,row,'officer:'+randomUUID(),body!,'officer',undefined,officer);await this.touch(c,id);return {id:message};
   }
   if(action==='resolve'&&row.state!=='human_active'||action==='resume'&&row.state!=='resolved')throw new Conflict('invalid_transition');
   const state=action==='resolve'?'resolved':'automated';
   await c.query('UPDATE conversations SET state=$2,state_version=state_version+1,officer_id=CASE WHEN $2=\'automated\' THEN NULL ELSE officer_id END WHERE id=$1',[id,state]);
   if(action==='resolve')await c.query("UPDATE callbacks SET status='resolved' WHERE conversation_id=$1 AND status='claimed'",[id]);
   await this.touch(c,id);return {state};
  }));
 }
 async generateResult(id:string,expectedVersion:number,body:string,key:string){
  // Future model adapter calls this guard; no LLM is installed in this increment.
  return this.locked(id,async(c,row)=>this.tx(c,async()=>{
   this.alive(row);if(row.state!=='automated'||row.state_version!==expectedVersion)return {superseded:true};
   return {superseded:false,id:await this.enqueue(c,row,key,body,'ai')};
  }));
 }
 async dispatch(transport:Transport){
  const item=(await this.pool.query("SELECT o.id,o.conversation_id FROM outbox o JOIN conversations c ON c.id=o.conversation_id WHERE o.status='pending' ORDER BY (o.expected_version=c.state_version) DESC,o.created_at,o.id LIMIT 1")).rows[0];if(!item)return false;
  try{await this.locked(item.conversation_id,async(c,row)=>{
   let outbound:any;const attempt=randomUUID();
   await this.tx(c,async()=>{
    outbound=(await c.query("SELECT * FROM outbox WHERE id=$1 AND status='pending' FOR UPDATE",[item.id])).rows[0];if(!outbound)return;
    const alive=!row.purged_at&&new Date(row.retention_expires_at)>this.now();
    let valid=alive&&row.state_version===outbound.expected_version&&row.state===outbound.required_state;
    if(outbound.kind==='ai')valid=valid&&row.state==='automated';
    if(outbound.kind==='officer')valid=valid&&row.state==='human_active'&&row.officer_id===outbound.officer_id;
    if(outbound.kind==='prompt'){const a=(await c.query("SELECT id FROM actions WHERE id=$1 AND revision=$2 AND status='pending' AND expires_at>$3",[outbound.action_id,outbound.action_revision,this.now()])).rowCount;valid=valid&&a===1;}
    if(!valid){await c.query('UPDATE outbox SET status=$2 WHERE id=$1',[outbound.id,alive?'suppressed':'expired']);outbound=undefined;return;}
    await c.query("UPDATE outbox SET status='dispatching',attempt_id=$2,started_at=$3 WHERE id=$1",[outbound.id,attempt,this.now()]);
    await c.query("INSERT INTO send_attempts(id,outbox_id,status,started_at) VALUES($1,$2,'dispatching',$3)",[attempt,outbound.id,this.now()]);
   });if(!outbound)return;
   let providerId:string|undefined,errorCode:string|undefined;
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
   const abort=()=>controller.abort();c.on('error',abort);
   try{providerId=(await transport.send({id:outbound.id,to:row.contact_ref,body:outbound.body,signal:controller.signal})).providerId;}catch{errorCode='acceptance_unknown';}finally{clearTimeout(timer);c.off('error',abort);}
   await this.tx(c,async()=>{
    const status=providerId?'accepted':'delivery_unknown';
    await c.query('UPDATE outbox SET status=$2,provider_id=$3,error_code=$4 WHERE id=$1 AND attempt_id=$5',[outbound.id,status,providerId??null,errorCode??null,attempt]);
    await c.query('UPDATE send_attempts SET status=$2,completed_at=$3,error_code=$4 WHERE id=$1',[attempt,status,this.now(),errorCode??null]);await this.touch(c,row.id);
   });
  },true);}catch(e){if(!(e instanceof Conflict&&e.code==='dispatch_in_progress'))throw e;}
  return true;
 }
 async recoverDispatches(){
  const ids=(await this.pool.query("SELECT DISTINCT conversation_id FROM outbox WHERE status='dispatching' AND started_at<=$1",[new Date(this.now().getTime()-60000)])).rows;
  for(const {conversation_id:id} of ids){try{await this.locked(id,async(c)=>this.tx(c,async()=>{
   await c.query("UPDATE send_attempts SET status='delivery_unknown',completed_at=$2,error_code='worker_interrupted' WHERE id IN (SELECT attempt_id FROM outbox WHERE conversation_id=$1 AND status='dispatching' AND started_at<=$3)",[id,this.now(),new Date(this.now().getTime()-60000)]);
   await c.query("UPDATE outbox SET status='delivery_unknown',error_code='worker_interrupted' WHERE conversation_id=$1 AND status='dispatching' AND started_at<=$2",[id,new Date(this.now().getTime()-60000)]);
  }),true);}catch(e){if(!(e instanceof Conflict))throw e;}}
 }
 async recoverExhaustedJobs(){
  const jobs=(await this.pool.query("SELECT * FROM jobs WHERE status='running' AND attempts>=5 AND lease_until<=$1",[this.now()])).rows;
  for(const job of jobs){
   const recover=async(c:PoolClient)=>this.tx(c,async()=>{
    const result=await c.query("UPDATE jobs SET status='dead_letter',lease_token=NULL,lease_until=NULL,error_code='lease_exhausted' WHERE id=$1 AND status='running' AND lease_until<=$2 RETURNING *",[job.id,this.now()]);
    if(!result.rowCount||!job.event_id)return;
    const event=(await c.query('SELECT sequence FROM inbound_events WHERE id=$1',[job.event_id])).rows[0];
    await c.query("UPDATE inbound_events SET status='dead_letter' WHERE id=$1",[job.event_id]);
    await c.query('UPDATE conversations SET processed_seq=$2 WHERE id=$1 AND processed_seq=$2-1',[job.conversation_id,event.sequence]);
   });
   if(job.conversation_id)await this.locked(job.conversation_id,recover);else{const c=await this.pool.connect();try{await recover(c);}finally{c.release();}}
  }
 }
 async receipt(providerId:string,status:'accepted'|'delivered'|'read'){
  const ranks={accepted:1,delivered:2,read:3};
  const item=(await this.pool.query('SELECT conversation_id FROM outbox WHERE provider_id=$1',[providerId])).rows[0];if(!item)return false;
  await this.locked(item.conversation_id,async(c,row)=>this.tx(c,async()=>{
   if(row.purged_at||new Date(row.retention_expires_at)<=this.now())return;
   await c.query("UPDATE outbox SET status=$2 WHERE provider_id=$1 AND status IN ('accepted','delivered','read') AND CASE status WHEN 'accepted' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 END < $3",[providerId,status,ranks[status]]);await this.touch(c,row.id);
  }));return true;
 }
 async schedulePurge(){const slot=Math.floor(this.now().getTime()/900000);await this.pool.query("INSERT INTO jobs(id,job_key,kind,run_after,retention_expires_at) VALUES($1,$2,'purge',$3,$4) ON CONFLICT(job_key) DO NOTHING",[randomUUID(),'purge:'+slot,this.now(),new Date(this.now().getTime()+86400000)]);}
 async purge(dryRun=false){
  const expired=(await this.pool.query('SELECT id FROM conversations WHERE retention_expires_at<=$1 AND purged_at IS NULL',[this.now()])).rows;
  if(dryRun)return {conversations:expired.length,dryRun:true};let count=0;
  for(const {id} of expired)await this.locked(id,async(c,row)=>this.tx(c,async()=>{
   if(row.purged_at||new Date(row.retention_expires_at)>this.now())return;
   await c.query("UPDATE inbound_events SET body=NULL,conversation_id=NULL,sequence=NULL,status='expired' WHERE conversation_id=$1",[id]);
   await c.query("UPDATE jobs SET status='expired',lease_token=NULL,lease_until=NULL,event_id=NULL WHERE conversation_id=$1",[id]);
   await c.query("UPDATE actions SET summary=NULL,consent_text=NULL,status='expired' WHERE conversation_id=$1",[id]);
   await c.query("UPDATE callbacks SET summary=NULL,consent_text=NULL,status='expired' WHERE conversation_id=$1",[id]);
   await c.query("UPDATE outbox SET body=NULL,provider_id=NULL,logical_key='purged:'||id::text,status=CASE WHEN status IN ('pending','dispatching') THEN 'expired' ELSE status END WHERE conversation_id=$1",[id]);
   await c.query('DELETE FROM operator_commands WHERE conversation_id=$1',[id]);
   await c.query('UPDATE conversations SET contact_key=NULL,contact_ref=NULL,context=\'{}\',officer_id=NULL,state=\'resolved\',state_version=state_version+1,purged_at=$2 WHERE id=$1',[id,this.now()]);
   await c.query("INSERT INTO audit_counts(day,category,outcome,count) VALUES($1::date,'retention','purged',1) ON CONFLICT(day,category,outcome) DO UPDATE SET count=audit_counts.count+1",[this.now()]);
   await this.touch(c,id,true);count++;
  }));
  await this.pool.query('DELETE FROM inbound_events WHERE conversation_id IS NULL AND tombstone_expires_at<=$1',[this.now()]);
  await this.pool.query("DELETE FROM jobs WHERE conversation_id IS NULL AND kind='purge' AND retention_expires_at<=$1 AND status<>'running'",[this.now()]);return {conversations:count,dryRun:false};
 }
 async detail(id:string,officer:string){
  const row=(await this.pool.query('SELECT id,state,state_version,officer_id,retention_expires_at,purged_at FROM conversations WHERE id=$1',[id])).rows[0];
  if(!row||row.officer_id&&row.officer_id!==officer)throw new Conflict('not_found',404);this.alive(row);
  const messages=(await this.pool.query('SELECT id,body,sequence FROM inbound_events WHERE conversation_id=$1 AND retention_expires_at>$2 ORDER BY sequence',[id,this.now()])).rows;
  const outbound=(await this.pool.query('SELECT id,body,status,kind FROM outbox WHERE conversation_id=$1 AND retention_expires_at>$2 ORDER BY created_at,id',[id,this.now()])).rows;
  return {...row,messages,outbound};
 }
}
