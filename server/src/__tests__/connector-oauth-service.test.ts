import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  companies,
  companySecretVersions,
  companySecrets,
  connectorAccounts,
  connectorOauthStates,
  createDb,
  instanceSettings,
} from "@bench/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { connectorOAuthService } from "../services/connector-oauth.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { secretService } from "../services/secrets.js";
import {
  __resetConnectorOAuthAdaptersForTests,
  registerConnectorOAuthAdapter,
} from "../services/connector-oauth-adapters/index.js";
import { createTestStubOAuthAdapter } from "../services/connector-oauth-adapters/test-stub.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function createWorkspace(db: ReturnType<typeof createDb>) {
  return db
    .insert(companies)
    .values({
      name: `Connector OAuth ${randomUUID()}`,
      issuePrefix: `CO${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

const REDIRECT_URI = "https://bench.example.test/api/connectors/test-stub/callback";

describeEmbeddedPostgres("connector OAuth service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("bench-connector-oauth-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  beforeEach(() => {
    __resetConnectorOAuthAdaptersForTests();
    registerConnectorOAuthAdapter(createTestStubOAuthAdapter("test-stub", ["test:read", "test:write"]));
  });

  afterEach(async () => {
    await db.delete(connectorOauthStates);
    await db.delete(connectorAccounts);
    await db.delete(companySecretVersions);
    await db.delete(companySecrets);
    await db.delete(companies);
    await db.delete(instanceSettings);
    __resetConnectorOAuthAdaptersForTests();
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function enableRuntime() {
    await instanceSettingsService(db).updateExperimental({ enableConnectorRuntime: true });
  }

  it("refuses every OAuth call when the runtime feature flag is off", async () => {
    const workspace = await createWorkspace(db);
    const oauth = connectorOAuthService(db);

    await expect(
      oauth.beginInstall({
        companyId: workspace.id,
        connectorId: "test-stub",
        initiatedByUserId: "user-aashish",
        redirectUri: REDIRECT_URI,
      }),
    ).rejects.toThrow(/disabled/i);

    expect(await db.select().from(connectorOauthStates)).toHaveLength(0);
  });

  it("404s if the connector has no registered adapter", async () => {
    await enableRuntime();
    const workspace = await createWorkspace(db);
    const oauth = connectorOAuthService(db);

    await expect(
      oauth.beginInstall({
        companyId: workspace.id,
        connectorId: "no-such-connector",
        initiatedByUserId: "user-aashish",
        redirectUri: REDIRECT_URI,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects non-HTTPS / non-loopback redirect URIs", async () => {
    await enableRuntime();
    const workspace = await createWorkspace(db);
    const oauth = connectorOAuthService(db);

    await expect(
      oauth.beginInstall({
        companyId: workspace.id,
        connectorId: "test-stub",
        initiatedByUserId: "user-aashish",
        redirectUri: "http://attacker.example/api/connectors/test-stub/callback",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("issues a state row + PKCE-bearing authorize URL on beginInstall", async () => {
    await enableRuntime();
    const workspace = await createWorkspace(db);
    const oauth = connectorOAuthService(db);

    const result = await oauth.beginInstall({
      companyId: workspace.id,
      connectorId: "test-stub",
      initiatedByUserId: "user-aashish",
      redirectUri: REDIRECT_URI,
      metadata: { returnTo: "/companies/abc/connectors" },
    });

    expect(result.state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60_000);

    const url = new URL(result.authorizationUrl);
    expect(url.searchParams.get("state")).toBe(result.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const codeChallenge = url.searchParams.get("code_challenge");
    expect(codeChallenge).toBeTruthy();
    expect(codeChallenge!.length).toBeGreaterThan(40);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe("test:read test:write");

    const stateRows = await db.select().from(connectorOauthStates);
    expect(stateRows).toHaveLength(1);
    expect(stateRows[0]!.state).toBe(result.state);
    expect(stateRows[0]!.companyId).toBe(workspace.id);
    expect(stateRows[0]!.codeVerifier.length).toBeGreaterThan(40);
    // Verifier must NOT equal challenge (would defeat PKCE).
    expect(stateRows[0]!.codeVerifier).not.toBe(codeChallenge);
    expect(stateRows[0]!.metadata).toEqual({ returnTo: "/companies/abc/connectors" });
  });

  it("completes an install: persists encrypted token + connector_account, deletes state row, prevents replay", async () => {
    await enableRuntime();
    const workspace = await createWorkspace(db);
    const oauth = connectorOAuthService(db);
    const stub = createTestStubOAuthAdapter("test-stub-2", ["test:read"]);
    __resetConnectorOAuthAdaptersForTests();
    registerConnectorOAuthAdapter(stub);

    const begin = await oauth.beginInstall({
      companyId: workspace.id,
      connectorId: "test-stub-2",
      initiatedByUserId: "user-aashish",
      redirectUri: REDIRECT_URI.replace("test-stub", "test-stub-2"),
    });

    stub.setNextGrant({
      accessToken: "vendor-access-supersecret",
      refreshToken: "vendor-refresh-supersecret",
      externalAccountId: "EXT-9000",
      externalAccountLabel: "Cisco Engineering",
      grantedScopes: ["test:read"],
      expiresAt: new Date(Date.now() + 3600_000),
      vendorPayload: { team: { id: "EXT-9000" }, ok: true },
    });

    const completed = await oauth.completeInstall({
      state: begin.state,
      code: "vendor-auth-code",
    });

    expect(completed.created).toBe(true);
    expect(completed.companyId).toBe(workspace.id);
    expect(completed.externalAccountId).toBe("EXT-9000");
    expect(completed.grantedScopes).toEqual(["test:read"]);

    // PKCE verifier round-tripped to the adapter.
    expect(stub.lastExchange).toMatchObject({
      code: "vendor-auth-code",
      redirectUri: REDIRECT_URI.replace("test-stub", "test-stub-2"),
    });
    expect(stub.lastExchange!.codeVerifier.length).toBeGreaterThan(40);

    const accounts = await db.select().from(connectorAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.tokenSecretId).toBeTruthy();

    // Token must NOT be persisted in plaintext anywhere.
    const versions = await db.select().from(companySecretVersions);
    const allMaterial = JSON.stringify(versions);
    expect(allMaterial).not.toContain("vendor-access-supersecret");
    expect(allMaterial).not.toContain("vendor-refresh-supersecret");

    // Round-trip decrypt to confirm the grant payload is intact.
    const decrypted = await secretService(db).resolveSecretValue(
      workspace.id,
      accounts[0]!.tokenSecretId!,
      "latest",
    );
    const grantPayload = JSON.parse(decrypted) as Record<string, unknown>;
    expect(grantPayload.accessToken).toBe("vendor-access-supersecret");
    expect(grantPayload.refreshToken).toBe("vendor-refresh-supersecret");
    expect(grantPayload.grantedScopes).toEqual(["test:read"]);

    // State row deleted (single-use).
    expect(await db.select().from(connectorOauthStates)).toHaveLength(0);

    // Replay with the same state must 404.
    await expect(
      oauth.completeInstall({ state: begin.state, code: "vendor-auth-code" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects expired state rows on callback", async () => {
    await enableRuntime();
    const workspace = await createWorkspace(db);
    const oauth = connectorOAuthService(db);
    const stub = createTestStubOAuthAdapter("test-stub-expiry", ["test:read"]);
    __resetConnectorOAuthAdaptersForTests();
    registerConnectorOAuthAdapter(stub);

    const begin = await oauth.beginInstall({
      companyId: workspace.id,
      connectorId: "test-stub-expiry",
      initiatedByUserId: "user-aashish",
      redirectUri: REDIRECT_URI.replace("test-stub", "test-stub-expiry"),
      ttlMs: 60_000,
    });

    // Force the state row to be expired without waiting wall-clock time. We
    // mutate `expiresAt` directly because waiting 15 minutes per test would
    // make the suite unusable.
    const past = new Date(Date.now() - 10_000);
    await db
      .update(connectorOauthStates)
      .set({ expiresAt: past })
      .where(eq(connectorOauthStates.state, begin.state));

    stub.setNextGrant({
      accessToken: "should-not-persist",
      externalAccountId: "EXT-EXP",
      grantedScopes: ["test:read"],
      vendorPayload: {},
    });

    await expect(
      oauth.completeInstall({ state: begin.state, code: "code" }),
    ).rejects.toMatchObject({ status: 403 });

    // Even on rejection, the state row is deleted (single-use guarantee).
    expect(await db.select().from(connectorOauthStates)).toHaveLength(0);
    // And no connector_account was persisted.
    expect(await db.select().from(connectorAccounts)).toHaveLength(0);
  });

  it("rejects callbacks initiated by a different user when binding is enforced", async () => {
    await enableRuntime();
    const workspace = await createWorkspace(db);
    const oauth = connectorOAuthService(db);
    const stub = createTestStubOAuthAdapter("test-stub-binding", ["test:read"]);
    __resetConnectorOAuthAdaptersForTests();
    registerConnectorOAuthAdapter(stub);

    const begin = await oauth.beginInstall({
      companyId: workspace.id,
      connectorId: "test-stub-binding",
      initiatedByUserId: "user-aashish",
      redirectUri: REDIRECT_URI.replace("test-stub", "test-stub-binding"),
    });
    stub.setNextGrant({
      accessToken: "x",
      externalAccountId: "EXT-1",
      grantedScopes: ["test:read"],
      vendorPayload: {},
    });

    await expect(
      oauth.completeInstall({
        state: begin.state,
        code: "code",
        expectedInitiatedByUserId: "user-bhawna",
      }),
    ).rejects.toMatchObject({ status: 403 });

    // State row is still consumed (single-use), so a subsequent legitimate
    // call with the right user also fails — the only safe recovery is to
    // restart the install. This is the conservative choice.
    await expect(
      oauth.completeInstall({
        state: begin.state,
        code: "code",
        expectedInitiatedByUserId: "user-aashish",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("reinstalls in place when the same vendor account comes back", async () => {
    await enableRuntime();
    const workspace = await createWorkspace(db);
    const oauth = connectorOAuthService(db);
    const stub = createTestStubOAuthAdapter("test-stub-reinstall", ["test:read"]);
    __resetConnectorOAuthAdaptersForTests();
    registerConnectorOAuthAdapter(stub);

    // First install.
    const begin1 = await oauth.beginInstall({
      companyId: workspace.id,
      connectorId: "test-stub-reinstall",
      initiatedByUserId: "user-aashish",
      redirectUri: REDIRECT_URI.replace("test-stub", "test-stub-reinstall"),
    });
    stub.setNextGrant({
      accessToken: "first-token",
      externalAccountId: "EXT-Reinstall",
      externalAccountLabel: "Cisco Eng",
      grantedScopes: ["test:read"],
      vendorPayload: { v: 1 },
    });
    const first = await oauth.completeInstall({ state: begin1.state, code: "c1" });
    expect(first.created).toBe(true);

    // Second install for the same external account: should reinstall, not
    // create a duplicate row, and should rotate the encrypted token.
    const begin2 = await oauth.beginInstall({
      companyId: workspace.id,
      connectorId: "test-stub-reinstall",
      initiatedByUserId: "user-aashish",
      redirectUri: REDIRECT_URI.replace("test-stub", "test-stub-reinstall"),
      scopes: ["test:read", "test:write"],
    });
    stub.setNextGrant({
      accessToken: "second-token",
      externalAccountId: "EXT-Reinstall",
      externalAccountLabel: "Cisco Eng (renamed)",
      grantedScopes: ["test:read", "test:write"],
      vendorPayload: { v: 2 },
    });
    const second = await oauth.completeInstall({ state: begin2.state, code: "c2" });
    expect(second.created).toBe(false);
    expect(second.connectorAccountId).toBe(first.connectorAccountId);

    const accounts = await db.select().from(connectorAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.scopes).toEqual(["test:read", "test:write"]);

    // Latest secret version should hold the new token.
    const decrypted = await secretService(db).resolveSecretValue(
      workspace.id,
      accounts[0]!.tokenSecretId!,
      "latest",
    );
    const payload = JSON.parse(decrypted) as Record<string, unknown>;
    expect(payload.accessToken).toBe("second-token");
  });

  it("revokes a connector account: marks revoked locally, calls vendor revoke, swallows vendor errors", async () => {
    await enableRuntime();
    const workspace = await createWorkspace(db);
    const oauth = connectorOAuthService(db);
    const stub = createTestStubOAuthAdapter("test-stub-revoke", ["test:read"]);
    __resetConnectorOAuthAdaptersForTests();
    registerConnectorOAuthAdapter(stub);

    const begin = await oauth.beginInstall({
      companyId: workspace.id,
      connectorId: "test-stub-revoke",
      initiatedByUserId: "user-aashish",
      redirectUri: REDIRECT_URI.replace("test-stub", "test-stub-revoke"),
    });
    stub.setNextGrant({
      accessToken: "revoke-me-token",
      externalAccountId: "EXT-R",
      grantedScopes: ["test:read"],
      vendorPayload: {},
    });
    const completed = await oauth.completeInstall({ state: begin.state, code: "c" });

    const revoked = await oauth.revokeAccount({
      companyId: workspace.id,
      connectorAccountId: completed.connectorAccountId,
      reason: "user requested removal",
    });
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBeTruthy();
    expect(stub.lastRevokedToken).toBe("revoke-me-token");

    // Even if the vendor revoke endpoint throws, local revoke must succeed.
    const reinstall = await oauth.beginInstall({
      companyId: workspace.id,
      connectorId: "test-stub-revoke",
      initiatedByUserId: "user-aashish",
      redirectUri: REDIRECT_URI.replace("test-stub", "test-stub-revoke"),
    });
    stub.setNextGrant({
      accessToken: "another-token",
      externalAccountId: "EXT-R2",
      grantedScopes: ["test:read"],
      vendorPayload: {},
    });
    const second = await oauth.completeInstall({ state: reinstall.state, code: "c2" });

    stub.reset();
    stub.setNextError(new Error("vendor 500"));
    const localOnly = await oauth.revokeAccount({
      companyId: workspace.id,
      connectorAccountId: second.connectorAccountId,
    });
    expect(localOnly.status).toBe("revoked");
  });

  it("sweeps expired state rows", async () => {
    await enableRuntime();
    const workspace = await createWorkspace(db);
    const oauth = connectorOAuthService(db);

    const begin = await oauth.beginInstall({
      companyId: workspace.id,
      connectorId: "test-stub",
      initiatedByUserId: "user-aashish",
      redirectUri: REDIRECT_URI,
      ttlMs: 60_000,
    });

    // No sweep before TTL elapses.
    expect(await oauth.sweepExpiredStates()).toBe(0);

    // Sweep with a faked "now" past the TTL deletes the row.
    const future = new Date(begin.expiresAt.getTime() + 1_000);
    expect(await oauth.sweepExpiredStates(future)).toBe(1);
    expect(await db.select().from(connectorOauthStates)).toHaveLength(0);
  });

});
