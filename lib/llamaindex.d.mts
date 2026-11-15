import type { FunctionTool } from '@llamaindex/core/tools';
import type { DiscoveryClientOptions, DiscoveryInput } from './cartrelay-discovery.mjs';
/** Lazy peer load; .call(input) returns a JSON string. Strict validation precedes credential retrieval. */
export function createLlamaIndexDiscoveryTool(options: DiscoveryClientOptions): Promise<FunctionTool<DiscoveryInput, Promise<string>>>;
