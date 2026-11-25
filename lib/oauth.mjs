import { DEFAULT_ORIGIN, validateOrigin } from './mcp-origin.mjs';
import { CartRelayMcpError, safeMcpError } from './mcp-errors.mjs';
export { CartRelayMcpError } from './mcp-errors.mjs';

const MAX_BODY_BYTES = 64 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const token = value => typeof value === 'string' && /^[\x21-\x7e]{1,18000}$/.test(value);
const fail = (code, status) => { throw new CartRelayMcpError(code, status); };

/** Refreshes an existing accepted public-client grant; does not register or log in. */
export function createOAuthCredentialProvider(options) {
  if (!record(options) || typeof options.loadTokens !== 'function' || typeof options.saveTokens !== 'function'
    || (options.clientId !== undefined && (typeof options.clientId !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(options.clientId)))
    || (options.fetchImpl !== undefined && typeof options.fetchImpl !== 'function')
    || (options.now !== undefined && typeof options.now !== 'function')) fail('INVALID_OPTIONS');
  let origin;
  try { origin = validateOrigin(options.origin ?? DEFAULT_ORIGIN); } catch { fail('INVALID_ORIGIN'); }
  const { clientId, loadTokens, saveTokens } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const skew = options.expirySkewMs ?? 60_000;
  const timeout = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(skew) || skew < 0 || skew > 300_000
    || !Number.isInteger(timeout) || timeout < 20 || timeout > 30_000) fail('INVALID_OPTIONS');
  let inFlight;
  // Any failed refresh may already have rotated remotely. Do not replay the old
  // token automatically; the caller must reconcile storage or authorize again.
  let refreshFailure;
  let activeController;
  const clock = () => {
    let value;
    try { value = now(); } catch { fail('INVALID_OPTIONS'); }
    if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_OPTIONS');
    return value;
  };

  const refresh = async stored => {
    const controller = new AbortController();
    activeController = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    let response;
    let reader;
    try {
      // Endpoint and resource are derived only from the same pinned origin.
      // No metadata discovery, secrets, authorization headers, cookies or retry.
      const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: stored.clientId,
        resource: `${origin}/mcp`, refresh_token: stored.refreshToken });
      response = await fetchImpl(new URL('/oauth/token', origin), {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: body.toString(), signal: controller.signal,
        credentials: 'omit', redirect: 'manual', cache: 'no-store',
      });
      if (response.redirected || (response.status >= 300 && response.status <= 399)) fail('OAUTH_REDIRECT_BLOCKED', response.status);
      if (response.url && response.url !== `${origin}/oauth/token`) fail('OAUTH_REDIRECT_BLOCKED');
      if (!response.ok) fail(response.status === 400 || response.status === 401 || response.status === 403
        ? 'OAUTH_LOGIN_REQUIRED' : 'OAUTH_REFRESH_FAILED', response.status);
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) fail('OAUTH_INVALID_RESPONSE');
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) fail('OAUTH_BODY_LIMIT');
      const chunks = [];
      let size = 0;
      reader = response.body?.getReader();
      if (reader) while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) fail('OAUTH_BODY_LIMIT');
        chunks.push(value);
      }
      if (controller.signal.aborted) fail('OAUTH_TIMEOUT');
      let data;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
      catch { fail('OAUTH_INVALID_RESPONSE'); }
      if (!record(data) || !token(data.access_token) || !token(data.refresh_token)
        || data.refresh_token === stored.refreshToken || typeof data.token_type !== 'string'
        || data.token_type.toLowerCase() !== 'bearer' || !Number.isSafeInteger(data.expires_in)
        || data.expires_in <= 0 || data.expires_in > 86400) fail('OAUTH_INVALID_RESPONSE');
      const issuedAt = clock();
      const updated = { clientId: stored.clientId, accessToken: data.access_token,
        refreshToken: data.refresh_token, expiresAt: issuedAt + data.expires_in * 1000 };
      // Never release a rotated access token until durable secure storage has
      // acknowledged the refresh token. Do not retain arbitrary response fields.
      try { await saveTokens(Object.freeze(updated)); } catch { fail('OAUTH_STORE_FAILED'); }
      if (controller.signal.aborted || refreshFailure) fail('OAUTH_TIMEOUT');
      if (clock() >= updated.expiresAt) fail('OAUTH_LOGIN_REQUIRED');
      return updated.accessToken;
    } catch (error) {
      const safe = refreshFailure ? safeMcpError(refreshFailure) : timedOut ? new CartRelayMcpError('OAUTH_TIMEOUT') : error instanceof CartRelayMcpError
        ? safeMcpError(error) : new CartRelayMcpError('OAUTH_REFRESH_FAILED');
      refreshFailure = safe;
      throw safe;
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (activeController === controller) activeController = undefined;
      if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
      else { try { await response?.body?.cancel(); } catch {} }
    }
  };

  const resolveCredential = async () => {
    if (refreshFailure) throw refreshFailure;
    let stored;
    try { stored = await loadTokens(); } catch { fail('OAUTH_STORE_FAILED'); }
    // A slow store may finish after the caller deadline; never start new refresh work then.
    if (refreshFailure) throw refreshFailure;
    if (!record(stored) || typeof stored.clientId !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(stored.clientId)
      || (clientId !== undefined && stored.clientId !== clientId) || !token(stored.accessToken)
      || !Number.isSafeInteger(stored.expiresAt) || stored.expiresAt < 0) fail('OAUTH_LOGIN_REQUIRED');
    // Snapshot only the fields needed by this request, not a mutable store object.
    stored = { clientId: stored.clientId, accessToken: stored.accessToken,
      refreshToken: stored.refreshToken, expiresAt: stored.expiresAt };
    if (clock() + skew < stored.expiresAt) return stored.accessToken;
    if (!token(stored.refreshToken)) fail('OAUTH_LOGIN_REQUIRED');
    return refresh(stored);
  };

  return Object.freeze({ origin, getCredential() {
    if (!inFlight) {
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => { refreshFailure ??= new CartRelayMcpError('OAUTH_TIMEOUT'); activeController?.abort(); reject(refreshFailure); }, timeout);
      });
      // Includes caller-owned load/save callbacks. Timed-out storage is uncertain,
      // not certainly unwritten; reconciliation/new authorization is required.
      const task = Promise.race([resolveCredential(), deadline]).finally(() => clearTimeout(timer));
      inFlight = task;
      void task.then(() => { if (inFlight === task) inFlight = undefined; },
        () => { if (inFlight === task) inFlight = undefined; });
    }
    return inFlight;
  } });
}
