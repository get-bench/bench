import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agentConnectorGrants,
  agents,
  companies,
  companySecretVersions,
  companySecrets,
  connectorAccounts,
  connectorInboundEvents,
  connectorOutboundAudit,
  createDb,
  instanceSettings,
} from "@bench/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { connectorRuntimeService } from "../services/connector-runtime.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { secretService } from "../services/secrets.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function createWorkspace(db: ReturnType<typeof createDb>) {
  return db
    .insert(companies)
    .values({
      name: `Connector Runtime ${randomUUID()}`,
      issuePrefix: `CR${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function createAgent(db: ReturnType<typeof createDb>, companyId: string) {
  return db
    .insert(agents)
    .values({
      companyId,
      name: `Riya ${randomUUID().slice(0, 6)}`,
      role: "designer",
    })
    .returning()
    .then((rows) => rows[0]!);
}

describeEmbeddedPostgres("connector runtime service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("bench-connector-runtime-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(connectorOutboundAudit);
    await db.delete(connectorInboundEvents);
    await db.delete(agentConnectorGrants);
    await db.delete(connectorAccounts);
    await db.delete(companySecretVersions);
    await db.delete(companySecrets);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(instanceSettings);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("refuses every write when the feature flag is off", async () => {
    const workspace = await createWorkspace(db);
    const runtime = connectorRuntimeService(db);

    await expect(
      runtime.createConnectorAccount({
        companyId: workspace.id,
        connectorId: "slack",
        externalAccountId: "T0123",
        scopes: ["chat:write"],
        tokenPayload: { access_token: "xoxb-secret" },
      }),
    ).rejects.toThrow(/disabled/i);

    expect(await db.select().from(connectorAccounts)).toHaveLength(0);
    expect(await db.select().from(companySecrets)).toHaveLength(0);
  });

  describe("with runtime enabled", () => {
    let workspace: Awaited<ReturnType<typeof createWorkspace>>;

    beforeAll(async () => {
      // Settings table is created by migrations; updateExperimental upserts.
    });

    afterEach(async () => {
      // workspace is recreated per test
    });

    async function enableRuntime() {
      await instanceSettingsService(db).updateExperimental({ enableConnectorRuntime: true });
    }

    it("creates a connector account, encrypts tokens via local_encrypted, and is idempotent on (workspace,connector,external)", async () => {
      await enableRuntime();
      workspace = await createWorkspace(db);
      const runtime = connectorRuntimeService(db);

      const account = await runtime.createConnectorAccount({
        companyId: workspace.id,
        connectorId: "slack",
        externalAccountId: "T0123",
        externalAccountLabel: "Cisco Engineering",
        installedByUserId: "user-aashish",
        scopes: ["chat:write", "channels:history", "chat:write"], // dedup
        tokenPayload: { access_token: "xoxb-supersecret", refresh_token: "xoxr-r" },
        webhookSecret: "whsec-12345",
        metadata: { region: "us-east-1" },
      });

      expect(account.connectorId).toBe("slack");
      expect(account.scopes).toEqual(["channels:history", "chat:write"]);
      expect(account.status).toBe("active");
      expect(account.tokenSecretId).toBeTruthy();
      expect(account.webhookSecretSecretId).toBeTruthy();

      // Token must NOT be persisted in plaintext anywhere.
      const tokenSecret = await db
        .select()
        .from(companySecretVersions)
        .where(eq(companySecretVersions.secretId, account.tokenSecretId!))
        .then((rows) => rows[0]!);
      const materialJson = JSON.stringify(tokenSecret.material);
      expect(materialJson).not.toContain("xoxb-supersecret");
      expect(materialJson).not.toContain("xoxr-r");
      expect((tokenSecret.material as { scheme?: string }).scheme).toBe("local_encrypted_v1");

      // Round-trip through the secret provider returns the original payload.
      const decrypted = await secretService(db).resolveSecretValue(
        workspace.id,
        account.tokenSecretId!,
        "latest",
      );
      expect(JSON.parse(decrypted)).toEqual({
        access_token: "xoxb-supersecret",
        refresh_token: "xoxr-r",
      });

      // Re-installing the same external account is rejected with a conflict
      // pointing at the existing row (caller should reuse, not double-write).
      await expect(
        runtime.createConnectorAccount({
          companyId: workspace.id,
          connectorId: "slack",
          externalAccountId: "T0123",
          scopes: ["chat:write"],
          tokenPayload: { access_token: "different" },
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("rejects per-coworker grants whose scopes exceed the workspace install", async () => {
      await enableRuntime();
      workspace = await createWorkspace(db);
      const runtime = connectorRuntimeService(db);
      const agent = await createAgent(db, workspace.id);

      const account = await runtime.createConnectorAccount({
        companyId: workspace.id,
        connectorId: "slack",
        externalAccountId: "T0123",
        scopes: ["chat:write"],
        tokenPayload: { access_token: "xoxb-x" },
      });

      await expect(
        runtime.createAgentGrant(workspace.id, {
          agentId: agent.id,
          connectorAccountId: account.id,
          scopes: ["chat:write", "channels:history"], // not granted at workspace level
          resourceFilter: { channels: ["C0123"] },
        }),
      ).rejects.toThrow(/not granted on the workspace install/i);

      const grant = await runtime.createAgentGrant(workspace.id, {
        agentId: agent.id,
        connectorAccountId: account.id,
        scopes: ["chat:write"],
        resourceFilter: { channels: ["C0123"] },
        grantedByUserId: "user-bhawna",
      });
      expect(grant.scopes).toEqual(["chat:write"]);
      expect(grant.resourceFilter).toEqual({ channels: ["C0123"] });

      // A second grant for the same (agent, account) is a conflict.
      await expect(
        runtime.createAgentGrant(workspace.id, {
          agentId: agent.id,
          connectorAccountId: account.id,
          scopes: ["chat:write"],
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("upsertAgentGrant replaces scopes + resourceFilter on the same (agent, account) row", async () => {
      // Why this test matters: the Slack channel-picker UI semantics are
      // "replace the channel allow-list with what the manager just selected".
      // If upsert merged instead of replaced, removing a channel from the
      // picker would silently keep it allow-listed. Lock that down.
      await enableRuntime();
      workspace = await createWorkspace(db);
      const runtime = connectorRuntimeService(db);
      const agent = await createAgent(db, workspace.id);
      const account = await runtime.createConnectorAccount({
        companyId: workspace.id,
        connectorId: "slack",
        externalAccountId: "T-UPSERT",
        scopes: ["chat:write", "channels:read", "channels:history"],
        tokenPayload: { access_token: "x" },
      });

      const first = await runtime.upsertAgentGrant(workspace.id, {
        agentId: agent.id,
        connectorAccountId: account.id,
        scopes: ["chat:write"],
        resourceFilter: { channels: ["C-1", "C-2"] },
        grantedByUserId: "user-bhawna",
      });
      expect(first.created).toBe(true);
      expect(first.row.resourceFilter).toEqual({ channels: ["C-1", "C-2"] });

      const second = await runtime.upsertAgentGrant(workspace.id, {
        agentId: agent.id,
        connectorAccountId: account.id,
        // Manager removed C-1, kept C-2, added C-3, expanded scopes.
        scopes: ["chat:write", "channels:read"],
        resourceFilter: { channels: ["C-2", "C-3"], coworkerSlackUserId: "U-1" },
      });
      expect(second.created).toBe(false);
      expect(second.row.id).toBe(first.row.id);
      expect(second.row.scopes).toEqual(["channels:read", "chat:write"]);
      expect(second.row.resourceFilter).toEqual({
        channels: ["C-2", "C-3"],
        coworkerSlackUserId: "U-1",
      });

      // Same scopes-exceed validation as createAgentGrant.
      await expect(
        runtime.upsertAgentGrant(workspace.id, {
          agentId: agent.id,
          connectorAccountId: account.id,
          scopes: ["chat:write", "im:write"],
          resourceFilter: { channels: ["C-2"] },
        }),
      ).rejects.toThrow(/not granted on the workspace install/i);
    });

    it("rejects cross-workspace grants and audit writes", async () => {
      await enableRuntime();
      const workspaceA = await createWorkspace(db);
      const workspaceB = await createWorkspace(db);
      const agentB = await createAgent(db, workspaceB.id);
      const runtime = connectorRuntimeService(db);

      const accountA = await runtime.createConnectorAccount({
        companyId: workspaceA.id,
        connectorId: "slack",
        externalAccountId: "T-A",
        scopes: ["chat:write"],
        tokenPayload: { access_token: "x" },
      });

      // Grant: agent in B can't be bound to account in A.
      await expect(
        runtime.createAgentGrant(workspaceA.id, {
          agentId: agentB.id,
          connectorAccountId: accountA.id,
          scopes: ["chat:write"],
        }),
      ).rejects.toMatchObject({ status: 403 });

      // Outbound: agent in B can't audit through account in A under workspace A's scope.
      await expect(
        runtime.recordOutboundCall({
          companyId: workspaceA.id,
          agentId: agentB.id,
          connectorAccountId: accountA.id,
          toolName: "slack.chat.postMessage",
          request: {},
          outcome: "ok",
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("ingests inbound events idempotently on (account, externalEventId) and redacts secrets in payload", async () => {
      await enableRuntime();
      workspace = await createWorkspace(db);
      const runtime = connectorRuntimeService(db);
      const account = await runtime.createConnectorAccount({
        companyId: workspace.id,
        connectorId: "slack",
        externalAccountId: "T0123",
        scopes: ["chat:write"],
        tokenPayload: { access_token: "x" },
      });

      const first = await runtime.recordInboundEvent({
        companyId: workspace.id,
        connectorAccountId: account.id,
        eventType: "app_mention",
        externalEventId: "Ev0001",
        payload: {
          text: "hey @riya",
          authorization: "Bearer leak-me-not",
          user: { id: "U999", profile: { api_key: "key-leak" } },
        },
      });
      expect(first.deduped).toBe(false);
      expect(first.row.status).toBe("received");

      const second = await runtime.recordInboundEvent({
        companyId: workspace.id,
        connectorAccountId: account.id,
        eventType: "app_mention",
        externalEventId: "Ev0001", // same external id → dedupe
        payload: { text: "vendor retry" },
      });
      expect(second.deduped).toBe(true);
      expect(second.row.id).toBe(first.row.id);
      // Original payload preserved (the retry didn't overwrite).
      const persisted = await db
        .select()
        .from(connectorInboundEvents)
        .where(eq(connectorInboundEvents.id, first.row.id))
        .then((rows) => rows[0]!);
      const persistedJson = JSON.stringify(persisted.payload);
      expect(persistedJson).not.toContain("leak-me-not");
      expect(persistedJson).not.toContain("key-leak");
      expect(persistedJson).toContain("***REDACTED***");
      expect(persistedJson).toContain("hey @riya");
    });

    it("appends outbound audit rows, redacts request secrets, and rolls up coworker spend", async () => {
      await enableRuntime();
      workspace = await createWorkspace(db);
      const runtime = connectorRuntimeService(db);
      const agent = await createAgent(db, workspace.id);
      const account = await runtime.createConnectorAccount({
        companyId: workspace.id,
        connectorId: "slack",
        externalAccountId: "T0123",
        scopes: ["chat:write"],
        tokenPayload: { access_token: "x" },
      });

      const ok = await runtime.recordOutboundCall({
        companyId: workspace.id,
        agentId: agent.id,
        connectorAccountId: account.id,
        toolName: "slack.chat.postMessage",
        request: {
          channel: "C0123",
          text: "Hi team",
          authorization: "Bearer secret-token",
        },
        outcome: "ok",
        responseStatus: 200,
        responseSummary: { ts: "1700000000.000100", channel: "C0123" },
        costCents: 3,
      });
      const persisted = await db
        .select()
        .from(connectorOutboundAudit)
        .where(eq(connectorOutboundAudit.id, ok.id))
        .then((rows) => rows[0]!);
      const requestJson = JSON.stringify(persisted.request);
      expect(requestJson).not.toContain("secret-token");
      expect(requestJson).toContain("***REDACTED***");
      expect(requestJson).toContain("C0123");

      await runtime.recordOutboundCall({
        companyId: workspace.id,
        agentId: agent.id,
        connectorAccountId: account.id,
        toolName: "slack.chat.postMessage",
        request: { channel: "C0123", text: "again" },
        outcome: "denied_resource",
        costCents: 0,
      });
      await runtime.recordOutboundCall({
        companyId: workspace.id,
        agentId: agent.id,
        connectorAccountId: account.id,
        toolName: "slack.chat.postMessage",
        request: { channel: "C0123", text: "third" },
        outcome: "ok",
        costCents: 5,
      });

      const spend = await runtime.getOutboundSpend(workspace.id, agent.id, 0);
      expect(spend.calls).toBe(3);
      expect(spend.costCents).toBe(8);
    });
  });
});
