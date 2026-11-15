# @cartrelay/agent

A public, source-free, installable JavaScript package for **authenticated CartRelay discovery**. The core has zero runtime dependencies and reuses CartRelay's approved released client unchanged. It contains no canonical server code, catalogue/source assets, product records or credentials. Public package installation is not anonymous product access, a public product index or redistribution permission.

The authorized distribution is the source-only GitHub repository and pinned release artifact. Npm registry publication is not available and is not claimed. Use the release URL only once v0.1.0 appears in the repository's Releases; the local reviewed tarball is also installable. Node.js 22+ and ESM are required. There are no install scripts or build step.

```sh
# Local source-free artifact, after npm pack in this package directory:
npm install ./cartrelay-agent-0.1.0.tgz

# Pinned source-free GitHub release artifact:
npm install https://github.com/geekspeak-commerce/cartrelay-agent/releases/download/v0.1.0/cartrelay-agent-0.1.0.tgz

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
npm install --no-save --package-lock=false --ignore-scripts @langchain/core@1.4.1 @llamaindex/core@0.6.23 @cfworker/json-schema@4.1.4
node --test verification/offline.test.mjs
npm pack --dry-run --json --ignore-scripts
npm pack --json --ignore-scripts

# From the private development repository root:
./node_modules/.bin/vitest run tests/cartrelay-agent-package.test.ts
```

Before publication, the owner must review the tarball/public-repository allowlist and licenses, choose the supported destinations, confirm npm scope ownership/authentication and version availability, then explicitly authorize publication. No publishing or GitHub action is performed here. See `NOTICE.md` for approved-client provenance and verified official API references, and `LICENSE` for the software-only licensing boundary.
