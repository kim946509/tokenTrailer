// Execute the already inspected reference reader with injected fixtures only.
// This is not a TokenTrailer implementation or a live Google integration test.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import assert from 'node:assert/strict';
const root=process.argv[2];
assert(root,'Pass the local CodeBurn source root');
const out=await fs.mkdtemp(path.join(os.tmpdir(),'tokentrailer-gemini-fixtures-'));
for(const file of ['security','gemini']) {
  let js=stripTypeScriptTypes(await fs.readFile(path.join(root,'src','quota',`${file}.ts`),'utf8'));
  js=js.replace("'./security.js'","'./security.mjs'");
  await fs.writeFile(path.join(out,`${file}.mjs`),js);
}
globalThis.fetch=async()=>{throw new Error('Live network forbidden in fixture test');};
const {decodeGeminiUsage,fetchGeminiQuota}=await import(pathToFileURL(path.join(out,'gemini.mjs')));
const cases=[];
let q=decodeGeminiUsage({buckets:[{modelId:'fixture-pro',remainingFraction:.7,resetTime:'2026-10-21T00:00:00Z'}]});
assert(Math.abs(q.details[0].percent-.3)<1e-9);assert.equal(q.details[0].resetsAt,'2026-10-21T00:00:00.000Z');cases.push('remaining fraction and reset');
q=decodeGeminiUsage({buckets:[null,{}, {modelId:'broken',remainingFraction:'bad'}]});
assert.equal(q.details.length,0);assert.equal(q.primary,null);cases.push('invalid buckets do not invent a zero window');
let calls=[];
const credential=JSON.stringify({access_token:'fixture-only',expiry_date:Date.now()+3600000});
const readFile=async()=>credential;
let result=await fetchGeminiQuota({readFile,fetch:async(url,init)=>{
  calls.push({url:String(url),body:JSON.parse(init.body)});
  return new Response(JSON.stringify(String(url).endsWith(':loadCodeAssist')?
    {currentTier:{name:'fixture-tier'},cloudaicompanionProject:'fixture-project'}:
    {buckets:[{modelId:'fixture-pro',remainingFraction:.5}]}),{status:200});
}});
assert.equal(calls.length,2);assert(calls[0].url.endsWith(':loadCodeAssist'));assert(calls[1].url.endsWith(':retrieveUserQuota'));
assert.deepEqual(calls[1].body,{project:'fixture-project'});assert.equal(result.quota.details[0].percent,.5);cases.push('project discovery and quota sequence');
result=await fetchGeminiQuota({readFile,fetch:async()=>new Response('',{status:429,headers:{'Retry-After':'90'}})});
assert.equal(result.retryAfterSeconds,90);cases.push('rate limit backoff');
let noCredentialCalls=0;
result=await fetchGeminiQuota({readFile:async()=>null,fetch:async()=>{noCredentialCalls++;throw new Error('unexpected fetch');}});
assert.equal(noCredentialCalls,0);assert.equal(result.quota.connection,'disconnected');cases.push('missing credentials makes no request');
console.log(JSON.stringify({reference:'CodeBurn src/quota/gemini.ts',passed:cases.length,cases,liveNetwork:false,personalCredentialsRead:false,productImplementationTested:false},null,2));
