import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCatalogueDiscoveryClient, CatalogueDiscoveryClientError, parseDiscoveryInput, discoveryInputSchema } from '../lib/index.mjs';
import { createLangChainDiscoveryTool } from '../lib/langchain.mjs';
import { createLlamaIndexDiscoveryTool } from '../lib/llamaindex.mjs';
import { prepareProductDiscovery } from '../starter/discovery.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const request = { query: 'synthetic bottle', context: { country: 'CA', currency: 'CAD' }, max_price_minor: 4000, limit: 3 };
const id = 'awin:v1:1:csv_1:c3ludGhldGlj';
function output() {
  return { ok: true, data: { products: [{ id, title: 'Synthetic fixture only', url: 'https://merchant.example/item', image_url: null,
    offers: [{ id, title: 'Synthetic offer', price: { amount: 2500, currency: 'USD' }, available: null, availability_status: null,
      options: [{ name: 'Colour', label: 'Black' }], merchant: { name: 'Synthetic merchant', id: null, domain: 'merchant.example', url: 'https://merchant.example/', policy_links: [{ type: 'terms', url: 'https://merchant.example/terms' }] },
      retailer_url: 'https://merchant.example/item', quantity_link_support: 'one_item_only', missing_facts: ['stock'], handoff_kind: 'retailer_product', availability_basis: 'advertiser_feed', source_updated_at: null, destination_url: 'https://merchant.example/item',
      price_estimate: { amount: 3300, currency: 'CAD', estimated: true, source: 'Bank of Canada', source_url: 'https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/', rate: '1.32', rate_date: '2024-02-29' } }],
    options: [{ name: 'Colour', values: ['Black'] }], description_inferred: false, missing_facts: ['shipping'] }],
    pagination: { cursor: null, has_next_page: false }, notices: ['PRICE_NOT_CONFIRMED_CURRENT', 'STOCK_UNKNOWN'], source: 'synthetic-source', fetched_at: '2026-01-01T00:00:00.000Z' },
    interpretation: { category: 'drinkware', query_kind: 'product', budget_applied: true, merchant_evidence: 'not_established' } };
}
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
function fixture(value = output(), status = 200) {
  const calls = [];
  let credentialCalls = 0;
  const options = { getCredential: () => { credentialCalls++; return 'synthetic-memory-only-token'; }, fetchImpl: async (...args) => { calls.push(args); return json(value, status); } };
  return { options, calls, get credentialCalls() { return credentialCalls; } };
}
function safe(error, code, status = null) {
  assert.ok(error instanceof CatalogueDiscoveryClientError);
  assert.equal(error.code, code); assert.equal(error.status, status);
  assert.doesNotMatch(String(error), /private-marker|synthetic-memory-only-token/);
  assert.equal(Object.hasOwn(error, 'cause'), false);
  return true;
}

// Test transports are memory-only Response/ReadableStream fixtures, never live fetch.
test('all root/subpath/starter imports and constructors are inert', async () => {
  const f = fixture();
  const client = createCatalogueDiscoveryClient(f.options);
  const action = prepareProductDiscovery(f.options);
  assert.deepEqual(Object.keys(client), ['discover']); assert.ok(Object.isFrozen(client)); assert.equal(typeof action, 'function');
  for (const file of ['index.mjs', 'cartrelay-discovery.mjs', 'schema.mjs', 'langchain.mjs', 'llamaindex.mjs']) {
    const source = await readFile(join(root, 'lib', file), 'utf8');
    assert.doesNotMatch(source, /process\.|localStorage|sessionStorage|console\.|api\/agent-keys|tools\/call|node:|src\//);
  }
  assert.equal(f.calls.length, 0); assert.equal(f.credentialCalls, 0);
  const child = execFileSync(process.execPath, ['--input-type=module', '-e', `
    let calls = 0; globalThis.fetch = () => { calls++; throw Error('network forbidden'); };
    for (const path of ['./lib/index.mjs','./lib/langchain.mjs','./lib/llamaindex.mjs','./starter/discovery.mjs']) await import(path);
    if (calls !== 0) throw Error('import performed network');
  `], { cwd: root, env: {} });
  assert.equal(child.length, 0);
});

test('approved public client is copied exactly with reviewed SHA-256', async () => {
  const packaged = await readFile(join(root, 'lib/cartrelay-discovery.mjs'));
  assert.equal(createHash('sha256').update(packaged).digest('hex'), '6966ef7ea6ab950b309520c73871e2edb5b28f63b1b36b0d2c0d846453881ee6');
  const original = new URL('../../../public/examples/cartrelay-discovery.mjs', import.meta.url);
  if (existsSync(original)) assert.deepEqual(packaged, await readFile(original));
});

test('core and starter execute one authenticated fixed-route request, preserving source unknowns', async () => {
  for (const prepare of [o => createCatalogueDiscoveryClient(o).discover.bind(createCatalogueDiscoveryClient(o)), prepareProductDiscovery]) {
    const f = fixture(); const invoke = prepare(f.options);
    const result = await invoke({ ...request, query: '  synthetic bottle  ' });
    assert.deepEqual(result, output()); assert.equal(f.credentialCalls, 1); assert.equal(f.calls.length, 1);
    const [url, options] = f.calls[0]; assert.equal(url, 'https://cartrelay.market/api/v1/discover');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-memory-only-token'); assert.deepEqual(JSON.parse(options.body), request);
    assert.equal(result.data.products[0].offers[0].available, null); assert.equal(result.data.products[0].offers[0].price.currency, 'USD');
  }
});

const badInputs = [null, {}, { ...request, query: 'x' }, { ...request, query: 'x'.repeat(301) }, { ...request, query: 'a\0b' },
  { ...request, query: '😀'.repeat(151) }, { ...request, limit: 9 }, { ...request, max_price_minor: 0 }, { ...request, cursor: '' }, { ...request, cursor: 'a'.repeat(2049) },
  { ...request, approval: true }, { ...request, key: 'private-marker' }, { ...request, context: { country: 'CA', currency: 'USD' } },
  { ...request, context: { country: 'CA', currency: 'CAD', postal_code: 'private-marker' } }, { ...request, context: { version: 1, country: 'CA', currency: 'CAD' } }];
for (let i = 0; i < badInputs.length; i++) test(`core rejects strict input ${i} before credential retrieval`, async () => {
  const f = fixture(); assert.throws(() => parseDiscoveryInput(badInputs[i]), error => safe(error, 'INVALID_INPUT'));
  await assert.rejects(createCatalogueDiscoveryClient(f.options).discover(badInputs[i]), error => safe(error, 'INVALID_INPUT'));
  assert.equal(f.calls.length, 0); assert.equal(f.credentialCalls, 0);
});

test('normalized parser matches approved client for boundary input including Unicode and version 2', async () => {
  const inputs = [request, { ...request, query: '😀' }, { ...request, query: '😀'.repeat(150) }, { ...request, query: '\t\nsynthetic bottle\t\n' },
    { query: 'synthetic mouse', context: { country: 'US', currency: 'USD' }, limit: 8, cursor: 'a'.repeat(2048), max_price_minor: 1000000 },
    { query: 'synthetic item', context: { version: 2, country: 'JP', currency: 'JPY' } }, { query: 'synthetic item', context: { version: 2, country: 'KW', currency: 'KWD' } }];
  for (const input of inputs) {
    const f = fixture(); await createCatalogueDiscoveryClient(f.options).discover(input);
    assert.deepEqual(parseDiscoveryInput(input), JSON.parse(f.calls[0][1].body));
  }
  assert.ok(Object.isFrozen(discoveryInputSchema)); assert.ok(Object.isFrozen(discoveryInputSchema.properties.context));
});

for (const origin of ['http://cartrelay.market', 'https://user:private-marker@cartrelay.market', 'https://cartrelay.market/path', 'https://cartrelay.market/?key=private-marker', ' https://cartrelay.market']) test(`invalid origin is rejected: ${origin.split('?')[0]}`, () => {
  const f = fixture(); assert.throws(() => createCatalogueDiscoveryClient({ ...f.options, origin }), error => safe(error, 'INVALID_ORIGIN')); assert.equal(f.credentialCalls, 0);
});

test('credential and transport exceptions never leak or retry', async () => {
  const f = fixture(); await assert.rejects(createCatalogueDiscoveryClient({ ...f.options, getCredential: () => { throw Error('private-marker'); } }).discover(request), error => safe(error, 'CREDENTIAL_UNAVAILABLE'));
  let count = 0; await assert.rejects(createCatalogueDiscoveryClient({ ...f.options, fetchImpl: async () => { count++; throw Error('private-marker'); } }).discover(request), error => safe(error, 'REQUEST_FAILED')); assert.equal(count, 1);
  for (const credential of ['', 'a b', 'a,b', 'x'.repeat(8193)]) await assert.rejects(createCatalogueDiscoveryClient({ ...f.options, getCredential: () => credential }).discover(request), error => safe(error, 'CREDENTIAL_UNAVAILABLE'));
  assert.equal(f.calls.length, 0);
});

const invalidOutput = change => { const v = output(); change(v); return v; };
const malformed = [null, {}, invalidOutput(v => { delete v.data.products; }), invalidOutput(v => { v.query = 'private-marker'; }),
  invalidOutput(v => { v.data.products = Array(9).fill(v.data.products[0]); }), invalidOutput(v => { v.data.products[0].offers = Array(65).fill(v.data.products[0].offers[0]); }),
  invalidOutput(v => { v.data.products[0].offers[0].retailer_url = 'javascript:private-marker'; }), invalidOutput(v => { v.data.products[0].offers[0].source_updated_at = '2026-02-30T00:00:00Z'; }),
  invalidOutput(v => { v.data.products[0].offers[0].price.amount = 1.5; }), invalidOutput(v => { v.interpretation.merchant_evidence = 'confirmed_brand'; })];
for (let i = 0; i < malformed.length; i++) test(`strict source parser rejects malformed response ${i}`, async () => {
  const f = fixture(malformed[i]); await assert.rejects(createCatalogueDiscoveryClient(f.options).discover(request), error => safe(error, 'INVALID_RESPONSE')); assert.equal(f.calls.length, 1);
});

test('valid empty success differs from fixed failures with safe bounded retry advice', async () => {
  const v = output(); v.data.products = []; assert.deepEqual(await createCatalogueDiscoveryClient(fixture(v).options).discover(request), v);
  const f = fixture({ ok: false, error: { code: 'DISCOVERY_BUSY', message: 'private-marker', retry_after: 60 } }, 429);
  await assert.rejects(createCatalogueDiscoveryClient(f.options).discover(request), error => { safe(error, 'DISCOVERY_BUSY', 429); assert.equal(error.retry_after, 60); return true; }); assert.equal(f.calls.length, 1);
  for (const error of [{ code: 'invented', message: 'private-marker' }, { code: 'DISCOVERY_BUSY', message: 'private-marker', retry_after: 601 }, { code: 'PROVIDER_UNAVAILABLE', message: 'private-marker', records: [] }]) await assert.rejects(createCatalogueDiscoveryClient(fixture({ ok: false, error }, 503).options).discover(request), e => safe(e, 'INVALID_RESPONSE'));
});

test('redirects, UTF-8, content type, actual/declared byte overflow and timeout remain bounded', async () => {
  const responses = [new Response('', { status: 302 }), new Response('<html>private-marker</html>', { headers: { 'Content-Type': 'text/html' } }), new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }), json(output(), 200, { 'Content-Length': String(256 * 1024 + 1) })];
  const codes = ['REDIRECT_REJECTED', 'INVALID_RESPONSE', 'INVALID_RESPONSE', 'RESPONSE_TOO_LARGE'];
  for (let i = 0; i < responses.length; i++) await assert.rejects(createCatalogueDiscoveryClient({ getCredential: () => 'synthetic-token', fetchImpl: async () => responses[i] }).discover(request), e => safe(e, codes[i]));
  let cancelled = false; const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(70000)); }, cancel() { cancelled = true; } });
  await assert.rejects(createCatalogueDiscoveryClient({ getCredential: () => 'synthetic-token', fetchImpl: async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }) }).discover(request), e => safe(e, 'RESPONSE_TOO_LARGE')); assert.equal(cancelled, true);
  let resolve; let count = 0;
  await assert.rejects(createCatalogueDiscoveryClient({ getCredential: () => new Promise(done => { resolve = done; }), fetchImpl: async () => { count++; return json(output()); }, timeoutMs: 5 }).discover(request), e => safe(e, 'CLIENT_TIMEOUT'));
  resolve('synthetic-token'); await Promise.resolve(); await Promise.resolve(); assert.equal(count, 0);
});

const peers = existsSync(join(root, 'node_modules/@langchain/core/package.json')) && existsSync(join(root, 'node_modules/@llamaindex/core/package.json'));
for (const [label, factory, method] of [['LangChain', createLangChainDiscoveryTool, 'invoke'], ['LlamaIndex', createLlamaIndexDiscoveryTool, 'call']]) {
  test(`${label}: real optional peer tool is inert, strict, source-preserving and safe`, { skip: peers ? false : 'Install package-only exact optional peers to execute adapters.' }, async () => {
    const f = fixture(); const instance = await factory(f.options);
    assert.equal(f.credentialCalls, 0); assert.equal(f.calls.length, 0);
    if (label === 'LangChain') { const { DynamicStructuredTool } = await import('@langchain/core/tools'); assert.ok(instance instanceof DynamicStructuredTool); assert.equal(instance.name, 'cartrelay_discover'); assert.equal(instance.schema, discoveryInputSchema); }
    else { const { FunctionTool } = await import('@llamaindex/core/tools'); assert.ok(instance instanceof FunctionTool); assert.equal(instance.metadata.parameters, discoveryInputSchema); }
    for (const input of badInputs) await assert.rejects(instance[method](input), error => safe(error, 'INVALID_INPUT'));
    assert.equal(f.credentialCalls, 0);
    const result = JSON.parse(await instance[method]({ ...request, query: '  synthetic bottle  ' })); assert.deepEqual(result, output()); assert.equal(f.calls.length, 1);
    const failure = fixture({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message: 'private-marker' } }, 502);
    await assert.rejects((await factory(failure.options))[method](request), error => safe(error, 'PROVIDER_UNAVAILABLE', 502)); assert.equal(failure.calls.length, 1);
    await assert.rejects((await factory(fixture({}).options))[method](request), error => safe(error, 'INVALID_RESPONSE'));
    await assert.rejects((await factory({ ...f.options, getCredential: () => { throw Error('private-marker'); } }))[method](request), error => safe(error, 'CREDENTIAL_UNAVAILABLE'));
  });
}

test('LangChain tool_call returns official ToolMessage and does not invoke supplied tool callbacks', { skip: !peers }, async () => {
  const f = fixture(); const tool = await createLangChainDiscoveryTool(f.options); let callbacks = 0;
  const { ToolMessage } = await import('@langchain/core/messages');
  const message = await tool.invoke({ type: 'tool_call', name: 'cartrelay_discover', id: 'synthetic-call-id', args: request }, { callbacks: [{ handleToolStart() { callbacks++; }, handleToolEnd() { callbacks++; } }] });
  assert.ok(message instanceof ToolMessage); assert.equal(message.tool_call_id, 'synthetic-call-id'); assert.deepEqual(JSON.parse(message.content), output()); assert.equal(callbacks, 0);
  assert.deepEqual(JSON.parse(await tool.call(request)), output());
  await assert.rejects(tool.invoke({ type: 'tool_call', name: 'unapproved', id: 'synthetic-id', args: request }), e => safe(e, 'INVALID_INPUT'));
});

test('framework JSON schemas reject extra fields and encode explicit source-safe limits', { skip: !peers }, async () => {
  const { validate } = await import('@cfworker/json-schema');
  const schema = structuredClone(discoveryInputSchema);
  assert.equal(validate(request, schema).valid, true);
  for (const input of badInputs.filter(v => v?.query !== '😀'.repeat(151))) assert.equal(validate(input, schema).valid, false);
  assert.equal(validate({ ...request, query: '😀' }, schema).valid, true);
  assert.equal(schema.properties.query['x-cartrelay-utf16-maxLength'], 300);
  assert.equal(validate({ query: 'synthetic mouse', context: { version: 2, country: 'JP', currency: 'JPY' } }, schema).valid, true);
});

test('npm dry-run and actual tarball contain exactly the explicit source-free files, no injected files', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@cartrelay/agent'); assert.equal(manifest.dependencies, undefined); assert.equal(manifest.scripts, undefined);
  assert.deepEqual(Object.keys(manifest.peerDependenciesMeta).sort(), ['@langchain/core', '@llamaindex/core'].sort());
  const permitted = new Set([...manifest.files, 'package.json']);
  const dir = await mkdtemp(join(tmpdir(), 'cartrelay-agent-pack-'));
  const probe = join(root, 'verification', 'unapproved-probe');
  try {
    // npm's exact-file allowlist must exclude synthetic private-looking files too.
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(probe, { recursive: true });
    await writeFile(join(probe, '.env'), 'SYNTHETIC_TEST_ONLY=not-a-credential\n');
    await writeFile(join(probe, 'server.ts'), '// synthetic excluded probe\n');
    const dry = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }))[0];
    assert.deepEqual(dry.files.map(f => f.path).sort(), [...permitted].sort());
    const actual = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', dir], { cwd: root, encoding: 'utf8' }))[0];
    const members = execFileSync('tar', ['-tzf', join(dir, actual.filename)], { encoding: 'utf8' }).trim().split('\n').sort();
    assert.deepEqual(members, [...permitted].map(path => `package/${path}`).sort());
    for (const path of permitted) {
      assert.doesNotMatch(path, /node_modules|verification|\.env|server|catalogue\/|records|fixtures|\.tgz|\.lock|\.map|src\//);
      const content = await readFile(join(root, path), 'utf8');
      assert.doesNotMatch(content, /synthetic-memory-only-token|private-marker|Synthetic fixture only|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/);
    }
  } finally {
    await rm(probe, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
