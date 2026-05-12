import { Router } from "express";
import { z } from "zod";
import type { Db } from "@bench/db";
import { validate } from "../middleware/validate.js";
import { badRequest, unauthorized } from "../errors.js";
import {
  assertBoard,
  assertWorkspaceCapability,
  getActorRoleForCompany,
} from "./authz.js";
import {
  connectorOAuthService,
  resolveConnectorRedirectUri,
} from "../services/connector-oauth.js";
import { logActivity } from "../services/activity-log.js";

/**
 * CRP2 — connector OAuth routes.
 *
 * Three endpoints:
 *   - `POST /api/connectors/:connectorId/install`  → Workspace Owner / Admin
 *     starts an install. Returns the vendor authorize URL the browser should
 *     redirect to. (POST, not GET, because the install creates a
 *     server-side state row.)
 *   - `GET /api/connectors/:connectorId/callback?state=&code=` → vendor
 *     redirects here. Exchanges the code, persists the connector_account,
 *     redirects the browser back to the workspace UI.
 *   - `POST /api/connectors/accounts/:accountId/revoke` → Workspace Owner /
 *     Admin tears down an install.
 *
 * The whole surface is gated on `enableConnectorRuntime` (CRP1 feature flag)
 * inside `connectorOAuthService` — no need to gate it again at the route
 * layer.
 *
 * Self-host operators MUST set `BENCH_PUBLIC_URL` (or trust a reverse proxy)
 * for the callback URL to be stable across vendor consent screens; the
 * `resolveConnectorRedirectUri` helper handles the precedence and rejects
 * non-HTTPS / non-loopback URLs explicitly.
 */

const installBodySchema = z.object({
  companyId: z.string().uuid(),
  /** Override default scopes (optional; usually unset). */
  scopes: z.array(z.string().min(1).max(256)).max(64).optional(),
  /**
   * Where to send the user after a successful callback. Must be a relative
   * path on this Bench instance — we never redirect to a third-party host
   * here per OWASP unvalidated-redirect guidance.
   */
  returnTo: z
    .string()
    .max(512)
    .regex(/^\/[^\s]*$/u, "returnTo must be an absolute path on this instance")
    .optional(),
});

const revokeBodySchema = z.object({
  companyId: z.string().uuid(),
  reason: z.string().max(512).optional(),
});

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCallbackErrorHtml(message: string): string {
  const safe = escapeHtml(message);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Connector install failed</title></head><body><h1>Connector install failed</h1><p>${safe}</p><p>You can close this window and try again from Bench.</p></body></html>`;
}

export function connectorOAuthRoutes(db: Db) {
  const router = Router();
  const oauth = connectorOAuthService(db);

  /**
   * Begin an OAuth install. The UI POSTs from the connector picker; the
   * server returns the vendor authorize URL and the UI does a top-level
   * navigation to it. We deliberately don't 302 from this endpoint because
   * the UI needs to show "redirecting to Slack…" first.
   */
  router.post(
    "/connectors/:connectorId/install",
    validate(installBodySchema),
    async (req, res) => {
      assertBoard(req);
      const connectorId = String(req.params.connectorId ?? "").trim();
      if (!connectorId) throw badRequest("connectorId is required");

      const { companyId, scopes, returnTo } = req.body as z.infer<typeof installBodySchema>;

      // Owner / Admin only. Connector installs grant the workspace's coworkers
      // a vendor identity; no Operator-level escalation is allowed (per
      // roles.md §5 → "Settings → Connectors").
      assertWorkspaceCapability(req, companyId, "workspace:connectors:wire");

      const initiatedByUserId = req.actor.type === "board" ? req.actor.userId : null;
      if (!initiatedByUserId) {
        throw unauthorized("Board user identity required to begin install");
      }

      const redirectUri = resolveConnectorRedirectUri(connectorId, {
        protocol: req.protocol,
        host: req.get("host") ?? "",
      });

      const result = await oauth.beginInstall({
        companyId,
        connectorId,
        initiatedByUserId,
        redirectUri,
        scopes,
        metadata: returnTo ? { returnTo } : {},
      });

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: initiatedByUserId,
        actorRole: getActorRoleForCompany(req, companyId),
        action: "connector.install_started",
        entityType: "connector",
        entityId: connectorId,
        details: { redirectUri, expiresAt: result.expiresAt.toISOString() },
      });

      res.json({
        authorizationUrl: result.authorizationUrl,
        expiresAt: result.expiresAt.toISOString(),
      });
    },
  );

  /**
   * Vendor callback. Public endpoint by necessity (vendors hit it without a
   * session cookie), but security relies on:
   *   1. `state` lookup (single-use, TTL-bounded, deleted on read).
   *   2. PKCE verifier round-trip (vendor can't accept the code without it).
   *   3. The `(company, connector, externalAccount)` uniqueness invariant
   *      enforced by the runtime service layer.
   *
   * We render an HTML response (not JSON) because this is the user's browser
   * coming back from the vendor consent screen.
   */
  router.get("/connectors/:connectorId/callback", async (req, res) => {
    const connectorId = String(req.params.connectorId ?? "").trim();
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const vendorError = typeof req.query.error === "string" ? req.query.error : null;
    const vendorErrorDescription =
      typeof req.query.error_description === "string" ? req.query.error_description : null;

    if (vendorError) {
      // The user hit "Cancel" on the vendor consent screen, or the vendor
      // refused. Surface the vendor's reason and stop — there's nothing for
      // us to persist.
      res
        .status(400)
        .type("text/html")
        .send(
          renderCallbackErrorHtml(
            `Vendor returned ${vendorError}${
              vendorErrorDescription ? `: ${vendorErrorDescription}` : ""
            }`,
          ),
        );
      return;
    }
    if (!connectorId || !state || !code) {
      res
        .status(400)
        .type("text/html")
        .send(renderCallbackErrorHtml("Missing connectorId, state, or code"));
      return;
    }

    try {
      const result = await oauth.completeInstall({ state, code });
      const returnToRaw = result.metadata?.returnTo;
      const returnTo =
        typeof returnToRaw === "string" && /^\/[^\s]*$/u.test(returnToRaw)
          ? returnToRaw
          : "/";

      // The user who initiated the install is recorded as the actor; the
      // callback itself runs without a session cookie (vendor → us), but
      // attribution lands on the human who clicked Install. Activity log
      // failures are swallowed so we still return a successful redirect to
      // the user — the runtime layer already persisted the connector_account
      // row, which is the source of truth.
      await logActivity(db, {
        companyId: result.companyId,
        actorType: "user",
        actorId: result.initiatedByUserId,
        action: result.created ? "connector.installed" : "connector.reinstalled",
        entityType: "connector_account",
        entityId: result.connectorAccountId,
        details: {
          connectorId: result.connectorId,
          externalAccountId: result.externalAccountId,
          externalAccountLabel: result.externalAccountLabel,
          grantedScopes: result.grantedScopes,
        },
      }).catch(() => {});

      res.redirect(302, returnTo);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res
        .status(400)
        .type("text/html")
        .send(renderCallbackErrorHtml(message));
    }
  });

  /**
   * Revoke a connector install. Idempotent: revoking an already-revoked
   * account returns the current row without re-calling the vendor.
   */
  router.post(
    "/connectors/accounts/:accountId/revoke",
    validate(revokeBodySchema),
    async (req, res) => {
      assertBoard(req);
      const accountId = String(req.params.accountId ?? "").trim();
      if (!accountId) throw badRequest("accountId is required");
      const { companyId, reason } = req.body as z.infer<typeof revokeBodySchema>;
      assertWorkspaceCapability(req, companyId, "workspace:connectors:wire");

      const updated = await oauth.revokeAccount({
        companyId,
        connectorAccountId: accountId,
        reason,
      });

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        actorRole: getActorRoleForCompany(req, companyId),
        action: "connector.revoked",
        entityType: "connector_account",
        entityId: accountId,
        details: { reason: reason ?? null, connectorId: updated.connectorId },
      });

      res.json({ connectorAccount: updated });
    },
  );

  return router;
}
