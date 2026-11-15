import type { DiscoveryInput } from './cartrelay-discovery.mjs';
export type JsonSchema = Readonly<{ [key: string]: string | number | boolean | null | JsonSchema | readonly (string | number | boolean | null | JsonSchema)[] }>;
/** Normalized-input metadata; parseDiscoveryInput authoritatively enforces the approved client's UTF-16 bounds. */
export const discoveryInputSchema: JsonSchema;
export function parseDiscoveryInput(input: unknown): DiscoveryInput;
export const discoveryToolName: 'cartrelay_discover';
export const discoveryToolDescription: string;
