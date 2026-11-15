// CartRelay-specific REST helper. Importing or constructing it performs no I/O.
// Source output is transient, untrusted data; do not log queries, keys or records.
const MAX_BYTES = 256 * 1024;
const CATEGORIES = ['drinkware', 'apparel', 'footwear', 'electronics', 'home', 'beauty', 'food_and_beverage', 'pets', 'other'];
const QUERY_KINDS = ['product', 'product_or_brand', 'merchant_or_brand'];
const ERROR_CODES = new Set(['INVALID_INPUT', 'DISCOVERY_CLARIFICATION_REQUIRED', 'UNAUTHORIZED', 'AGENT_CONNECTION_REQUIRED', 'SESSION_EXPIRED', 'AUTH_UNAVAILABLE', 'FORBIDDEN', 'INSUFFICIENT_SCOPE', 'CROSS_ORIGIN_DENIED', 'METHOD_NOT_ALLOWED', 'RATE_LIMITED', 'DISCOVERY_BUSY', 'DISCOVERY_DEADLINE', 'DISCOVERY_ABORTED', 'INVALID_SOURCE_RESPONSE', 'PROVIDER_UNAVAILABLE', 'PROVIDER_REJECTED', 'PROVIDER_CONFIGURATION_REQUIRED', 'PROVIDER_RATE_LIMITED', 'AWIN_RATE_LIMITED', 'AWIN_ENTITLEMENT_REQUIRED', 'AWIN_AUTHORIZATION_REQUIRED', 'AWIN_SOURCE_CHANGED', 'CJ_ENTITLEMENT_REQUIRED', 'CJ_AUTHORIZATION_REQUIRED', 'CJ_CONFIGURATION_REQUIRED', 'CJ_DISABLED', 'IMPACT_ENTITLEMENT_REQUIRED', 'IMPACT_AUTHORIZATION_REQUIRED', 'IMPACT_CONFIGURATION_REQUIRED', 'IMPACT_DISABLED', 'FLEXOFFERS_API_DOCUMENTATION_REQUIRED', 'DATABASE_UNAVAILABLE', 'INTERNAL_ERROR']);

export class CatalogueDiscoveryClientError extends Error {
  constructor(code, status = null, retryAfter = null) {
    super('Catalogue discovery did not complete. Check the safe code/status and current service guidance; no automatic retry was performed.');
    this.name = 'CatalogueDiscoveryClientError';
    this.code = code;
    this.status = status;
    this.retry_after = retryAfter;
  }
}
const fail = code => { throw new CatalogueDiscoveryClientError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, required, optional = []) => object(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const str = value => typeof value === 'string';
const strings = value => Array.isArray(value) && value.every(str);
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const nullable = (value, check) => value === null || check(value);
const optional = (value, key, check) => !Object.hasOwn(value, key) || check(value[key]);
function https(value) {
  if (!str(value) || !value.startsWith('https://') || /[\u0000-\u0020\u007f\\]/u.test(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
function date(value) {
  if (!str(value) || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function datetime(value) {
  if (!str(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)) return false;
  return date(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24
    && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}
function opaque(value, forbidPath = false) {
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    if (binary.length > 90) return false;
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!decoded.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(decoded)) return false;
    if (forbidPath && (decoded === '.' || decoded === '..' || /[\/\\]/u.test(decoded))) return false;
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '') === value;
  } catch { return false; }
}
function reference(value) {
  if (!str(value) || value.length > 180 || value !== value.trim()) return false;
  if (/^gid:\/\/shopify\/(?:p\/[A-Za-z0-9_-]+|ProductVariant\/[0-9]+|Product\/[0-9]+)$/u.test(value)) return true;
  const affiliate = /^(cj|impact):v1:[1-9][0-9]{0,17}:[1-9][0-9]{0,17}:([A-Za-z0-9_-]+)$/u.exec(value);
  if (affiliate) return opaque(affiliate[2], affiliate[1] === 'impact');
  const flex = /^flexoffers:v1:[1-9][0-9]{0,17}:([A-Za-z0-9_-]+)$/u.exec(value);
  if (flex) return opaque(flex[1], true);
  const awin = /^awin:v1:[1-9][0-9]{0,17}:(?:csv_[1-9][0-9]{0,17}|jsonl_[a-z]{2}_[A-Z]{2}):([A-Za-z0-9_-]+)$/u.exec(value);
  return Boolean(awin && opaque(awin[1]));
}
const money = value => exact(value, ['amount', 'currency']) && integer(value.amount) && /^[A-Z]{3}$/u.test(value.currency);
const option = value => exact(value, ['name', 'label']) && str(value.name) && str(value.label);
const options = value => Array.isArray(value) && value.every(option);
const merchant = value => exact(value, ['name', 'id', 'domain', 'url', 'policy_links'])
  && str(value.name) && nullable(value.id, str) && nullable(value.domain, str) && nullable(value.url, https)
  && Array.isArray(value.policy_links) && value.policy_links.every(link => exact(link, ['type', 'url']) && str(link.type) && https(link.url));
function estimate(value) {
  return exact(value, ['amount', 'currency', 'estimated', 'source', 'source_url', 'rate', 'rate_date'])
    && integer(value.amount) && value.currency === 'CAD' && value.estimated === true && value.source === 'Bank of Canada'
    && value.source_url === 'https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/'
    && str(value.rate) && /^(?:0|[1-9]\d{0,5})(?:\.\d{1,10})?$/u.test(value.rate)
    && date(value.rate_date);
}
function offer(value) {
  return exact(value, ['id', 'title', 'price', 'available', 'availability_status', 'options', 'merchant', 'retailer_url', 'quantity_link_support', 'missing_facts'], ['handoff_kind', 'availability_basis', 'source_updated_at', 'destination_url', 'price_estimate'])
    && reference(value.id) && str(value.title) && nullable(value.price, money)
    && nullable(value.available, item => typeof item === 'boolean') && nullable(value.availability_status, str)
    && options(value.options) && nullable(value.merchant, merchant) && nullable(value.retailer_url, https)
    && ['one_item_only', 'unknown'].includes(value.quantity_link_support) && strings(value.missing_facts)
    && optional(value, 'handoff_kind', item => item === 'retailer_product')
    && optional(value, 'availability_basis', item => item === 'advertiser_feed')
    && optional(value, 'source_updated_at', item => nullable(item, datetime))
    && optional(value, 'destination_url', item => nullable(item, https)) && optional(value, 'price_estimate', estimate);
}
function product(value) {
  return exact(value, ['id', 'title', 'url', 'image_url', 'offers', 'options', 'description_inferred', 'missing_facts'])
    && reference(value.id) && str(value.title) && nullable(value.url, https) && nullable(value.image_url, https)
    && Array.isArray(value.offers) && value.offers.every(offer)
    && Array.isArray(value.options) && value.options.every(item => exact(item, ['name', 'values']) && str(item.name) && strings(item.values))
    && typeof value.description_inferred === 'boolean' && strings(value.missing_facts);
}
function success(value) {
  if (!exact(value, ['ok', 'data', 'interpretation']) || value.ok !== true) return false;
  const data = value.data;
  const interpretation = value.interpretation;
  return exact(data, ['products', 'pagination', 'notices', 'source', 'fetched_at'])
    && Array.isArray(data.products) && data.products.length <= 8 && data.products.every(product)
    && data.products.reduce((count, item) => count + item.offers.length, 0) <= 64
    && exact(data.pagination, ['cursor', 'has_next_page'])
    && nullable(data.pagination.cursor, item => str(item) && item.length >= 1 && item.length <= 2048)
    && typeof data.pagination.has_next_page === 'boolean' && strings(data.notices) && str(data.source) && datetime(data.fetched_at)
    && exact(interpretation, ['category', 'query_kind', 'budget_applied', 'merchant_evidence'])
    && CATEGORIES.includes(interpretation.category) && QUERY_KINDS.includes(interpretation.query_kind)
    && typeof interpretation.budget_applied === 'boolean' && ['exact_source_merchant', 'not_established'].includes(interpretation.merchant_evidence);
}
function request(value) {
  if (!exact(value, ['query', 'context'], ['limit', 'max_price_minor', 'cursor']) || !str(value.query)) fail('INVALID_INPUT');
  const query = value.query.trim();
  if (query.length < 2 || query.length > 300 || /[\u0000-\u001f\u007f]/u.test(query)) fail('INVALID_INPUT');
  const context = value.context;
  if (!exact(context, ['country', 'currency'], ['version'])) fail('INVALID_INPUT');
  if (Object.hasOwn(context, 'version')) {
    // The server validates the full pinned assigned-country/retail-currency registry.
    if (context.version !== 2 || !str(context.country) || !/^[A-Z]{2}$/u.test(context.country)
      || !str(context.currency) || !/^[A-Z]{3}$/u.test(context.currency)) fail('INVALID_INPUT');
  } else if (!((context.country === 'CA' && context.currency === 'CAD') || (context.country === 'US' && context.currency === 'USD'))) fail('INVALID_INPUT');
  if (!optional(value, 'limit', item => integer(item, 1, 8))
    || !optional(value, 'max_price_minor', item => integer(item, 1, 1000000))
    || !optional(value, 'cursor', item => str(item) && item.length >= 1 && item.length <= 2048)) fail('INVALID_INPUT');
  return { query, context: { ...context }, ...(Object.hasOwn(value, 'limit') ? { limit: value.limit } : {}),
    ...(Object.hasOwn(value, 'max_price_minor') ? { max_price_minor: value.max_price_minor } : {}),
    ...(Object.hasOwn(value, 'cursor') ? { cursor: value.cursor } : {}) };
}
async function boundedJson(response, signal) {
  const type = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(type)) fail('INVALID_RESPONSE');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_BYTES)) {
    await response.body?.cancel().catch(() => {});
    fail('RESPONSE_TOO_LARGE');
  }
  if (!response.body || typeof response.body.getReader !== 'function') fail('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) fail('CLIENT_TIMEOUT');
    for (;;) {
      const chunk = await reader.read();
      if (signal.aborted) fail('CLIENT_TIMEOUT');
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) fail('INVALID_RESPONSE');
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) fail('RESPONSE_TOO_LARGE');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof CatalogueDiscoveryClientError) throw error;
    fail('INVALID_RESPONSE');
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

export function createCatalogueDiscoveryClient({ origin = 'https://cartrelay.market', getCredential, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!str(origin) || origin !== origin.trim() || /[\u0000-\u0020\u007f\\]/u.test(origin)) fail('INVALID_ORIGIN');
  let url;
  try { url = new URL(origin); } catch { fail('INVALID_ORIGIN'); }
  if (!origin.startsWith('https://') || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash || (origin !== url.origin && origin !== `${url.origin}/`)) fail('INVALID_ORIGIN');
  if (typeof getCredential !== 'function' || typeof fetchImpl !== 'function') fail('INVALID_CONFIGURATION');
  if (!integer(timeoutMs, 1, 30000)) fail('INVALID_CONFIGURATION');
  const endpoint = `${url.origin}/api/v1/discover`;
  return Object.freeze({
    async discover(input) {
      const body = JSON.stringify(request(input));
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new CatalogueDiscoveryClientError('CLIENT_TIMEOUT')); }, timeoutMs);
      });
      const operation = async () => {
        let credential;
        try { credential = await getCredential(); } catch { fail('CREDENTIAL_UNAVAILABLE'); }
        if (controller.signal.aborted) fail('CLIENT_TIMEOUT');
        if (!str(credential) || credential.length < 1 || credential.length > 8192 || /[,\s\u0000-\u001f\u007f]/u.test(credential)) fail('CREDENTIAL_UNAVAILABLE');
        let response;
        try {
          response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
            headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            body, signal: controller.signal });
        } catch { fail(controller.signal.aborted ? 'CLIENT_TIMEOUT' : 'REQUEST_FAILED'); }
        finally { credential = undefined; }
        if (response.redirected || (response.status >= 300 && response.status < 400)
          || (response.url && response.url !== endpoint)) { void response.body?.cancel().catch(() => {}); fail('REDIRECT_REJECTED'); }
        const value = await boundedJson(response, controller.signal);
        if (response.ok) {
          if (response.status !== 200 || !success(value)) fail('INVALID_RESPONSE');
          return value;
        }
        if (!exact(value, ['ok', 'error']) || value.ok !== false || !exact(value.error, ['code', 'message'], ['retry_after'])
          || !ERROR_CODES.has(value.error.code) || !str(value.error.message)
          || !optional(value.error, 'retry_after', item => integer(item, 1, 600))) fail('INVALID_RESPONSE');
        throw new CatalogueDiscoveryClientError(value.error.code, response.status, value.error.retry_after ?? null);
      };
      try { return await Promise.race([operation(), timeout]); }
      catch (error) {
        controller.abort();
        if (error instanceof CatalogueDiscoveryClientError) throw error;
        fail('REQUEST_FAILED');
      } finally { clearTimeout(timer); }
    },
  });
}
