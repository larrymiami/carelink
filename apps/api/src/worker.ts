import { Store, type Transport } from './store.js';
export async function tick(store:Store,transport:Transport){
 await store.schedulePurge();await store.recoverDispatches();await store.recoverExhaustedJobs();
 const job=await store.claimJob();
 if(job){
  const heartbeat=setInterval(()=>{void store.heartbeat(job.id,job.lease_token).catch(()=>{});},15000);
  try{await store.process(job);}catch{await store.failJob(job);}finally{clearInterval(heartbeat);}
 }
 await store.dispatch(transport);
 return Boolean(job);
}
export const sampleTransport:Transport={async send({id,signal}){
 if(signal.aborted)throw new Error('aborted');return {providerId:'sample:'+id};
}};
