import type { CreateConfigValues } from "../components/AgentConfigForm";
import { buildNewAgentRuntimeConfig } from "./new-agent-runtime-config";
import { BENCH_MANAGER_EMAIL_METADATA_KEY, normalizePersonaEmail } from "./manager-scope";

export function buildNewAgentHirePayload(input: {
  name: string;
  effectiveRole: string;
  title?: string;
  reportsTo?: string | null;
  selectedSkillKeys?: string[];
  configValues: CreateConfigValues;
  adapterConfig: Record<string, unknown>;
  /** People-manager email for Manager-view scoping (`metadata.benchManagerEmail`). */
  managerEmail?: string | null;
}) {
  const {
    name,
    effectiveRole,
    title,
    reportsTo,
    selectedSkillKeys = [],
    configValues,
    adapterConfig,
    managerEmail,
  } = input;

  const metadata: Record<string, unknown> = {};
  if (managerEmail?.trim()) {
    metadata[BENCH_MANAGER_EMAIL_METADATA_KEY] = normalizePersonaEmail(managerEmail.trim());
  }
  const hasMetadata = Object.keys(metadata).length > 0;

  return {
    name: name.trim(),
    role: effectiveRole,
    ...(title?.trim() ? { title: title.trim() } : {}),
    ...(reportsTo ? { reportsTo } : {}),
    ...(selectedSkillKeys.length > 0 ? { desiredSkills: selectedSkillKeys } : {}),
    adapterType: configValues.adapterType,
    defaultEnvironmentId: configValues.defaultEnvironmentId ?? null,
    adapterConfig,
    runtimeConfig: buildNewAgentRuntimeConfig({
      heartbeatEnabled: configValues.heartbeatEnabled,
      intervalSec: configValues.intervalSec,
      cheapModel: configValues.cheapModel,
      cheapModelEnabled: configValues.cheapModelEnabled,
    }),
    budgetMonthlyCents: 0,
    ...(hasMetadata ? { metadata } : {}),
  };
}
