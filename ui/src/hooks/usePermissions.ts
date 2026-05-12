import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  HUMAN_COMPANY_MEMBERSHIP_ROLES,
  instanceRoleCanDo,
  roleCanDoWorkspace,
  type HumanCompanyMembershipRole,
  type InstanceCapability,
  type WorkspaceCapability,
} from "@bench/shared";
import { accessApi, type CurrentBoardAccess } from "../api/access";
import { queryKeys } from "../lib/queryKeys";

/**
 * Single source of truth for "can the signed-in board user do X?" in the UI.
 *
 * The hook mirrors `assertWorkspaceCapability` / `instanceRoleCanDo` on the
 * server so that gating in the UI never drifts from gating in the API.
 *
 * Always pair UI gating with a server-side check — the UI prevents broken
 * affordances; the server enforces the rule. See `doc/roles.md`.
 */

const KNOWN_ROLES = new Set<HumanCompanyMembershipRole>(
  HUMAN_COMPANY_MEMBERSHIP_ROLES,
);

function normalizeRoleString(
  value: unknown,
): HumanCompanyMembershipRole | null {
  if (typeof value !== "string") return null;
  // Legacy/alias normalization — keep in sync with
  // `server/src/services/company-member-roles.ts#normalizeHumanRole`.
  if (value === "member") return "operator";
  if (KNOWN_ROLES.has(value as HumanCompanyMembershipRole)) {
    return value as HumanCompanyMembershipRole;
  }
  return null;
}

/**
 * Pure resolver for the signed-in user's effective role in a given workspace.
 * Mirrors `resolveWorkspaceRole` in `server/src/routes/authz.ts`. Exported so
 * tests don't need to drive the hook through React Query.
 */
export function resolveWorkspaceRole(
  boardAccess: CurrentBoardAccess | null | undefined,
  companyId: string | null | undefined,
): HumanCompanyMembershipRole | "instance_admin" | null {
  if (!boardAccess) return null;

  // Local single-tenant boot mode is treated as full owner-equivalent access
  // by the server — mirror that here.
  if (boardAccess.source === "local_implicit") return "owner";

  if (boardAccess.isInstanceAdmin) return "instance_admin";

  if (!companyId) return null;

  const membership = boardAccess.memberships?.find(
    (entry) => entry.companyId === companyId && entry.status === "active",
  );
  if (membership) {
    return normalizeRoleString(membership.membershipRole);
  }

  // Older /cli-auth/me responses omitted memberships and only included
  // companyIds; in that case we can't tell which role the user has, so we
  // fall back to the most restrictive read-only role rather than guess.
  if (!boardAccess.memberships && boardAccess.companyIds.includes(companyId)) {
    return "viewer";
  }

  return null;
}

export type WorkspacePermissions = {
  /** True while board access is being fetched. */
  isLoading: boolean;
  /** Raw response — null if the user is not signed in. */
  boardAccess: CurrentBoardAccess | null;
  /** Whether the signed-in user is an instance admin (Bench owner). */
  isInstanceAdmin: boolean;
  /** Resolved workspace role for the requested companyId. */
  role: HumanCompanyMembershipRole | "instance_admin" | null;
  /** Check a workspace-scoped capability for the requested companyId. */
  can: (capability: WorkspaceCapability) => boolean;
  /** Check an instance-scoped capability. */
  canInstance: (capability: InstanceCapability) => boolean;
};

/**
 * Returns derived permission booleans for the given companyId. When companyId
 * is undefined the hook still returns instance-level info (`isInstanceAdmin`,
 * `canInstance`) but `can()` will always return false.
 */
export function usePermissions(
  companyId: string | null | undefined,
): WorkspacePermissions {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    retry: false,
    staleTime: 30_000,
  });

  return useMemo(() => {
    const boardAccess = data ?? null;
    const role = resolveWorkspaceRole(boardAccess, companyId);
    const isInstanceAdmin = Boolean(boardAccess?.isInstanceAdmin) ||
      boardAccess?.source === "local_implicit";

    const can = (capability: WorkspaceCapability) => {
      if (!boardAccess) return false;
      if (role === "instance_admin") return true;
      if (!role) return false;
      return roleCanDoWorkspace(role, capability);
    };

    const canInstance = (capability: InstanceCapability) => {
      if (!boardAccess) return false;
      if (boardAccess.source === "local_implicit") return true;
      if (boardAccess.isInstanceAdmin) {
        return instanceRoleCanDo("instance_admin", capability);
      }
      return false;
    };

    return {
      isLoading,
      boardAccess,
      isInstanceAdmin,
      role,
      can,
      canInstance,
    };
  }, [companyId, data, isLoading]);
}
