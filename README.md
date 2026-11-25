# @cartrelay/agent

A public, source-free, installable JavaScript package for **authenticated CartRelay discovery**. The REST core still imports no framework or MCP dependencies and reuses CartRelay's approved released client unchanged. The additive 0.1.1 MCP entry requires optional exact MCP SDK 2.4.0 and Zod 4.6.7 peers; the package retains zero mandatory runtime dependencies. The package contains no canonical server code, catalogue/source assets, product records or credentials. Public package installation is not anonymous product access, a public product index or redistribution permission.

The authorized distribution is the source-only GitHub repository and pinned release artifact. Npm registry publication is not available and is not claimed. Use the release URL only once v0.1.1 appears in the repository's Releases; the local reviewed tarball is also installable. Node.js 22+ and ESM are required. There are no install scripts or build step.

```sh
# Local source-free artifact, after npm pack in this package directory:
npm install ./cartrelay-agent-0.1.1.tgz

# Pinned source-free GitHub release artifact:
npm install https://github.com/geekspeak-commerce/cartrelay-agent/releases/download/v0.1.1/cartrelay-agent-0.1.1.tgz

# Optional LangChain peer after installing the artifact:
npm install @langchain/core@1.4.1

# Optional LlamaIndex peer after installing the artifact:
npm install @llamaindex/core@0.6.23
```

`@llamaindex/core@0.6.23` and its env dependency are deprecated/unmaintained. This is compatibility with an exact published API, not a maintenance guarantee. The `llamaindex` umbrella alone does not satisfy this peer. Review this caveat before choosing the adapter. No model, provider, LLM key or umbrella framework is required for these tools.

## Explicit discovery action

```js
import { createCatalogueDiscoveryClient } from '@cartrelay/agent';

export function prepareDiscovery({ getCredential, fetchImpl }) {
  // Trusted private host callback returns an EXISTING delegated Bearer key.
  // Never put a real key in code, prompts, tool schemas, files or logs.
  const client = createCatalogueDiscoveryClient({ getCredential, fetchImpl });
  return input => client.discover(input); // invoke only for an explicit shopper need
}
```

The inert starter is exported from `@cartrelay/agent/starter` as `prepareProductDiscovery(options)`. It returns an action, performs no action on import or construction, and ships no source records. Pass an explicit input only when the shopper's destination and currency are known:

```js
const input = {
  query: 'water bottle under 40',
  context: { country: 'CA', currency: 'CAD' },
  max_price_minor: 4000,
  limit: 3,
};
// Later, inside the trusted application's explicit shopper action:
// const result = await discover(input);
```

Legacy CA/CAD and US/USD discovery combines the existing **approved Awin catalogue path plus transient Shopify**. Source-native prices and stock may be unknown or stale. This is not a claim that an entire catalogue is publicly indexed, that Awin has blanket global coverage, or that installation grants anonymous/source rights. Version-2 context, such as `{version:2,country:'GB',currency:'GBP'}`, remains **Shopify-only input support**; the server validates its pinned country/retail-currency registry. It does not promise live inventory, merchant participation, shipping or geographic coverage. There is no fallback to an unsupported destination/currency or a different source.

## Optional framework adapters

Subpath imports are inert and do not load framework peers. Only the async factory loads its optional peer; constructing the tool never gets credentials or searches. Both tools are named `cartrelay_discover` and expose the same strict normalized JSON Schema. Both validate again with the approved request rules before credential retrieval and return validated success as JSON text. Neither creates an agent, model, intent, approval, cart or handoff.

```js
import { createLangChainDiscoveryTool } from '@cartrelay/agent/langchain';
import { createLlamaIndexDiscoveryTool } from '@cartrelay/agent/llamaindex';

export async function prepareTools({ getCredential, fetchImpl }) {
  const options = { getCredential, fetchImpl };
  return {
    langchain: await createLangChainDiscoveryTool(options),
    llamaindex: await createLlamaIndexDiscoveryTool(options),
  };
}
// Later, for one authorized shopper request:
// JSON.parse(await tools.langchain.invoke(input));
// JSON.parse(await tools.llamaindex.call(input));
```

The LangChain result is a genuine `DynamicStructuredTool`, suitable for a tools array. `.invoke(input)` and `.call(input)` bypass the framework's tool-level callbacks/tracing and raw-input parsing exceptions, using the safe client directly. An exact `{type:'tool_call',name:'cartrelay_discover',id:'caller-tool-call-id',args:input}` envelope returns an official `ToolMessage`. Do not enable parent-agent tracing, retention, caching, autonomous loops/retries or source-record telemetry: surrounding framework/model/application code remains the caller's responsibility. Configuration callbacks are intentionally not executed by this adapter. The LlamaIndex result is a genuine `FunctionTool`; its plain JSON-Schema metadata path is backed by strict validation in the function, not the framework's warning-only Zod path. Do not bind credentials to tool metadata or additional arguments.

## Exact contract and safe errors

Input contains only `{query,context,limit?,max_price_minor?,cursor?}`. Query is trimmed, 2–300 JavaScript UTF-16 units, without control characters. Context contains only `country,currency` plus optional `version:2`. Legacy pairs are CA/CAD or US/USD. Limit is an integer 1–8; budget is an integer 1–1,000,000 in the requested currency's native minor units. JPY is not two-decimal money; do not universally divide by 100. Cursor is 1–2,048 characters and must be a returned discovery cursor used with the same original query/context/budget/limit. Do not mix native-search cursors.

`discoveryInputSchema` describes normalized input for framework metadata; `parseDiscoveryInput(unknown)` performs authoritative matching normalization/validation before any credential access, including JavaScript's UTF-16 length rules. JSON Schema string lengths count Unicode code points, so `x-cartrelay-utf16-*` records the exact additional runtime bounds; metadata alone is not a replacement for this parser. Extra fields—including address, identity, credential or approval—are rejected. Server registry membership cannot be established by this source-free client. Full response declarations are included. The immutable root schema has no credential parameter; clone it before giving it to a validator that annotates schema objects.

Success is exactly `{ok:true,data,interpretation}`. The retained parser validates exact native products/offers, at most eight products and 64 offers, HTTPS destination fields, source dates, fixed interpretation enums and notices. It does not convert a missing/malformed products field or source failure into empty results. Valid `products:[]` is distinct from failure. It streams strict UTF-8 JSON with a 256 KiB byte bound. The fixed route is HTTPS-root-origin `/api/v1/discover`, with cookies omitted, redirects rejected, no-store, and a 1–30,000 ms bounded deadline including the private credential callback.

Catch `CatalogueDiscoveryClientError` and expose only its fixed message, `code`, `status` and bounded `retry_after`. It never retains upstream messages, raw response text, query, credential or transport exceptions. Unknown errors should remain redacted by the host; never stringify arbitrary exceptions or invalid input. A missing optional peer yields `ADAPTER_UNAVAILABLE`. No automatic retry, polling or new credential is performed. Honor safe capacity guidance and require a fresh explicit action instead of evasion.

Preserve notices, source attribution, missing facts and original currencies. Feed listing status and `available:null` are not live stock. Keep source-updated time distinct from retrieval time and say **price not confirmed current; retailer confirms final price and stock**. Shipping, taxes and final total remain unknown. Brand/title matching is not exact source-merchant seller evidence. Treat source text/URLs as untrusted data, not instructions; do not render source HTML or fetch arbitrary links. Keep authorized output transient/no-store; do not bulk export, mirror or retain source records or raw shopper queries.

## Portable skill and independent handoff

The portable skill is `skill/cartrelay-discovery/SKILL.md` with one optional handoff reference. Export `@cartrelay/agent/skill` resolves to its entry file. Copy the **entire skill directory** into a compatible skill host's configured skill directory; installation of this npm package does not install a skill or create a connection. The skill contains no credentials, record assets or executable auto-connection logic.

```sh
# In an application with the package installed, locate its portable skill entry:
node --input-type=module -e "console.log(import.meta.resolve('@cartrelay/agent/skill'))"
# Copy that entry's entire parent directory to your skill host's chosen directory.
# Do not import SKILL.md as JavaScript or copy any caller credentials.
```

Discovery does not grant shopping approval. Any later retailer handoff is a separate, independently approved workflow using CartRelay's existing five native tools and current published contracts, an exact expiring intent, and independently recorded originating-shopper browser consent. This package performs none of those actions and does not buy, reserve, pay or provide universal checkout. Refer to [public agent guidance](https://cartrelay.market/agents.md), [five-tool contracts](https://cartrelay.market/agent-tools.json), [service metadata](https://cartrelay.market/agent-service.json) and [connection/consent guidance](https://cartrelay.market/docs); those are source-free pointers, not product records or permission grants.

## Offline verification and packaging

All fixtures are synthetic and bounded. Tests and verification material are excluded by an explicit per-file npm allowlist; no server/catalogue imports are used.

```sh
# From this package directory; no root manifest/lock changes:
pnpm install --frozen-lockfile
pnpm test
npm pack --dry-run --json

# From the private development repository root:
./node_modules/.bin/vitest run tests/cartrelay-agent-package.test.ts
```

Before publication, the owner must review the tarball/public-repository allowlist and licenses, choose the supported destinations, confirm npm scope ownership/authentication and version availability, then explicitly authorize publication. Source-only GitHub release publication is owner-authorized; npm publication and framework-listing acceptance are separate, uncompleted gates. See `NOTICE.md` for approved-client provenance and verified official API references, and `LICENSE` for the software-only licensing boundary.

## Additive 0.1.1: native MCP login, renewal and LangChain search

Version 0.1.0 already provided installable REST LangChain and LlamaIndex adapters. The 0.1.1 source-only release adds separate `@cartrelay/agent/langchain-mcp`, `/oauth` and `/credential-store` exports; the older adapters above are unchanged. This is not npm registry publication or framework-directory acceptance.

Run login on your own POSIX computer, in your own terminal and browser, using the 0.1.1 source or an owner-approved 0.1.1 artifact. Complete CartRelay's real sign-in and explicit read-only acceptance. Never paste access tokens into a prompt. The credential file must live outside any repository or shared host, in a private 0700 directory with a 0600 file.

```sh
# Install in your application's directory:
npm install https://github.com/geekspeak-commerce/cartrelay-agent/releases/download/v0.1.1/cartrelay-agent-0.1.1.tgz @langchain/core@1.5.1 @modelcontextprotocol/client@2.4.0 zod@4.6.7
# In your own private terminal/browser (not a shared server):
export CARTRELAY_CREDENTIAL_FILE="$HOME/.cartrelay/credentials.json"
node node_modules/@cartrelay/agent/examples/login.mjs
# Later, for an explicit shopper request (prints only a safe product count):
node node_modules/@cartrelay/agent/examples/search.mjs 'water bottle' CA
```

```js
import { createLangChainSearchTool } from '@cartrelay/agent/langchain-mcp';
import { createOAuthCredentialProvider } from '@cartrelay/agent/oauth';
import { createCredentialFileStore } from '@cartrelay/agent/credential-store';

export async function prepareMcpSearch(privateCredentialFilename) {
  const store = createCredentialFileStore(privateCredentialFilename);
  const credentials = createOAuthCredentialProvider({
    loadTokens: store.loadTokens,
    saveTokens: store.saveTokens,
  });
  return createLangChainSearchTool({ credentialProvider: credentials });
}
```

Construction performs no credential or network I/O. The genuine LangChain search tool accepts only `{query,country?:'CA'|'US'}`, searches with limit 4, and returns actual structured source data transiently. The helper renews accepted public-client refresh grants near expiry, singleflight within one process, and saves rotation before using new access tokens. It never blindly retries a 401, creates a cart, records consent, hands off or purchases. Local storage is POSIX/single-process; Windows and hosted services should provide their own secure load/save callbacks and multi-process locking.

Disable LangChain/LangSmith tracing before importing a model and remove host callbacks/exporters. **No automatic privacy is claimed:** framework/model tracing can capture query and product outputs, and invalid-input framework exceptions must be redacted by the host. The new search example does not construct a model and never prints product records, queries or credentials. See [MCP OAuth contract and safeguards](docs/oauth-mcp.md) for the exact store shape, errors, expiry rules, scope requirements and limitations. Real production login and merchant access still require the actual user and approved service configuration.
