import type { OAuthTokens } from './oauth.js';
export interface CredentialFileStore {
  loadTokens(): Promise<OAuthTokens>;
  assertCreateReady(): Promise<void>;
  saveTokens(tokens: Readonly<OAuthTokens>, options?: { createOnly?: boolean }): Promise<void>;
}
/** Inert POSIX, local single-process store. Private 0700 directory and 0600 file. */
export function createCredentialFileStore(filename: string): Readonly<CredentialFileStore>;
export function validateStoredTokens(value: unknown): OAuthTokens & { refreshToken: string };
