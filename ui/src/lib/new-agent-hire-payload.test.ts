// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildNewAgentHirePayload } from "./new-agent-hire-payload";
import { defaultCreateValues } from "../components/agent-config-defaults";

describe("buildNewAgentHirePayload", () => {
  it("persists the selected default environment id", () => {
    expect(
      buildNewAgentHirePayload({
        name: "Linux Claude",
        effectiveRole: "general",
        configValues: {
          ...defaultCreateValues,
          adapterType: "claude_local",
          defaultEnvironmentId: "11111111-1111-4111-8111-111111111111",
        },
        adapterConfig: { foo: "bar" },
      }),
    ).toMatchObject({
      name: "Linux Claude",
      role: "general",
      adapterType: "claude_local",
      defaultEnvironmentId: "11111111-1111-4111-8111-111111111111",
      adapterConfig: { foo: "bar" },
      budgetMonthlyCents: 0,
    });
  });

  it("sends null when no default environment is selected", () => {
    expect(
      buildNewAgentHirePayload({
        name: "Local Claude",
        effectiveRole: "general",
        configValues: {
          ...defaultCreateValues,
          adapterType: "claude_local",
        },
        adapterConfig: {},
      }),
    ).toMatchObject({
      defaultEnvironmentId: null,
    });
  });

  // Pin the contract that broke Manager view: when an `managerEmail` is
  // supplied (the form now defaults this to the signed-in user), the hire
  // payload MUST land `metadata.benchManagerEmail` on the new coworker.
  // Without this the Manager-view filter (exact-match on the same field)
  // hides the freshly-hired coworker even though Admin view shows it.
  it("stamps metadata.benchManagerEmail (lowercased) when managerEmail is provided", () => {
    expect(
      buildNewAgentHirePayload({
        name: "Frontend Bot",
        effectiveRole: "general",
        configValues: {
          ...defaultCreateValues,
          adapterType: "claude_local",
        },
        adapterConfig: {},
        managerEmail: "  Manager@Cisco.COM  ",
      }),
    ).toMatchObject({
      metadata: { benchManagerEmail: "manager@cisco.com" },
    });
  });

  it("omits metadata when managerEmail is null/empty (admin can hire unassigned on purpose)", () => {
    const explicitNull = buildNewAgentHirePayload({
      name: "Founding Admin",
      effectiveRole: "admin",
      configValues: {
        ...defaultCreateValues,
        adapterType: "claude_local",
      },
      adapterConfig: {},
      managerEmail: null,
    });
    expect(explicitNull).not.toHaveProperty("metadata");

    const blank = buildNewAgentHirePayload({
      name: "Other",
      effectiveRole: "general",
      configValues: {
        ...defaultCreateValues,
        adapterType: "claude_local",
      },
      adapterConfig: {},
      managerEmail: "   ",
    });
    expect(blank).not.toHaveProperty("metadata");
  });
});
