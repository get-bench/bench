import { describe, expect, it } from "vitest";
import { roleCanDoWorkspace } from "@bench/shared";
import type { CurrentBoardAccess } from "../api/access";
import { resolveWorkspaceRole } from "./usePermissions";

const COMPANY_A = "00000000-0000-4000-8000-00000000000a";
const COMPANY_B = "00000000-0000-4000-8000-00000000000b";

function makeAccess(overrides: Partial<CurrentBoardAccess>): CurrentBoardAccess {
  return {
    user: { id: "u1", email: "u1@example.com", name: "Test", image: null },
    userId: "u1",
    isInstanceAdmin: false,
    companyIds: [],
    memberships: [],
    source: "session",
    keyId: null,
    ...overrides,
  };
}

describe("resolveWorkspaceRole", () => {
  it("returns null when board access is missing", () => {
    expect(resolveWorkspaceRole(null, COMPANY_A)).toBeNull();
    expect(resolveWorkspaceRole(undefined, COMPANY_A)).toBeNull();
  });

  it("treats local_implicit boot as full owner-equivalent", () => {
    const access = makeAccess({ source: "local_implicit" });
    expect(resolveWorkspaceRole(access, COMPANY_A)).toBe("owner");
  });

  it("returns instance_admin override when the user is an instance admin", () => {
    const access = makeAccess({ isInstanceAdmin: true });
    expect(resolveWorkspaceRole(access, COMPANY_A)).toBe("instance_admin");
  });

  it("returns the active membership role for the requested workspace", () => {
    const access = makeAccess({
      companyIds: [COMPANY_A, COMPANY_B],
      memberships: [
        { companyId: COMPANY_A, membershipRole: "operator", status: "active" },
        { companyId: COMPANY_B, membershipRole: "owner", status: "active" },
      ],
    });
    expect(resolveWorkspaceRole(access, COMPANY_A)).toBe("operator");
    expect(resolveWorkspaceRole(access, COMPANY_B)).toBe("owner");
  });

  it("normalizes the legacy 'member' role to 'operator'", () => {
    const access = makeAccess({
      companyIds: [COMPANY_A],
      memberships: [
        { companyId: COMPANY_A, membershipRole: "member", status: "active" },
      ],
    });
    expect(resolveWorkspaceRole(access, COMPANY_A)).toBe("operator");
  });

  it("ignores non-active memberships", () => {
    const access = makeAccess({
      companyIds: [COMPANY_A],
      memberships: [
        { companyId: COMPANY_A, membershipRole: "owner", status: "suspended" },
      ],
    });
    expect(resolveWorkspaceRole(access, COMPANY_A)).toBeNull();
  });

  it("returns null when no companyId is provided", () => {
    const access = makeAccess({
      companyIds: [COMPANY_A],
      memberships: [
        { companyId: COMPANY_A, membershipRole: "owner", status: "active" },
      ],
    });
    expect(resolveWorkspaceRole(access, null)).toBeNull();
    expect(resolveWorkspaceRole(access, undefined)).toBeNull();
  });

  it("falls back to viewer for legacy responses missing memberships[]", () => {
    const access = makeAccess({
      companyIds: [COMPANY_A],
      memberships: undefined,
    });
    expect(resolveWorkspaceRole(access, COMPANY_A)).toBe("viewer");
  });
});

describe("permission matrix wiring", () => {
  it("operator (people manager) cannot delete the workspace", () => {
    expect(roleCanDoWorkspace("operator", "workspace:transfer_or_delete")).toBe(false);
  });

  it("admin can manage members but cannot transfer or delete", () => {
    expect(roleCanDoWorkspace("admin", "workspace:members:manage")).toBe(true);
    expect(roleCanDoWorkspace("admin", "workspace:transfer_or_delete")).toBe(false);
  });

  it("owner can transfer and set budgets", () => {
    expect(roleCanDoWorkspace("owner", "workspace:transfer_or_delete")).toBe(true);
    expect(roleCanDoWorkspace("owner", "workspace:budget:set")).toBe(true);
  });

  it("operator can request — but not approve — a hire", () => {
    expect(roleCanDoWorkspace("operator", "workspace:hire_request:create")).toBe(true);
    expect(roleCanDoWorkspace("operator", "workspace:hire_request:approve")).toBe(false);
    expect(roleCanDoWorkspace("operator", "workspace:coworkers:hire_direct")).toBe(false);
  });

  it("viewer cannot perform any mutating capability", () => {
    expect(roleCanDoWorkspace("viewer", "workspace:hire_request:create")).toBe(false);
    expect(roleCanDoWorkspace("viewer", "workspace:coworkers:edit_any")).toBe(false);
    expect(roleCanDoWorkspace("viewer", "work:tasks:assign_any")).toBe(false);
  });
});
