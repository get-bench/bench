import { describe, expect, it } from "vitest";
import { CONNECTOR_CATALOG, getConnectorById } from "./connectors/catalog.js";

describe("CONNECTOR_CATALOG", () => {
  it("has unique connector ids", () => {
    const ids = CONNECTOR_CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves known ids", () => {
    expect(getConnectorById("slack")?.name).toBe("Slack");
    expect(getConnectorById("figma")?.category).toBe("design_research");
    expect(getConnectorById("dovetail")?.name).toBe("Dovetail");
  });

  it("includes a broad catalog", () => {
    expect(CONNECTOR_CATALOG.length).toBeGreaterThanOrEqual(95);
  });
});
