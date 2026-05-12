import { Router } from "express";
import type { Db } from "@bench/db";
import {
  SECRET_PROVIDERS,
  type SecretProvider,
  createSecretSchema,
  rotateSecretSchema,
  updateSecretSchema,
} from "@bench/shared";
import { validate } from "../middleware/validate.js";
import {
  assertBoard,
  assertCompanyAccess,
  assertWorkspaceCapability,
  getActorRoleForCompany,
} from "./authz.js";
import { logActivity, secretService } from "../services/index.js";

export function secretRoutes(db: Db) {
  const router = Router();
  const svc = secretService(db);
  const configuredDefaultProvider = process.env.BENCH_SECRETS_PROVIDER;
  const defaultProvider = (
    configuredDefaultProvider && SECRET_PROVIDERS.includes(configuredDefaultProvider as SecretProvider)
      ? configuredDefaultProvider
      : "local_encrypted"
  ) as SecretProvider;

  router.get("/companies/:companyId/secret-providers", (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(svc.listProviders());
  });

  router.get("/companies/:companyId/secrets", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const secrets = await svc.list(companyId);
    res.json(secrets);
  });

  router.post("/companies/:companyId/secrets", validate(createSecretSchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    // Secrets back connector credentials, OAuth tokens, webhook signing keys, etc.
    // Per roles.md §5 (Settings → Connectors), creating/rotating workspace
    // secrets is Owner+Admin only.
    assertWorkspaceCapability(req, companyId, "workspace:connectors:wire");

    const created = await svc.create(
      companyId,
      {
        name: req.body.name,
        provider: req.body.provider ?? defaultProvider,
        value: req.body.value,
        description: req.body.description,
        externalRef: req.body.externalRef,
      },
      { userId: req.actor.userId ?? "board", agentId: null },
    );

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      actorRole: getActorRoleForCompany(req, companyId),
      action: "secret.created",
      entityType: "secret",
      entityId: created.id,
      details: { name: created.name, provider: created.provider },
    });

    res.status(201).json(created);
  });

  router.post("/secrets/:id/rotate", validate(rotateSecretSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    assertWorkspaceCapability(req, existing.companyId, "workspace:connectors:wire");

    const rotated = await svc.rotate(
      id,
      {
        value: req.body.value,
        externalRef: req.body.externalRef,
      },
      { userId: req.actor.userId ?? "board", agentId: null },
    );

    await logActivity(db, {
      companyId: rotated.companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      actorRole: getActorRoleForCompany(req, rotated.companyId),
      action: "secret.rotated",
      entityType: "secret",
      entityId: rotated.id,
      details: { version: rotated.latestVersion },
    });

    res.json(rotated);
  });

  router.patch("/secrets/:id", validate(updateSecretSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    assertWorkspaceCapability(req, existing.companyId, "workspace:connectors:wire");

    const updated = await svc.update(id, {
      name: req.body.name,
      description: req.body.description,
      externalRef: req.body.externalRef,
    });

    if (!updated) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }

    await logActivity(db, {
      companyId: updated.companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      actorRole: getActorRoleForCompany(req, updated.companyId),
      action: "secret.updated",
      entityType: "secret",
      entityId: updated.id,
      details: { name: updated.name },
    });

    res.json(updated);
  });

  router.delete("/secrets/:id", async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    assertWorkspaceCapability(req, existing.companyId, "workspace:connectors:wire");

    const removed = await svc.remove(id);
    if (!removed) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }

    await logActivity(db, {
      companyId: removed.companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      actorRole: getActorRoleForCompany(req, removed.companyId),
      action: "secret.deleted",
      entityType: "secret",
      entityId: removed.id,
      details: { name: removed.name },
    });

    res.json({ ok: true });
  });

  return router;
}
