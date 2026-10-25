import { open } from 'node:fs/promises';

const endpoint = 'https://cloudcode-pa.googleapis.com/v1internal';
const result = (state, extra = {}) => ({ provider: 'gemini', state, windows: [], ...extra });

// Backend only. Caller supplies the explicitly connected credential path.
async function readCredential(file) {
  const handle = await open(file, 'r');
  try {
    const bytes = Buffer.alloc(65537);
    let size = 0;
    while (size < bytes.length) {
      const read = await handle.read(bytes, size, bytes.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > 65536) throw new Error('credential-size');
    return bytes.subarray(0, size).toString('utf8');
  } finally { await handle.close(); }
}

export function decodeGeminiQuota(body) {
  if (!Array.isArray(body?.buckets) || !body.buckets.length) return result('invalid-response');
  const windows = [];
  let invalid = 0;
  for (const bucket of body.buckets) {
    const fraction = bucket?.remainingFraction;
    if (typeof bucket?.modelId !== 'string' || !bucket.modelId.trim() ||
        !Number.isFinite(fraction) || fraction < 0 || fraction > 1) { invalid++; continue; }
    const reset = bucket.resetTime;
    const validReset = typeof reset === 'string' && Number.isFinite(Date.parse(reset));
    if (reset != null && !validReset) invalid++;
    windows.push({ modelId: bucket.modelId, usedPercent: (1 - fraction) * 100,
      resetsAt: validReset ? new Date(reset).toISOString() : null });
  }
  return result(!windows.length ? 'invalid-response' : invalid ? 'partial' : 'success', { windows });
}

/** No refresh grants, credential writes, logging, or implicit account discovery. */
export async function fetchGeminiQuota({ credentialPath, signal, fetch: request = globalThis.fetch,
  readFile = readCredential, now = Date.now } = {}) {
  if (!credentialPath) return result('not-connected');
  const budget = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
  async function tokenFromFile() {
    try {
      const raw = await readFile(credentialPath);
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > 65536) return null;
      const token = JSON.parse(raw)?.access_token;
      return typeof token === 'string' && token.trim() && !/[\r\n]/.test(token) ? token : null;
    } catch { return null; }
  }
  let token = await tokenFromFile();
  if (!token) return result('authentication-required');
  let reread = false;
  async function post(method, payload) {
    budget.throwIfAborted();
    const response = await request(`${endpoint}:${method}`, {
      method: 'POST', redirect: 'error', signal: budget,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.status === 401 && !reread) {
      reread = true;
      const next = await tokenFromFile();
      if (next && next !== token) {
        token = next;
        return method === 'retrieveUserQuota' ? { restart: true } : post(method, payload);
      }
    }
    if (response.status === 401) return { failure: result('authentication-required') };
    if (response.status === 429) {
      const raw = response.headers.get('Retry-After');
      const seconds = raw && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
      const date = raw ? Date.parse(raw) : NaN;
      const delay = Number.isFinite(seconds) ? seconds * 1000 :
        Number.isFinite(date) ? Math.max(0, date - now()) : 300000;
      return { failure: result('rate-limited', { retryAt: now() + delay }) };
    }
    let body;
    try { body = await response.json(); } catch {
      return { failure: result(response.ok ? 'invalid-response' : response.status === 403 ? 'access-denied' : 'request-failed') };
    }
    if (body?.error?.status === 'UNSUPPORTED_CLIENT' ||
        (typeof body?.error?.message === 'string' && body.error.message.includes('IneligibleTierError'))) {
      return { failure: result('unsupported') };
    }
    if (!response.ok) return { failure: result(response.status === 403 ? 'access-denied' : 'request-failed') };
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.error) {
      return { failure: result('invalid-response') };
    }
    return { body };
  }
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
    const assist = await post('loadCodeAssist', { metadata: { ideType: 'GEMINI_CLI', pluginType: 'GEMINI' } });
    if (assist.failure) return assist.failure;
    const project = assist.body.cloudaicompanionProject;
    // shortcut: project-less lookup follows CodeBurn; verify against a supported live account before release.
    if (project != null && (typeof project !== 'string' || !project.trim())) return result('invalid-response');
    const quota = await post('retrieveUserQuota', project ? { project } : {});
    if (quota.restart) continue; // A changed token may belong to another quota project.
    if (quota.failure) return quota.failure;
    const decoded = decodeGeminiQuota(quota.body);
    const label = assist.body.paidTier?.name ?? assist.body.currentTier?.name ?? assist.body.currentTier?.id;
    return { ...decoded, planLabel: typeof label === 'string' ? label : null,
      ...(decoded.windows.length ? { fetchedAt: now() } : {}) };
    }
    return result('authentication-required');
  } catch {
    return result(signal?.aborted ? 'cancelled' : budget.aborted ? 'timeout' : 'request-failed');
  }
}
