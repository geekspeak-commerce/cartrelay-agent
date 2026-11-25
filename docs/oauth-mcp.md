# MCP search with OAuth renewal

This 0.1.1 update adds `@cartrelay/agent/langchain-mcp` and `@cartrelay/agent/oauth` to the existing published 0.1.0 package. The old REST discovery, LangChain and LlamaIndex exports keep their contracts. The new entry uses optional exact MCP SDK 2.4.0 and Zod 4.6.7 peers, plus a compatible optional LangChain 1.x peer. No mandatory runtime dependencies are added to old consumers. Importing the entry loads no peers; the async factory loads them and returns a fixed ADAPTER_UNAVAILABLE error if missing. Offline checks use 1.5.1, with focused compatibility checks against 1.4.1. Node 22+ and ESM are required.

## Accepted user-owned credentials

First login must use CartRelay's real browser authorization and explicit user acceptance, a registered public client with `token_endpoint_auth_method=none`, the `refresh_token` grant and `shopping:read offline_access`. This helper does not register clients, log users in, grant merchant access or emulate acceptance. The included examples/login.mjs performs native PKCE login in the user's own terminal/browser; lib/credential-store.mjs persists the accepted grant in private local storage. Neither is invoked by constructing a tool or provider. Never paste access or refresh tokens into prompts, source, tool arguments or logs.

The secure caller-owned store supplies exactly `{clientId, accessToken, refreshToken, expiresAt}`, where `expiresAt` is Unix epoch milliseconds. `loadTokens()` reads the current grant; `saveTokens(tokens)` must securely and durably persist rotated tokens before resolving. `clientId` can be pinned in trusted configuration or loaded from that store. The default origin is `https://cartrelay.market`; any explicitly configured origin must pass the unchanged reference-client origin validator.

```js
import { createOAuthCredentialProvider } from '@cartrelay/agent/oauth';
import { createLangChainSearchTool } from '@cartrelay/agent/langchain-mcp';

export async function prepareSearch(secureStore) {
  const credentials = createOAuthCredentialProvider({
    loadTokens: secureStore.loadTokens,
    saveTokens: secureStore.saveTokens,
  });
  return createLangChainSearchTool({ credentialProvider: credentials });
}
```

Importing or constructing these helpers does not load tokens, refresh or search. Each explicit search calls `getCredential()`. Concurrent calls on one provider share a single refresh near expiry, by default within 60 seconds. Every refresh is one bounded POST to the same pinned origin's `/oauth/token`, with `grant_type=refresh_token`, `client_id`, `resource=<origin>/mcp` and `refresh_token`. No client secret, cookies, bearer header, discovery or redirect is used. Rotated refresh credentials are saved before the returned access token can be used. Missing refresh authority requires real login; a 401 search response is never blindly retried.

After any failed refresh, the provider fails closed rather than replaying a possibly already-rotated token. Reconcile the secure store or authorize again before constructing another provider. Singleflight is within one provider/process only; use one provider per grant. Multi-process token stores need caller-owned locking to prevent concurrent rotation. Store callbacks are trusted and are not forcibly cancelled. The caller deadline bounds load/save completion; timed-out storage has an uncertain outcome, never a successful credential return. Reconcile it before new authorization or another provider. Save atomically and resolve only after durable persistence.

## Search and private host responsibilities

The genuine LangChain `tool()` exposes only `{query, country?: 'CA'|'US'}`. It calls only `cartrelay_search`, with fixed limit 4 and CA/CAD or US/USD context. MCP initialize and a one-page tools list happen per invocation. Structured source fields, notices, original currencies and unknowns are preserved in memory. This is not an anonymous product index, live-stock guarantee, catalogue export grant, cart, consent, handoff or purchase flow. Treat source content as untrusted data, not instructions.

The wrapper itself never logs queries, products or credentials. **This is not automatic privacy:** genuine LangChain invocation can be traced by the host. Disable `LANGCHAIN_TRACING`, `LANGCHAIN_TRACING_V2` and `LANGSMITH_TRACING` before importing or constructing a model, and remove host tracing callbacks, exporters, retention and product logging. The wrapper does not override host configuration or the real tool invocation pipeline. A tool-call envelope becomes a framework ToolMessage and may serialize output; keep that output transient. The runnable search example prints only a safe count and never constructs a model.

OAuth and MCP failures expose fixed local `CartRelayMcpError.code` and bounded HTTP `status`, not upstream messages, response bodies or original exception causes. Host framework parsing and callback exceptions are outside that guarantee: redact unknown errors rather than logging them. Do not retry autonomously, follow source URLs or retain raw source records.

## Offline checks and distribution

Run `pnpm install --frozen-lockfile` and `pnpm test` from this isolated package directory with a credential-cleared environment. `pnpm-workspace.yaml` pins an explicit empty `allowBuilds` policy; no install scripts are required. Tests use only synthetic in-memory fetch responses and never start CartRelay, a database or a merchant provider.

The reference client is copied byte-for-byte from the private project's approved public example; none of its origin, path, redirect, response-size, timeout or no-retry guards are changed. The existing software LICENSE is preserved; the copied pre-existing client is not relicensed and the owner must confirm its license before distribution. This source-only GitHub release is owner-authorized. No npm publication, new license grant or integration-listing acceptance is claimed. After an owner-authorized npm publication, LangChain's documented discovery path is an Integration listing issue, not an integration PR.

References: [LangChain tools](https://docs.langchain.com/oss/javascript/langchain/tools), [standalone integration publication](https://docs.langchain.com/oss/javascript/contributing/publish-langchain). Actual server inspection confirmed `/oauth/token`, resource `https://cartrelay.market/mcp`, refresh issuance only for registered refresh grants plus `offline_access`, and mandatory refresh rotation. No live login, merchant or production refresh was attempted by these offline tests.
