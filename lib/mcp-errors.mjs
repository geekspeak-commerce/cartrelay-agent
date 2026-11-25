const codes = new Set([
  'INVALID_OPTIONS', 'ADAPTER_UNAVAILABLE', 'CREDENTIAL_FAILED', 'KEY_REQUIRED',
  'INVALID_KEY', 'INVALID_ORIGIN', 'INVALID_TIMEOUT', 'INVALID_CONTEXT', 'INVALID_QUERY',
  'INVALID_INPUT', 'CLIENT_FAILED', 'MALFORMED_RESPONSE', 'TOOL_ERROR',
  'TIMEOUT', 'NETWORK_ERROR', 'CLIENT_CLOSED', 'BLOCKED_DESTINATION',
  'REDIRECT_BLOCKED', 'AUTH_REQUIRED', 'FORBIDDEN', 'HTTP_ERROR', 'BODY_LIMIT', 'PROTOCOL_ERROR',
  'OAUTH_LOGIN_REQUIRED', 'OAUTH_STORE_FAILED', 'OAUTH_REFRESH_FAILED',
  'OAUTH_REDIRECT_BLOCKED', 'OAUTH_BODY_LIMIT', 'OAUTH_TIMEOUT', 'OAUTH_INVALID_RESPONSE',
]);

export class CartRelayMcpError extends Error {
  constructor(code, status) {
    const safe = codes.has(code) ? code : 'CLIENT_FAILED';
    super(safe);
    this.name = 'CartRelayMcpError';
    this.code = safe;
    if (Number.isInteger(status) && status >= 300 && status <= 599) this.status = status;
  }
}

export function safeMcpError(error) {
  try { return new CartRelayMcpError(codes.has(error?.code) ? error.code : 'CLIENT_FAILED', error?.status); }
  catch { return new CartRelayMcpError('CLIENT_FAILED'); }
}
