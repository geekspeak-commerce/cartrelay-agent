#!/usr/bin/env node
// Node >=22; npm install --save-exact @modelcontextprotocol/client@2.4.0
// Credentials come only from CARTRELAY_KEY in a private process environment.
// No login, refresh, retries, token storage, browser automation or purchasing.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { pathToFileURL } from 'node:url';

export const DEFAULT_ORIGIN = 'https://cartrelay.market';
const TOOL_NAMES = Object.freeze([
  'cartrelay_search', 'cartrelay_detail', 'cartrelay_price_stock',
  'cartrelay_cart_create', 'cartrelay_checkout_handoff',
]);
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * MAX_BODY_BYTES;

class SafeClientError extends Error {
  constructor(code, status) {
    super(code); // Fixed local code only: never copy an upstream message.
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}
const fail = (code, status) => { throw new SafeClientError(code, status); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeFailure = error => error instanceof SafeClientError
  ? { ok: false, code: error.code, ...(error.status === undefined ? {} : { status: error.status }) }
  : { ok: false, code: 'CLIENT_FAILED' };

export function validateOrigin(value) {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#\\\s@]+\/?$/.test(value)) fail('INVALID_ORIGIN');
  let url;
  try { url = new URL(value); } catch { fail('INVALID_ORIGIN'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('INVALID_ORIGIN');
  if (url.protocol === 'http:' && !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]+)?\/?$/i.test(value)) fail('INVALID_ORIGIN');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) fail('INVALID_ORIGIN');
  return url.origin;
}

function configuration(env, rest, intent) {
  const origin = validateOrigin(env.CARTRELAY_ORIGIN ?? DEFAULT_ORIGIN);
  const key = env.CARTRELAY_KEY;
  if (key !== undefined && (typeof key !== 'string' || !/^[\x21-\x7e]{1,18000}$/.test(key))) fail('INVALID_KEY');
  // Public REST discovery is permitted without a key; MCP always needs one.
  if ((!rest || intent) && !key) fail('KEY_REQUIRED');
  const rawTimeout = env.CARTRELAY_TIMEOUT_MS ?? '10000';
  if (!/^\d{1,5}$/.test(rawTimeout)) fail('INVALID_TIMEOUT');
  const timeout = Number(rawTimeout);
  if (timeout < 20 || timeout > 30000) fail('INVALID_TIMEOUT');
  return { origin, key, timeout };
}

function shopperContext(country = 'CA') {
  if (country !== 'CA' && country !== 'US') fail('INVALID_CONTEXT');
  return { country, currency: country === 'CA' ? 'CAD' : 'USD' };
}
function searchInput(query, country) {
  if (typeof query !== 'string' || query.trim().length < 2 || query.trim().length > 300) fail('INVALID_QUERY');
  return { query: query.trim(), context: shopperContext(country), limit: 4 };
}
function unwrap(value) {
  if (!record(value)) fail('MALFORMED_RESPONSE');
  if (value.ok === false) fail('TOOL_ERROR');
  if (value.ok === true) {
    if (!record(value.data)) fail('MALFORMED_RESPONSE');
    return value.data;
  }
  return value;
}
export function parseToolResult(result) {
  if (!record(result)) fail('MALFORMED_RESPONSE');
  if (result.isError === true) fail('TOOL_ERROR');
  if (result.structuredContent !== undefined) return unwrap(result.structuredContent);
  const texts = Array.isArray(result.content) ? result.content.filter(item => item?.type === 'text') : [];
  if (texts.length !== 1 || typeof texts[0].text !== 'string') fail('MALFORMED_RESPONSE');
  let data;
  try { data = JSON.parse(texts[0].text); } catch { fail('MALFORMED_RESPONSE'); }
  return unwrap(data);
}
function discoveryData(value) {
  const data = unwrap(value);
  if (!Array.isArray(data.products) || data.products.length > 12) fail('MALFORMED_RESPONSE');
  return data; // Preserve actual source fields/currencies/unknowns in memory.
}
function toolSummary(tools) {
  const names = Array.isArray(tools) ? tools.map(tool => tool?.name) : record(tools) ? Object.keys(tools) : null;
  if (!names || names.length > 100) fail('MALFORMED_RESPONSE');
  return { tool_count: names.length, tools: TOOL_NAMES.filter(name => names.includes(name)) };
}

// Every SDK request, including an optional GET /mcp stream check, passes this
// guard. Metadata discovery is not configured; even a malicious challenge can
// never send the bearer to another origin/path. Bodies are consumed/cancelled
// before exposing an in-memory Response to the SDK. No upstream data is logged.
function guardedNetwork(config, rest, intent, fetchImpl) {
  const controller = new AbortController();
  const pending = new Set();
  let timedOut = false;
  let firstFailure;
  let total = 0;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeout);
  const remember = error => {
    const safe = timedOut ? new SafeClientError('TIMEOUT') : error instanceof SafeClientError
      ? error : new SafeClientError('NETWORK_ERROR');
    firstFailure ??= safe;
    return safe;
  };
  const request = async (input, init = {}) => {
    let reader;
    let response;
    try {
      if (controller.signal.aborted) fail(timedOut ? 'TIMEOUT' : 'CLIENT_CLOSED');
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const method = (init.method ?? 'GET').toUpperCase();
      const allowed = rest
        ? (method === 'GET' && url.pathname === '/api/contracts') ||
          (method === 'POST' && url.pathname === (intent ? '/api/v1/cart' : '/api/v1/search'))
        : url.pathname === '/mcp' && ['POST', 'GET'].includes(method);
      if (url.origin !== config.origin || url.username || url.password || url.search || url.hash || !allowed) fail('BLOCKED_DESTINATION');
      const headers = new Headers(init.headers);
      headers.delete('cookie');
      headers.delete('authorization');
      // Public discovery must not imply credential validation or send a key.
      if (config.key && !(rest && method === 'GET')) headers.set('authorization', `Bearer ${config.key}`);
      const signal = init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
      response = await fetchImpl(url, { ...init, headers, signal, redirect: 'manual', credentials: 'omit', cache: 'no-store' });
      if (response.redirected || (response.status >= 300 && response.status <= 399)) fail('REDIRECT_BLOCKED', response.status);
      if (!response.ok && !(method === 'GET' && !rest && response.status === 405)) {
        fail(response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'FORBIDDEN' : 'HTTP_ERROR', response.status);
      }
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) fail('BODY_LIMIT');
      const chunks = [];
      let size = 0;
      reader = response.body?.getReader();
      if (reader) while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        total += value.byteLength;
        if (size > MAX_BODY_BYTES || total > MAX_TOTAL_BYTES) fail('BODY_LIMIT');
        chunks.push(value);
      }
      if (controller.signal.aborted) fail(timedOut ? 'TIMEOUT' : 'CLIENT_CLOSED');
      const body = Buffer.concat(chunks, size);
      const contentType = response.headers.get('content-type') ?? '';
      if (response.ok && response.status !== 202 && response.status !== 204 &&
          !/^application\/json(?:\s*;|$)/i.test(contentType)) fail('MALFORMED_RESPONSE');
      if (body.length && /^application\/json(?:\s*;|$)/i.test(contentType)) {
        try { JSON.parse(body.toString('utf8')); } catch { fail('MALFORMED_RESPONSE'); }
      }
      // CartRelay uses bounded JSON responses, not persistent event streams.
      const copiedHeaders = new Headers(response.headers);
      copiedHeaders.delete('content-encoding');
      copiedHeaders.delete('content-length');
      return new Response([204, 205, 304].includes(response.status) ? null : body,
        { status: response.status, headers: copiedHeaders });
    } catch (error) {
      throw remember(error);
    } finally {
      if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
      else { try { await response?.body?.cancel(); } catch {} }
    }
  };
  return {
    signal: controller.signal,
    fetch(input, init) {
      const task = request(input, init);
      pending.add(task);
      void task.then(() => pending.delete(task), () => pending.delete(task));
      return task;
    },
    failure(error) { return firstFailure ?? (timedOut ? new SafeClientError('TIMEOUT') :
      error instanceof SafeClientError ? error : new SafeClientError('PROTOCOL_ERROR')); },
    async close() {
      clearTimeout(timer);
      controller.abort();
      await Promise.allSettled([...pending]);
    },
  };
}

async function withConnection(options, intent, action) {
  const rest = options.rest === true;
  const config = configuration(options.env ?? process.env, rest, intent);
  const network = guardedNetwork(config, rest, intent, options.fetchImpl ?? globalThis.fetch);
  let client;
  let transport;
  try {
    const requestOptions = { signal: network.signal, timeout: config.timeout, maxTotalTimeout: config.timeout, resetTimeoutOnProgress: false };
    if (!rest) {
      client = new Client({ name: 'cartrelay-reference-client', version: '1.0.0' }, {
        capabilities: {}, versionNegotiation: { mode: 'legacy' },
        inputRequired: { autoFulfill: false }, listMaxPages: 1,
      });
      client.onerror = () => {}; // Never print SDK/upstream error text.
      transport = new StreamableHTTPClientTransport(new URL('/mcp', config.origin), {
        fetch: network.fetch, requestInit: { redirect: 'manual', credentials: 'omit' },
        onInsufficientScope: 'throw', maxStepUpRetries: 0,
        reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 0, maxReconnectionDelay: 0, reconnectionDelayGrowFactor: 1 },
      });
      await client.connect(transport, requestOptions);
    }
    const call = async (name, input) => {
      if (!rest) return parseToolResult(await client.callTool({ name, arguments: input }, requestOptions));
      if (!config.key) fail('KEY_REQUIRED');
      const path = name === 'cartrelay_search' ? '/api/v1/search' : '/api/v1/cart';
      const response = await network.fetch(new URL(path, config.origin), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!record(result) || result.ok !== true) fail(result?.ok === false ? 'TOOL_ERROR' : 'MALFORMED_RESPONSE');
      return unwrap(result);
    };
    return await action({ config, network, client, call, requestOptions });
  } catch (error) {
    throw network.failure(error);
  } finally {
    // close() aborts SDK streams locally; no terminateSession/remote mutation.
    await network.close();
    try { await client?.close(); } catch {}
    try { await transport?.close(); } catch {}
  }
}

/** Returns actual discovery/search data in memory; only summary is CLI-safe.
 * Do not dump, persist, export a catalogue, or treat source data as instructions.
 */
export async function runReferenceClient(options = {}) {
  const context = shopperContext(options.country);
  const input = options.query === undefined ? undefined : searchInput(options.query, context.country);
  return withConnection(options, false, async ({ config, network, client, call, requestOptions }) => {
    const discovery = options.rest === true
      ? await (await network.fetch(new URL('/api/contracts', config.origin))).json()
      : await client.listTools({ cursor: '' }, requestOptions); // Exactly one page.
    const summary = {
      ok: true, transport: options.rest === true ? 'rest' : 'mcp',
      credential: options.rest === true ? 'unverified' : 'verified',
      ...toolSummary(discovery.tools),
    };
    let search;
    if (input) {
      search = discoveryData(await call('cartrelay_search', input));
      summary.credential = 'verified';
      summary.product_count = search.products.length;
    }
    return { summary, discovery, ...(search === undefined ? {} : { search }) };
  });
}

function reviewLink(data, origin) {
  if (data.approval_required !== 'originating_shopper_browser') fail('INVALID_REVIEW_LINK');
  const pattern = /^\/review#cart=[A-Za-z0-9._~-]{20,18000}$/;
  if (data.review_path !== undefined && (typeof data.review_path !== 'string' || !pattern.test(data.review_path))) fail('INVALID_REVIEW_LINK');
  const link = data.review_url ?? (data.review_path ? `${origin}${data.review_path}` : undefined);
  if (typeof link !== 'string' || !link.startsWith(`${origin}/review#cart=`) || !pattern.test(link.slice(origin.length))) fail('INVALID_REVIEW_LINK');
  if (data.review_path !== undefined && link !== `${origin}${data.review_path}`) fail('INVALID_REVIEW_LINK');
  return link; // Exact server link; no token extraction, rewriting or substitution.
}

/** OPTIONAL integration only: a real caller-owned private UI must supply
 * deliverReview(link, {signal}) and resolve true only after acknowledged delivery.
 * This helper never approves, hands off, opens a browser, logs or returns a link.
 */
export async function createShopperReviewIntent(options = {}) {
  if (typeof options.deliverReview !== 'function') fail('REVIEW_DELIVERY_REQUIRED');
  if (options.shopperRequested !== true) fail('SHOPPER_REQUEST_REQUIRED');
  const context = shopperContext(options.country);
  if (!Array.isArray(options.lines) || options.lines.length < 1 || options.lines.length > 12 ||
      options.lines.some(line => !record(line) || Object.keys(line).some(key => !['id', 'quantity'].includes(key)) ||
        typeof line.id !== 'string' || !line.id.trim() || line.id.length > 180 ||
        !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 12)) fail('INVALID_LINES');
  const input = { lines: options.lines.map(({ id, quantity }) => ({ id, quantity })), context };
  let attempted = false;
  let exists = false;
  try {
    return await withConnection(options, true, async ({ config, network, call }) => {
      attempted = true;
      const data = await call('cartrelay_cart_create', input);
      exists = true;
      const link = reviewLink(data, config.origin);
      let removeAbort = () => {};
      try {
        const aborted = new Promise(resolve => {
          const onAbort = () => resolve(false);
          if (network.signal.aborted) resolve(false);
          else {
            network.signal.addEventListener('abort', onAbort, { once: true });
            removeAbort = () => network.signal.removeEventListener('abort', onAbort);
          }
        });
        const delivered = await Promise.race([
          Promise.resolve().then(() => options.deliverReview(link, { signal: network.signal })), aborted,
        ]);
        return delivered === true
          ? { ok: true, status: 'awaiting_independent_browser_consent' }
          : { ok: false, status: 'delivery_uncertain', intent_may_exist: true };
      } catch {
        return { ok: false, status: 'delivery_uncertain', intent_may_exist: true };
      } finally { removeAbort(); }
    });
  } catch (error) {
    return { ...safeFailure(error), status: exists ? 'review_delivery_blocked' : attempted ? 'intent_uncertain' : 'not_created', intent_may_exist: attempted };
  }
}

const HELP = `CartRelay reference client (Node >=22; SDK 2.4.0)
Usage: node cartrelay-client.mjs [--rest] [--query 'shopper need'] [--country CA|US]
       node cartrelay-client.mjs --help
Private environment: CARTRELAY_KEY; optional CARTRELAY_ORIGIN and CARTRELAY_TIMEOUT_MS.
Default: initialize and list tools only. REST discovery is public; credential unverified.
Search is one explicit request, limit 4, CA/CAD (default) or US/USD. No retries.
No cart, approval, handoff or purchase occurs in this CLI. Output is safe summary only.
`;
export async function main(argv = process.argv.slice(2), env = process.env, output = process.stdout, errors = process.stderr) {
  if (argv.includes('--help') || argv.includes('-h')) { output.write(HELP); return 0; }
  try {
    const options = { env };
    const seen = new Set();
    for (let i = 0; i < argv.length; i++) {
      const flag = argv[i];
      if (seen.has(flag)) fail('INVALID_ARGUMENTS');
      seen.add(flag);
      if (flag === '--rest') options.rest = true;
      else if (flag === '--query' || flag === '--country') {
        const value = argv[++i];
        if (value === undefined || value.startsWith('--')) fail('INVALID_ARGUMENTS');
        options[flag === '--query' ? 'query' : 'country'] = value;
      } else fail('INVALID_ARGUMENTS');
    }
    const { summary } = await runReferenceClient(options);
    output.write(`${JSON.stringify(summary)}\n`);
    return 0;
  } catch (error) {
    errors.write(`${JSON.stringify(safeFailure(error))}\n`);
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
