import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const file=path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(),'.claude'),'.credentials.json');
const report={credentialPresent:fs.existsSync(file),networkRequested:false};
if(report.credentialPresent && process.argv.includes('--quota')) {
  const raw=fs.readFileSync(file), hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  const oauth=JSON.parse(raw).claudeAiOauth;
  report.accessTokenPresent=typeof oauth?.accessToken==='string';
  if(report.accessTokenPresent) {
    report.networkRequested=true;
    try {
      const response=await fetch('https://api.anthropic.com/api/oauth/usage',{
        headers:{Authorization:`Bearer ${oauth.accessToken}`,'anthropic-beta':'oauth-2025-04-20'},
        redirect:'error',signal:AbortSignal.timeout(20000)});
      report.httpStatus=response.status;
      if(response.ok) {
        const body=await response.json();
        report.windows=['five_hour','seven_day'].map(name=>({name,present:!!body[name],
          validPercent:typeof body[name]?.utilization==='number' && Number.isFinite(body[name].utilization),
          validReset:typeof body[name]?.resets_at==='string' && Number.isFinite(Date.parse(body[name].resets_at))}));
      }
      if(response.status===429)report.retryAfterPresent=response.headers.has('Retry-After');
    } catch(e){report.errorType=e.name;}
  }
  report.authFileUnchanged=hash(raw)===hash(fs.readFileSync(file));
  assert.equal(report.authFileUnchanged,true,'Credential changed during probe; external writer possible');
}
console.log(JSON.stringify(report,null,2));
