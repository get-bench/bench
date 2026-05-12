// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Agent } from "@bench/shared";
import {
  BENCH_MANAGER_EMAIL_METADATA_KEY,
  buildClaimManagerMetadataPatch,
  filterAgentsForManagerEmail,
  findUnassignedCoworkers,
  getBenchManagerEmailFromMetadata,
} from "./manager-scope";

function agent(overrides: Partial<Agent>): Agent {
  const base: Agent = {
    id: "agent-id",
    companyId: "company-1",
    name: "Test",
    urlKey: "test",
    role: "general",
    title: null,
    icon: null,
    coworkerEmail: null,
    reportsTo: null,
    capabilities: null,
    adapterType: "claude_local",
    adapterConfig: {},
    runtimeConfig: {},
    defaultEnvironmentId: null,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    status: "active",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  return { ...base, ...overrides };
}

describe("getBenchManagerEmailFromMetadata", () => {
  it("returns lowercased email when present", () => {
    expect(getBenchManagerEmailFromMetadata({ benchManagerEmail: "  Bob@X.io " })).toBe("bob@x.io");
  });

  it("returns null when missing, blank, or non-string", () => {
    expect(getBenchManagerEmailFromMetadata(null)).toBeNull();
    expect(getBenchManagerEmailFromMetadata({})).toBeNull();
    expect(getBenchManagerEmailFromMetadata({ benchManagerEmail: "   " })).toBeNull();
    expect(getBenchManagerEmailFromMetadata({ benchManagerEmail: 123 } as never)).toBeNull();
  });
});

describe("filterAgentsForManagerEmail", () => {
  it("matches case-insensitively on the metadata key", () => {
    const a1 = agent({ id: "1", metadata: { benchManagerEmail: "alice@x.io" } });
    const a2 = agent({ id: "2", metadata: { benchManagerEmail: "BOB@X.IO" } });
    const a3 = agent({ id: "3", metadata: null });
    const result = filterAgentsForManagerEmail([a1, a2, a3], "Bob@X.io");
    expect(result.map((a) => a.id)).toEqual(["2"]);
  });
});

describe("findUnassignedCoworkers — Manager-view recovery", () => {
  // Pins the regression: a freshly-hired coworker without
  // metadata.benchManagerEmail must surface as "unassigned" so the manager
  // can self-claim from the empty state, and a terminated row must NOT
  // appear (we don't want managers re-claiming wound-down coworkers).
  it("includes coworkers with null/missing metadata and excludes terminated", () => {
    const noMeta = agent({ id: "no-meta", metadata: null });
    const blankMeta = agent({ id: "blank", metadata: { other: "thing" } });
    const blankEmail = agent({ id: "blank-email", metadata: { benchManagerEmail: "  " } });
    const owned = agent({ id: "owned", metadata: { benchManagerEmail: "alice@x.io" } });
    const terminatedNoMeta = agent({ id: "term", status: "terminated", metadata: null });
    const pendingNoMeta = agent({ id: "pending", status: "pending_approval", metadata: null });

    const out = findUnassignedCoworkers([
      noMeta,
      blankMeta,
      blankEmail,
      owned,
      terminatedNoMeta,
      pendingNoMeta,
    ]);
    expect(out.map((a) => a.id).sort()).toEqual(["blank", "blank-email", "no-meta", "pending"]);
  });
});

describe("buildClaimManagerMetadataPatch — preserves existing metadata", () => {
  // Critical: PATCH /agents/:id replaces metadata wholesale on the server.
  // If callers send a bare { benchManagerEmail }, every other key on the
  // agent's metadata is lost. The helper MUST merge from the live row.
  it("merges into existing metadata and stamps lowercased email", () => {
    const patch = buildClaimManagerMetadataPatch(
      { coworkerAvatarContentPath: "/avatars/x.png", customField: 42 },
      "Manager@Cisco.COM",
    );
    expect(patch).toEqual({
      coworkerAvatarContentPath: "/avatars/x.png",
      customField: 42,
      [BENCH_MANAGER_EMAIL_METADATA_KEY]: "manager@cisco.com",
    });
  });

  it("handles null/non-object metadata by starting from a fresh object", () => {
    expect(buildClaimManagerMetadataPatch(null, "X@Y.io")).toEqual({
      [BENCH_MANAGER_EMAIL_METADATA_KEY]: "x@y.io",
    });
  });

  it("overwrites a stale benchManagerEmail with the claiming user", () => {
    const patch = buildClaimManagerMetadataPatch(
      { [BENCH_MANAGER_EMAIL_METADATA_KEY]: "old@x.io", keep: true },
      "new@x.io",
    );
    expect(patch).toEqual({
      keep: true,
      [BENCH_MANAGER_EMAIL_METADATA_KEY]: "new@x.io",
    });
  });
});
