import type { DiscoveryClientOptions, DiscoveryInput, DiscoveryResult } from '../lib/index.mjs';
export function prepareProductDiscovery(options: DiscoveryClientOptions): (input: DiscoveryInput) => Promise<DiscoveryResult>;
