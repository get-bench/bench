import type { DeploymentMode } from "@bench/shared";
import type { DashboardPersona } from "../context/DashboardPersonaContext";

/** Names stored for the local operator that should not be shown as a human “manager” label. */
const RESERVED_MANAGER_LABELS = new Set(["board", "admin"]);

function titleCaseLocalPart(local: string): string {
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(" ");
}

function identityFromEmail(email: string | null | undefined): string | null {
  if (!email?.includes("@")) return null;
  const local = email.split("@")[0]?.trim();
  if (!local) return null;
  const pretty = titleCaseLocalPart(local);
  return pretty || local;
}

/** Human-facing manager name (skips legacy operator labels). */
export function resolveManagerDisplayName(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  const raw = name?.trim();
  if (raw && !RESERVED_MANAGER_LABELS.has(raw.toLowerCase())) {
    return raw;
  }
  return identityFromEmail(email) ?? email?.split("@")[0]?.trim() ?? "Manager";
}

/**
 * Title shown in the account menu / sidebar footer for the active dashboard persona.
 */
export function resolveAccountPersonaTitle(opts: {
  deploymentMode: DeploymentMode | undefined;
  userId: string | null | undefined;
  name: string | null | undefined;
  email: string | null | undefined;
  persona: DashboardPersona;
}): string {
  const localOperator =
    opts.deploymentMode !== "authenticated" || opts.userId === "local-board";

  if (opts.persona === "manager") {
    return resolveManagerDisplayName(opts.name, opts.email);
  }

  if (localOperator) {
    return "Admin";
  }

  const raw = opts.name?.trim();
  if (raw && raw.toLowerCase() !== "board") {
    return raw;
  }
  return identityFromEmail(opts.email) ?? opts.email?.split("@")[0]?.trim() ?? "Admin";
}
