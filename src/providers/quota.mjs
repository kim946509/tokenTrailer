import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fetchGeminiQuota } from './gemini-quota.mjs';

export const credentialFile = (provider, home) => join(home, provider === 'claude' ? '.credentials.json' : provider === 'codex' ? 'auth.json' : 'oauth_creds.json');
// Backend-only change detector, never an account identity or a renderer field.
export async function credentialRevision(provider, home) {
  try {
    const file = credentialFile(provider, home);
    if ((await stat(file)).size > 65536) return null;
    const bytes = await readFile(file);
    return bytes.length <= 65536 ? createHash('sha256').update(bytes).digest('hex') : null;
  } catch { return null; }
}
const result = (provider, state, extra = {}) => ({ provider, state, windows: [], ...extra });
export function decodeQuota(provider, body) {
  const windows = [];
  let invalid = 0;
  const source = provider === 'claude' ? Object.entries(body ?? {}).filter(([key]) => key === 'five_hour' || key.startsWith('seven_day')) :
    Object.entries(body?.rate_limit ?? {}).filter(([key]) => key.endsWith('_window'));
  for (const [id, value] of source) {
    if (value == null) continue;
    const percent = provider === 'claude' ? value.utilization : value.used_percent;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) { invalid++; continue; }
    const reset = provider === 'claude' ? Date.parse(value.resets_at) :
      typeof value.reset_at === 'number' ? value.reset_at * 1000 : NaN;
    const validReset = Number.isFinite(reset) && Math.abs(reset) <= 8640000000000000;
    if (!validReset) invalid++;
    windows.push({ modelId: id, usedPercent: percent, resetsAt: validReset ? new Date(reset).toISOString() : null,
      durationSeconds: Number.isFinite(value.limit_window_seconds) ? value.limit_window_seconds : null });
  }
  return result(provider, windows.length ? invalid ? 'partial' : 'success' : 'invalid-response', { windows,
    planLabel: typeof body?.plan_type === 'string' ? body.plan_type : null });
}

export async function fetchQuota(provider, home, { signal, fetch: request = globalThis.fetch, readCredential, now = Date.now } = {}) {
  const file = credentialFile(provider, home);
  if (provider === 'gemini') return fetchGeminiQuota({ credentialPath: file, signal, fetch: request, now });
  if (!['claude', 'codex'].includes(provider)) return result(provider, 'unsupported');
  const read = readCredential ?? (async () => {
    if ((await stat(file)).size > 65536) throw new Error('size');
    const raw = await readFile(file, 'utf8');
    if (Buffer.byteLength(raw) > 65536) throw new Error('size');
    return JSON.parse(raw);
  });
  const auth = async () => {
    const value = await read();
    return provider === 'claude' ? { token: value?.claudeAiOauth?.accessToken } :
      { token: value?.tokens?.access_token, account: value?.tokens?.account_id };
  };
  const budget = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
  try {
    let credential;
    try { credential = await auth(); } catch { return result(provider, 'authentication-required'); }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (typeof credential.token !== 'string' || !credential.token.trim() || /[\r\n]/.test(credential.token)) return result(provider, 'authentication-required');
      budget.throwIfAborted();
      const headers = { Authorization: `Bearer ${credential.token}` };
      if (provider === 'claude') headers['anthropic-beta'] = 'oauth-2025-04-20';
      if (provider === 'codex' && typeof credential.account === 'string' && !/[\r\n]/.test(credential.account)) headers['ChatGPT-Account-Id'] = credential.account;
      const response = await request(provider === 'claude' ? 'https://api.anthropic.com/api/oauth/usage' : 'https://chatgpt.com/backend-api/wham/usage', { headers, redirect: 'error', signal: budget });
      if (response.status === 401) {
        if (attempt === 0) {
          let next; try { next = await auth(); } catch {}
          if (next?.token && next.token !== credential.token) { credential = next; continue; }
        }
        return result(provider, 'authentication-required');
      }
      if (response.status === 429) {
        const raw = response.headers.get('Retry-After');
        const delay = raw && /^\d+$/.test(raw.trim()) ? Number(raw) * 1000 : raw && Number.isFinite(Date.parse(raw)) ? Math.max(0, Date.parse(raw) - now()) : 300000;
        return result(provider, 'rate-limited', { retryAt: now() + delay });
      }
      if (!response.ok) return result(provider, response.status === 403 ? 'access-denied' : 'request-failed');
      let body; try { body = await response.json(); } catch { return result(provider, 'invalid-response'); }
      const decoded = decodeQuota(provider, body);
      return { ...decoded, ...(decoded.windows.length ? { fetchedAt: now() } : {}) };
    }
  } catch { return result(provider, signal?.aborted ? 'cancelled' : budget.aborted ? 'timeout' : 'request-failed'); }
}
