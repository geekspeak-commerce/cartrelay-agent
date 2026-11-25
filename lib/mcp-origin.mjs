import { CartRelayMcpError } from './mcp-errors.mjs';
export const DEFAULT_ORIGIN = 'https://cartrelay.market';
const fail = code => { throw new CartRelayMcpError(code); };

// Exact origin validation rules from the unchanged approved reference client.
export function validateOrigin(value) {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#\\\s@]+\/?$/.test(value)) fail('INVALID_ORIGIN');
  let url;
  try { url = new URL(value); } catch { fail('INVALID_ORIGIN'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('INVALID_ORIGIN');
  if (url.protocol === 'http:' && !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]+)?\/?$/i.test(value)) fail('INVALID_ORIGIN');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) fail('INVALID_ORIGIN');
  return url.origin;
}
