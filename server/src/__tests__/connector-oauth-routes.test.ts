import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level smoke tests for CRP2 connector OAuth endpoints.
 *
 * These mock the OAuth service so the test focuses on the HTTP surface:
 *   - Workspace capability gate (Owner/Admin only on install + revoke).
 *   - Feature-flag gate (forwarded as a 403 from the service layer).
 *   - Vendor-error callback rendering (no persistence, 400 HTML).
 *   - Successful callback issues a 302 to the round-tripped returnTo.
 *
 * The deeper "did we actually persist a connector_account" assertions live
 * in `connector-oauth-service.test.ts`, which exercises the real DB.
 */

const mockOAuth = vi.hoisted(() => ({
  beginInstall: vi.fn(),
  completeInstall: vi.fn(),
  revokeAccount: vi.fn(),
  sweepExpiredStates: vi.fn(),
}));
const mockLogActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockResolveConnectorRedirectUri = vi.hoisted(() =>
  vi.fn(
    (connectorId: string) =>
      `https://bench.example.test/api/connectors/${connectorId}/callback`,
  ),
);

function registerModuleMocks() {
  vi.doMock("../services/connector-oauth.js", () => ({
    connectorOAuthService: () => mockOAuth,
    resolveConnectorRedirectUri: mockResolveConnectorRedirectUri,
  }));
  vi.doMock("../services/activity-log.js", () => ({
    logActivity: mockLogActivity,
  }));
}

const TEST_COMPANY_ID = "11111111-1111-4111-8111-111111111111";

function ownerActor() {
  return {
    type: "board",
    userId: "user-aashish",
    source: "session",
    isInstanceAdmin: false,
    companyIds: [TEST_COMPANY_ID],
    memberships: [
      {
        companyId: TEST_COMPANY_ID,
        status: "active",
        membershipRole: "owner",
      },
    ],
  };
}

function operatorActor() {
  return {
    type: "board",
    userId: "user-bhawna",
    source: "session",
    isInstanceAdmin: false,
    companyIds: [TEST_COMPANY_ID],
    memberships: [
      {
        companyId: TEST_COMPANY_ID,
        status: "active",
        membershipRole: "operator",
      },
    ],
  };
}

function anonymousActor() {
  return { type: "none" } as const;
}

async function createApp(actor: ReturnType<typeof ownerActor> | { type: "none" }) {
  const [{ errorHandler }, { connectorOAuthRoutes }] = await Promise.all([
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../routes/connector-oauth.js")>(
      "../routes/connector-oauth.js",
    ),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: typeof actor }).actor = actor;
    next();
  });
  app.use("/api", connectorOAuthRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("connector OAuth routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/connector-oauth.js");
    vi.doUnmock("../services/activity-log.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockOAuth.beginInstall.mockReset();
    mockOAuth.completeInstall.mockReset();
    mockOAuth.revokeAccount.mockReset();
    mockOAuth.sweepExpiredStates.mockReset();
    mockLogActivity.mockReset().mockResolvedValue(undefined);
    mockResolveConnectorRedirectUri.mockClear();
  });

  describe("POST /api/connectors/:id/install", () => {
    it("rejects unauthenticated callers with 403", async () => {
      const app = await createApp(anonymousActor());
      const res = await request(app)
        .post("/api/connectors/slack/install")
        .send({ companyId: TEST_COMPANY_ID });
      expect(res.status).toBe(403);
      expect(mockOAuth.beginInstall).not.toHaveBeenCalled();
    });

    it("rejects Operator (People Manager) with 403 — install is Owner/Admin only", async () => {
      const app = await createApp(operatorActor());
      const res = await request(app)
        .post("/api/connectors/slack/install")
        .send({ companyId: TEST_COMPANY_ID });
      expect(res.status).toBe(403);
      expect(res.body?.error).toMatch(/workspace:connectors:wire/);
      expect(mockOAuth.beginInstall).not.toHaveBeenCalled();
    });

    it("forwards feature-flag-disabled errors as 403", async () => {
      const { forbidden } = await vi.importActual<typeof import("../errors.js")>(
        "../errors.js",
      );
      const app = await createApp(ownerActor());
      mockOAuth.beginInstall.mockRejectedValue(forbidden("Connector Runtime is disabled"));
      const res = await request(app)
        .post("/api/connectors/slack/install")
        .send({ companyId: TEST_COMPANY_ID });
      expect(res.status).toBe(403);
    });

    it("happy path: returns the authorize URL and logs install_started", async () => {
      const app = await createApp(ownerActor());
      const expiresAt = new Date(Date.now() + 600_000);
      mockOAuth.beginInstall.mockResolvedValue({
        authorizationUrl: "https://slack.com/oauth/v2/authorize?state=abc",
        state: "abc",
        expiresAt,
      });

      const res = await request(app)
        .post("/api/connectors/slack/install")
        .send({
          companyId: TEST_COMPANY_ID,
          returnTo: "/companies/abc/connectors",
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        authorizationUrl: "https://slack.com/oauth/v2/authorize?state=abc",
        expiresAt: expiresAt.toISOString(),
      });
      expect(mockOAuth.beginInstall).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: TEST_COMPANY_ID,
          connectorId: "slack",
          initiatedByUserId: "user-aashish",
          metadata: { returnTo: "/companies/abc/connectors" },
        }),
      );
      expect(mockLogActivity).toHaveBeenCalledTimes(1);
      expect(mockLogActivity.mock.calls[0]![1]).toMatchObject({
        companyId: TEST_COMPANY_ID,
        actorType: "user",
        action: "connector.install_started",
        entityType: "connector",
        entityId: "slack",
      });
    });

    it("rejects open-redirect attempts in returnTo", async () => {
      const app = await createApp(ownerActor());
      const res = await request(app)
        .post("/api/connectors/slack/install")
        .send({
          companyId: TEST_COMPANY_ID,
          returnTo: "https://attacker.example/steal",
        });
      expect(res.status).toBe(400);
      expect(mockOAuth.beginInstall).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/connectors/:id/callback", () => {
    it("renders an HTML error and skips persistence when the vendor returned an error", async () => {
      const app = await createApp(anonymousActor());
      const res = await request(app)
        .get("/api/connectors/slack/callback")
        .query({ error: "access_denied", error_description: "user cancelled" });
      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toMatch(/html/);
      expect(res.text).toContain("user cancelled");
      expect(mockOAuth.completeInstall).not.toHaveBeenCalled();
    });

    it("returns 400 HTML if state or code is missing", async () => {
      const app = await createApp(anonymousActor());
      const res = await request(app)
        .get("/api/connectors/slack/callback")
        .query({ state: "abc" });
      expect(res.status).toBe(400);
      expect(mockOAuth.completeInstall).not.toHaveBeenCalled();
    });

    it("redirects to round-tripped returnTo on success", async () => {
      const app = await createApp(anonymousActor());
      mockOAuth.completeInstall.mockResolvedValue({
        connectorAccountId: "acct-1",
        created: true,
        companyId: TEST_COMPANY_ID,
        connectorId: "slack",
        externalAccountId: "T0123",
        externalAccountLabel: "Cisco Eng",
        grantedScopes: ["chat:write"],
        metadata: { returnTo: "/companies/abc/connectors" },
        initiatedByUserId: "user-aashish",
      });

      const res = await request(app)
        .get("/api/connectors/slack/callback")
        .query({ state: "abc", code: "code" });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/companies/abc/connectors");
      expect(mockOAuth.completeInstall).toHaveBeenCalledWith({
        state: "abc",
        code: "code",
      });
    });

    it("falls back to / when returnTo is missing or unsafe", async () => {
      const app = await createApp(anonymousActor());
      mockOAuth.completeInstall.mockResolvedValue({
        connectorAccountId: "acct-1",
        created: false,
        companyId: TEST_COMPANY_ID,
        connectorId: "slack",
        externalAccountId: "T0123",
        externalAccountLabel: null,
        grantedScopes: ["chat:write"],
        metadata: { returnTo: "https://attacker.example/steal" },
        initiatedByUserId: "user-aashish",
      });

      const res = await request(app)
        .get("/api/connectors/slack/callback")
        .query({ state: "abc", code: "code" });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/");
    });
  });

  describe("POST /api/connectors/accounts/:id/revoke", () => {
    it("rejects Operator with 403", async () => {
      const app = await createApp(operatorActor());
      const res = await request(app)
        .post("/api/connectors/accounts/acct-1/revoke")
        .send({ companyId: TEST_COMPANY_ID });
      expect(res.status).toBe(403);
      expect(mockOAuth.revokeAccount).not.toHaveBeenCalled();
    });

    it("happy path: calls service, logs activity, returns 200", async () => {
      const app = await createApp(ownerActor());
      mockOAuth.revokeAccount.mockResolvedValue({
        id: "acct-1",
        connectorId: "slack",
        status: "revoked",
        revokedAt: new Date(),
      });

      const res = await request(app)
        .post("/api/connectors/accounts/acct-1/revoke")
        .send({ companyId: TEST_COMPANY_ID, reason: "user requested" });
      expect(res.status).toBe(200);
      expect(res.body.connectorAccount.id).toBe("acct-1");
      expect(mockOAuth.revokeAccount).toHaveBeenCalledWith({
        companyId: TEST_COMPANY_ID,
        connectorAccountId: "acct-1",
        reason: "user requested",
      });
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "connector.revoked",
          entityType: "connector_account",
          entityId: "acct-1",
        }),
      );
    });
  });
});
