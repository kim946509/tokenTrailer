// Explicit local validation only; never prints credentials or conversation text.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import assert from 'node:assert/strict';

const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const keys = value => value && typeof value === 'object' ? Object.keys(value).sort() : [];
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir,e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) files.push({p,mtime:fs.statSync(p).mtimeMs});
  }
}
walk(path.join(home,'sessions'));
walk(path.join(home,'archived_sessions'));
files.sort((a,b)=>b.mtime-a.mtime);
const sources = new Map();
let sampled=0, tokenEvents=0, malformed=0, desktopFiles=0, desktopTokenEvents=0;
const audit={completeCounters:0,inputPlusOutputMismatches:0,cachedExceedsInput:0,reasoningExceedsOutput:0,repeatedCumulativeSnapshots:0,cumulativeDecreases:0};
const usageKeys=new Set(), rateKeys=new Set();
for (const f of files.slice(0,30)) {
  sampled++;
  let firstMeta=true, desktop=false;
  let lastTotal=null,lastSignature=null;
  const lines=readline.createInterface({input:fs.createReadStream(f.p),crlfDelay:Infinity});
  for await (const line of lines) {
    let r; try {r=JSON.parse(line);} catch {malformed++;continue;}
    if(r.type==='session_meta' && firstMeta) {
      firstMeta=false;
      const p=r.payload || {};
      desktop=p.originator==='Codex Desktop';
      if(desktop)desktopFiles++;
      // Only allow known public source categories, never arbitrary session fields.
      const origin=desktop?'Codex Desktop':typeof p.originator==='string' && /^[a-zA-Z0-9_.-]{1,70}$/.test(p.originator) ? p.originator : 'other';
      const source=typeof p.source==='string' && /^[a-zA-Z0-9_.-]{1,40}$/.test(p.source) ? p.source : 'structured-or-unknown';
      const key=`${origin}/${source}`; sources.set(key,(sources.get(key)||0)+1);
    }
    if(r.type==='event_msg' && r.payload?.type==='token_count') {
      tokenEvents++;
      if(desktop)desktopTokenEvents++;
      for(const k of keys(r.payload.info?.total_token_usage))usageKeys.add(k);
      for(const k of keys(r.payload.rate_limits))rateKeys.add(k);
      const u=r.payload.info?.total_token_usage;
      if(u && ['input_tokens','output_tokens','total_tokens'].every(k=>Number.isSafeInteger(u[k]) && u[k]>=0)) {
        audit.completeCounters++;
        if(u.input_tokens+u.output_tokens!==u.total_tokens)audit.inputPlusOutputMismatches++;
        if(Number.isFinite(u.cached_input_tokens) && u.cached_input_tokens>u.input_tokens)audit.cachedExceedsInput++;
        if(Number.isFinite(u.reasoning_output_tokens) && u.reasoning_output_tokens>u.output_tokens)audit.reasoningExceedsOutput++;
        const signature=JSON.stringify(Object.fromEntries(Object.keys(u).sort().map(k=>[k,u[k]])));
        if(signature===lastSignature)audit.repeatedCumulativeSnapshots++;
        if(lastTotal!==null && u.total_tokens<lastTotal)audit.cumulativeDecreases++;
        lastTotal=u.total_tokens;lastSignature=signature;
      }
    }
  }
}
const result={sampledFiles:sampled,sources:Object.fromEntries(sources),desktopFiles,desktopTokenEvents,tokenEvents,malformedLines:malformed,
  counterAudit:audit,
  usageFieldNames:[...usageKeys].sort(),recordedRateLimitFieldNames:[...rateKeys].sort(),
  limitation:'Recent 30 files only; local rate_limits are historical, not a fresh account query.'};

if(process.argv.includes('--quota')) {
  const authPath=path.join(home,'auth.json');
  const before=fs.readFileSync(authPath);
  const a=JSON.parse(before);
  result.auth={mode:a.auth_mode === 'chatgpt'?'chatgpt':'other-or-unspecified',
    hasAccessToken:typeof a.tokens?.access_token==='string',hasAccountId:typeof a.tokens?.account_id==='string'};
  if(a.tokens?.access_token) {
    try {
      const headers={Authorization:`Bearer ${a.tokens.access_token}`};
      if(a.tokens.account_id)headers['ChatGPT-Account-Id']=a.tokens.account_id;
      const response=await fetch('https://chatgpt.com/backend-api/wham/usage',{
        headers,redirect:'error',signal:AbortSignal.timeout(20000)});
      result.quota={httpStatus:response.status};
      if(response.ok) {
        const body=await response.json();
        result.quota.hasPlanType=typeof body.plan_type==='string';
        result.quota.windows=['primary_window','secondary_window'].map(name=>{
          const w=body.rate_limit?.[name];
          return {name,present:!!w,validUsedPercent:typeof w?.used_percent==='number' && Number.isFinite(w.used_percent),
            hasResetEpoch:typeof w?.reset_at==='number',hasDuration:typeof w?.limit_window_seconds==='number'};
        });
      }
    } catch(e) {result.quota={errorType:e.name};}
  }
  result.authFileUnchanged=hash(before)===hash(fs.readFileSync(authPath));
  assert.equal(result.authFileUnchanged,true,'Auth file changed during probe (external writer possible)');
}
assert(sampled>0,'No session fixtures found');
assert(tokenEvents>0,'No token_count records observed');
console.log(JSON.stringify(result,null,2));
