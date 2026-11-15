import { createCatalogueDiscoveryClient, parseDiscoveryInput, discoveryInputSchema, type DiscoveryInput, type DiscoveryResult } from '../lib/index.mjs';
import { createLangChainDiscoveryTool } from '../lib/langchain.mjs';
import { createLlamaIndexDiscoveryTool } from '../lib/llamaindex.mjs';
import { prepareProductDiscovery } from '../starter/discovery.mjs';

const input: DiscoveryInput = { query: 'synthetic bottle', context: { country: 'CA', currency: 'CAD' } };
const options = { getCredential: async () => 'synthetic-type-only-value', fetchImpl: globalThis.fetch };
const client = createCatalogueDiscoveryClient(options);
const action: (input: DiscoveryInput) => Promise<DiscoveryResult> = prepareProductDiscovery(options);
const parsed: DiscoveryInput = parseDiscoveryInput(input);
void discoveryInputSchema;
void client; void action; void parsed;
async function typedAdapters() {
  const langchain = await createLangChainDiscoveryTool(options);
  const llamaindex = await createLlamaIndexDiscoveryTool(options);
  const json: string = await llamaindex.call(input);
  void json; void langchain.invoke;
}
void typedAdapters;
// @ts-expect-error legacy context currency mismatch must be caught statically
const invalidContext: DiscoveryInput = { query: 'synthetic item', context: { country: 'CA', currency: 'USD' } };
// @ts-expect-error version 1 is not a discovery context
const invalidVersion: DiscoveryInput = { query: 'synthetic item', context: { version: 1, country: 'JP', currency: 'JPY' } };
// @ts-expect-error approval is not part of discovery
const invalidApproval: DiscoveryInput = { ...input, approval: true };
void invalidContext; void invalidVersion; void invalidApproval;
