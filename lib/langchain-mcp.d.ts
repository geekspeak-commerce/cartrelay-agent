import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { z } from 'zod';
import type { CredentialProvider } from './oauth.js';
export { CartRelayMcpError } from './oauth.js';
export interface CartRelaySearchInput { query: string; country?: 'CA' | 'US' }
export interface CartRelaySearchData extends Record<string, unknown> {
  products: Array<Record<string, unknown>>;
}
export interface CartRelaySearchToolOptions {
  origin?: string;
  env?: Record<string, string | undefined>;
  credentialProvider?: CredentialProvider;
  fetchImpl?: typeof globalThis.fetch;
}
/** Factory does not load credentials or contact CartRelay. */
export function createLangChainSearchTool(options?: CartRelaySearchToolOptions): Promise<DynamicStructuredTool<z.ZodObject<{
  query: z.ZodString;
  country: z.ZodDefault<z.ZodEnum<{ CA: 'CA'; US: 'US' }>>;
}>, { query: string; country: 'CA' | 'US' }, CartRelaySearchInput, CartRelaySearchData>>;
