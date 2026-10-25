import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeGeminiQuota, fetchGeminiQuota } from '../src/providers/gemini-quota.mjs';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const bucket = { modelId: 'fixture-model', remainingFraction: .7, resetTime: '2026-10-21T00:00:00Z' };
const credential = JSON.stringify({ access_token: 'fixture-only', refresh_token: 'never-send' });
const options = { credentialPath: 'fixture', readFile: async () => credential };
globalThis.fetch = async () => { throw new Error('Live network forbidden'); };

test('valid percentages, duplicate model windows preserved, invalid values never become zero', () => {
  const decoded = decodeGeminiQuota({ buckets: [bucket, { ...bucket, remainingFraction: 1 }, null] });
  assert.equal(decoded.state, 'partial');
  assert.equal(decoded.windows.length, 2);
  assert.ok(Math.abs(decoded.windows[0].usedPercent - 30) < 1e-10);
  assert.equal(decoded.windows[1].usedPercent, 0);
  for (const value of [null, '0', -1, 2, NaN]) {
    assert.equal(decodeGeminiQuota({ buckets: [{ ...bucket, remainingFraction: value }] }).state, 'invalid-response');
  }
  assert.equal(decodeGeminiQuota({}).state, 'invalid-response');
  assert.equal(decodeGeminiQuota({ buckets: [{ ...bucket, resetTime: 'bad' }] }).state, 'partial');
});

test('fixed hosts, project discovery, no credential writes or secret output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-gemini-'));
  const file = join(dir, 'oauth_creds.json');
  try {
    await writeFile(file, credential);
    const calls = [];
    const value = await fetchGeminiQuota({ credentialPath: file, fetch: async (url, init) => {
      assert.ok(url.startsWith('https://cloudcode-pa.googleapis.com/v1internal:'));
      assert.equal(init.redirect, 'error');
      assert.ok(!init.body.includes('never-send'));
      calls.push(JSON.parse(init.body));
      return json(calls.length === 1 ? { cloudaicompanionProject: 'project-a', currentTier: { name: 'Fixture' } } : { buckets: [bucket] });
    } });
    assert.equal(value.state, 'success');
    assert.deepEqual(calls[1], { project: 'project-a' });
    assert.equal(await readFile(file, 'utf8'), credential);
    assert.ok(!JSON.stringify(value).includes('fixture-only'));
  } finally { await rm(dir, { recursive: true }); }
});

test('missing or malformed credentials perform no requests', async () => {
  for (const raw of ['', '{}', '{', 'x'.repeat(65537)]) {
    const value = await fetchGeminiQuota({ ...options, readFile: async () => raw, fetch: () => assert.fail('unexpected request') });
    assert.equal(value.state, 'authentication-required');
  }
  assert.equal((await fetchGeminiQuota()).state, 'not-connected');
});

test('401 same token stops; changed quota token rediscovers its project', async () => {
  let calls = 0;
  assert.equal((await fetchGeminiQuota({ ...options, fetch: async () => { calls++; return json({}, 401); } })).state, 'authentication-required');
  assert.equal(calls, 1);
  let reads = 0;
  const bodies = [];
  const value = await fetchGeminiQuota({ ...options,
    readFile: async () => JSON.stringify({ access_token: ++reads === 1 ? 'old' : 'new' }),
    fetch: async (url, init) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 2) return json({}, 401);
      return json(url.endsWith(':loadCodeAssist') ? { cloudaicompanionProject: bodies.length === 1 ? 'old-project' : 'new-project' } : { buckets: [bucket] });
    } });
  assert.equal(value.state, 'success');
  assert.deepEqual(bodies[3], { project: 'new-project' });
  assert.equal(reads, 2);
});

test('errors at either API stage are classified without raw error disclosure', async () => {
  for (const stage of [1, 2]) {
    for (const [response, state] of [
      [() => json({}, 403), 'access-denied'],
      [() => json({}, 500), 'request-failed'],
      [() => json({ error: { status: 'UNSUPPORTED_CLIENT', message: 'private' } }), 'unsupported'],
      [() => json({ error: { message: 'IneligibleTierError private' } }, 403), 'unsupported'],
      [() => new Response('not-json'), 'invalid-response'],
    ]) {
      let calls = 0;
      const value = await fetchGeminiQuota({ ...options, fetch: async () => ++calls === stage ? response() : json({}) });
      assert.equal(value.state, state);
      assert.ok(!JSON.stringify(value).includes('private'));
    }
  }
});

test('Retry-After seconds and HTTP date, cancellation and network failure', async () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  for (const raw of ['90', 'Tue, 20 Oct 2026 00:01:30 GMT']) {
    const value = await fetchGeminiQuota({ ...options, now: () => now,
      fetch: async () => json({}, 429, { 'Retry-After': raw }) });
    assert.equal(value.state, 'rate-limited');
    assert.equal(value.retryAt, now + 90000);
  }
  assert.equal((await fetchGeminiQuota({ ...options, signal: AbortSignal.abort(), fetch: () => assert.fail() })).state, 'cancelled');
  assert.equal((await fetchGeminiQuota({ ...options, fetch: async () => { throw new Error('secret'); } })).state, 'request-failed');
});
