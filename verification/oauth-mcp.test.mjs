import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ToolMessage } from '@langchain/core/messages';
import { createLangChainSearchTool, CartRelayMcpError } from '../lib/langchain-mcp.mjs';
import { createOAuthCredentialProvider } from '../lib/oauth.mjs';

// No application/server, DB, merchant module, credential file or real network.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ORIGIN = 'https://cartrelay.market';
const SECRET = 'synthetic-private-value-not-a-real-token';
const NEED = 'synthetic shopper need';
const SEARCH = { products: [{ id: 'synthetic-only', offers: [{ price: { amount: 17, currency: 'USD' }, available: null }], missing_facts: ['synthetic_unknown'] }], notices: ['synthetic-only'], source: 'synthetic-memory' };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const safe = code => error => {
  assert.ok(error instanceof CartRelayMcpError);
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  assert.equal(Object.hasOwn(error, 'cause'), false);
  assert.doesNotMatch(String(error), new RegExp(SECRET));
  return true;
};
function memoryMcp(override) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), ...init, body });
    if (override) { const result = await override(body, init); if (result) return result; }
    if (init.method === 'GET') return json({}, 405);
    if (body.method?.startsWith('notifications/')) return new Response(null, { status: 202 });
    let result;
    if (body.method === 'initialize') result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'synthetic-memory', version: '0' } };
    else if (body.method === 'tools/list') result = { tools: ['cartrelay_search', 'cartrelay_cart_create', 'cartrelay_checkout_handoff'].map(name => ({ name, inputSchema: { type: 'object', properties: {} } })) };
    else if (body.method === 'tools/call') { assert.equal(body.params.name, 'cartrelay_search'); result = { structuredContent: SEARCH, content: [] }; }
    else throw new Error(SECRET);
    return json({ jsonrpc: '2.0', id: body.id, result });
  };
  return { calls, fetchImpl };
}
function tokenStore(overrides = {}) {
  let stored = { clientId: 'synthetic-public-client', accessToken: 'synthetic-old-access', refreshToken: 'synthetic-old-refresh', expiresAt: 1_050_000, ...overrides };
  let loads = 0;
  const saves = [];
  return { loadTokens: async () => { loads++; return stored; }, saveTokens: async value => { saves.push(value); stored = { ...value }; }, saves, get loads() { return loads; }, get tokens() { return stored; } };
}
const fresh = (overrides = {}) => ({ access_token: 'synthetic-new-access', refresh_token: 'synthetic-new-refresh', expires_in: 1800, token_type: 'Bearer', scope: 'shopping:read', ...overrides });

test('imports and construction are inert; real LangChain tool performs search only and preserves structure', async () => {
  const f = memoryMcp();
  let credentials = 0;
  const tool = await createLangChainSearchTool({ env: {}, fetchImpl: f.fetchImpl, credentialProvider: { getCredential: () => { credentials++; return SECRET; } } });
  assert.ok(tool instanceof DynamicStructuredTool);
  assert.equal(tool.name, 'cartrelay_search');
  assert.equal(f.calls.length, 0); assert.equal(credentials, 0);
  assert.deepEqual(await tool.invoke({ query: `  ${NEED}  `, country: 'US' }), SEARCH);
  assert.equal(credentials, 1);
  assert.deepEqual(f.calls.filter(r => r.method === 'POST').map(r => r.body.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  assert.deepEqual(f.calls.find(r => r.body?.method === 'tools/call').body.params, { name: 'cartrelay_search', arguments: { query: NEED, context: { country: 'US', currency: 'USD' }, limit: 4 } });
  for (const r of f.calls) { assert.equal(r.url, `${ORIGIN}/mcp`); assert.equal(r.redirect, 'manual'); assert.equal(r.credentials, 'omit'); assert.equal(r.cache, 'no-store'); assert.equal(r.headers.get('authorization'), `Bearer ${SECRET}`); assert.equal(r.headers.has('cookie'), false); assert.equal(r.signal.aborted, true); }
  await tool.invoke({ query: NEED }); assert.equal(credentials, 2);
  assert.deepEqual(f.calls.filter(r => r.body?.method === 'tools/call')[1].body.params.arguments.context, { country: 'CA', currency: 'CAD' });
});

test('real ToolCall invocation returns genuine ToolMessage, not a patched invoke boundary', async () => {
  const f = memoryMcp();
  const tool = await createLangChainSearchTool({ env: { CARTRELAY_KEY: SECRET }, fetchImpl: f.fetchImpl });
  const message = await tool.invoke({ type: 'tool_call', name: 'cartrelay_search', id: 'synthetic-call', args: { query: NEED } });
  assert.ok(message instanceof ToolMessage); assert.equal(message.tool_call_id, 'synthetic-call');
  assert.deepEqual(JSON.parse(message.content), SEARCH);
});

test('strict Zod input rejects unknown fields, short/long queries and unsupported country before credentials', async () => {
  const f = memoryMcp(); let credentials = 0;
  const tool = await createLangChainSearchTool({ env: {}, fetchImpl: f.fetchImpl, credentialProvider: { getCredential: () => { credentials++; return SECRET; } } });
  for (const value of [{ query: 'x' }, { query: 'x'.repeat(301) }, { query: NEED, country: 'GB' }, { query: NEED, limit: 1 }, { query: NEED, approval: true }, { query: NEED, key: SECRET }]) await assert.rejects(tool.invoke(value));
  assert.equal(credentials, 0); assert.equal(f.calls.length, 0);
});

test('credentials are read per call, never copied into tool metadata; environment origin stays pinned', async () => {
  const f = memoryMcp(); const env = { CARTRELAY_KEY: 'synthetic-first', CARTRELAY_ORIGIN: ORIGIN };
  const tool = await createLangChainSearchTool({ env, fetchImpl: f.fetchImpl });
  await tool.invoke({ query: NEED }); env.CARTRELAY_KEY = 'synthetic-second'; env.CARTRELAY_ORIGIN = 'https://foreign.invalid';
  await tool.invoke({ query: NEED });
  assert.equal(f.calls.at(-1).headers.get('authorization'), 'Bearer synthetic-second');
  assert.ok(f.calls.every(r => r.url === `${ORIGIN}/mcp`));
  assert.doesNotMatch(JSON.stringify({ name: tool.name, description: tool.description, schema: tool.schema }), /synthetic-first|synthetic-second/);
});

for (const status of [401, 403, 503]) test(`MCP HTTP ${status} is fixed and never retries or performs OAuth discovery`, async () => {
  const f = memoryMcp(() => json({ error_description: SECRET }, status, { 'www-authenticate': `Bearer resource_metadata="https://foreign.invalid/${SECRET}"` }));
  const tool = await createLangChainSearchTool({ env: { CARTRELAY_KEY: SECRET }, fetchImpl: f.fetchImpl });
  await assert.rejects(tool.invoke({ query: NEED }), safe(status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'FORBIDDEN' : 'HTTP_ERROR'));
  assert.equal(f.calls.length, 1);
});

for (const status of [302, 307]) test(`MCP redirect ${status} never follows`, async () => {
  const f = memoryMcp(() => new Response(null, { status, headers: { location: `https://foreign.invalid/${SECRET}` } }));
  const tool = await createLangChainSearchTool({ env: { CARTRELAY_KEY: SECRET }, fetchImpl: f.fetchImpl });
  await assert.rejects(tool.invoke({ query: NEED }), safe('REDIRECT_BLOCKED')); assert.equal(f.calls.length, 1);
});

test('credential failure is fixed and mismatched provider origin is blocked before credential access', async () => {
  const f = memoryMcp();
  await assert.rejects(createLangChainSearchTool({ env: {}, credentialProvider: { origin: 'https://foreign.invalid', getCredential: () => { throw new Error(SECRET); } } }), safe('BLOCKED_DESTINATION'));
  const tool = await createLangChainSearchTool({ env: {}, fetchImpl: f.fetchImpl, credentialProvider: { getCredential: () => { throw new Error(SECRET); } } });
  await assert.rejects(tool.invoke({ query: NEED }), safe('CREDENTIAL_FAILED')); assert.equal(f.calls.length, 0);
});

test('OAuth fresh tokens cause no refresh; store is reloaded on each nonconcurrent credential request', async () => {
  const store = tokenStore({ expiresAt: 5_000_000 }); let fetches = 0;
  const provider = createOAuthCredentialProvider({ ...store, now: () => 1_000_000, fetchImpl: async () => { fetches++; throw new Error(SECRET); } });
  assert.equal(store.loads, 0);
  assert.equal(await provider.getCredential(), 'synthetic-old-access');
  assert.equal(await provider.getCredential(), 'synthetic-old-access');
  assert.equal(store.loads, 2); assert.equal(fetches, 0); assert.equal(store.saves.length, 0);
});

test('near-expiry OAuth rotates once for concurrent calls, pinned form grant and persist-before-use', async () => {
  const store = tokenStore(); const calls = []; let releaseSave; let saved = false;
  const provider = createOAuthCredentialProvider({ loadTokens: store.loadTokens, now: () => 1_000_000,
    saveTokens: async value => { await new Promise(resolve => { releaseSave = resolve; }); await store.saveTokens(value); saved = true; },
    fetchImpl: async (url, init) => { calls.push([url, init]); return json(fresh()); } });
  const tasks = Array.from({ length: 12 }, () => provider.getCredential().then(value => { assert.equal(saved, true); return value; }));
  for (let i = 0; i < 50 && !releaseSave; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1); assert.equal(store.loads, 1); assert.equal(saved, false); releaseSave();
  assert.deepEqual(await Promise.all(tasks), Array(12).fill('synthetic-new-access'));
  assert.equal(store.saves.length, 1); assert.deepEqual(store.tokens, { clientId: 'synthetic-public-client', accessToken: 'synthetic-new-access', refreshToken: 'synthetic-new-refresh', expiresAt: 2_800_000 });
  const [url, init] = calls[0]; assert.equal(String(url), `${ORIGIN}/oauth/token`);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)), { grant_type: 'refresh_token', client_id: 'synthetic-public-client', resource: `${ORIGIN}/mcp`, refresh_token: 'synthetic-old-refresh' });
  assert.equal(init.method, 'POST'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'manual'); assert.equal(init.cache, 'no-store'); assert.equal(new Headers(init.headers).has('authorization'), false); assert.equal(new Headers(init.headers).has('cookie'), false); assert.equal(init.signal.aborted, true);
  assert.equal(await provider.getCredential(), 'synthetic-new-access'); assert.equal(calls.length, 1);
});

test('expired token requires actual refresh authority; configured client binding must match store', async () => {
  for (const changes of [{ refreshToken: undefined }, { accessToken: undefined }, { clientId: 'different-client' }, { expiresAt: '1000' }]) {
    const store = tokenStore({ expiresAt: 1, ...changes }); let fetches = 0;
    const provider = createOAuthCredentialProvider({ ...store, clientId: 'synthetic-public-client', now: () => 1_000_000, fetchImpl: async () => { fetches++; throw Error(SECRET); } });
    await assert.rejects(provider.getCredential(), safe('OAUTH_LOGIN_REQUIRED')); assert.equal(fetches, 0);
  }
});

for (const status of [400, 401, 403, 429, 500]) test(`OAuth ${status} discards raw messages and does not replay failed refresh`, async () => {
  const store = tokenStore(); let calls = 0;
  const provider = createOAuthCredentialProvider({ ...store, now: () => 1_000_000, fetchImpl: async () => { calls++; return json({ error: SECRET, error_description: SECRET }, status); } });
  const code = [400, 401, 403].includes(status) ? 'OAUTH_LOGIN_REQUIRED' : 'OAUTH_REFRESH_FAILED';
  await assert.rejects(provider.getCredential(), safe(code)); await assert.rejects(provider.getCredential(), safe(code)); assert.equal(calls, 1); assert.equal(store.saves.length, 0);
});

for (const foreign of [false, true]) test(`OAuth unsafe redirect is blocked, foreign=${foreign}`, async () => {
  const store = tokenStore(); let calls = 0;
  const provider = createOAuthCredentialProvider({ ...store, now: () => 1_000_000, fetchImpl: async () => { calls++; return new Response(null, { status: 307, headers: { location: `${foreign ? 'https://foreign.invalid' : ORIGIN}/oauth/token` } }); } });
  await assert.rejects(provider.getCredential(), safe('OAUTH_REDIRECT_BLOCKED')); assert.equal(calls, 1);
});

test('OAuth already-followed or foreign response URL fails closed', async () => {
  for (const fields of [{ redirected: true }, { url: 'https://foreign.invalid/oauth/token' }]) {
    const response = json(fresh()); for (const [key, value] of Object.entries(fields)) Object.defineProperty(response, key, { value });
    const store = tokenStore(); const provider = createOAuthCredentialProvider({ ...store, now: () => 1_000_000, fetchImpl: async () => response });
    await assert.rejects(provider.getCredential(), safe('OAUTH_REDIRECT_BLOCKED')); assert.equal(store.saves.length, 0);
  }
});

for (const value of [fresh({ refresh_token: undefined }), fresh({ refresh_token: 'synthetic-old-refresh' }), fresh({ expires_in: 0 }), fresh({ expires_in: 1.1 }), fresh({ token_type: 'cookie' }), fresh({ access_token: `${SECRET}\n` })]) test('OAuth malformed response never releases or saves credentials', async () => {
  const store = tokenStore(); const provider = createOAuthCredentialProvider({ ...store, now: () => 1_000_000, fetchImpl: async () => json(value) });
  await assert.rejects(provider.getCredential(), safe('OAUTH_INVALID_RESPONSE')); assert.equal(store.saves.length, 0);
});

test('OAuth save failure prevents use and automatic replay; load failure redacts original cause', async () => {
  const store = tokenStore(); let fetches = 0;
  const provider = createOAuthCredentialProvider({ ...store, now: () => 1_000_000, saveTokens: async () => { throw new Error(SECRET); }, fetchImpl: async () => { fetches++; return json(fresh()); } });
  await assert.rejects(provider.getCredential(), safe('OAUTH_STORE_FAILED')); await assert.rejects(provider.getCredential(), safe('OAUTH_STORE_FAILED')); assert.equal(fetches, 1);
  const other = createOAuthCredentialProvider({ loadTokens: () => { throw Error(SECRET); }, saveTokens: () => {} });
  await assert.rejects(other.getCredential(), safe('OAUTH_STORE_FAILED'));
});

test('OAuth bounds streamed and advertised bodies and malformed JSON/content type', async () => {
  for (const [response, code] of [[new Response('x'.repeat(65537), { headers: { 'content-type': 'application/json' } }), 'OAUTH_BODY_LIMIT'], [json(fresh(), 200, { 'content-length': '65537' }), 'OAUTH_BODY_LIMIT'], [new Response(`{${SECRET}`, { headers: { 'content-type': 'application/json' } }), 'OAUTH_INVALID_RESPONSE'], [new Response(JSON.stringify(fresh()), { headers: { 'content-type': 'text/html' } }), 'OAUTH_INVALID_RESPONSE']]) {
    const store = tokenStore(); const provider = createOAuthCredentialProvider({ ...store, now: () => 1_000_000, fetchImpl: async () => response });
    await assert.rejects(provider.getCredential(), safe(code)); assert.equal(store.saves.length, 0);
  }
});

test('OAuth overall timeout aborts a stalled network request and never replays', async () => {
  const store = tokenStore(); let calls = 0; let signal;
  const provider = createOAuthCredentialProvider({ ...store, now: () => 1_000_000, timeoutMs: 20,
    fetchImpl: async (_url, init) => { calls++; signal = init.signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error(SECRET)), { once: true })); } });
  await assert.rejects(provider.getCredential(), safe('OAUTH_TIMEOUT')); assert.equal(signal.aborted, true);
  await assert.rejects(provider.getCredential(), safe('OAUTH_TIMEOUT')); assert.equal(calls, 1);
});

test('unsafe origins rejected before callback IO and returned providers are immutable', () => {
  const callbacks = { loadTokens: () => { throw Error(SECRET); }, saveTokens: () => {} };
  for (const origin of ['http://foreign.invalid', 'https://cartrelay.market/path', 'https://user:pass@cartrelay.market', 'https://cartrelay.market?x=1', 'https://cartrelay.market#x']) assert.throws(() => createOAuthCredentialProvider({ ...callbacks, origin }), safe('INVALID_ORIGIN'));
  assert.ok(Object.isFrozen(createOAuthCredentialProvider(callbacks)));
});

test('MCP tool and OAuth helper never call console logging', async () => {
  const old = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug }; let logs = 0;
  try {
    for (const key of Object.keys(old)) console[key] = () => { logs++; };
    const store = tokenStore(); const credentials = createOAuthCredentialProvider({ ...store, now: () => 1_000_000, fetchImpl: async () => json(fresh()) });
    const f = memoryMcp(); const tool = await createLangChainSearchTool({ env: {}, credentialProvider: credentials, fetchImpl: f.fetchImpl });
    assert.deepEqual(await tool.invoke({ query: NEED }), SEARCH); assert.equal(logs, 0);
  } finally { for (const [key, value] of Object.entries(old)) console[key] = value; }
});

test('exact npm file allowlist excludes tests, dependencies, private sources and tokens; old exports remain', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, '@cartrelay/agent'); assert.equal(manifest.version, '0.1.1');
  assert.equal(manifest.packageManager, 'pnpm@11.25.0');
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.peerDependencies['@modelcontextprotocol/client'], '2.4.0');
  assert.equal(manifest.peerDependencies.zod, '4.6.7');
  for (const path of ['.', './langchain', './llamaindex', './starter', './skill', './package.json', './langchain-mcp', './oauth', './credential-store']) assert.ok(manifest.exports[path]);
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: '/home/ubuntu', CI: 'true' }, encoding: 'utf8' });
  const files = JSON.parse(raw)[0].files.map(f => f.path).sort();
  assert.deepEqual(files, [...new Set([...manifest.files, 'package.json'])].sort());
  for (const path of files) assert.doesNotMatch(path, /node_modules|\.env|^src\/|verification|tests|credentials\.json|pnpm-lock|pnpm-workspace/);
  const reference = await readFile(new URL('../lib/reference-client.mjs', import.meta.url));
  assert.deepEqual(reference, await readFile('/home/ubuntu/cartrelay/public/examples/cartrelay-client.mjs'));
  for (const name of ['langchain-mcp.mjs', 'oauth.mjs']) assert.doesNotMatch(await readFile(new URL(`../lib/${name}`, import.meta.url), 'utf8'), /cartrelay_cart_create|cartrelay_checkout_handoff|createShopperReviewIntent|console\./);
});


test('new entry imports and OAuth construction work with no SDK/Zod/framework peers; missing tool peer is fixed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cartrelay-no-peers-'));
  try {
    await mkdir(join(directory, 'lib'));
    for (const name of ['langchain-mcp.mjs', 'oauth.mjs', 'mcp-origin.mjs', 'mcp-errors.mjs', 'reference-client.mjs']) await copyFile(join(ROOT, 'lib', name), join(directory, 'lib', name));
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      let calls = 0; globalThis.fetch = () => { calls++; throw Error('network forbidden'); };
      const { createLangChainSearchTool } = await import('./lib/langchain-mcp.mjs');
      const { createOAuthCredentialProvider } = await import('./lib/oauth.mjs');
      createOAuthCredentialProvider({ loadTokens: () => { calls++; throw Error('store forbidden'); }, saveTokens: () => { calls++; } });
      await assert.rejects(createLangChainSearchTool({env:{}}), error => error.code === 'ADAPTER_UNAVAILABLE' && error.message === 'ADAPTER_UNAVAILABLE' && !Object.hasOwn(error,'cause'));
      assert.equal(calls, 0);
    `], { cwd: directory, env: { PATH: process.env.PATH, HOME: '/home/ubuntu', CI: 'true' } });
    assert.equal(output.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('independent OAuth origin guard is byte-identical to the reference validation function', async () => {
  const reference = await readFile(new URL('../lib/reference-client.mjs', import.meta.url), 'utf8');
  const independent = await readFile(new URL('../lib/mcp-origin.mjs', import.meta.url), 'utf8');
  const extract = source => source.slice(source.indexOf('export function validateOrigin'), source.indexOf('\n}', source.indexOf('export function validateOrigin')) + 2);
  assert.equal(extract(independent), extract(reference));
});

test('reconstructs callback-owned MCP errors without messages, causes or extra fields', async () => {
  const changed = new CartRelayMcpError('OAUTH_STORE_FAILED'); changed.message = SECRET; changed.cause = Error(SECRET); changed.privateField = SECRET;
  const tool = await createLangChainSearchTool({ credentialProvider: { getCredential: async () => { throw changed; } } });
  await assert.rejects(tool.invoke({ query: NEED }), error => { assert.notEqual(error, changed); assert.equal(Object.hasOwn(error, 'privateField'), false); return safe('OAUTH_STORE_FAILED')(error); });
  const store = tokenStore(); const thrown = new CartRelayMcpError('OAUTH_REFRESH_FAILED'); thrown.message = SECRET; thrown.cause = Error(SECRET);
  const provider = createOAuthCredentialProvider({ ...store, now: () => 1_000_000, fetchImpl: async () => { throw thrown; } });
  await assert.rejects(provider.getCredential(), error => { assert.notEqual(error, thrown); return safe('OAUTH_REFRESH_FAILED')(error); });
});
test('bounds a hanging secure store and does not start a late refresh', async () => {
  let resolveLoad; let calls = 0;
  const provider = createOAuthCredentialProvider({ timeoutMs: 20, loadTokens: () => new Promise(resolve => { resolveLoad = resolve; }), saveTokens: () => {}, fetchImpl: async () => { calls++; return json(fresh()); } });
  await assert.rejects(provider.getCredential(), safe('OAUTH_TIMEOUT'));
  resolveLoad({ clientId: 'synthetic-client', accessToken: 'synthetic-old-access', refreshToken: 'synthetic-old-refresh', expiresAt: 0 });
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(calls, 0);
  await assert.rejects(provider.getCredential(), safe('OAUTH_TIMEOUT'));
});
