import crypto from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "@bench/db";
import { connectorAccounts, connectorOauthStates } from "@bench/db";
import { badRequest, forbidden, notFound, unprocessable } from "../errors.js";
import { sanitizeRecord } from "../redaction.js";
import { getConnectorOAuthAdapter } from "./connector-oauth-adapters/index.js";
import type { ConnectorOAuthAdapter } from "./connector-oauth-adapters/index.js";
import { connectorRuntimeService } from "./connector-runtime.js";
import { instanceSettingsService } from "./instance-settings.js";

/**
 * Default lifetime of an `connector_oauth_states` row.
 *
 * 15 minutes is enough for the slowest enterprise SSO flow (Okta + step-up
 * MFA + admin-consent re-auth) while keeping the replay window bounded. PKCE
 * already pins the code-exchange to the originating browser, so this TTL is
 * defense-in-depth, not the only line.
 */
export const DEFAULT_OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

/**
 * `state` parameter entropy in bytes (encoded base64url).
 *
 * 32 bytes = 256 bits, comfortably above the OWASP-recommended 128 bits for
 * session-class identifiers. We use this for the OAuth `state` parameter,
 * which is functionally a one-shot session token.
 */
const STATE_ENTROPY_BYTES = 32;

/**
 * PKCE verifier length per RFC 7636 §4.1: 43–128 chars of unreserved chars.
 * We use the maximum allowed to maximize entropy.
 */
const PKCE_VERIFIER_BYTES = 64;

export interface BeginInstallInput {
  companyId: string;
  connectorId: string;
  initiatedByUserId: string;
  /**
   * Absolute redirect URI we'll send to the vendor and round-trip through
   * the state row. Must match the route the callback handler is mounted at;
   * the route layer is the authoritative source for this — see
   * `resolveConnectorRedirectUri` below.
   */
  redirectUri: string;
  /** Override the adapter's default scopes; usually unset. */
  scopes?: string[];
  /** Optional opaque metadata round-tripped through the state row. */
  metadata?: Record<string, unknown>;
  /** Override TTL for the state row (defaults to 15 minutes). */
  ttlMs?: number;
}

export interface BeginInstallResult {
  /** Full vendor authorize URL to redirect the user to. */
  authorizationUrl: string;
  /** The `state` we sent — useful for tests; not needed by the route layer. */
  state: string;
  /** Absolute expiry of the state row. */
  expiresAt: Date;
}

export interface CompleteInstallInput {
  /** State token returned by the vendor in the `?state=` query param. */
  state: string;
  /** Authorization code returned by the vendor in the `?code=` query param. */
  code: string;
  /**
   * Optional binding check — if set, the route layer asserts this matches
   * `state.initiatedByUserId`. Lets us defend against a different signed-in
   * user picking up a stale callback URL (the same-browser invariant).
   */
  expectedInitiatedByUserId?: string;
}

export interface CompleteInstallResult {
  /** The connector_account row that was created or updated. */
  connectorAccountId: string;
  /** True if this completion *created* a new install (vs reinstalled). */
  created: boolean;
  /** Workspace this install belongs to (round-tripped from the state row). */
  companyId: string;
  /** Stable connector id from `CONNECTOR_CATALOG`. */
  connectorId: string;
  /** Vendor-side workspace/org id. Surfaced to the UI for redirect. */
  externalAccountId: string;
  /** Human-readable vendor label. */
  externalAccountLabel: string | null;
  /** Scopes the vendor actually granted. */
  grantedScopes: string[];
  /** Round-tripped metadata from the state row (e.g. UI returnTo). */
  metadata: Record<string, unknown>;
  /** Auth-user id who initiated the install (for audit). */
  initiatedByUserId: string;
}

/**
 * Resolve the absolute redirect URI Bench should send to the vendor for a
 * given connector. The vendor will reject the code-exchange if this doesn't
 * exactly match what was sent at install time, and most vendors also check
 * it against an allowlist on the OAuth app.
 *
 * Order of precedence:
 *   1. `BENCH_PUBLIC_URL` env var — set in cloud and any production self-host.
 *   2. The current request's `Forwarded` / `X-Forwarded-*` headers if Express
 *      `trust proxy` is enabled (`req.protocol`, `req.get('host')`).
 *
 * Self-host instances behind a reverse proxy MUST configure `trust proxy` and
 * `BENCH_PUBLIC_URL`; otherwise the OAuth callback will fail with a
 * redirect-URI mismatch the first time a user clicks Install.
 */
export function resolveConnectorRedirectUri(
  connectorId: string,
  fallback: { protocol: string; host: string },
): string {
  const explicit = process.env.BENCH_PUBLIC_URL?.trim();
  const base = explicit && explicit.length > 0 ? explicit.replace(/\/+$/, "") : `${fallback.protocol}://${fallback.host}`;
  if (!isHttpsOrLoopback(base)) {
    throw unprocessable(
      "Connector OAuth requires HTTPS or a loopback URL. Set BENCH_PUBLIC_URL.",
    );
  }
  return `${base}/api/connectors/${encodeURIComponent(connectorId)}/callback`;
}

function isHttpsOrLoopback(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:") {
      const host = parsed.hostname;
      return (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host.endsWith(".localhost")
      );
    }
    return false;
  } catch {
    return false;
  }
}

function generateState(): string {
  return crypto.randomBytes(STATE_ENTROPY_BYTES).toString("base64url");
}

function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(PKCE_VERIFIER_BYTES).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

function uniqueScopes(input: string[]): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > 256) continue;
    out.add(trimmed);
  }
  return Array.from(out).sort();
}

/**
 * Connector OAuth service — CRP2.
 *
 * Owns the install / callback / revoke choreography for every per-vendor
 * adapter. Vendor specifics (authorize URL shape, token exchange, scope
 * names) live in `ConnectorOAuthAdapter` implementations; this service
 * contains the shared invariants:
 *
 *   - Feature flag (`enableConnectorRuntime`) is checked on every entry.
 *   - PKCE S256 (RFC 7636) is mandatory for every adapter.
 *   - State rows have a bounded TTL and are single-use (deleted after
 *     successful exchange) to defend against replay.
 *   - The `(companyId, connectorId, externalAccountId)` uniqueness invariant
 *     is enforced at the runtime service layer; OAuth callback either
 *     creates or reinstalls atomically through that contract.
 *   - Tokens are persisted via the existing AES-256-GCM
 *     `local_encrypted` secret provider — no new crypto code paths.
 */
export function connectorOAuthService(db: Db) {
  const runtime = connectorRuntimeService(db);
  const settings = instanceSettingsService(db);

  function getAdapterOrThrow(connectorId: string): ConnectorOAuthAdapter {
    const adapter = getConnectorOAuthAdapter(connectorId);
    if (!adapter) {
      throw notFound(`No OAuth adapter registered for connector "${connectorId}"`);
    }
    return adapter;
  }

  async function beginInstall(input: BeginInstallInput): Promise<BeginInstallResult> {
    await runtime.requireEnabled();

    if (!input.initiatedByUserId || input.initiatedByUserId.trim().length === 0) {
      throw badRequest("initiatedByUserId is required to begin an OAuth install");
    }
    if (!input.redirectUri || !isHttpsOrLoopback(input.redirectUri)) {
      throw unprocessable(
        "redirectUri must be an absolute HTTPS or loopback URL",
      );
    }

    const adapter = getAdapterOrThrow(input.connectorId);
    const requestedScopes = uniqueScopes(
      input.scopes && input.scopes.length > 0 ? input.scopes : adapter.defaultScopes,
    );
    if (requestedScopes.length === 0) {
      throw badRequest(`Connector "${input.connectorId}" has no scopes to request`);
    }

    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const ttl = Math.min(
      Math.max(input.ttlMs ?? DEFAULT_OAUTH_STATE_TTL_MS, 60_000),
      60 * 60 * 1000,
    );
    const expiresAt = new Date(Date.now() + ttl);

    await db.insert(connectorOauthStates).values({
      state,
      companyId: input.companyId,
      connectorId: input.connectorId,
      initiatedByUserId: input.initiatedByUserId,
      redirectUri: input.redirectUri,
      codeVerifier,
      requestedScopes,
      metadata: sanitizeRecord(input.metadata ?? {}),
      expiresAt,
    });

    const authorizationUrl = adapter.buildAuthorizationUrl({
      state,
      codeChallenge,
      redirectUri: input.redirectUri,
      scopes: requestedScopes,
    });

    return { authorizationUrl, state, expiresAt };
  }

  async function completeInstall(
    input: CompleteInstallInput,
  ): Promise<CompleteInstallResult> {
    await runtime.requireEnabled();

    if (!input.state || input.state.trim().length === 0) {
      throw badRequest("state is required");
    }
    if (!input.code || input.code.trim().length === 0) {
      throw badRequest("code is required");
    }

    const stateRow = await db
      .select()
      .from(connectorOauthStates)
      .where(eq(connectorOauthStates.state, input.state))
      .then((rows) => rows[0] ?? null);

    if (!stateRow) {
      // Could be expired+swept, never issued, or a replay. We deliberately do
      // not distinguish in the error message to avoid leaking which case it is.
      throw notFound("OAuth state not found or already used");
    }

    // Single-use: delete the state row up-front so a concurrent replay can't
    // race the token exchange. If the exchange fails, the user starts a new
    // install — the only cost is one extra browser round-trip.
    await db
      .delete(connectorOauthStates)
      .where(eq(connectorOauthStates.id, stateRow.id));

    if (stateRow.expiresAt.getTime() < Date.now()) {
      throw forbidden("OAuth state has expired; restart the install");
    }
    if (
      input.expectedInitiatedByUserId &&
      input.expectedInitiatedByUserId !== stateRow.initiatedByUserId
    ) {
      throw forbidden(
        "OAuth callback initiated by a different user than the install request",
      );
    }

    const adapter = getAdapterOrThrow(stateRow.connectorId);

    const grant = await adapter.exchangeCode({
      code: input.code,
      redirectUri: stateRow.redirectUri,
      codeVerifier: stateRow.codeVerifier,
    });

    if (!grant.externalAccountId || grant.externalAccountId.trim().length === 0) {
      throw unprocessable("Vendor did not return an externalAccountId");
    }

    const grantedScopes = uniqueScopes(grant.grantedScopes);
    const sanitizedVendorPayload = sanitizeRecord(grant.vendorPayload ?? {});

    const tokenPayload: Record<string, unknown> = {
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken ?? null,
      expiresAt: grant.expiresAt ? grant.expiresAt.toISOString() : null,
      grantedScopes,
      vendor: sanitizedVendorPayload,
    };

    const accountMetadata: Record<string, unknown> = {
      ...sanitizeRecord(stateRow.metadata ?? {}),
    };

    const existing = await db
      .select()
      .from(connectorAccounts)
      .where(
        and(
          eq(connectorAccounts.companyId, stateRow.companyId),
          eq(connectorAccounts.connectorId, stateRow.connectorId),
          eq(connectorAccounts.externalAccountId, grant.externalAccountId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    let connectorAccountId: string;
    let created: boolean;
    if (existing) {
      const reinstalled = await runtime.reinstallConnectorAccount({
        companyId: stateRow.companyId,
        connectorId: stateRow.connectorId,
        externalAccountId: grant.externalAccountId,
        externalAccountLabel: grant.externalAccountLabel ?? null,
        installedByUserId: stateRow.initiatedByUserId,
        scopes: grantedScopes,
        tokenPayload,
        webhookSecret: grant.webhookSecret ?? null,
        metadata: accountMetadata,
        expiresAt: grant.expiresAt ?? null,
      });
      connectorAccountId = reinstalled.id;
      created = false;
    } else {
      const createdRow = await runtime.createConnectorAccount({
        companyId: stateRow.companyId,
        connectorId: stateRow.connectorId,
        externalAccountId: grant.externalAccountId,
        externalAccountLabel: grant.externalAccountLabel ?? null,
        installedByUserId: stateRow.initiatedByUserId,
        scopes: grantedScopes,
        tokenPayload,
        webhookSecret: grant.webhookSecret ?? null,
        metadata: accountMetadata,
        expiresAt: grant.expiresAt ?? null,
      });
      connectorAccountId = createdRow.id;
      created = true;
    }

    return {
      connectorAccountId,
      created,
      companyId: stateRow.companyId,
      connectorId: stateRow.connectorId,
      externalAccountId: grant.externalAccountId,
      externalAccountLabel: grant.externalAccountLabel ?? null,
      grantedScopes,
      metadata: accountMetadata,
      initiatedByUserId: stateRow.initiatedByUserId,
    };
  }

  async function revokeAccount(input: {
    companyId: string;
    connectorAccountId: string;
    reason?: string;
  }) {
    await runtime.requireEnabled();
    const account = await runtime.getConnectorAccount(
      input.companyId,
      input.connectorAccountId,
    );
    const adapter = getConnectorOAuthAdapter(account.connectorId);

    // Best-effort vendor revoke. Vendor revoke endpoints are notoriously
    // unreliable (Slack returns 200 for unknown tokens, GitHub returns 204
    // even for already-revoked installs, etc.), so we never block the local
    // revoke on it succeeding.
    if (adapter && adapter.revoke) {
      const tokenPayload = await runtime.readConnectorAccountToken(
        input.companyId,
        input.connectorAccountId,
      );
      const accessToken =
        typeof tokenPayload?.accessToken === "string" ? tokenPayload.accessToken : null;
      if (accessToken) {
        try {
          await adapter.revoke({ accessToken });
        } catch {
          // Swallow vendor revoke failures intentionally; the local row will
          // be marked revoked regardless. CRP3 can layer dead-letter retries
          // for the webhook deregistration call when that ships.
        }
      }
    }

    return runtime.updateConnectorAccountStatus(
      input.companyId,
      input.connectorAccountId,
      "revoked",
      input.reason,
    );
  }

  /**
   * Sweep expired state rows. Mounted on the periodic cleanup job (CRP3 will
   * register the cron); also safe to call ad-hoc from tests.
   */
  async function sweepExpiredStates(now: Date = new Date()): Promise<number> {
    const deleted = await db
      .delete(connectorOauthStates)
      .where(lt(connectorOauthStates.expiresAt, now))
      .returning({ id: connectorOauthStates.id });
    return deleted.length;
  }

  return {
    beginInstall,
    completeInstall,
    revokeAccount,
    sweepExpiredStates,
  };
}
