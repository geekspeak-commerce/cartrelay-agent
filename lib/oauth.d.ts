export interface OAuthTokens {
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  /** Absolute Unix epoch milliseconds, not seconds. */
  expiresAt: number;
}
export interface CredentialProvider {
  /** If provided, must exactly equal the tool's normalized pinned origin. */
  readonly origin?: string;
  getCredential(): string | Promise<string>;
}
export interface OAuthCredentialProviderOptions {
  /** Optional trusted binding; otherwise taken from the secure store. */
  clientId?: string;
  origin?: string;
  loadTokens(): OAuthTokens | undefined | Promise<OAuthTokens | undefined>;
  /** Must securely and durably persist rotation before resolving. */
  saveTokens(tokens: Readonly<OAuthTokens>): void | Promise<void>;
  fetchImpl?: typeof globalThis.fetch;
  now?: () => number;
  expirySkewMs?: number;
  timeoutMs?: number;
}
export class CartRelayMcpError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, status?: number);
}
export function createOAuthCredentialProvider(options: OAuthCredentialProviderOptions): Readonly<CredentialProvider & { origin: string }>;
