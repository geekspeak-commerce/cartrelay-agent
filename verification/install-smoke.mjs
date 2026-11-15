import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const tarball = join(packageRoot, 'verification/artifacts/cartrelay-agent-0.1.0.tgz');
assert.ok(existsSync(tarball), 'First npm pack to verification/artifacts.');
const temporary = await mkdtemp(join(tmpdir(), 'cartrelay-agent-install-'));
const env = { PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, HOME: temporary, LANG: 'C.UTF-8' };
try {
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const installed = execFileSync('npm', ['install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', '--package-lock=false', tarball], { cwd: temporary, encoding: 'utf8', env, timeout: 60000 });
  assert.equal(existsSync(join(temporary, 'node_modules/@langchain/core')), false);
  assert.equal(existsSync(join(temporary, 'node_modules/@llamaindex/core')), false);
  const smoke = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    let network = 0;
    globalThis.fetch = () => { network++; throw Error('network forbidden'); };
    const core = await import('@cartrelay/agent');
    const langchain = await import('@cartrelay/agent/langchain');
    const llamaindex = await import('@cartrelay/agent/llamaindex');
    const starter = await import('@cartrelay/agent/starter');
    let credentials = 0;
    const output = {ok:true,data:{products:[],pagination:{cursor:null,has_next_page:false},notices:[],source:'synthetic-source',fetched_at:'2026-01-01T00:00:00Z'},interpretation:{category:'other',query_kind:'product',budget_applied:false,merchant_evidence:'not_established'}};
    const options = {getCredential:()=>{credentials++; return 'synthetic-memory-token';},fetchImpl:async()=>new Response(JSON.stringify(output),{headers:{'content-type':'application/json'}})};
    const client = core.createCatalogueDiscoveryClient(options);
    const action = starter.prepareProductDiscovery(options);
    assert.equal(credentials,0);
    assert.equal(network,0);
    assert.deepEqual(await client.discover({query:'synthetic item',context:{country:'US',currency:'USD'}}),output);
    assert.deepEqual(await action({query:'synthetic item',context:{country:'CA',currency:'CAD'}}),output);
    assert.equal(credentials,2);
    for(const factory of [langchain.createLangChainDiscoveryTool,llamaindex.createLlamaIndexDiscoveryTool]) await assert.rejects(factory(options),error=>error instanceof core.CatalogueDiscoveryClientError && error.code==='ADAPTER_UNAVAILABLE' && !Object.hasOwn(error,'cause'));
    assert.equal(credentials,2);
    assert.equal(network,0);
    console.log('Clean tarball install: root and all public subpaths inert, zero peers, bounded synthetic core/starter calls, safe missing-adapter errors.');
  `], { cwd: temporary, encoding: 'utf8', env, timeout: 30000 });
  console.log(installed.trim());
  console.log(smoke.trim());
} finally { await rm(temporary, { recursive: true, force: true }); }
