import type { Agent } from "@bench/shared";
import { BENCH_MANAGER_EMAIL_METADATA_KEY, normalizePersonaEmail } from "./manager-scope";

export interface AgentModelProfileOverlay {
  enabled?: boolean;
  adapterConfig?: Record<string, unknown>;
  /**
   * Mark the cheap profile for clearing. When true, the patch removes
   * `runtimeConfig.modelProfiles.cheap` instead of merging into it.
   */
  cleared?: boolean;
}

export interface AgentConfigOverlay {
  identity: Record<string, unknown>;
  adapterType?: string;
  adapterConfig: Record<string, unknown>;
  heartbeat: Record<string, unknown>;
  runtime: Record<string, unknown>;
  modelProfiles?: { cheap?: AgentModelProfileOverlay };
  /** Shallow metadata keys to merge (empty string removes key). */
  metadata?: Record<string, unknown>;
}

const ADAPTER_AGNOSTIC_KEYS = [
  "env",
  "promptTemplate",
  "instructionsFilePath",
  "cwd",
  "timeoutSec",
  "graceSec",
  "bootstrapPromptTemplate",
] as const;

function omitUndefinedEntries(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

export function buildAgentUpdatePatch(agent: Agent, overlay: AgentConfigOverlay) {
  const patch: Record<string, unknown> = {};

  if (Object.keys(overlay.identity).length > 0) {
    const idPatch = { ...overlay.identity };
    if ("coworkerEmail" in idPatch && (idPatch.coworkerEmail === "" || idPatch.coworkerEmail === undefined)) {
      idPatch.coworkerEmail = null;
    }
    Object.assign(patch, idPatch);
  }

  if (overlay.metadata && Object.keys(overlay.metadata).length > 0) {
    const base = { ...(agent.metadata ?? {}) };
    for (const [k, v] of Object.entries(overlay.metadata)) {
      if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
        delete base[k];
      } else if (k === BENCH_MANAGER_EMAIL_METADATA_KEY && typeof v === "string") {
        base[k] = normalizePersonaEmail(v.trim());
      } else {
        base[k] = v;
      }
    }
    patch.metadata = base;
  }

  if (overlay.adapterType !== undefined) {
    patch.adapterType = overlay.adapterType;
  }

  if (overlay.adapterType !== undefined || Object.keys(overlay.adapterConfig).length > 0) {
    const existing = (agent.adapterConfig ?? {}) as Record<string, unknown>;
    const nextAdapterConfig =
      overlay.adapterType !== undefined
        ? {
            ...Object.fromEntries(
              ADAPTER_AGNOSTIC_KEYS
                .filter((key) => existing[key] !== undefined)
                .map((key) => [key, existing[key]]),
            ),
            ...overlay.adapterConfig,
          }
        : {
            ...existing,
            ...overlay.adapterConfig,
          };

    patch.adapterConfig = omitUndefinedEntries(nextAdapterConfig);
    patch.replaceAdapterConfig = true;
  }

  const cheapOverlay = overlay.modelProfiles?.cheap;
  const hasModelProfileChange = cheapOverlay !== undefined;

  if (Object.keys(overlay.heartbeat).length > 0 || hasModelProfileChange) {
    const existingRc = (agent.runtimeConfig ?? {}) as Record<string, unknown>;
    const nextRuntimeConfig: Record<string, unknown> = (patch.runtimeConfig as Record<string, unknown> | undefined)
      ?? { ...existingRc };

    if (Object.keys(overlay.heartbeat).length > 0) {
      const existingHb = (existingRc.heartbeat ?? {}) as Record<string, unknown>;
      nextRuntimeConfig.heartbeat = { ...existingHb, ...overlay.heartbeat };
    }

    if (hasModelProfileChange) {
      const existingProfiles = ((existingRc.modelProfiles ?? {}) as Record<string, unknown>);
      const existingCheap = ((existingProfiles.cheap ?? {}) as Record<string, unknown>);
      const nextProfiles = { ...existingProfiles };

      if (cheapOverlay?.cleared) {
        delete nextProfiles.cheap;
      } else if (cheapOverlay) {
        const mergedAdapterConfig = {
          ...((existingCheap.adapterConfig ?? {}) as Record<string, unknown>),
          ...(cheapOverlay.adapterConfig ?? {}),
        };
        const enabled = cheapOverlay.enabled ?? (existingCheap.enabled !== false);
        nextProfiles.cheap = {
          ...existingCheap,
          enabled,
          adapterConfig: mergedAdapterConfig,
        };
      }

      if (Object.keys(nextProfiles).length === 0) {
        delete nextRuntimeConfig.modelProfiles;
      } else {
        nextRuntimeConfig.modelProfiles = nextProfiles;
      }
    }

    patch.runtimeConfig = nextRuntimeConfig;
  }

  if (Object.keys(overlay.runtime).length > 0) {
    Object.assign(patch, overlay.runtime);
  }

  return patch;
}
