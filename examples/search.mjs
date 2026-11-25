#!/usr/bin/env node
// Run only for an explicit shopper request after real browser login and acceptance.
// Keep credential files outside the repository and inaccessible to other users.
// Disable tracing BEFORE framework/model imports; also remove host callbacks.
for (const key of ['LANGCHAIN_TRACING', 'LANGCHAIN_TRACING_V2', 'LANGSMITH_TRACING']) process.env[key] = 'false';

async function main() {
  const filename = process.env.CARTRELAY_CREDENTIAL_FILE;
  if (!filename) throw new Error('CREDENTIAL_FILE_REQUIRED');
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2) throw new Error('INVALID_ARGUMENTS');
  // This module is copied from the real login's secure caller-owned file store.
  const { createCredentialFileStore } = await import('../lib/credential-store.mjs');
  const { createOAuthCredentialProvider } = await import('../lib/oauth.mjs');
  const { createLangChainSearchTool } = await import('../lib/langchain-mcp.mjs');
  const store = createCredentialFileStore(filename);
  const credentials = createOAuthCredentialProvider({ loadTokens: store.loadTokens, saveTokens: store.saveTokens });
  const search = await createLangChainSearchTool({ credentialProvider: credentials });
  const result = await search.invoke({ query: args[0], country: args[1] ?? 'CA' });
  // No queries, products, credentials or raw exceptions are emitted.
  process.stdout.write(`${JSON.stringify({ ok: true, product_count: result.products.length })}\n`);
}

try { await main(); }
catch { process.stderr.write('{"ok":false,"code":"SEARCH_EXAMPLE_FAILED"}\n'); process.exitCode = 1; }
