import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings, validateSettings, Engine } from '../src/engine.mjs';
import { connectedProviders, taskbarText, taskbarResetItems } from '../src/presence.mjs';
import { analyze } from '../src/analysis.mjs';

test('order migration, validation, persistence and top two connected quota rows', async () => {
  const config = defaultSettings(); delete config.connectionOrder;
  delete config.widgetOpacity;
  assert.equal(validateSettings(config).widgetOpacity, 1);
  for (const widgetOpacity of [0.29, 1.01, NaN, null, '0.5']) assert.throws(() => validateSettings({...config, widgetOpacity}));
  config.widgetOpacity = 0.3; assert.equal(validateSettings(config).widgetOpacity, 0.3);
  config.widgetOpacity = 0.5;
  assert.deepEqual(validateSettings(config).connectionOrder, ['codex', 'claude', 'gemini']);
  assert.throws(() => validateSettings({ ...config, connectionOrder: ['claude', 'claude', 'gemini'] }));
  config.connectionOrder = ['gemini', 'claude', 'codex'];
  config.sources.claude.quota = true; config.sources.codex.enabled = true;
  assert.deepEqual(connectedProviders(config), ['claude', 'codex']);
  const quotas = { claude: { windows: [{ modelId: 'five_hour', usedPercent: 0 }, { modelId: 'seven_day', usedPercent: 64 }] } };
  assert.equal(taskbarText(config, quotas), 'Claude 5h 0% · 7d 64%\nCodex --');
  assert.equal(taskbarText(config, quotas, true), 'CL 5h 0% · 7d 64%\nCX --');
  config.sources.gemini.quota = true;
  quotas.claude.stale = true; quotas.claude.windows.push({ modelId: 'seven_day_opus', usedPercent: 80 });
  assert.equal(taskbarText(config, quotas), 'Gemini --\nClaude 5h 0% · 7d 64% +1 *');
  quotas.claude.windows.reverse();
  assert.equal(taskbarText(config, quotas), 'Gemini --\nClaude 5h 0% · 7d 64% +1 *');
  const dir = await mkdtemp(join(tmpdir(), 'tt-order-'));
  try {
    const engine = await new Engine(dir).init(); await engine.configure(config);
    const restored = await new Engine(dir).init();
    assert.deepEqual(restored.settings.connectionOrder, config.connectionOrder);
    assert.equal(restored.settings.widgetOpacity, 0.5);
  } finally { await rm(dir, { recursive: true }); }
});

test('AI filters retain period/bucket/project scope and distinguish retained history', () => {
  const now = new Date(2026, 9, 20, 12).getTime();
  const events = [
    { provider: 'claude', total: 10, project: 'A', session: '1', timestamp: new Date(2026, 9, 20, 9).toISOString() },
    { provider: 'codex', total: 20, project: 'A', session: '2', timestamp: new Date(2026, 9, 20, 9).toISOString() },
    { provider: 'gemini', total: 30, project: 'B', session: '3', timestamp: new Date(2026, 9, 20, 10).toISOString() },
    { provider: 'claude', total: 40, project: 'B', session: '4', timestamp: null },
  ];
  const all = analyze(events, {}, now);
  assert.deepEqual(all.providerTotals, { claude: 10, codex: 20, gemini: 30 });
  assert.deepEqual(all.projects.find(p => p.key === 'A').providers, { claude: 10, codex: 20 });
  const connected = analyze(events, { provider: 'connected', allowedProviders: ['claude', 'codex'] }, now);
  assert.equal(connected.total, 30); assert.equal(connected.unknownTimeTokens, 40);
  assert.equal(analyze(events, { provider: 'connected', allowedProviders: [] }, now).total, 0);
  const selected = analyze(events, { provider: 'codex', project: 'A', bucket: all.buckets.find(b => b.total === 30).start }, now);
  assert.equal(selected.total, 20); assert.equal(selected.sessions.length, 1);
  assert.equal(selected.sessions[0].provider, 'codex');
  assert.equal(selected.projects.reduce((n, p) => n + p.total, 0), selected.total);
  assert.equal(selected.buckets.reduce((n, b) => n + b.total, 0), selected.periodTotal);
});

test('reset menu has only connected quota remaining times, not calendar dates', () => {
  const settings=defaultSettings();settings.sources.claude.quota=true;
  const now=Date.now(), quotas={claude:{windows:[{modelId:'five_hour',resetsAt:now+3600000},{modelId:'seven_day',resetsAt:null}]}};
  assert.deepEqual(taskbarResetItems(settings,quotas,now).map(i=>i.label),['Claude','5시간   1시간 후 초기화','주간   미확인']);
  quotas.claude.windows[0].resetsAt=now-1;
  assert.equal(taskbarResetItems(settings,quotas,now)[1].label,'5시간   갱신 대기');
  settings.sources.claude.quota=false;
  assert.equal(taskbarResetItems(settings,quotas)[0].label,'연결된 AI가 없습니다');
});
