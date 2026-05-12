import { describe, expect, it } from "vitest";
import {
  HUMAN_COMPANY_MEMBERSHIP_ROLES,
  INSTANCE_USER_ROLES,
} from "../constants.js";
import {
  INSTANCE_CAPABILITIES,
  ROLES_ALLOWED_BY_INSTANCE_CAPABILITY,
  ROLES_ALLOWED_BY_WORKSPACE_CAPABILITY,
  WORKSPACE_CAPABILITIES,
  instanceRoleCanDo,
  roleCanDoWorkspace,
  rolesAllowedForWorkspaceCapability,
} from "./permission-matrix.js";

describe("permission-matrix — workspace", () => {
  it("declares an entry for every WorkspaceCapability", () => {
    for (const cap of WORKSPACE_CAPABILITIES) {
      expect(ROLES_ALLOWED_BY_WORKSPACE_CAPABILITY[cap]).toBeDefined();
      expect(Array.isArray(ROLES_ALLOWED_BY_WORKSPACE_CAPABILITY[cap])).toBe(
        true,
      );
    }
  });

  it("only references known human roles", () => {
    const known = new Set(HUMAN_COMPANY_MEMBERSHIP_ROLES);
    for (const cap of WORKSPACE_CAPABILITIES) {
      for (const role of ROLES_ALLOWED_BY_WORKSPACE_CAPABILITY[cap]) {
        expect(known.has(role)).toBe(true);
      }
    }
  });

  it("matches the canonical roles.md §5 matrix on the high-blast-radius rows", () => {
    expect(rolesAllowedForWorkspaceCapability("workspace:transfer_or_delete")).toEqual(["owner"]);
    expect(rolesAllowedForWorkspaceCapability("workspace:budget:set")).toEqual(["owner"]);
    expect(rolesAllowedForWorkspaceCapability("workspace:portability:import")).toEqual(["owner"]);

    expect(rolesAllowedForWorkspaceCapability("workspace:members:manage")).toEqual(["owner", "admin"]);
    expect(rolesAllowedForWorkspaceCapability("workspace:hire_request:approve")).toEqual([
      "owner",
      "admin",
    ]);
    expect(rolesAllowedForWorkspaceCapability("workspace:connectors:wire")).toEqual([
      "owner",
      "admin",
    ]);

    expect(rolesAllowedForWorkspaceCapability("workspace:hire_request:create")).toEqual([
      "owner",
      "admin",
      "operator",
    ]);
    expect(rolesAllowedForWorkspaceCapability("work:tasks:file")).toEqual([
      "owner",
      "admin",
      "operator",
      "viewer",
    ]);
  });

  it("People Manager (operator) is blocked from owner/admin-only verbs", () => {
    expect(roleCanDoWorkspace("operator", "workspace:settings:general:edit")).toBe(false);
    expect(roleCanDoWorkspace("operator", "workspace:members:manage")).toBe(false);
    expect(roleCanDoWorkspace("operator", "workspace:transfer_or_delete")).toBe(false);
    expect(roleCanDoWorkspace("operator", "workspace:budget:set")).toBe(false);
    expect(roleCanDoWorkspace("operator", "workspace:hire_request:approve")).toBe(false);
    expect(roleCanDoWorkspace("operator", "workspace:portability:export")).toBe(false);
    expect(roleCanDoWorkspace("operator", "workspace:portability:import")).toBe(false);
    expect(roleCanDoWorkspace("operator", "workspace:connectors:wire")).toBe(false);
    expect(roleCanDoWorkspace("operator", "workspace:coworkers:hire_direct")).toBe(false);
  });

  it("Viewer can only file tasks and read; never mutates", () => {
    expect(roleCanDoWorkspace("viewer", "work:tasks:file")).toBe(true);
    expect(roleCanDoWorkspace("viewer", "workspace:settings:general:view")).toBe(true);
    expect(roleCanDoWorkspace("viewer", "workspace:audit:view_scoped")).toBe(true);

    expect(roleCanDoWorkspace("viewer", "work:tasks:assign_any")).toBe(false);
    expect(roleCanDoWorkspace("viewer", "work:tasks:assign_roster")).toBe(false);
    expect(roleCanDoWorkspace("viewer", "workspace:hire_request:create")).toBe(false);
    expect(roleCanDoWorkspace("viewer", "workspace:coworkers:edit_roster")).toBe(false);
    expect(roleCanDoWorkspace("viewer", "workspace:coworkers:pause_resume_roster")).toBe(false);
    expect(roleCanDoWorkspace("viewer", "workspace:settings:general:edit")).toBe(false);
  });

  it("returns false for null/undefined role", () => {
    expect(roleCanDoWorkspace(null, "work:tasks:file")).toBe(false);
    expect(roleCanDoWorkspace(undefined, "work:tasks:file")).toBe(false);
  });

  it("transfer_or_delete is exclusively Owner — Admin must not slip in", () => {
    expect(roleCanDoWorkspace("admin", "workspace:transfer_or_delete")).toBe(false);
    expect(roleCanDoWorkspace("owner", "workspace:transfer_or_delete")).toBe(true);
  });
});

describe("permission-matrix — instance", () => {
  it("declares an entry for every InstanceCapability", () => {
    for (const cap of INSTANCE_CAPABILITIES) {
      expect(ROLES_ALLOWED_BY_INSTANCE_CAPABILITY[cap]).toBeDefined();
    }
  });

  it("only references instance_admin", () => {
    const known = new Set(INSTANCE_USER_ROLES);
    for (const cap of INSTANCE_CAPABILITIES) {
      for (const role of ROLES_ALLOWED_BY_INSTANCE_CAPABILITY[cap]) {
        expect(known.has(role)).toBe(true);
      }
    }
  });

  it("instanceRoleCanDo gates instance_admin verbs", () => {
    expect(instanceRoleCanDo("instance_admin", "instance:identity:manage")).toBe(true);
    expect(instanceRoleCanDo(null, "instance:identity:manage")).toBe(false);
  });
});
