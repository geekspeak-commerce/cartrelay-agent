import { createCatalogueDiscoveryClient } from '../lib/index.mjs';

// No keys, environment lookup, source records, auto-connect or import-time action.
// Pass the host application's trusted private callback for an EXISTING delegated key.
export function prepareProductDiscovery(options) {
  const client = createCatalogueDiscoveryClient(options);
  return async function discoverForShopper(input) {
    // Invoke only for an explicit shopper need, with known destination/currency.
    return client.discover(input);
  };
}
