import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useDashboardPersona } from "../context/DashboardPersonaContext";
import { agentsApi } from "../api/agents";
import { companySkillsApi } from "../api/companySkills";
import { normalizePersonaEmail } from "../lib/manager-scope";
import { queryKeys } from "../lib/queryKeys";
import { HIRABLE_COWORKER_ROLES, type AdapterEnvironmentTestResult } from "@bench/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Shield } from "lucide-react";
import { cn, agentUrl } from "../lib/utils";
import { roleLabels } from "../components/agent-config-primitives";
import {
  AgentConfigForm,
  AdapterEnvironmentResult,
  type CreateConfigValues,
} from "../components/AgentConfigForm";
import { defaultCreateValues } from "../components/agent-config-defaults";
import { getUIAdapter, listUIAdapters } from "../adapters";
import { useDisabledAdaptersSync } from "../adapters/use-disabled-adapters";
import { isValidAdapterType } from "../adapters/metadata";
import { ReportsToPicker } from "../components/ReportsToPicker";
import { buildNewAgentHirePayload } from "../lib/new-agent-hire-payload";
import { CX } from "../lib/coworker-language";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
  DEFAULT_CODEX_LOCAL_MODEL,
} from "@bench/adapter-codex-local";
import { DEFAULT_CURSOR_LOCAL_MODEL } from "@bench/adapter-cursor-local";
import { DEFAULT_GEMINI_LOCAL_MODEL } from "@bench/adapter-gemini-local";

function createValuesForAdapterType(
  adapterType: CreateConfigValues["adapterType"],
): CreateConfigValues {
  const { adapterType: _discard, ...defaults } = defaultCreateValues;
  const nextValues: CreateConfigValues = { ...defaults, adapterType };
  if (adapterType === "codex_local") {
    nextValues.model = DEFAULT_CODEX_LOCAL_MODEL;
    nextValues.dangerouslyBypassSandbox =
      DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX;
  } else if (adapterType === "gemini_local") {
    nextValues.model = DEFAULT_GEMINI_LOCAL_MODEL;
  } else if (adapterType === "cursor") {
    nextValues.model = DEFAULT_CURSOR_LOCAL_MODEL;
  } else if (adapterType === "opencode_local") {
    nextValues.model = "";
  }
  return nextValues;
}

export function NewAgent() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetAdapterType = searchParams.get("adapterType");

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState("general");
  const [reportsTo, setReportsTo] = useState<string | null>(null);
  const { sessionEmail } = useDashboardPersona();
  const defaultManagerEmail = sessionEmail ? normalizePersonaEmail(sessionEmail) : "";
  const [managerEmail, setManagerEmail] = useState<string>(defaultManagerEmail);
  const [managerEmailUserEdited, setManagerEmailUserEdited] = useState(false);
  const [configValues, setConfigValues] = useState<CreateConfigValues>(defaultCreateValues);
  const [selectedSkillKeys, setSelectedSkillKeys] = useState<string[]>([]);
  const [roleOpen, setRoleOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testAgentAction, setTestAgentAction] = useState<(() => void) | null>(null);
  const [testAgentState, setTestAgentState] = useState({ disabled: true, pending: false });
  const [testAgentFeedback, setTestAgentFeedback] = useState<{
    errorMessage: string | null;
    result: AdapterEnvironmentTestResult | null;
  }>({
    errorMessage: null,
    result: null,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const {
    data: adapterModels,
    error: adapterModelsError,
    isLoading: adapterModelsLoading,
    isFetching: adapterModelsFetching,
  } = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.agents.adapterModels(selectedCompanyId, configValues.adapterType)
      : ["agents", "none", "adapter-models", configValues.adapterType],
    queryFn: () => agentsApi.adapterModels(selectedCompanyId!, configValues.adapterType),
    enabled: Boolean(selectedCompanyId),
  });

  const { data: companySkills } = useQuery({
    queryKey: queryKeys.companySkills.list(selectedCompanyId ?? ""),
    queryFn: () => companySkillsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const isFirstAgent = !agents || agents.length === 0;
  const effectiveRole = isFirstAgent ? "admin" : role;

  useEffect(() => {
    setBreadcrumbs([
      { label: CX.Coworkers, href: "/agents" },
      { label: CX.newCoworker },
    ]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (isFirstAgent) {
      if (!name) setName("Admin");
      if (!title) setTitle("Admin");
    }
  }, [isFirstAgent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hydrate the People-manager email default from the signed-in user once the
  // session resolves. Without a default, every coworker shipped here lands with
  // metadata.benchManagerEmail unset, which makes them invisible in Manager
  // view (the manager dashboard filters by exact email match). Defaulting to
  // the hiring user matches the most common case (manager hires for self) and
  // is trivially overridden when an admin hires on behalf of someone else.
  useEffect(() => {
    if (managerEmailUserEdited) return;
    if (isFirstAgent) return;
    const next = sessionEmail ? normalizePersonaEmail(sessionEmail) : "";
    if (next !== managerEmail) setManagerEmail(next);
  }, [sessionEmail, isFirstAgent, managerEmailUserEdited, managerEmail]);

  useEffect(() => {
    const requested = presetAdapterType;
    if (!requested) return;
    if (!isValidAdapterType(requested)) return;
    setConfigValues((prev) => {
      if (prev.adapterType === requested) return prev;
      return createValuesForAdapterType(requested as CreateConfigValues["adapterType"]);
    });
  }, [presetAdapterType]);

  const createAgent = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      agentsApi.hire(selectedCompanyId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
      navigate(agentUrl(result.agent));
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : "Failed to create agent");
    },
  });

  function buildAdapterConfig() {
    const adapter = getUIAdapter(configValues.adapterType);
    return adapter.buildAdapterConfig(configValues);
  }

  function handleSubmit() {
    if (!selectedCompanyId || !name.trim()) return;
    setFormError(null);
    if (configValues.adapterType === "opencode_local") {
      const selectedModel = configValues.model.trim();
      if (!selectedModel) {
        setFormError("OpenCode requires an explicit model in provider/model format.");
        return;
      }
      if (adapterModelsError) {
        setFormError(
          adapterModelsError instanceof Error
            ? adapterModelsError.message
            : "Failed to load OpenCode models.",
        );
        return;
      }
      if (adapterModelsLoading || adapterModelsFetching) {
        setFormError("OpenCode models are still loading. Please wait and try again.");
        return;
      }
      const discovered = adapterModels ?? [];
      if (!discovered.some((entry) => entry.id === selectedModel)) {
        setFormError(
          discovered.length === 0
            ? "No OpenCode models discovered. Run `opencode models` and authenticate providers."
            : `Configured OpenCode model is unavailable: ${selectedModel}`,
        );
        return;
      }
    }
    createAgent.mutate(
      buildNewAgentHirePayload({
        name,
        effectiveRole,
        title,
        reportsTo,
        selectedSkillKeys,
        configValues,
        adapterConfig: buildAdapterConfig(),
        managerEmail: isFirstAgent ? null : managerEmail.trim() || null,
      }),
    );
  }

  const availableSkills = (companySkills ?? []).filter((skill) => !skill.key.startsWith("bench/bench/"));

  function toggleSkill(key: string, checked: boolean) {
    setSelectedSkillKeys((prev) => {
      if (checked) {
        return prev.includes(key) ? prev : [...prev, key];
      }
      return prev.filter((value) => value !== key);
    });
  }

  const handleTestAgentActionChange = useCallback((fn: (() => void) | null) => {
    setTestAgentAction(() => fn);
  }, []);

  const handleTestAgentStateChange = useCallback((state: { disabled: boolean; pending: boolean }) => {
    setTestAgentState(state);
  }, []);

  const handleTestAgentFeedbackChange = useCallback((feedback: {
    errorMessage: string | null;
    result: AdapterEnvironmentTestResult | null;
  }) => {
    setTestAgentFeedback(feedback);
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{CX.newCoworker}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Adapter, runtime, and onboarding settings for this hire.
        </p>
      </div>

      <div className="border border-border">
        {/* Name */}
        <div className="px-4 pt-4 pb-2">
          <input
            className="w-full text-lg font-semibold bg-transparent outline-none placeholder:text-muted-foreground/50"
            placeholder="Coworker name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        {/* Title */}
        <div className="px-4 pb-2">
          <input
            className="w-full bg-transparent outline-none text-sm text-muted-foreground placeholder:text-muted-foreground/40"
            placeholder="Title (e.g. VP of Engineering)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Property chips: Role + Reports To */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-t border-border flex-wrap">
          <Popover open={roleOpen} onOpenChange={setRoleOpen}>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors",
                  isFirstAgent && "opacity-60 cursor-not-allowed"
                )}
                disabled={isFirstAgent}
              >
                <Shield className="h-3 w-3 text-muted-foreground" />
                {roleLabels[effectiveRole] ?? effectiveRole}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-36 p-1" align="start">
              {HIRABLE_COWORKER_ROLES.map((r) => (
                <button
                  key={r}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                    r === role && "bg-accent"
                  )}
                  onClick={() => { setRole(r); setRoleOpen(false); }}
                >
                  {roleLabels[r] ?? r}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <ReportsToPicker
            agents={agents ?? []}
            value={reportsTo}
            onChange={setReportsTo}
            disabled={isFirstAgent}
          />
        </div>

        {!isFirstAgent ? (
          <div className="px-4 py-3 border-t border-border space-y-2 max-w-lg">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="hire-manager-email" className="text-xs text-muted-foreground">
                People manager email
              </Label>
              {sessionEmail
                && managerEmail.trim() !== normalizePersonaEmail(sessionEmail)
                && managerEmail.trim().length > 0 ? (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => {
                    setManagerEmail(normalizePersonaEmail(sessionEmail));
                    setManagerEmailUserEdited(false);
                  }}
                >
                  Reset to me
                </button>
              ) : null}
            </div>
            <input
              id="hire-manager-email"
              type="email"
              autoComplete="email"
              placeholder="manager@company.com — scopes Manager view"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/50"
              value={managerEmail}
              onChange={(e) => {
                setManagerEmail(e.target.value);
                setManagerEmailUserEdited(true);
              }}
            />
            <p className="text-[11px] text-muted-foreground leading-snug">
              Defaults to <span className="font-mono">{sessionEmail ?? "(no signed-in email)"}</span> so this
              coworker appears in your Manager view. Override if you&apos;re hiring on behalf of another
              manager. Clear to leave the coworker unassigned (visible in Admin view only). Stored as{" "}
              <span className="font-mono">benchManagerEmail</span>, normalized to lowercase.
            </p>
          </div>
        ) : null}

        {/* Shared config form */}
        <AgentConfigForm
          mode="create"
          values={configValues}
          onChange={(patch) => setConfigValues((prev) => ({ ...prev, ...patch }))}
          adapterModels={adapterModels}
          onTestActionChange={handleTestAgentActionChange}
          onTestActionStateChange={handleTestAgentStateChange}
          onTestFeedbackChange={handleTestAgentFeedbackChange}
        />

        <div className="border-t border-border px-4 py-4">
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-medium">Company skills</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Optional skills from the company library. Built-in Bench runtime skills are added automatically.
              </p>
            </div>
            {availableSkills.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No optional company skills installed yet.
              </p>
            ) : (
              <div className="space-y-3">
                {availableSkills.map((skill) => {
                  const inputId = `skill-${skill.id}`;
                  const checked = selectedSkillKeys.includes(skill.key);
                  return (
                    <div key={skill.id} className="flex items-start gap-3">
                      <Checkbox
                        id={inputId}
                        checked={checked}
                        onCheckedChange={(next) => toggleSkill(skill.key, next === true)}
                      />
                      <label htmlFor={inputId} className="grid gap-1 leading-none">
                        <span className="text-sm font-medium">{skill.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {skill.description ?? skill.key}
                        </span>
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-3">
          {isFirstAgent && (
            <p className="text-xs text-muted-foreground mb-2">This will be the company Admin</p>
          )}
          {formError && (
            <p className="text-xs text-destructive mb-2">{formError}</p>
          )}
          <div className="space-y-3">
            {testAgentFeedback.errorMessage && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {testAgentFeedback.errorMessage}
              </div>
            )}
            {testAgentFeedback.result && (
              <AdapterEnvironmentResult result={testAgentFeedback.result} />
            )}
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate("/agents")}>
                Cancel
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testAgentState.disabled}
                  onClick={() => testAgentAction?.()}
                >
                  {testAgentState.pending ? "Testing..." : "Test setup"}
                </Button>
                <Button
                  size="sm"
                  disabled={!name.trim() || createAgent.isPending}
                  onClick={handleSubmit}
                >
                  {createAgent.isPending ? "Creating…" : `Create ${CX.coworker}`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
