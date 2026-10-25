import { EventEmitter } from 'node:events';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { collect } from './collection.mjs';
import { analyze } from './analysis.mjs';
import { connectedProviders } from './presence.mjs';
import { emptyStore, loadJSON, saveJSON, deleteHistory, allowReimport } from './store.mjs';
import { fetchQuota, credentialRevision } from './providers/quota.mjs';

export const providers = ['claude', 'codex', 'gemini'];
export const intervals = [5, 15, 30, 60, 300];
export function defaultSettings() {
  return { version: 1, widget: false, alwaysOnTop: true, taskbar: true, hiddenStart: false, autoStart: false,
    selectedProvider: 'codex', connectionOrder: [...providers], widgetBounds: null, widgetOpacity: 1,
    sources: Object.fromEntries(providers.map(p => [p, { enabled: false, quota: false, interval: 300,
      home: p === 'codex' ? process.env.CODEX_HOME || join(homedir(), '.codex') : p === 'claude' ? process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude') : join(homedir(), '.gemini') }])) };
}
export function validateSettings(value) {
  if (!value || value.version !== 1 || !providers.includes(value.selectedProvider)) throw new Error('잘못된 설정');
  for (const key of ['widget', 'alwaysOnTop', 'taskbar', 'hiddenStart', 'autoStart']) if (typeof value[key] !== 'boolean') throw new Error('잘못된 설정');
  for (const p of providers) {
    const s = value.sources?.[p];
    if (!s || typeof s.enabled !== 'boolean' || typeof s.quota !== 'boolean' || !intervals.includes(s.interval) ||
        typeof s.home !== 'string' || !isAbsolute(s.home) || s.home.length > 2048) throw new Error('출처 또는 갱신 설정을 확인하세요');
  }
  if (value.widgetBounds != null && !['x', 'y', 'width', 'height'].every(k => Number.isFinite(value.widgetBounds[k]))) throw new Error('잘못된 위젯 위치');
  const result = structuredClone(value);
  if (result.widgetOpacity === undefined) result.widgetOpacity = 1;
  if (!Number.isFinite(result.widgetOpacity) || result.widgetOpacity < 0.3 || result.widgetOpacity > 1) throw new Error('위젯 불투명도는 30~100%입니다');
  result.connectionOrder ??= [value.selectedProvider, ...providers.filter(p => p !== value.selectedProvider)];
  if (!Array.isArray(result.connectionOrder) || result.connectionOrder.length !== providers.length || new Set(result.connectionOrder).size !== providers.length || result.connectionOrder.some(p => !providers.includes(p))) throw new Error('잘못된 연결 순서');
  return result;
}
export class Engine extends EventEmitter {
  constructor(directory, quota = fetchQuota) {
    super(); this.directory = directory; this.fetchQuota = quota;
    this.status = {}; this.quotas = {}; this.pending = {}; this.revisions = {}; this.failures = {}; this.generation = 0; this.error = null;
    this.storeQueue = Promise.resolve();
  }
  async init() {
    this.settings = validateSettings(await loadJSON(join(this.directory, 'settings.json'), defaultSettings()));
    this.store = await loadJSON(join(this.directory, 'history.json'), emptyStore());
    if (this.store?.version !== 1 || !this.store.events || !this.store.files || !this.store.excluded) throw new Error('이력 파일 구조가 손상되었습니다. 파일은 보존됩니다.');
    for (const event of Object.values(this.store.events)) {
      if (!providers.includes(event.provider) || !Number.isSafeInteger(event.total) || event.total < 0) throw new Error('이력 값이 손상되었습니다. 파일은 보존됩니다.');
    }
    return this;
  }
  view(filter) {
    const connected = connectedProviders(this.settings), events = Object.values(this.store.events);
    return { settings: this.settings, status: this.status, quotas: this.quotas, busy: !!this.scanning,
      connectedProviders: connected, historicalProviders: providers.filter(p => events.some(e => e.provider === p)),
      error: this.error, eventCount: Object.keys(this.store.events).length,
      analysis: analyze(events, { ...filter, allowedProviders: filter?.provider === 'connected' ? connected : null }), today: analyze(events).total };
  }
  async configure(next) {
    const value = validateSettings(next);
    const job = this.storeQueue.then(async () => {
      await saveJSON(join(this.directory, 'settings.json'), value);
      for (const p of providers) {
        if (JSON.stringify(value.sources[p]) !== JSON.stringify(this.settings.sources[p])) {
          this.pending[p]?.abort(); delete this.quotas[p];
        }
      }
      this.generation++; this.settings = value; this.emit('change');
    });
    this.storeQueue = job.catch(() => {}); return job;
  }
  async scan() {
    if (this.scanning) return this.scanning;
    this.scanning = this.storeQueue.then(async () => {
      const next = structuredClone(this.store);
      const statuses = {};
      for (const p of providers) {
        if (!this.settings.sources[p].enabled) { statuses[p] = { state: 'not-connected' }; continue; }
        statuses[p] = await collect(p, this.settings.sources[p].home, next);
        statuses[p].lastSuccess ??= this.status[p]?.lastSuccess;
      }
      await saveJSON(join(this.directory, 'history.json'), next);
      this.store = next; this.status = statuses; this.error = null;
    }).catch(() => { this.error = '수집 또는 저장에 실패했습니다. 이전 이력을 유지합니다.'; }).finally(() => { this.scanning = null; this.emit('change'); });
    this.storeQueue = this.scanning;
    this.emit('change'); return this.scanning;
  }
  async refreshQuotas(manual = false) {
    await Promise.all(providers.map(async p => {
      const source = this.settings.sources[p], previous = this.quotas[p];
      if (!source.quota || this.pending[p] || previous?.retryAt > Date.now() || (!manual && previous?.nextAt > Date.now())) return;
      const generation = this.generation, controller = new AbortController(); this.pending[p] = controller;
      try {
        const revision = await credentialRevision(p, source.home);
        const sameCredential = revision != null && this.revisions[p] === revision;
        this.revisions[p] = revision;
        const value = await this.fetchQuota(p, source.home, { signal: controller.signal });
        if (generation !== this.generation || controller.signal.aborted) return;
        // No old windows are attached to an unverified/changed account after an auth failure.
        const stale = sameCredential && ['request-failed', 'rate-limited', 'timeout'].includes(value.state) && previous?.windows?.length;
        const paused = ['authentication-required', 'access-denied', 'unsupported'].includes(value.state);
        const failed = ['request-failed', 'timeout', 'invalid-response'].includes(value.state);
        this.failures[p] = failed ? (this.failures[p] ?? 0) + 1 : 0;
        const backoff = failed ? [60000, 300000, 900000][Math.min(2, this.failures[p] - 1)] : 0;
        this.quotas[p] = { ...value, ...(stale ? { windows: previous.windows, fetchedAt: previous.fetchedAt, stale: true } : {}),
          lastAttemptAt: Date.now(), nextAt: paused ? Number.MAX_SAFE_INTEGER : Math.max(value.retryAt ?? 0, Date.now() + Math.max(source.interval * 1000, backoff)) };
      } finally { if (this.pending[p] === controller) delete this.pending[p]; this.emit('change'); }
    }));
  }
  async historyAction(action, provider) {
    if (!['delete', 'reimport'].includes(action) || !['all', ...providers].includes(provider)) throw new Error('잘못된 요청');
    const job = this.storeQueue.then(async () => {
      const next = structuredClone(this.store);
      if (action === 'delete') deleteHistory(next, provider); else allowReimport(next, provider);
      await saveJSON(join(this.directory, 'history.json'), next); this.store = next; this.emit('change');
    });
    this.storeQueue = job.catch(() => {}); await job;
    if (action === 'reimport') await this.scan();
  }
  start() {
    this.scan(); this.refreshQuotas();
    this.localTimer = setInterval(() => this.scan(), 30000);
    this.quotaTimer = setInterval(() => this.refreshQuotas(), 1000);
  }
  stop() { clearInterval(this.localTimer); clearInterval(this.quotaTimer); for (const c of Object.values(this.pending)) c.abort(); }
}
