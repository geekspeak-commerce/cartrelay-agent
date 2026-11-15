import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { DiscoveryClientOptions } from './cartrelay-discovery.mjs';
/** Lazy peer load; .invoke(input) returns JSON text or a ToolMessage for an explicit tool_call envelope. Tool-level tracing/callbacks are bypassed. */
export function createLangChainDiscoveryTool(options: DiscoveryClientOptions): Promise<DynamicStructuredTool>;
