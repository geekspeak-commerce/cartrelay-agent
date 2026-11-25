#!/usr/bin/env node
// Node >=22. Run locally in the user's own terminal/browser; never on a shared host.
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createCredentialFileStore } from '../lib/credential-store.mjs';
const ORIGIN = 'https://cartrelay.market';
const SCOPES = 'openid offline_access shopping:read';
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const credential = value => typeof value === 'string' && /^[\x21-\x7e]{1,18000}$/.test(value) && !/[\s,]/.test(value);
const equal = (left, right) => typeof left === 'string' && Buffer.byteLength(left) === Buffer.byteLength(right)
  && timingSafeEqual(Buffer.from(left), Buffer.from(right));
async function responseJson(response, expected, signal) {
  const reader = response.body?.getReader();
  let bytes = 0; const chunks = [];
  try {
    if (response.status !== expected || response.redirected || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) fail('OAUTH_REQUEST_FAILED');
    if (!reader) fail('OAUTH_INVALID_RESPONSE');
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) fail('OAUTH_TIMEOUT');
      if (done) break;
      bytes += value.byteLength; if (bytes > 65536) fail('OAUTH_INVALID_RESPONSE'); chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
  } catch (error) { if (['OAUTH_REQUEST_FAILED', 'OAUTH_TIMEOUT'].includes(error?.code)) throw error; fail('OAUTH_INVALID_RESPONSE'); }
  finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
}

/** Only registers and signs in a public native client. No product/cart/payment API.
 * onAuthorization receives the sign-in URL; writeTokens is a private secret-store callback.
 * @param {{fetchImpl?:(url:string,init:RequestInit)=>Promise<Response>,onAuthorization:(url:string)=>unknown,writeTokens:(tokens:{clientId:string,accessToken:string,refreshToken:string,expiresAt:number})=>unknown,timeoutMs?:number}} options
 */
export async function runOAuthLogin({ fetchImpl = globalThis.fetch, onAuthorization, writeTokens, timeoutMs = 180000 } = {}) {
  if (typeof fetchImpl !== 'function' || typeof onAuthorization !== 'function' || typeof writeTokens !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000) fail('OAUTH_INVALID_CONFIGURATION');
  const controller = new AbortController();
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let deadlineReject;
  const deadline = new Promise((_, reject) => { deadlineReject = reject; });
  void deadline.catch(() => {});
  let callbackResolve; let callbackReject; let accepted = false;
  const callback = new Promise((resolve, reject) => { callbackResolve = resolve; callbackReject = reject; });
  // A callback timeout may happen during registration; immediately observe rejection.
  void callback.catch(() => {});
  const server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store'); res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    let url;
    try { if (!req.url || req.url.length > 4096) throw new Error(); url = new URL(req.url, 'http://127.0.0.1'); }
    catch { res.writeHead(400).end('Invalid callback.'); return; }
    if (req.method !== 'GET' || url.pathname !== '/callback' || accepted
      || url.searchParams.getAll('state').length !== 1 || !equal(url.searchParams.get('state'), state)) {
      res.writeHead(400).end('Invalid callback.'); return;
    }
    if (url.searchParams.has('error')) { accepted = true; res.writeHead(400).end('Sign-in was not approved.'); callbackReject(Object.assign(new Error('OAUTH_AUTHORIZATION_DENIED'), { code: 'OAUTH_AUTHORIZATION_DENIED' })); return; }
    const code = url.searchParams.get('code');
    if (url.searchParams.getAll('code').length !== 1 || !credential(code)) { res.writeHead(400).end('Invalid callback.'); return; }
    accepted = true; res.writeHead(200).end('Sign-in received. Return to your terminal.'); callbackResolve(code);
  });
  const timer = setTimeout(() => { controller.abort(); const error = Object.assign(new Error('OAUTH_TIMEOUT'), { code: 'OAUTH_TIMEOUT' }); callbackReject(error); deadlineReject(error); server.closeAllConnections(); }, timeoutMs);
  const post = async (path, body, expected, json = false) => {
    let response;
    try { response = await Promise.race([fetchImpl(`${ORIGIN}${path}`, { method: 'POST', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: { 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded', accept: 'application/json' }, body: json ? JSON.stringify(body) : new URLSearchParams(body).toString() }), deadline]); }
    catch { fail(controller.signal.aborted ? 'OAUTH_TIMEOUT' : 'OAUTH_REQUEST_FAILED'); }
    if ((response.url && response.url !== `${ORIGIN}${path}`) || response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {}); fail('OAUTH_REQUEST_FAILED');
    }
    return Promise.race([responseJson(response, expected, controller.signal), deadline]);
  };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    const redirectUri = `http://127.0.0.1:${address.port}/callback`;
    const registered = await post('/oauth/register', { client_name: 'CartRelay LangChain local client', application_type: 'native',
      redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: SCOPES }, 201, true);
    if (!registered || typeof registered.client_id !== 'string' || !/^[A-Za-z0-9._~-]{1,512}$/.test(registered.client_id)
      || registered.client_secret !== undefined || registered.token_endpoint_auth_method !== 'none') fail('OAUTH_INVALID_RESPONSE');
    const authorization = new URL('/oauth/authorize', ORIGIN);
    for (const [key, value] of Object.entries({ client_id: registered.client_id, redirect_uri: redirectUri, response_type: 'code',
      scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', resource: `${ORIGIN}/mcp` })) authorization.searchParams.set(key, value);
    await Promise.race([Promise.resolve().then(() => onAuthorization(authorization.href)), deadline]);
    const code = await callback;
    const issued = await post('/oauth/token', { grant_type: 'authorization_code', code, client_id: registered.client_id,
      redirect_uri: redirectUri, code_verifier: verifier, resource: `${ORIGIN}/mcp` }, 200);
    const scopes = typeof issued?.scope === 'string' ? issued.scope.split(' ') : [];
    if (!issued || issued.token_type?.toLowerCase() !== 'bearer' || !credential(issued.access_token) || !credential(issued.refresh_token)
      || !Number.isInteger(issued.expires_in) || issued.expires_in < 1 || issued.expires_in > 86400
      || !scopes.includes('shopping:read') || scopes.some(scope => !SCOPES.split(' ').includes(scope))) fail('OAUTH_INVALID_RESPONSE');
    if (controller.signal.aborted) fail('OAUTH_TIMEOUT');
    // A timeout can leave storage outcome uncertain; it is never reported as success.
    await Promise.race([Promise.resolve().then(() => writeTokens({ clientId: registered.client_id, accessToken: issued.access_token, refreshToken: issued.refresh_token, expiresAt: Date.now() + issued.expires_in * 1000 })), deadline]);
    if (controller.signal.aborted) fail('OAUTH_TIMEOUT');
    return { ok: true, scope: 'shopping:read', refresh_enabled: true };
  } catch (error) {
    if (['OAUTH_REQUEST_FAILED', 'OAUTH_INVALID_RESPONSE', 'OAUTH_TIMEOUT', 'OAUTH_AUTHORIZATION_DENIED', 'CREDENTIAL_STORE_UNAVAILABLE'].includes(error?.code)) fail(error.code);
    fail('OAUTH_LOGIN_FAILED');
  } finally {
    clearTimeout(timer); controller.abort(); server.closeAllConnections();
    await new Promise(resolve => server.close(() => resolve()));
  }
}

export async function main(argv = process.argv.slice(2), env = process.env, output = process.stdout, errors = process.stderr) {
  if (argv.includes('--help')) { output.write('CartRelay native read-only OAuth login (Node>=22)\nUsage: node cartrelay-oauth-login.mjs\nOptional CARTRELAY_CREDENTIAL_FILE; default ~/.cartrelay/credentials.json.\nOpen the printed sign-in URL in your own browser. Saves private local credentials, never products.\nExisting credentials are not overwritten. No search, cart, approval, handoff or purchase.\n'); return 0; }
  if (argv.length) { errors.write('OAUTH_INVALID_ARGUMENTS\n'); return 1; }
  try {
    const store = createCredentialFileStore(env.CARTRELAY_CREDENTIAL_FILE ?? join(homedir(), '.cartrelay', 'credentials.json'));
    await store.assertCreateReady();
    const summary = await runOAuthLogin({ onAuthorization: url => { output.write(`Open this sign-in URL in your own browser:\n${url}\n`); },
      writeTokens: tokens => store.saveTokens(tokens, { createOnly: true }) });
    output.write(`${JSON.stringify(summary)}\n`); return 0;
  } catch (error) { errors.write(`${['OAUTH_REQUEST_FAILED', 'OAUTH_INVALID_RESPONSE', 'OAUTH_TIMEOUT', 'OAUTH_AUTHORIZATION_DENIED', 'CREDENTIAL_STORE_UNAVAILABLE'].includes(error?.code) ? error.code : 'OAUTH_LOGIN_FAILED'}\n`); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
