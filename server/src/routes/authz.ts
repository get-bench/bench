import type { Request } from "express";
import {
  HUMAN_COMPANY_MEMBERSHIP_ROLE_LABELS,
  rolesAllowedForWorkspaceCapability,
  roleCanDoWorkspace,
  type HumanCompanyMembershipRole,
  type WorkspaceCapability,
} from "@bench/shared";
import { forbidden, unauthorized } from "../errors.js";
import { normalizeHumanRole } from "../services/company-member-roles.js";

export function assertAuthenticated(req: Request) {
  if (req.actor.type === "none") {
    throw unauthorized();
  }
}

export function assertBoard(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
}

export function hasBoardOrgAccess(req: Request) {
  if (req.actor.type !== "board") {
    return false;
  }
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return true;
  }
  return Array.isArray(req.actor.companyIds) && req.actor.companyIds.length > 0;
}

export function assertBoardOrgAccess(req: Request) {
  assertBoard(req);
  if (hasBoardOrgAccess(req)) {
    return;
  }
  throw forbidden("Company membership or instance admin access required");
}

export function assertInstanceAdmin(req: Request) {
  assertBoard(req);
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

export function assertCompanyAccess(req: Request, companyId: string) {
  assertAuthenticated(req);
  if (req.actor.type === "agent" && req.actor.companyId !== companyId) {
    throw forbidden("Agent key cannot access another company");
  }
  if (req.actor.type === "board" && req.actor.source !== "local_implicit") {
    const allowedCompanies = req.actor.companyIds ?? [];
    if (!allowedCompanies.includes(companyId)) {
      throw forbidden("User does not have access to this company");
    }
    const method = typeof req.method === "string" ? req.method.toUpperCase() : "GET";
    const isSafeMethod = ["GET", "HEAD", "OPTIONS"].includes(method);
    if (!isSafeMethod && !req.actor.isInstanceAdmin && Array.isArray(req.actor.memberships)) {
      const membership = req.actor.memberships.find((item) => item.companyId === companyId);
      if (!membership || membership.status !== "active") {
        throw forbidden("User does not have active company access");
      }
      if (membership.membershipRole === "viewer") {
        throw forbidden("Viewer access is read-only");
      }
    }
  }
}

/**
 * Resolve the caller's effective workspace role for `companyId`.
 *
 * Returns:
 *   - `"instance_admin"` — caller is the local board operator or holds the
 *     `instance_admin` instance role; treated as a global override per
 *     `roles.md` §4.1.
 *   - `HumanCompanyMembershipRole` — the caller's membership role for this
 *     workspace, normalized (legacy `member` → `operator`).
 *   - `null` — the caller is not a board user with a membership in this
 *     workspace.
 *
 * Pure read against `req.actor`; never touches the DB. Callers should run
 * `assertCompanyAccess(req, companyId)` first if they need the standard 403
 * for non‑members.
 */
export function resolveWorkspaceRole(
  req: Request,
  companyId: string,
): "instance_admin" | HumanCompanyMembershipRole | null {
  if (req.actor.type !== "board") return null;
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return "instance_admin";
  }
  const memberships = Array.isArray(req.actor.memberships) ? req.actor.memberships : [];
  const membership = memberships.find((row) => row.companyId === companyId);
  if (!membership || membership.status !== "active") return null;
  return normalizeHumanRole(membership.membershipRole, "operator");
}

/**
 * Asserts the caller is permitted to perform `capability` against `companyId`.
 *
 * Flow:
 *   1. `assertCompanyAccess` — caller must be a member of the workspace (this
 *      throws for non-members, viewers on writes, agents from another company,
 *      etc.).
 *   2. Instance Admin / local_implicit short-circuit allow.
 *   3. Caller's membership role must appear in the matrix entry for the
 *      capability (`packages/shared/src/access/permission-matrix.ts`).
 *
 * Use this on every mutating endpoint. The matrix file in `@bench/shared`
 * mirrors `doc/roles.md` §5; if you add a row, update the doc in the same PR.
 *
 * @throws 403 with `code: "forbidden"` and message naming the capability so
 *   logs can attribute denials.
 */
export function assertWorkspaceCapability(
  req: Request,
  companyId: string,
  capability: WorkspaceCapability,
) {
  assertCompanyAccess(req, companyId);

  // Agents authenticated by API key bypass the human-role matrix; their access
  // is already validated by `assertCompanyAccess` (same-company check) and any
  // additional gates the route applies (e.g. `agents.role === 'admin'` for
  // company branding edits).
  if (req.actor.type === "agent") return;

  const role = resolveWorkspaceRole(req, companyId);
  if (role === "instance_admin") return;

  if (!role || !roleCanDoWorkspace(role, capability)) {
    const allowed = rolesAllowedForWorkspaceCapability(capability)
      .map((entry) => HUMAN_COMPANY_MEMBERSHIP_ROLE_LABELS[entry])
      .join(" or ");
    throw forbidden(
      `Requires ${allowed} (capability: ${capability})`,
    );
  }
}

export function getActorInfo(req: Request, companyId?: string) {
  assertAuthenticated(req);
  // actorRole is only meaningful for mutating endpoints scoped to a workspace.
  // Pass `companyId` to record it; omit for reads / non-workspace contexts.
  const actorRole = companyId ? getActorRoleForCompany(req, companyId) : null;
  if (req.actor.type === "agent") {
    return {
      actorType: "agent" as const,
      actorId: req.actor.agentId ?? "unknown-agent",
      agentId: req.actor.agentId ?? null,
      runId: req.actor.runId ?? null,
      actorRole,
    };
  }

  return {
    actorType: "user" as const,
    actorId: req.actor.userId ?? "board",
    agentId: null,
    runId: req.actor.runId ?? null,
    actorRole,
  };
}

/**
 * Audit-friendly description of the caller's role in the given workspace.
 * Returns one of `owner | admin | operator | viewer | instance_admin |
 * local_implicit | agent` so activity log readers can quickly see "which
 * level of authority approved this mutation". Returns `null` when no role
 * applies (anonymous, or board user with no membership).
 */
export function getActorRoleForCompany(
  req: Request,
  companyId: string,
): string | null {
  if (req.actor.type === "agent") {
    return "agent";
  }
  if (req.actor.type !== "board") return null;
  if (req.actor.source === "local_implicit") return "local_implicit";
  if (req.actor.isInstanceAdmin) return "instance_admin";
  return resolveWorkspaceRole(req, companyId);
}
