import { describe, expect, it } from "vitest";
import { resolveAccountPersonaTitle, resolveManagerDisplayName } from "./account-display";

describe("resolveManagerDisplayName", () => {
  it("skips legacy operator labels and uses email-derived identity", () => {
    expect(resolveManagerDisplayName("Board", "local@bench.local")).toBe("Local");
    expect(resolveManagerDisplayName("Admin", "local@bench.local")).toBe("Local");
    expect(resolveManagerDisplayName("Jane Doe", "jane@example.com")).toBe("Jane Doe");
  });
});

describe("resolveAccountPersonaTitle", () => {
  it("shows Admin for local-trusted operator in admin persona", () => {
    expect(
      resolveAccountPersonaTitle({
        deploymentMode: "local_trusted",
        userId: "local-board",
        name: "Board",
        email: "local@bench.local",
        persona: "admin",
      }),
    ).toBe("Admin");
  });

  it("shows human manager identity in manager persona for local operator", () => {
    expect(
      resolveAccountPersonaTitle({
        deploymentMode: "local_trusted",
        userId: "local-board",
        name: "Admin",
        email: "local@bench.local",
        persona: "manager",
      }),
    ).toBe("Local");
  });

  it("shows signed-in name for authenticated admin persona", () => {
    expect(
      resolveAccountPersonaTitle({
        deploymentMode: "authenticated",
        userId: "user-99",
        name: "Priya Shah",
        email: "priya@example.com",
        persona: "admin",
      }),
    ).toBe("Priya Shah");
  });
});
