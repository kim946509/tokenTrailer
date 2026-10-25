import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeQuota, fetchQuota } from '../src/providers/quota.mjs';
import { Engine, validateSettings, defaultSettings } from '../src/engine.mjs';
test('Claude and Codex preserve zero, missing windows and invalid reset', () => {
  assert.equal(decodeQuota('claude', { five_hour: { utilization: 0, resets_at: '2026-10-21T00:00:00Z' } }).windows[0].usedPercent, 0);
  const q = decodeQuota('codex', { rate_limit: { primary_window: { used_percent: 35, reset_at: 1792540800, limit_window_seconds: 18000 } } });
  assert.equal(q.state, 'success'); assert.equal(q.windows.length, 1);
  assert.equal(decodeQuota('codex', { rate_limit: { primary_window: { used_percent: null } } }).state, 'invalid-response');
});
test('readonly Claude/Codex 401 re-read and 429 without leaking headers', async () => {
  for (const p of ['claude', 'codex']) {
    let calls = 0, reads = 0;
    const q = await fetchQuota(p, 'fixture', { now: () => 1000,
      readCredential: async () => p === 'claude' ? { claudeAiOauth: { accessToken: ++reads === 1 ? 'old' : 'new' } } : { tokens: { access_token: ++reads === 1 ? 'old' : 'new', account_id: 'fixture' } },
      fetch: async (url, init) => { assert.equal(init.redirect, 'error'); assert.ok(url.startsWith('https://')); return ++calls === 1 ? new Response('', { status: 401 }) : new Response('', { status: 429, headers: { 'Retry-After': '90' } }); } });
    assert.equal(q.state, 'rate-limited'); assert.equal(q.retryAt, 91000); assert.equal(calls, 2); assert.equal(reads, 2); assert.ok(!JSON.stringify(q).includes('Bearer'));
  }
});
test('scheduler respects retryAt, combines concurrent refresh and discards disconnected response', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-engine-'));
  let release, calls = 0;
  let start;
  let entered = new Promise(resolve => start = resolve);
  try {
    const engine = await new Engine(dir, async () => { calls++; start(); return new Promise(r => release = r); }).init();
    const config = structuredClone(engine.settings); config.sources.codex.quota = true; await engine.configure(config);
    const pending = engine.refreshQuotas(); await entered; await engine.refreshQuotas(true); assert.equal(calls, 1);
    release({ state: 'rate-limited', windows: [], retryAt: Date.now() + 90000 }); await pending;
    await engine.refreshQuotas(true); assert.equal(calls, 1);
    delete engine.quotas.codex;
    entered = new Promise(resolve => start = resolve);
    const late = engine.refreshQuotas(); await entered; config.sources.codex.quota = false; await engine.configure(config);
    release({ state: 'success', windows: [{ usedPercent: 100 }] }); await late; assert.equal(engine.quotas.codex, undefined);
    assert.throws(() => validateSettings({ ...defaultSettings(), selectedProvider: 'invalid' }));
    engine.stop();
  } finally { await rm(dir, { recursive: true }); }
});
test('concurrent collection and deletion serialize; failed settings save preserves active settings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-transaction-'));
  try {
    const home = join(dir, 'claude'); await mkdir(join(home, 'projects'), { recursive: true });
    await writeFile(join(home, 'projects', 'fixture.jsonl'), JSON.stringify({ type: 'assistant', sessionId: 's', timestamp: '2026-10-20T01:00:00Z', message: { id: 'm', usage: { input_tokens: 10, output_tokens: 20 } } }) + '\n');
    const engine = await new Engine(join(dir, 'data')).init();
    const config = structuredClone(engine.settings); config.sources.claude.enabled = true; config.sources.claude.home = home;
    await engine.configure(config);
    const scan = engine.scan(), deletion = engine.historyAction('delete', 'all'); await Promise.all([scan, deletion]);
    await engine.scan(); assert.equal(Object.keys(engine.store.events).length, 0);
    await engine.historyAction('reimport', 'all'); assert.equal(Object.keys(engine.store.events).length, 1);
    await mkdir(join(dir, 'data', 'settings.json.tmp'));
    const next = structuredClone(config); next.widget = true;
    await assert.rejects(engine.configure(next)); assert.equal(engine.settings.widget, false);
    const reopened = await new Engine(join(dir, 'data')).init(); assert.equal(reopened.settings.widget, false);
    engine.stop(); reopened.stop();
  } finally { await rm(dir, { recursive: true }); }
});
