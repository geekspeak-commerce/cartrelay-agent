import { createCatalogueDiscoveryClient, CatalogueDiscoveryClientError } from './cartrelay-discovery.mjs';
import { discoveryInputSchema, parseDiscoveryInput, discoveryToolName, discoveryToolDescription } from './schema.mjs';

export async function createLangChainDiscoveryTool(options) {
  // Validate configuration without I/O, even when the optional peer is absent.
  const client = createCatalogueDiscoveryClient(options);
  let tool, ToolMessage;
  try {
    ({ tool } = await import('@langchain/core/tools'));
    ({ ToolMessage } = await import('@langchain/core/messages'));
  } catch { throw new CatalogueDiscoveryClientError('ADAPTER_UNAVAILABLE'); }
  const execute = async input => JSON.stringify(await client.discover(parseDiscoveryInput(input)));
  const instance = tool(execute, { name: discoveryToolName, description: discoveryToolDescription, schema: discoveryInputSchema, verbose: false });
  // Official tools normally trace raw arguments/results and can attach invalid input
  // to parsing exceptions. Keep the actual framework tool/schema, but replace its
  // execution boundary: validated core only, no tool callbacks or tracing pipeline.
  const invoke = async input => {
    let args = input;
    let id;
    if (input !== null && typeof input === 'object' && !Array.isArray(input) && input.type === 'tool_call') {
      if (Object.keys(input).some(key => !['type', 'name', 'id', 'args'].includes(key))
        || input.name !== discoveryToolName || typeof input.id !== 'string' || input.id.length < 1 || input.id.length > 256
        || /[\u0000-\u001f\u007f]/u.test(input.id) || !Object.hasOwn(input, 'args')) throw new CatalogueDiscoveryClientError('INVALID_INPUT');
      args = input.args;
      id = input.id;
    }
    const content = await execute(args);
    return id === undefined ? content : new ToolMessage({ content, name: discoveryToolName, tool_call_id: id });
  };
  Object.defineProperties(instance, {
    invoke: { value: invoke },
    call: { value: invoke },
    _call: { value: execute },
    func: { value: execute }
  });
  return instance;
}
