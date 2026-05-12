/**
 * Bench permission matrix — the single source of truth for "who can do what".
 *
 * This module is consumed by:
 *   - `server/src/middleware/require-workspace-role.ts` (HTTP gate)
 *   - `ui/src/hooks/usePermissions.ts` (UI affordance gate)
 *
 * If you change a row here, update `doc/roles.md` §5 in the same change so the
 * canonical doc and the runtime stay in lock‑step.
 *
 * Two scopes:
 *   - **Workspace capability** — `WorkspaceCapability` / `ROLES_ALLOWED_BY_WORKSPACE_CAPABILITY`.
 *     Gated by the `requireWorkspaceRole` middleware against the caller's
 *     `companyMemberships.membershipRole` for the resolved company.
 *   - **Instance capability** — `InstanceCapability` / `ROLES_ALLOWED_BY_INSTANCE_CAPABILITY`.
 *     Gated by the `requireInstanceAdmin` middleware against the caller's
 *     `instanceUserRoles.role`.
 *
 * Naming convention: `<scope>:<area>:<verb>` e.g. `workspace:members:manage`.
 *
 * Notes:
 *   - `operator` is the DB literal for **People Manager** (product copy). The
 *     rename to `people_manager` is tracked in the RBAC plan; this matrix uses
 *     the DB literal so it stays cheap to evolve without migrations.
 *   - `member` is a legacy alias of `operator`; routes normalize before this
 *     matrix is consulted, so it is intentionally absent from the role union.
 *   - "Scoped" capabilities (e.g. operator can pause coworkers in **their**
 *     roster only) are listed here as allowed for the role; the route handler
 *     is then responsible for narrowing to the roster — see
 *     `roles.md` §4.4. The matrix gates *whether* the verb is reachable; the
 *     handler gates *which rows* are reachable.
 */

import type { HumanCompanyMembershipRole, InstanceUserRole } from "../constants.js";

export const WORKSPACE_CAPABILITIES = [
  // Settings — workspace metadata
  "workspace:settings:general:edit",
  "workspace:settings:general:view",
  "workspace:branding:edit",

  // Settings — membership and budget
  "workspace:members:manage",
  "workspace:transfer_or_delete",
  "workspace:budget:set",

  // Settings — connectors
  "workspace:connectors:wire",
  "workspace:connectors:request",

  // Settings — environments / skills / audit
  "workspace:environments:manage",
  "workspace:skills:edit",
  "workspace:audit:view_full",
  "workspace:audit:view_scoped",

  // Settings — portability (export / import)
  "workspace:portability:export",
  "workspace:portability:import",

  // Hires (the contract — see roles.md §7)
  "workspace:hire_request:create",
  "workspace:hire_request:approve",
  "workspace:coworkers:hire_direct",
  "workspace:coworkers:terminate",

  // Coworker mutations
  "workspace:coworkers:edit_any",
  "workspace:coworkers:edit_roster",
  "workspace:coworkers:pause_resume_any",
  "workspace:coworkers:pause_resume_roster",

  // Work
  "work:tasks:file",
  "work:tasks:assign_any",
  "work:tasks:assign_roster",
] as const;

export type WorkspaceCapability = (typeof WORKSPACE_CAPABILITIES)[number];

export const INSTANCE_CAPABILITIES = [
  "instance:identity:manage",
  "instance:adapters:manage",
  "instance:plugins:manage",
  "instance:coworker_schedules:manage",
  "instance:audit:view",
  "instance:workspaces:create",
  "instance:admins:manage",
] as const;

export type InstanceCapability = (typeof INSTANCE_CAPABILITIES)[number];

/**
 * Map: capability → roles allowed.
 *
 * Mirrors `doc/roles.md` §5. The matrix is intentionally repetitive so each row
 * is independently auditable.
 */
export const ROLES_ALLOWED_BY_WORKSPACE_CAPABILITY: Record<
  WorkspaceCapability,
  ReadonlyArray<HumanCompanyMembershipRole>
> = {
  // ─── Settings — workspace metadata ──────────────────────────────────────
  "workspace:settings:general:view": ["owner", "admin", "operator", "viewer"],
  "workspace:settings:general:edit": ["owner", "admin"],
  "workspace:branding:edit": ["owner", "admin"],

  // ─── Settings — membership and budget ───────────────────────────────────
  "workspace:members:manage": ["owner", "admin"],
  "workspace:transfer_or_delete": ["owner"],
  "workspace:budget:set": ["owner"],

  // ─── Settings — connectors ──────────────────────────────────────────────
  "workspace:connectors:wire": ["owner", "admin"],
  "workspace:connectors:request": ["owner", "admin", "operator"],

  // ─── Settings — environments / skills / audit ───────────────────────────
  "workspace:environments:manage": ["owner", "admin"],
  "workspace:skills:edit": ["owner", "admin"],
  "workspace:audit:view_full": ["owner", "admin"],
  "workspace:audit:view_scoped": ["owner", "admin", "operator", "viewer"],

  // ─── Settings — portability ─────────────────────────────────────────────
  "workspace:portability:export": ["owner", "admin"],
  "workspace:portability:import": ["owner"],

  // ─── Hires ──────────────────────────────────────────────────────────────
  "workspace:hire_request:create": ["owner", "admin", "operator"],
  "workspace:hire_request:approve": ["owner", "admin"],
  "workspace:coworkers:hire_direct": ["owner", "admin"],
  "workspace:coworkers:terminate": ["owner", "admin"],

  // ─── Coworker mutations ─────────────────────────────────────────────────
  "workspace:coworkers:edit_any": ["owner", "admin"],
  "workspace:coworkers:edit_roster": ["owner", "admin", "operator"],
  "workspace:coworkers:pause_resume_any": ["owner", "admin"],
  "workspace:coworkers:pause_resume_roster": ["owner", "admin", "operator"],

  // ─── Work ───────────────────────────────────────────────────────────────
  "work:tasks:file": ["owner", "admin", "operator", "viewer"],
  "work:tasks:assign_any": ["owner", "admin"],
  "work:tasks:assign_roster": ["owner", "admin", "operator"],
};

export const ROLES_ALLOWED_BY_INSTANCE_CAPABILITY: Record<
  InstanceCapability,
  ReadonlyArray<InstanceUserRole>
> = {
  "instance:identity:manage": ["instance_admin"],
  "instance:adapters:manage": ["instance_admin"],
  "instance:plugins:manage": ["instance_admin"],
  "instance:coworker_schedules:manage": ["instance_admin"],
  "instance:audit:view": ["instance_admin"],
  "instance:workspaces:create": ["instance_admin"],
  "instance:admins:manage": ["instance_admin"],
};

/**
 * Returns true when `role` is permitted to perform `capability`.
 *
 * Used by both `requireWorkspaceRole` (server) and `usePermissions` (UI). Pure
 * function — never read DB, never read request — caller must have already
 * resolved the role for the relevant workspace.
 */
export function roleCanDoWorkspace(
  role: HumanCompanyMembershipRole | null | undefined,
  capability: WorkspaceCapability,
): boolean {
  if (!role) return false;
  return ROLES_ALLOWED_BY_WORKSPACE_CAPABILITY[capability].includes(role);
}

/**
 * Returns the set of roles permitted to perform `capability`. Mostly used by
 * tests to enumerate the matrix and by the middleware to build error messages.
 */
export function rolesAllowedForWorkspaceCapability(
  capability: WorkspaceCapability,
): ReadonlyArray<HumanCompanyMembershipRole> {
  return ROLES_ALLOWED_BY_WORKSPACE_CAPABILITY[capability];
}

export function instanceRoleCanDo(
  role: InstanceUserRole | null | undefined,
  capability: InstanceCapability,
): boolean {
  if (!role) return false;
  return ROLES_ALLOWED_BY_INSTANCE_CAPABILITY[capability].includes(role);
}
