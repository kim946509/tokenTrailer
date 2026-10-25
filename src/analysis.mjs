export function periodRange(period, now = Date.now()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  if (period === 'month') start.setDate(1);
  return { start: +start, end: now + 1 };
}
const sum = rows => rows.reduce((n, e) => n + e.total, 0);
export function analyze(events, { period = 'today', provider = 'all', bucket = null, project = null, allowedProviders = null } = {}, now = Date.now()) {
  const range = periodRange(period, now);
  const relevant = events.filter(e => (provider === 'all' || provider === 'connected' || e.provider === provider) && (allowedProviders == null || allowedProviders.includes(e.provider)));
  const periodEvents = relevant.filter(e => e.timestamp && Date.parse(e.timestamp) >= range.start && Date.parse(e.timestamp) < range.end);
  const buckets = [];
  for (let cursor = range.start; cursor < range.end;) {
    const next = new Date(cursor);
    if (period === 'today') next.setTime(cursor + 3600000); else next.setDate(next.getDate() + 1);
    const end = Math.min(+next, range.end);
    buckets.push({ start: cursor, end, total: sum(periodEvents.filter(e => Date.parse(e.timestamp) >= cursor && Date.parse(e.timestamp) < end)) });
    cursor = +next;
  }
  const selected = buckets.find(b => b.start === bucket);
  const rows = selected ? periodEvents.filter(e => Date.parse(e.timestamp) >= selected.start && Date.parse(e.timestamp) < selected.end) : periodEvents;
  const projects = new Map();
  for (const e of rows) {
    const key = e.project ?? '미확인';
    const row = projects.get(key) ?? { key, total: 0, providers: {} };
    row.total += e.total; row.providers[e.provider] = (row.providers[e.provider] ?? 0) + e.total;
    projects.set(key, row);
  }
  const sessions = new Map();
  for (const e of rows.filter(e => project == null || (e.project ?? '미확인') === project)) {
    const key = `${e.provider}:${e.session}`;
    const row = sessions.get(key) ?? { key, session: e.session, provider: e.provider, client: e.client, project: e.project, total: 0, models: [], timestamp: e.timestamp };
    row.total += e.total;
    if (e.model && !row.models.includes(e.model)) row.models.push(e.model);
    sessions.set(key, row);
  }
  const components = {};
  for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']) {
    components[field] = { total: rows.reduce((n, e) => n + (e[field] ?? 0), 0), unknown: rows.filter(e => e[field] == null).length };
  }
  const providerTotals = {};
  for (const e of rows) providerTotals[e.provider] = (providerTotals[e.provider] ?? 0) + e.total;
  return { range, selected, total: sum(rows), periodTotal: sum(periodEvents), providerTotals, components, buckets,
    unknownTime: relevant.filter(e => !e.timestamp).length, unknownTimeTokens: sum(relevant.filter(e => !e.timestamp)),
    projects: [...projects.values()].sort((a, b) => b.total - a.total), sessions: [...sessions.values()].sort((a, b) => b.total - a.total) };
}
