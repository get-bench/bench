import type {
  BuildAuthorizationUrlInput,
  ConnectorOAuthAdapter,
  ConnectorOAuthGrant,
  ExchangeCodeInput,
} from "./types.js";

/**
 * In-process OAuth adapter used by unit + integration tests to exercise the
 * Connector Runtime install / callback / revoke flow without touching the
 * network.
 *
 * NOT a real OAuth client. Do not register this in production paths. The
 * shape of `simulateExchange()` is what tests use to seed the next callback's
 * grant payload.
 */
export interface TestStubOAuthAdapter extends ConnectorOAuthAdapter {
  /** The vendor authorize URL the stub will return from buildAuthorizationUrl. */
  authorizeBaseUrl: string;
  /**
   * Tests call this *before* posting to the callback route to rig what the
   * "vendor" returned. If unset, exchangeCode rejects.
   */
  setNextGrant(grant: ConnectorOAuthGrant | (() => ConnectorOAuthGrant)): void;
  /**
   * Tests can rig the next exchange to throw — useful for the "vendor 4xx"
   * unhappy path.
   */
  setNextError(err: Error): void;
  /** Reset between tests. */
  reset(): void;
  /** Inspect what the most recent exchange was called with (for assertions). */
  lastExchange: ExchangeCodeInput | null;
  /** Inspect what the most recent revoke was called with (for assertions). */
  lastRevokedToken: string | null;
}

export function createTestStubOAuthAdapter(
  connectorId = "test-stub",
  defaultScopes: string[] = ["test:read"],
): TestStubOAuthAdapter {
  let nextGrant: ConnectorOAuthGrant | (() => ConnectorOAuthGrant) | null = null;
  let nextError: Error | null = null;

  const adapter: TestStubOAuthAdapter = {
    connectorId,
    defaultScopes,
    authorizeBaseUrl: "https://stub.example.test/oauth/authorize",
    lastExchange: null,
    lastRevokedToken: null,

    buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
      const params = new URLSearchParams({
        state: input.state,
        code_challenge: input.codeChallenge,
        code_challenge_method: "S256",
        redirect_uri: input.redirectUri,
        scope: input.scopes.join(" "),
      });
      return `${this.authorizeBaseUrl}?${params.toString()}`;
    },

    async exchangeCode(input: ExchangeCodeInput): Promise<ConnectorOAuthGrant> {
      adapter.lastExchange = input;
      if (nextError) {
        const err = nextError;
        nextError = null;
        throw err;
      }
      if (!nextGrant) {
        throw new Error(
          `[test-stub] No grant rigged. Call setNextGrant() before triggering the callback for "${connectorId}".`,
        );
      }
      const grant = typeof nextGrant === "function" ? nextGrant() : nextGrant;
      nextGrant = null;
      return grant;
    },

    async revoke({ accessToken }: { accessToken: string }): Promise<void> {
      adapter.lastRevokedToken = accessToken;
    },

    setNextGrant(grant) {
      nextGrant = grant;
    },
    setNextError(err) {
      nextError = err;
    },
    reset() {
      nextGrant = null;
      nextError = null;
      adapter.lastExchange = null;
      adapter.lastRevokedToken = null;
    },
  };

  return adapter;
}
