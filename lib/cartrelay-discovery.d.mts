export type DiscoveryContext = { country: 'CA'; currency: 'CAD'; version?: never }
  | { country: 'US'; currency: 'USD'; version?: never }
  | { version: 2; country: string; currency: string };
export interface DiscoveryInput {
  query: string;
  context: DiscoveryContext;
  limit?: number;
  max_price_minor?: number;
  cursor?: string;
}
export interface DiscoveryClientOptions {
  origin?: string;
  getCredential: () => string | Promise<string>;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}
export interface Money { amount: number; currency: string }
export interface Merchant {
  name: string; id: string | null; domain: string | null; url: string | null;
  policy_links: { type: string; url: string }[];
}
export interface PriceEstimate {
  amount: number; currency: 'CAD'; estimated: true; source: 'Bank of Canada';
  source_url: 'https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/';
  rate: string; rate_date: string;
}
export interface DiscoveryOffer {
  id: string; title: string; price: Money | null; available: boolean | null;
  availability_status: string | null; options: { name: string; label: string }[];
  merchant: Merchant | null; retailer_url: string | null;
  quantity_link_support: 'one_item_only' | 'unknown'; missing_facts: string[];
  handoff_kind?: 'retailer_product'; availability_basis?: 'advertiser_feed';
  source_updated_at?: string | null; destination_url?: string | null; price_estimate?: PriceEstimate;
}
export interface DiscoveryProduct {
  id: string; title: string; url: string | null; image_url: string | null;
  offers: DiscoveryOffer[]; options: { name: string; values: string[] }[];
  description_inferred: boolean; missing_facts: string[];
}
export interface DiscoveryResult {
  ok: true;
  data: {
    products: DiscoveryProduct[];
    pagination: { cursor: string | null; has_next_page: boolean };
    notices: string[]; source: string; fetched_at: string;
  };
  interpretation: {
    category: 'drinkware' | 'apparel' | 'footwear' | 'electronics' | 'home' | 'beauty' | 'food_and_beverage' | 'pets' | 'other';
    query_kind: 'product' | 'product_or_brand' | 'merchant_or_brand';
    budget_applied: boolean; merchant_evidence: 'exact_source_merchant' | 'not_established';
  };
}
export interface CatalogueDiscoveryClient { discover(input: DiscoveryInput): Promise<DiscoveryResult> }
export type DiscoveryErrorCode = 'INVALID_INPUT' | 'INVALID_ORIGIN' | 'INVALID_CONFIGURATION' | 'CREDENTIAL_UNAVAILABLE'
  | 'CLIENT_TIMEOUT' | 'INVALID_RESPONSE' | 'RESPONSE_TOO_LARGE' | 'REQUEST_FAILED' | 'REDIRECT_REJECTED'
  | 'ADAPTER_UNAVAILABLE' | 'DISCOVERY_CLARIFICATION_REQUIRED' | 'UNAUTHORIZED' | 'AGENT_CONNECTION_REQUIRED'
  | 'SESSION_EXPIRED' | 'AUTH_UNAVAILABLE' | 'FORBIDDEN' | 'INSUFFICIENT_SCOPE' | 'CROSS_ORIGIN_DENIED'
  | 'METHOD_NOT_ALLOWED' | 'RATE_LIMITED' | 'DISCOVERY_BUSY' | 'DISCOVERY_DEADLINE' | 'DISCOVERY_ABORTED'
  | 'INVALID_SOURCE_RESPONSE' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_REJECTED' | 'PROVIDER_CONFIGURATION_REQUIRED'
  | 'PROVIDER_RATE_LIMITED' | 'AWIN_RATE_LIMITED' | 'AWIN_ENTITLEMENT_REQUIRED' | 'AWIN_AUTHORIZATION_REQUIRED'
  | 'AWIN_SOURCE_CHANGED' | 'CJ_ENTITLEMENT_REQUIRED' | 'CJ_AUTHORIZATION_REQUIRED' | 'CJ_CONFIGURATION_REQUIRED'
  | 'CJ_DISABLED' | 'IMPACT_ENTITLEMENT_REQUIRED' | 'IMPACT_AUTHORIZATION_REQUIRED' | 'IMPACT_CONFIGURATION_REQUIRED'
  | 'IMPACT_DISABLED' | 'FLEXOFFERS_API_DOCUMENTATION_REQUIRED' | 'DATABASE_UNAVAILABLE' | 'INTERNAL_ERROR';
export class CatalogueDiscoveryClientError extends Error {
  constructor(code: DiscoveryErrorCode, status?: number | null, retryAfter?: number | null);
  readonly code: DiscoveryErrorCode;
  readonly status: number | null;
  readonly retry_after: number | null;
}
export function createCatalogueDiscoveryClient(options: DiscoveryClientOptions): CatalogueDiscoveryClient;
