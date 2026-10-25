import { readdir, lstat, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';

export const hash = value => createHash('sha256').update(value).digest('hex');
const count = n => Number.isSafeInteger(n) && n >= 0;
const text = v => typeof v === 'string' ? v : null;
const time = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;

const usageIdentity = info => hash(JSON.stringify(['total_token_usage', 'last_token_usage'].map(field =>
  ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'].map(k => info?.[field]?.[k] ?? null))));
function codexIndex(raw) {
  let meta; const usages = [];
  for (const line of raw.split('\n')) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.type === 'session_meta') meta ??= r.payload;
    if (r.type === 'event_msg' && r.payload?.type === 'token_count' && r.payload.info?.total_token_usage) usages.push([Date.parse(r.timestamp), usageIdentity(r.payload.info)]);
  }
  return meta?.id ? { session: meta.id, usages } : null;
}
export function parseRecords(provider, raw, sourceKey, parents = new Map()) {
  const events = new Map();
  const issues = { malformed: 0, incomplete: 0, unsupported: 0, deferred: 0 };
  let records = [];
  if (provider === 'gemini') {
    try { const document = JSON.parse(raw); if (Array.isArray(document.messages)) records = [document]; } catch {}
  }
  if (!records.length) {
    const lines = raw.split('\n');
    if (lines.at(-1)?.trim()) { lines.pop(); issues.deferred++; }
    for (const line of lines) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { issues.malformed++; }
    }
  }
  const emit = (id, session, timestamp, project, model, metrics, client = provider) => {
    if (!id || !session || !count(metrics.total)) { issues.incomplete++; return; }
    const key = hash(`${provider}:${session}:${id}`);
    events.set(key, { key, provider, session, timestamp: time(timestamp), project: text(project),
      model: text(model), client, sourceKey, ...metrics });
  };
  if (provider === 'claude') {
    for (const r of records) {
      const u = r.message?.usage;
      if (r.type !== 'assistant' || !u) continue;
      const input = u.input_tokens, output = u.output_tokens;
      const cacheRead = u.cache_read_input_tokens ?? 0, cacheWrite = u.cache_creation_input_tokens ?? 0;
      if (![input, output, cacheRead, cacheWrite].every(count)) { issues.incomplete++; continue; }
      emit(r.message.id ?? r.uuid, r.sessionId, r.timestamp, r.cwd, r.message.model,
        { input, output, cacheRead, cacheWrite, reasoning: null, total: input + output + cacheRead + cacheWrite });
    }
  } else if (provider === 'codex') {
    const meta = records.find(r => r.type === 'session_meta')?.payload;
    if (!meta?.id) { issues.unsupported++; return { events: [], issues }; }
    const parent = meta.forked_from_id ?? meta.forked_from ?? meta.parent_session_id;
    const forkAt = Date.parse(meta.timestamp ?? records.find(r => r.type === 'session_meta')?.timestamp);
    const inherited = parent && parents.get(parent);
    // shortcut: unresolved parents remain excluded rather than guessing which copied usage was new.
    if (parent && (!inherited || !Number.isFinite(forkAt))) { issues.unsupported++; return { events: [], issues }; }
    const inheritedKeys = new Set((inherited?.usages ?? []).filter(([at]) => Number.isFinite(at) && at <= forkAt).map(([, key]) => key));
    let previous = null, model = null;
    const client = meta.originator === 'Codex Desktop' ? 'Codex Desktop' : 'Codex CLI';
    for (const r of records) {
      if (r.type === 'turn_context') model = r.payload?.model ?? model;
      if (r.type !== 'event_msg' || r.payload?.type !== 'token_count') continue;
      const u = r.payload.info?.total_token_usage;
      if (!u || !['input_tokens', 'output_tokens', 'total_tokens'].every(k => count(u[k])) ||
          u.input_tokens + u.output_tokens !== u.total_tokens) { issues.incomplete++; continue; }
      if (parent && inheritedKeys.has(usageIdentity(r.payload.info))) { previous = u; continue; }
      if (previous && (u.input_tokens < previous.input_tokens || u.output_tokens < previous.output_tokens)) {
        issues.incomplete++; continue;
      }
      if (previous?.total_tokens === u.total_tokens) continue;
      const diff = k => count(u[k]) && (!previous || count(previous[k])) ? u[k] - (previous?.[k] ?? 0) : null;
      const input = diff('input_tokens'), output = diff('output_tokens');
      const cacheRead = diff('cached_input_tokens'), reasoning = diff('reasoning_output_tokens');
      if ((cacheRead != null && (cacheRead < 0 || cacheRead > input)) ||
          (reasoning != null && (reasoning < 0 || reasoning > output))) { issues.incomplete++; continue; }
      const metrics = { input, output, cacheRead, reasoning, cacheWrite: null, total: input + output };
      const last = r.payload.info?.last_token_usage;
      // A first cumulative snapshot can include older work; keep that time unknown.
      const timestamp = !previous && last?.total_tokens !== u.total_tokens ? null : r.timestamp;
      emit(`${u.input_tokens}:${u.output_tokens}`, meta.id, timestamp, meta.cwd, model, metrics, client);
      previous = u;
    }
  } else if (provider === 'gemini') {
    let session = records.find(r => r.sessionId);
    if (!session) { issues.unsupported++; return { events: [], issues }; }
    const messages = session.messages ?? records.filter(r => r.type === 'gemini');
    if (records.some(r => r.$set !== undefined)) issues.unsupported++;
    for (const r of messages) {
      if (r.type !== 'gemini' || !r.tokens) continue;
      const t = r.tokens, input = t.input, output = t.output;
      const reasoning = t.thoughts ?? 0, cacheRead = t.cached ?? 0, tool = t.tool ?? 0;
      if (![input, output, reasoning, cacheRead, tool].every(count) || cacheRead > input) { issues.incomplete++; continue; }
      const total = input + output + reasoning + tool;
      if (t.total != null && t.total !== total) { issues.incomplete++; continue; }
      emit(r.id, session.sessionId, r.timestamp, session.projectHash ? `hash:${session.projectHash}` : null, r.model,
        { input, output, reasoning, cacheRead, cacheWrite: null, tool, total });
    }
  }
  return { events: [...events.values()], issues };
}

async function* filesIn(dir, provider) {
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* filesIn(file, provider);
    else if (entry.isFile() && (entry.name.endsWith('.jsonl') || provider === 'gemini' && entry.name.endsWith('.json'))) {
      if (provider !== 'gemini' || /[\\/]chats[\\/]/.test(file)) yield file;
    }
  }
}

export async function collect(provider, home, store) {
  const roots = provider === 'claude' ? ['projects'] : provider === 'codex' ? ['sessions', 'archived_sessions'] : ['tmp'];
  const status = { state: 'success', files: 0, events: 0, malformed: 0, incomplete: 0, unsupported: 0, deferred: 0, failed: 0 };
  let rootsFound = 0;
  const parents = new Map();
  if (provider === 'codex') {
    for (const file of Object.values(store.files)) if (file.provider === 'codex' && file.codexIndex) parents.set(file.codexIndex.session, file.codexIndex);
    for (const suffix of roots) {
      try {
        for await (const file of filesIn(join(home, suffix), provider)) {
          const info = await lstat(file), key = hash(file), signature = `2:${info.size}:${info.mtimeMs}`;
          if (info.size > 128 * 1024 * 1024) continue;
          const index = store.files[key]?.signature === signature ? store.files[key].codexIndex : codexIndex(await readFile(file, 'utf8'));
          if (index) parents.set(index.session, index);
        }
      } catch { /* The normal pass below reports source failures. */ }
    }
  }
  for (const suffix of roots) {
    try {
      for await (const file of filesIn(join(home, suffix), provider)) {
        status.files++;
        const sourceKey = hash(file);
        try {
          const before = await lstat(file);
          const signature = `2:${before.size}:${before.mtimeMs}`;
          const old = store.files[sourceKey];
          if (old?.signature === signature && !(provider === 'codex' && old.issues.unsupported)) {
            for (const key of ['malformed', 'incomplete', 'unsupported', 'deferred']) status[key] += old.issues[key];
            continue;
          }
          if (before.isSymbolicLink() || before.size > 128 * 1024 * 1024) { status.unsupported++; continue; }
          const raw = await readFile(file, 'utf8');
          const after = await lstat(file);
          if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) { status.deferred++; continue; }
          const parsed = parseRecords(provider, raw, sourceKey, parents);
          for (const event of parsed.events) {
            if (!store.excluded[event.key]) {
              const previous = store.events[event.key];
              if (!previous || event.total >= previous.total) store.events[event.key] = event;
              else parsed.issues.incomplete++;
            }
          }
          store.files[sourceKey] = { signature, provider, issues: parsed.issues,
            ...(provider === 'codex' ? { codexIndex: codexIndex(raw) } : {}) };
          for (const key of Object.keys(parsed.issues)) status[key] += parsed.issues[key];
        } catch { status.failed++; }
      }
      rootsFound++;
    } catch (e) { if (e.code !== 'ENOENT') status.failed++; }
  }
  status.events = Object.values(store.events).filter(e => e.provider === provider).length;
  status.state = status.failed ? 'read-failed' : status.unsupported || status.malformed || status.incomplete || status.deferred ? 'partial' : !rootsFound ? 'not-found' : !status.files ? 'empty' : 'success';
  if (rootsFound && !status.failed) status.lastSuccess = Date.now();
  return status;
}
