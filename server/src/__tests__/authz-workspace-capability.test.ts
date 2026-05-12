import { describe, expect, it } from "vitest";
import {
  assertWorkspaceCapability,
  getActorRoleForCompany,
  resolveWorkspaceRole,
} from "../routes/authz.js";
import type { HumanCompanyMembershipRole, WorkspaceCapability } from "@bench/shared";

const COMPANY = "company-rbac-1";

function makeReq(input: {
  method?: string;
  actor: Express.Request["actor"];
}) {
  return {
    method: input.method ?? "POST",
    actor: input.actor,
  } as Express.Request;
}

function makeBoardReq(opts: {
  role?: HumanCompanyMembershipRole | "member" | null;
  status?: "active" | "suspended" | "archived" | "pending";
  isInstanceAdmin?: boolean;
  source?: "session" | "local_implicit";
  method?: string;
  companyIds?: string[];
  membershipsOmitted?: boolean;
}) {
  const memberships = opts.membershipsOmitted
    ? undefined
    : opts.role !== undefined
      ? [
          {
            companyId: COMPANY,
            membershipRole: opts.role,
            status: opts.status ?? "active",
          },
        ]
      : [];
  return makeReq({
    method: opts.method ?? "POST",
    actor: {
      type: "board",
      userId: "user-1",
      source: opts.source ?? "session",
      isInstanceAdmin: opts.isInstanceAdmin ?? false,
      companyIds: opts.companyIds ?? [COMPANY],
      ...(memberships ? { memberships } : {}),
    },
  });
}

describe("resolveWorkspaceRole (server-side)", () => {
  it("returns instance_admin for local_implicit boot (full override)", () => {
    const req = makeBoardReq({ source: "local_implicit", role: undefined });
    expect(resolveWorkspaceRole(req, COMPANY)).toBe("instance_admin");
  });

  it("returns instance_admin for users with the instance admin role", () => {
    const req = makeBoardReq({ isInstanceAdmin: true, role: undefined });
    expect(resolveWorkspaceRole(req, COMPANY)).toBe("instance_admin");
  });

  it("returns the matching active membership role", () => {
    const req = makeBoardReq({ role: "operator" });
    expect(resolveWorkspaceRole(req, COMPANY)).toBe("operator");
  });

  it("normalizes legacy 'member' to operator", () => {
    const req = makeBoardReq({ role: "member" });
    expect(resolveWorkspaceRole(req, COMPANY)).toBe("operator");
  });

  it("ignores non-active memberships", () => {
    const req = makeBoardReq({ role: "owner", status: "suspended" });
    expect(resolveWorkspaceRole(req, COMPANY)).toBeNull();
  });
});

describe("getActorRoleForCompany", () => {
  it("returns 'agent' for agent actors", () => {
    const req = makeReq({
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: COMPANY,
      },
    });
    expect(getActorRoleForCompany(req, COMPANY)).toBe("agent");
  });

  it("returns 'instance_admin' for instance admins", () => {
    const req = makeBoardReq({ isInstanceAdmin: true, role: undefined });
    expect(getActorRoleForCompany(req, COMPANY)).toBe("instance_admin");
  });

  it("returns 'local_implicit' for the local boot mode", () => {
    const req = makeBoardReq({
      source: "local_implicit",
      role: undefined,
    });
    expect(getActorRoleForCompany(req, COMPANY)).toBe("local_implicit");
  });

  it("returns the membership role for ordinary signed-in users", () => {
    const req = makeBoardReq({ role: "admin" });
    expect(getActorRoleForCompany(req, COMPANY)).toBe("admin");
  });

  it("returns null for actors with no membership in the workspace", () => {
    const req = makeBoardReq({ role: undefined });
    expect(getActorRoleForCompany(req, COMPANY)).toBeNull();
  });
});

describe("assertWorkspaceCapability — per-role gating contract", () => {
  // Capabilities chosen to exercise each rung of the role matrix.
  const cases: Array<{
    capability: WorkspaceCapability;
    role: HumanCompanyMembershipRole;
    allowed: boolean;
  }> = [
    // workspace:transfer_or_delete — Owner only
    { capability: "workspace:transfer_or_delete", role: "owner", allowed: true },
    { capability: "workspace:transfer_or_delete", role: "admin", allowed: false },
    { capability: "workspace:transfer_or_delete", role: "operator", allowed: false },
    { capability: "workspace:transfer_or_delete", role: "viewer", allowed: false },

    // workspace:members:manage — Owner + Admin
    { capability: "workspace:members:manage", role: "owner", allowed: true },
    { capability: "workspace:members:manage", role: "admin", allowed: true },
    { capability: "workspace:members:manage", role: "operator", allowed: false },
    { capability: "workspace:members:manage", role: "viewer", allowed: false },

    // workspace:hire_request:create — Owner + Admin + Operator (People Manager)
    { capability: "workspace:hire_request:create", role: "owner", allowed: true },
    { capability: "workspace:hire_request:create", role: "admin", allowed: true },
    { capability: "workspace:hire_request:create", role: "operator", allowed: true },
    { capability: "workspace:hire_request:create", role: "viewer", allowed: false },

    // workspace:hire_request:approve — Owner + Admin only
    { capability: "workspace:hire_request:approve", role: "owner", allowed: true },
    { capability: "workspace:hire_request:approve", role: "admin", allowed: true },
    { capability: "workspace:hire_request:approve", role: "operator", allowed: false },

    // workspace:coworkers:hire_direct — Owner + Admin (operator must use request flow)
    { capability: "workspace:coworkers:hire_direct", role: "operator", allowed: false },
    { capability: "workspace:coworkers:hire_direct", role: "admin", allowed: true },

    // workspace:coworkers:terminate — Owner + Admin
    { capability: "workspace:coworkers:terminate", role: "operator", allowed: false },

    // workspace:budget:set — Owner only
    { capability: "workspace:budget:set", role: "admin", allowed: false },
    { capability: "workspace:budget:set", role: "owner", allowed: true },

    // workspace:connectors:wire — Owner + Admin
    { capability: "workspace:connectors:wire", role: "operator", allowed: false },
    { capability: "workspace:connectors:wire", role: "admin", allowed: true },
  ];

  for (const { capability, role, allowed } of cases) {
    it(`${role} ${allowed ? "can" : "cannot"} ${capability}`, () => {
      const req = makeBoardReq({ role, method: "POST" });
      if (allowed) {
        expect(() => assertWorkspaceCapability(req, COMPANY, capability)).not.toThrow();
      } else {
        expect(() => assertWorkspaceCapability(req, COMPANY, capability)).toThrow();
      }
    });
  }

  it("instance admins bypass the matrix", () => {
    const req = makeBoardReq({ isInstanceAdmin: true, role: undefined });
    expect(() =>
      assertWorkspaceCapability(req, COMPANY, "workspace:transfer_or_delete"),
    ).not.toThrow();
    expect(() =>
      assertWorkspaceCapability(req, COMPANY, "workspace:budget:set"),
    ).not.toThrow();
  });

  it("local_implicit boot mode bypasses the matrix", () => {
    const req = makeBoardReq({ source: "local_implicit", role: undefined });
    expect(() =>
      assertWorkspaceCapability(req, COMPANY, "workspace:transfer_or_delete"),
    ).not.toThrow();
  });

  it("rejects users with no membership at all (even if companyIds includes the workspace)", () => {
    const req = makeBoardReq({ role: undefined });
    expect(() =>
      assertWorkspaceCapability(req, COMPANY, "workspace:hire_request:create"),
    ).toThrow();
  });

  it("agent actors are not gated by the human role matrix", () => {
    const req = makeReq({
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: COMPANY,
      },
    });
    // Agents pass `assertCompanyAccess` because their key is scoped to the
    // workspace, and `assertWorkspaceCapability` short-circuits for them.
    expect(() =>
      assertWorkspaceCapability(req, COMPANY, "workspace:coworkers:edit_any"),
    ).not.toThrow();
  });
});
