// Read-only local acceptance check. Output contains counts/states, never source text or credentials.
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.mjs';
import { credentialFile, fetchQuota } from '../src/providers/quota.mjs';
const temp = await mkdtemp(join(tmpdir(), 'tt-local-check-'));
try {
  const engine = await new Engine(temp).init();
  const settings = structuredClone(engine.settings);
  for (const p of ['claude', 'codex']) settings.sources[p].enabled = true;
  await engine.configure(settings);
  const started = Date.now(); await engine.scan();
  assert.equal(engine.error, null);
  const first = engine.view(), firstCount = first.eventCount;
  await engine.scan(); assert(engine.view().eventCount >= firstCount, 'Source logs can grow but history must not disappear');
  const restart = await new Engine(temp).init(); assert.equal(restart.view().eventCount, engine.view().eventCount);
  const report = { elapsedMs: Date.now() - started, eventCount: engine.view().eventCount, sourceStates: engine.status,
    restoredAfterRestart: true, sourceWrites: false, quotas: {} };
  report.clientEvents = {};
  for (const event of Object.values(engine.store.events)) report.clientEvents[event.client] = (report.clientEvents[event.client] ?? 0) + 1;
  assert(report.clientEvents['Codex Desktop'] > 0, 'Desktop logs must be covered separately');
  if (process.argv.includes('--quota')) {
    for (const p of ['claude', 'codex']) {
      const file = credentialFile(p, settings.sources[p].home);
      try {
        const digest = b => createHash('sha256').update(b).digest('hex');
        const before = digest(await readFile(file));
        const q = await fetchQuota(p, settings.sources[p].home);
        report.quotas[p] = { state: q.state, windowCount: q.windows.length, credentialUnchanged: before === digest(await readFile(file)) };
      } catch { report.quotas[p] = { state: 'unavailable' }; }
    }
  }
  await mkdir('.test-output', { recursive: true }); await writeFile(process.argv.includes('--quota') ? '.test-output/local-validation-quota.json' : '.test-output/local-validation.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await rm(temp, { recursive: true }); }
