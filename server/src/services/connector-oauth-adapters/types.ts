/**
 * Connector OAuth adapter contract — CRP2.
 *
 * The Connector Runtime owns identity, scoping, audit, webhook ingress, and
 * token storage. What it does NOT know is *how* a specific vendor (Slack,
 * GitHub, Notion, …) does its OAuth handshake — every vendor differs in
 * authorize URL shape, scope syntax, code-exchange body, and what comes back
 * in the token response.
 *
 * This file defines the small contract every per-vendor adapter must satisfy
 * so the generic install/callback routes can stay vendor-agnostic.
 *
 * Design constraints:
 *   - Adapters are pure description + a small fetch wrapper. No DB access, no
 *     secret service, no Express. The runtime supplies all of that.
 *   - PKCE S256 (RFC 7636) is used for every adapter — even those whose
 *     vendors don't strictly require it — because it costs nothing and
 *     defends against authorization-code interception per OWASP guidance.
 *   - We deliberately resolve `externalAccountId` + `externalAccountLabel`
 *     here rather than doing it post-hoc, because (a) we need the id to
 *     enforce the `(company, connector, externalAccount)` uniqueness invariant
 *     before persisting anything, and (b) the label is what a Workspace Admin
 *     needs to see in the UI to distinguish "the Cisco-Eng Slack" from "the
 *     Cisco-Marketing Slack".
 *   - Adapters never log raw tokens or PKCE verifiers — the route layer is
 *     responsible for that constraint via the redaction helpers, but the
 *     adapter must not introduce its own logging that violates it.
 */

/**
 * OAuth grant payload as returned by the vendor's token endpoint, normalized
 * onto a Bench-side shape so the rest of the runtime doesn't have to know
 * vendor quirks (e.g. Slack's `bot_token` vs. GitHub's `access_token`).
 *
 * `vendorPayload` carries the raw response for forensic / debug use — the
 * runtime sanitizes it before persisting via `sanitizeRecord`.
 */
export interface ConnectorOAuthGrant {
  /** Bearer token used for outbound vendor API calls. */
  accessToken: string;
  /** Refresh token, if the vendor issued one. */
  refreshToken?: string | null;
  /** Vendor-side workspace/org id (Slack `T0123`, GH org login, …). Required. */
  externalAccountId: string;
  /** Human-friendly label — surfaced to Workspace Admins in the UI. */
  externalAccountLabel?: string | null;
  /**
   * The actual scopes the vendor granted. May be a subset of what we asked
   * for (vendors often quietly drop scopes the org's policy disallows). We
   * persist what we *got*, not what we *asked*, because per-coworker grant
   * checks must be against reality.
   */
  grantedScopes: string[];
  /** Absolute expiry (UTC) if the vendor returned one. */
  expiresAt?: Date | null;
  /** Webhook signing key the vendor exposed at install time, if any. */
  webhookSecret?: string | null;
  /** Raw token response — sanitized before persistence; useful for debugging. */
  vendorPayload: Record<string, unknown>;
}

export interface BuildAuthorizationUrlInput {
  /** Random opaque token round-tripped through the vendor. */
  state: string;
  /** PKCE S256 code challenge (RFC 7636 §4.2). */
  codeChallenge: string;
  /** Absolute redirect URI we'll receive the callback on. */
  redirectUri: string;
  /** Scopes the install is requesting (may be filtered by vendor). */
  scopes: string[];
}

export interface ExchangeCodeInput {
  /** The `code` the vendor sent back to our callback. */
  code: string;
  /** Same redirect URI we sent in the authorize step (vendor checks it). */
  redirectUri: string;
  /** PKCE S256 verifier (RFC 7636 §4.5). */
  codeVerifier: string;
}

export interface RevokeAccessInput {
  accessToken: string;
}

/**
 * The contract a per-vendor OAuth adapter must satisfy. Adapters are
 * registered in `connectorOAuthAdapters` (see `./registry.ts`).
 */
export interface ConnectorOAuthAdapter {
  /** Stable id from `CONNECTOR_CATALOG` (e.g. "slack", "github"). */
  readonly connectorId: string;
  /** Default scopes the install flow requests if the caller didn't override. */
  readonly defaultScopes: string[];
  /**
   * Build the vendor authorize URL the user's browser is redirected to.
   * Synchronous because every vendor exposes a URL; no network call needed
   * here.
   */
  buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string;
  /**
   * Exchange the callback `code` for a normalized `ConnectorOAuthGrant`. May
   * call the vendor's token endpoint; must throw on any vendor failure so the
   * route layer can return a 502 or 422 with audit context.
   */
  exchangeCode(input: ExchangeCodeInput): Promise<ConnectorOAuthGrant>;
  /**
   * Optional best-effort revoke against the vendor side. The runtime will
   * still mark the row revoked locally even if this throws — vendor revoke
   * endpoints are notoriously unreliable.
   */
  revoke?(input: RevokeAccessInput): Promise<void>;
}
