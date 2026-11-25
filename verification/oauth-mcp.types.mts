import { createLangChainSearchTool, type CartRelaySearchData } from '@cartrelay/agent/langchain-mcp';
import { createOAuthCredentialProvider, type OAuthTokens, CartRelayMcpError } from '@cartrelay/agent/oauth';
import { createCredentialFileStore } from '@cartrelay/agent/credential-store';
const tokens: OAuthTokens = { clientId: 'synthetic-client', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: 1000 };
const store = createCredentialFileStore('/not-used/type-only');
const credentials = createOAuthCredentialProvider({ loadTokens: () => tokens, saveTokens: store.saveTokens });
async function check() {
  const tool = await createLangChainSearchTool({ credentialProvider: credentials, env: {}, fetchImpl: globalThis.fetch });
  const data: CartRelaySearchData = await tool.invoke({ query: 'synthetic-only', country: 'CA' });
  const noCountry: CartRelaySearchData = await tool.invoke({ query: 'synthetic-only' });
  // @ts-expect-error MCP search only supports CA or US.
  await tool.invoke({ query: 'synthetic-only', country: 'GB' });
  // LangChain's official envelope union permits extension fields statically;
  // runtime strict Zod rejects them before credential access.
  void data; void noCountry;
}
void check; void tokens; void new CartRelayMcpError('CLIENT_FAILED');
