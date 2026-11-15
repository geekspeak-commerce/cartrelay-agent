import { createCatalogueDiscoveryClient, CatalogueDiscoveryClientError } from './cartrelay-discovery.mjs';
import { discoveryInputSchema, parseDiscoveryInput, discoveryToolName, discoveryToolDescription } from './schema.mjs';

export async function createLlamaIndexDiscoveryTool(options) {
  const client = createCatalogueDiscoveryClient(options);
  let FunctionTool;
  try { ({ FunctionTool } = await import('@llamaindex/core/tools')); }
  catch { throw new CatalogueDiscoveryClientError('ADAPTER_UNAVAILABLE'); }
  // JSON-schema metadata is not validated by LlamaIndex's FunctionTool.from.
  // Avoid its Zod warning/logger path and validate strictly before credential access.
  return FunctionTool.from(async input => JSON.stringify(await client.discover(parseDiscoveryInput(input))), {
    name: discoveryToolName, description: discoveryToolDescription, parameters: discoveryInputSchema
  });
}
