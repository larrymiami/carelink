import { spawnSync, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('.tmp',{recursive:true});await mkdir('evals/reports',{recursive:true});
const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--reporter=json','--outputFile=.tmp/test-results.json'],{encoding:'utf8',timeout:180000});
process.stdout.write(run.stdout??'');process.stderr.write(run.stderr??'');
let result:any;
try{result=JSON.parse(await readFile('.tmp/test-results.json','utf8'));}catch{console.error('Test report unavailable; no passing report generated.');process.exit(1);}
const spec=JSON.parse(await readFile('evals/acceptance-cases.json','utf8'));
const assertions=result.testResults.flatMap((suite:any)=>suite.assertionResults);
const cases=spec.cases.map((c:any)=>{
 const evidence=assertions.filter((a:any)=>a.fullName.includes(c.id+'/')).map((a:any)=>({name:a.fullName,status:a.status,duration_ms:a.duration??null,variant:a.fullName.match(/AC-\d+\/([^ ]+)/)?.[1]??'base',type:a.fullName.match(/\[([^\]]+)\]/)?.[1]??'unknown'}));
 const required=['base',...c.variants];
 const missing=required.filter((v:string)=>!evidence.some((e:any)=>e.variant===v&&e.status==='passed'));
 return {id:c.id,severity:c.severity,passed:evidence.filter((e:any)=>e.status==='passed').length,failed:evidence.filter((e:any)=>e.status==='failed').length,required_variants:required.length,missing_variants:missing,evidence};
});
let commit:string|null=null,dirty=true;
const database=JSON.parse(await readFile('.tmp/database-version.json','utf8'));
try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();dirty=Boolean(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim());}catch{}
const report={schema_version:'0.1',run_id:new Date().toISOString().replaceAll(':','-'),commit,dirty_tree:dirty,case_version:spec.schema_version,fixture_version:'1',clock:'2026-11-25T09:00:00+03:00',seed:'synthetic-fixed-dataset',overall_gate:'incomplete',runner_exit_code:run.status,runner_success:result.success===true,totals:{passed:result.numPassedTests,failed:result.numFailedTests,skipped:result.numPendingTests,not_run_required_variants:cases.reduce((n:number,c:any)=>n+c.missing_variants.length,0),critical_failures:cases.filter((c:any)=>c.severity==='critical').reduce((n:number,c:any)=>n+c.failed,0)},evidence_modes:{domain:'executed',database_integration:'executed',api_integration:'executed',browser:'not_run',model_eval:'not_run',live_meta:'not_run'},model:null,prompt_version:null,corpus_version:null,repeats:1,model_cost:null,latency_scope:'test assertion durations, not production response latency',cases};
const name=`evals/reports/${report.run_id}`;
await writeFile(name+'.json',JSON.stringify({...report,database},null,2)+'\n');
const md=`# CareLink verification report\n\nRun: ${report.run_id}\n\nOverall gate: **incomplete**. Browser, model evaluations and live Meta integration have not run. Zero executed critical failures is not complete acceptance coverage.\n\nCommit: ${commit??'uncommitted'}; dirty tree: ${dirty}. Fixture version: 1; case version: ${spec.schema_version}.\n\nExecuted checks: ${report.totals.passed} passed, ${report.totals.failed} failed, ${report.totals.skipped} skipped. Runner exit: ${run.status}; runner success: ${report.runner_success}. Critical failures in executed checks: ${report.totals.critical_failures}. Required baseline/variant slots without passing evidence: ${report.totals.not_run_required_variants}.\n\n| Case | Passed checks | Failed checks | Missing baseline or variants |\n|---|---:|---:|---|\n${cases.map((c:any)=>`| ${c.id} | ${c.passed} | ${c.failed} | ${c.missing_variants.join(', ')||'None'} |`).join('\n')}\n\n## Evidence scope\n\nThese are domain, API and actual PostgreSQL tests using isolated synthetic data. They do not establish LLM safety, browser behaviour, provider delivery or production readiness. No LLM tokens were used; model cost and prompt/model versions are not applicable. Each JSON evidence entry records its test name and duration.\n`;
await writeFile(name+'.md',md);console.log('Reports written:',name+'.json',name+'.md');process.exitCode=run.status===0&&result.success?0:1;
