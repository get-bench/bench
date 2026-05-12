import type { CoworkerRole } from "@bench/shared";
import { COWORKER_ROLE_LABELS, getConnectorById } from "@bench/shared";

export type HirableCoworkerRole = Exclude<CoworkerRole, "admin">;

export interface RoleConnectorRow {
  id: string;
  name: string;
  authorized: boolean;
}

const ROLE_CONNECTOR_HINTS: Partial<Record<HirableCoworkerRole, readonly string[]>> = {
  engineer: ["github", "linear"],
  designer: ["figma"],
  pm: ["linear", "notion"],
  qa: ["github", "linear"],
  devops: ["github"],
  researcher: ["notion"],
  general: [],
};

/**
 * Pessimistic stub for whether a connector has a workspace-scoped install.
 * Replace with a real query against `connector_accounts` once the directory
 * page wires up live state.
 */
export function isCatalogConnectorConnected(_connectorId: string): boolean {
  return false;
}

export function resolveRoleConnectorRows(role: HirableCoworkerRole): RoleConnectorRow[] {
  const ids = ROLE_CONNECTOR_HINTS[role] ?? [];
  return ids.map((id) => {
    const def = getConnectorById(id);
    return {
      id,
      name: def?.name ?? id,
      authorized: isCatalogConnectorConnected(id),
    };
  });
}

export function buildAdminHirePrepIssueBody(input: {
  role: HirableCoworkerRole;
  connectorRows: RoleConnectorRow[];
}): string {
  const label = COWORKER_ROLE_LABELS[input.role];
  const lines: string[] = [
    `Hire prep for **${label}** (\`${input.role}\`).`,
    "",
    "## Connectors typically used for this role",
    "",
  ];
  if (input.connectorRows.length === 0) {
    lines.push("_No connectors recommended for this role yet._");
  } else {
    for (const row of input.connectorRows) {
      const status = row.authorized ? "authorized" : "needs install";
      lines.push(`- **${row.name}** (\`${row.id}\`) — ${status}`);
    }
  }
  lines.push("", "Verify credentials in Adapter manager before completing the hire.");
  return lines.join("\n");
}
