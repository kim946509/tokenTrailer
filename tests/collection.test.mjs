import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRecords, collect } from '../src/collection.mjs';
import { emptyStore, saveJSON, loadJSON, deleteHistory, allowReimport } from '../src/store.mjs';
import { analyze, periodRange } from '../src/analysis.mjs';
const lines = values => values.map(JSON.stringify).join('\n') + '\n';
const claude = (id = 'message', output = 30) => ({ type: 'assistant', sessionId: 'session', timestamp: '2026-10-20T01:00:00Z', cwd: 'C:/fixture', message: { id, model: 'fixture', content: 'PRIVATE', usage: { input_tokens: 60, output_tokens: output, cache_read_input_tokens: 40, cache_creation_input_tokens: 20 } } });
test('Claude streams upsert, additive cache, corrupt tails and no conversation metadata', () => {
  const p = parseRecords('claude', lines([claude(), claude('message', 50)]) + '{broken', 'source');
  assert.equal(p.events.length, 1); assert.equal(p.events[0].total, 170); assert.equal(p.issues.deferred, 1);
  assert.ok(!JSON.stringify(p).includes('PRIVATE'));
  const bad = claude(); bad.message.usage.output_tokens = -1;
  assert.equal(parseRecords('claude', lines([bad]), 's').events.length, 0);
});
const codex = (input, output) => ({ type: 'event_msg', timestamp: '2026-10-20T01:00:00Z', payload: { type: 'token_count', info: {
  total_token_usage: { input_tokens: input, output_tokens: output, total_tokens: input + output, cached_input_tokens: 0, reasoning_output_tokens: 0 },
  last_token_usage: { total_tokens: input + output },
} } });
test('Codex cumulative 100→150, repeated snapshot and decrease do not double count', () => {
  const p = parseRecords('codex', lines([{ type: 'session_meta', payload: { id: 'session', originator: 'Codex Desktop' } }, codex(80, 20), codex(80, 20), codex(120, 30), codex(10, 10)]), 's');
  assert.equal(p.events.reduce((n, e) => n + e.total, 0), 150); assert.equal(p.events[0].client, 'Codex Desktop'); assert.equal(p.issues.incomplete, 1);
  const fork = parseRecords('codex', lines([{ type: 'session_meta', payload: { id: 'fork', forked_from_id: 'parent' } }, codex(80, 20)]), 's');
  assert.equal(fork.events.length, 0); assert.equal(fork.issues.unsupported, 1);
});
test('Gemini JSON and JSONL use same keys; cache subset, thoughts separate', () => {
  const header = { sessionId: 'session', projectHash: 'project' };
  const message = { id: 'message', type: 'gemini', timestamp: '2026-10-20T01:00:00Z', model: 'fixture', tokens: { input: 100, output: 30, thoughts: 10, cached: 40, total: 140 } };
  const a = parseRecords('gemini', JSON.stringify({ ...header, messages: [message] }), 's');
  const b = parseRecords('gemini', lines([header, message]), 's');
  assert.deepEqual(a.events, b.events); assert.equal(a.events[0].total, 140);
  message.tokens.total = 999;
  assert.equal(parseRecords('gemini', lines([header, message]), 's').issues.incomplete, 1);
});
test('Codex fork replay matches parent usage before fork, retaining only new delta', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-fork-'));
  try {
    await mkdir(join(dir, 'sessions'));
    const parent = { type: 'session_meta', payload: { id: 'parent', timestamp: '2026-10-20T00:00:00Z' } };
    const child = { type: 'session_meta', payload: { id: 'child', forked_from_id: 'parent', timestamp: '2026-10-20T02:00:00Z', originator: 'Codex Desktop' } };
    await writeFile(join(dir, 'sessions', 'parent.jsonl'), lines([parent, codex(80, 20)]));
    await writeFile(join(dir, 'sessions', 'child.jsonl'), lines([child, codex(80, 20), codex(120, 30)]));
    const store = emptyStore(); const status = await collect('codex', dir, store);
    assert.equal(status.unsupported, 0);
    assert.equal(Object.values(store.events).reduce((n, e) => n + e.total, 0), 150);
    assert.equal(Object.values(store.events).find(e => e.session === 'child').total, 50);
  } finally { await rm(dir, { recursive: true }); }
});
test('three scans, copy, restart, original removal, deletion and explicit reimport', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-ingest-'));
  try {
    const home = join(dir, 'home'), projects = join(home, 'projects'); await mkdir(projects, { recursive: true });
    const file = join(projects, 'a.jsonl'), original = lines([claude()]); await writeFile(file, original);
    let store = emptyStore();
    for (let i = 0; i < 3; i++) await collect('claude', home, store);
    assert.equal(Object.keys(store.events).length, 1);
    await copyFile(file, join(projects, 'copy.jsonl')); await collect('claude', home, store); assert.equal(Object.keys(store.events).length, 1);
    const saved = join(dir, 'history.json'); await saveJSON(saved, store); store = await loadJSON(saved);
    await collect('claude', home, store); assert.equal(Object.keys(store.events).length, 1);
    assert.equal(await readFile(file, 'utf8'), original);
    deleteHistory(store, 'claude'); await collect('claude', home, store); assert.equal(Object.keys(store.events).length, 0);
    await writeFile(file, original + lines([claude('new')])); await collect('claude', home, store); assert.equal(Object.keys(store.events).length, 1);
    allowReimport(store, 'claude'); await collect('claude', home, store); assert.equal(Object.keys(store.events).length, 2);
    await rm(home, { recursive: true }); await collect('claude', home, store); assert.equal(Object.keys(store.events).length, 2);
    await writeFile(saved, '{broken'); await assert.rejects(loadJSON(saved)); assert.equal(await readFile(saved, 'utf8'), '{broken');
  } finally { await rm(dir, { recursive: true }); }
});
test('analysis uses local boundaries, half-open intervals, all project/session totals match', () => {
  const now = new Date(2026, 9, 20, 12).getTime(), start = periodRange('today', now).start;
  const rows = [40, 60, 20].map((total, i) => ({ provider: 'claude', session: 's', project: i === 2 ? null : 'A', total, timestamp: new Date(start + (i - 1) * 3600000).toISOString() }));
  rows.push({ provider: 'claude', session: 'unknown', total: 25, timestamp: null });
  const a = analyze(rows, {}, now); assert.equal(a.total, 80); assert.equal(a.unknownTimeTokens, 25);
  assert.equal(a.buckets.reduce((n, b) => n + b.total, 0), 80); assert.equal(a.projects.reduce((n, p) => n + p.total, 0), 80);
  assert.equal(analyze(rows, { bucket: start }, now).total, 60);
  assert.equal(new Date(periodRange('week', now).start).getDay(), 1);
});
