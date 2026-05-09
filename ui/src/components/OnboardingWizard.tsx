import { useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdapterEnvironmentTestResult } from "@bench/shared";
import { useLocation, useNavigate, useParams } from "@/lib/router";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { companiesApi } from "../api/companies";
import { goalsApi } from "../api/goals";
import { agentsApi } from "../api/agents";
import { approvalsApi } from "../api/approvals";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { Dialog, DialogPortal } from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";
import {
  extractModelName,
  extractProviderIdWithFallback
} from "../lib/model-utils";
import { getUIAdapter } from "../adapters";
import { listUIAdapters } from "../adapters";
import { isVisualAdapterChoice } from "../adapters/metadata";
import { useDisabledAdaptersSync } from "../adapters/use-disabled-adapters";
import { useAdapterCapabilities } from "../adapters/use-adapter-capabilities";
import { getAdapterDisplay } from "../adapters/adapter-display-registry";
import { defaultCreateValues } from "./agent-config-defaults";
import {
  buildOnboardingIssuePayload,
  buildOnboardingProjectPayload,
  selectDefaultCompanyGoalId
} from "../lib/onboarding-launch";
import { buildNewAgentRuntimeConfig } from "../lib/new-agent-runtime-config";
import {
  DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
  DEFAULT_CODEX_LOCAL_MODEL
} from "@bench/adapter-codex-local";
import { DEFAULT_CURSOR_LOCAL_MODEL } from "@bench/adapter-cursor-local";
import { DEFAULT_GEMINI_LOCAL_MODEL } from "@bench/adapter-gemini-local";
import { resolveRouteOnboardingOptions } from "../lib/onboarding-route";
import { AsciiArtAnimation } from "./AsciiArtAnimation";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  Bot,
  ListTodo,
  Rocket,
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  ChevronDown,
  Upload,
  X,
  Package,
  UserCog,
  Search,
  LayoutTemplate,
  Server,
  Palette,
  ClipboardCheck,
  Shield,
} from "lucide-react";
import StackIcon, { type IconName } from "tech-stack-icons";
import { useTheme } from "../context/ThemeContext";


type Step = 1 | 2 | 3;
type CoworkerPhase = "choose" | "configure";
type AdapterType = string;

const DEFAULT_TASK_DESCRIPTION = `You are the Admin. You set the direction for the company.

- hire a founding engineer
- write a hiring plan
- break the roadmap into concrete tasks and start delegating work`;

type CoworkerTemplate = {
  id: string;
  role: "admin" | "engineer" | "designer" | "pm" | "qa" | "devops" | "researcher" | "general";
  title: string;
  defaultName: string;
  capabilities: string;
  adapterType: AdapterType;
  featuredPriceUsd: number;
  currentPriceUsd: number;
  launchTaskTitle: string;
  launchTaskDescription: string;
  RoleIcon: LucideIcon;
};

type ToolCategoryId =
  | "team_chat"
  | "email_calendar"
  | "code_hosting"
  | "meetings"
  | "work_tracking"
  | "docs_wiki";

type ToolDirectoryOption = {
  id: string;
  label: string;
  /** `tech-stack-icons` key — null uses generic icon */
  icon: IconName | null;
};

type ToolDirectoryCategory = {
  id: ToolCategoryId;
  label: string;
  blurb: string;
  required: boolean;
  options: ToolDirectoryOption[];
};

const TOOL_DIRECTORY: ToolDirectoryCategory[] = [
  {
    id: "team_chat",
    label: "Collaboration",
    blurb: "Where standups, DMs, and quick decisions happen.",
    required: true,
    options: [
      { id: "slack", label: "Slack", icon: "slack" },
      { id: "teams", label: "Microsoft Teams", icon: "microsoft" },
      { id: "webex", label: "Webex / Cisco", icon: null },
      { id: "google_chat", label: "Google Chat", icon: "google" },
      { id: "mattermost", label: "Mattermost", icon: null },
      { id: "other_chat", label: "Other", icon: null },
    ],
  },
  {
    id: "email_calendar",
    label: "Email & calendar",
    blurb: "So your coworker can follow threads and schedule like a real teammate.",
    required: true,
    options: [
      { id: "outlook", label: "Outlook / Microsoft 365", icon: "microsoft" },
      { id: "gmail_workspace", label: "Gmail / Google Workspace", icon: "google" },
      { id: "icloud", label: "Apple Mail / iCloud", icon: null },
      { id: "other_mail", label: "Other", icon: null },
    ],
  },
  {
    id: "code_hosting",
    label: "Code & repositories",
    blurb: "Where branches, PRs, and reviews live (separate from task trackers).",
    required: false,
    options: [
      { id: "later_code", label: "Decide later in dashboard", icon: null },
      { id: "github", label: "GitHub", icon: "github" },
      { id: "gitlab", label: "GitLab", icon: "gitlab" },
      { id: "bitbucket", label: "Bitbucket", icon: "bitbucket" },
      { id: "azure_repos", label: "Azure Repos", icon: "azure" },
    ],
  },
  {
    id: "meetings",
    label: "Meetings",
    blurb: "Where reviews and planning conversations live.",
    required: false,
    options: [
      { id: "later_meetings", label: "Decide later in dashboard", icon: null },
      { id: "meet", label: "Google Meet", icon: "google" },
      { id: "zoom", label: "Zoom", icon: null },
      { id: "teams_meetings", label: "Microsoft Teams", icon: "microsoft" },
      { id: "webex_meetings", label: "Webex Meetings", icon: null },
    ],
  },
  {
    id: "work_tracking",
    label: "Work tracking",
    blurb: "Tickets and delivery tracking.",
    required: false,
    options: [
      { id: "later_tracking", label: "Decide later in dashboard", icon: null },
      { id: "jira", label: "Jira", icon: "jira" },
      { id: "linear", label: "Linear", icon: "linear" },
      { id: "asana", label: "Asana", icon: "asana" },
      { id: "azure_devops", label: "Azure DevOps Boards", icon: "azure" },
      { id: "github_issues", label: "GitHub Issues / Projects", icon: "github" },
    ],
  },
  {
    id: "docs_wiki",
    label: "Docs & wiki",
    blurb: "Specs, PRDs, and internal knowledge.",
    required: false,
    options: [
      { id: "later_docs", label: "Decide later in dashboard", icon: null },
      { id: "confluence", label: "Confluence", icon: "atlassian" },
      { id: "notion", label: "Notion", icon: "notion" },
      { id: "google_docs", label: "Google Docs / Drive", icon: "drive" },
      { id: "sharepoint", label: "SharePoint", icon: "microsoft" },
    ],
  },
];

/** Shown under the toolchain picker — these are typical post-onboarding connectors */
const CONNECTORS_COMING_LATER_BLURB =
  "After launch you can connect more systems your team already uses: Docker / container registries, CI/CD (GitHub Actions, GitLab CI, Jenkins), observability (Datadog, Sentry), secrets vaults, identity (Okta), HR tools, and anything else we add to the connector catalog.";

/** Preset-or-custom picker: custom uses connector-first configure UI */
const CUSTOM_ROLE_TEMPLATE_ID = "custom-role";

const COWORKER_TEMPLATES: CoworkerTemplate[] = [
  {
    id: "company-admin",
    role: "admin",
    title: "Admin",
    defaultName: "Admin",
    capabilities:
      "Runs day-to-day operations, routes hiring and budget extension requests to the board, and delegates execution across the team.",
    adapterType: "claude_local",
    featuredPriceUsd: 0,
    currentPriceUsd: 0,
    launchTaskTitle: "Hire your first engineer and create a hiring plan",
    launchTaskDescription: DEFAULT_TASK_DESCRIPTION,
    RoleIcon: Shield,
  },
  {
    id: "frontend-engineer",
    role: "engineer",
    title: "Frontend Engineer",
    defaultName: "Frontend Engineer",
    capabilities:
      "Owns React/TypeScript UI development, component architecture, performance optimization, and design-system consistency.",
    adapterType: "codex_local",
    featuredPriceUsd: 39,
    currentPriceUsd: 0,
    launchTaskTitle: "Ship onboarding stepper UI and wiring",
    launchTaskDescription:
      "Implement the onboarding stepper UX end-to-end, connect it to existing APIs, and verify all happy-path and skip-path states.",
    RoleIcon: LayoutTemplate,
  },
  {
    id: "backend-engineer",
    role: "engineer",
    title: "Backend Engineer",
    defaultName: "Backend Engineer",
    capabilities:
      "Builds APIs, service integrations, schema changes, and reliability tooling with production-safe defaults.",
    adapterType: "claude_local",
    featuredPriceUsd: 39,
    currentPriceUsd: 0,
    launchTaskTitle: "Define company onboarding data model + endpoints",
    launchTaskDescription:
      "Add support for website/context intake and connector metadata in onboarding workflows while preserving current contracts.",
    RoleIcon: Server,
  },
  {
    id: "product-designer",
    role: "designer",
    title: "Product Designer",
    defaultName: "Product Designer",
    capabilities:
      "Designs UX flows, interaction specs, and copy; aligns information architecture and visual language.",
    adapterType: "cursor",
    featuredPriceUsd: 39,
    currentPriceUsd: 0,
    launchTaskTitle: "Design first-run onboarding journey",
    launchTaskDescription:
      "Draft a polished onboarding flow with progressive disclosure and conversion-focused copy from company setup through launch.",
    RoleIcon: Palette,
  },
  {
    id: "qa-automation",
    role: "qa",
    title: "QA Automation",
    defaultName: "QA Automation",
    capabilities:
      "Builds regression tests, validates critical paths, and hardens release confidence across UI/API boundaries.",
    adapterType: "gemini_local",
    featuredPriceUsd: 39,
    currentPriceUsd: 0,
    launchTaskTitle: "Create onboarding regression suite",
    launchTaskDescription:
      "Add coverage for onboarding stepper creation flow, skip-task launch, and connector guidance rendering.",
    RoleIcon: ClipboardCheck,
  },
];

function CoworkerRoleIconFrame({
  selected,
  children,
}: {
  selected: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center",
        selected ? "rounded-md bg-muted/60 p-2" : "p-2",
      )}
    >
      {children}
    </div>
  );
}

function toolDirectorySelectionsComplete(
  picks: Partial<Record<ToolCategoryId, string>>
): boolean {
  return TOOL_DIRECTORY.filter((c) => c.required).every((c) => {
    const v = picks[c.id];
    return Boolean(v?.trim());
  });
}

function serializeOnboardingToolDirectory(
  picks: Partial<Record<ToolCategoryId, string>>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of TOOL_DIRECTORY) {
    const v = picks[c.id];
    if (v) out[c.id] = v;
  }
  return out;
}

function filterToolDirectoryBySearch(query: string): ToolDirectoryCategory[] {
  const q = query.trim().toLowerCase();
  if (!q) return TOOL_DIRECTORY;
  return TOOL_DIRECTORY.map((cat) => ({
    ...cat,
    options: cat.options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        cat.label.toLowerCase().includes(q) ||
        cat.blurb.toLowerCase().includes(q),
    ),
  })).filter((cat) => cat.options.length > 0);
}

function ToolBrandIcon({
  icon,
  className,
}: {
  icon: IconName | null;
  className?: string;
}) {
  const { theme } = useTheme();
  if (!icon) {
    return (
      <Package
        className={cn("h-4 w-4 shrink-0 text-muted-foreground", className)}
        aria-hidden
      />
    );
  }
  return (
    <StackIcon
      name={icon}
      variant={theme === "dark" ? "dark" : "light"}
      className={cn("h-4 w-4 shrink-0", className)}
    />
  );
}

export function OnboardingWizard() {
  const { onboardingOpen, onboardingOptions, closeOnboarding } = useDialog();
  const { companies, setSelectedCompanyId, loading: companiesLoading } = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();
  const [routeDismissed, setRouteDismissed] = useState(false);

  // Sync disabled adapter types from server so adapter grid filters them out
  const disabledTypes = useDisabledAdaptersSync();

  const routeOnboardingOptions =
    companyPrefix && companiesLoading
      ? null
      : resolveRouteOnboardingOptions({
          pathname: location.pathname,
          companyPrefix,
          companies,
        });
  const effectiveOnboardingOpen =
    onboardingOpen || (routeOnboardingOptions !== null && !routeDismissed);
  const effectiveOnboardingOptions = onboardingOpen
    ? onboardingOptions
    : routeOnboardingOptions ?? {};

  const initialStep = effectiveOnboardingOptions.initialStep ?? 1;
  const existingCompanyId = effectiveOnboardingOptions.companyId;

  const [step, setStep] = useState<Step>(initialStep);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");

  // Step 1
  const [companyName, setCompanyName] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [companyWebsiteUrl, setCompanyWebsiteUrl] = useState("");
  const [companyLearningAttachmentName, setCompanyLearningAttachmentName] =
    useState<string | null>(null);
  const [companyLearningAttachmentText, setCompanyLearningAttachmentText] =
    useState("");

  const [coworkerPhase, setCoworkerPhase] = useState<CoworkerPhase>("choose");
  const [toolPicks, setToolPicks] = useState<
    Partial<Record<ToolCategoryId, string>>
  >({
    code_hosting: "later_code",
    meetings: "later_meetings",
    work_tracking: "later_tracking",
    docs_wiki: "later_docs",
  });
  const [connectorSearch, setConnectorSearch] = useState("");
  const [customRoleTitle, setCustomRoleTitle] = useState("");
  const [customRoleCapabilities, setCustomRoleCapabilities] = useState("");

  const [selectedTemplateId, setSelectedTemplateId] = useState(
    COWORKER_TEMPLATES[0]!.id
  );
  const [agentName, setAgentName] = useState(
    COWORKER_TEMPLATES[0]!.defaultName
  );
  const [adapterType, setAdapterType] = useState<AdapterType>("claude_local");
  const [model, setModel] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [adapterEnvResult, setAdapterEnvResult] =
    useState<AdapterEnvironmentTestResult | null>(null);
  const [adapterEnvError, setAdapterEnvError] = useState<string | null>(null);
  const [adapterEnvLoading, setAdapterEnvLoading] = useState(false);
  const [forceUnsetAnthropicApiKey, setForceUnsetAnthropicApiKey] =
    useState(false);
  const [unsetAnthropicLoading, setUnsetAnthropicLoading] = useState(false);
  const [showMoreAdapters, setShowMoreAdapters] = useState(false);

  // Step 3
  const [taskTitle, setTaskTitle] = useState(
    "Hire your first engineer and create a hiring plan"
  );
  const [taskDescription, setTaskDescription] = useState(
    DEFAULT_TASK_DESCRIPTION
  );
  const [skipInitialTask, setSkipInitialTask] = useState(false);

  // Auto-grow textarea for task description
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, []);

  // Created entity IDs — pre-populate from existing company when skipping step 1
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(
    existingCompanyId ?? null
  );
  const [createdCompanyPrefix, setCreatedCompanyPrefix] = useState<
    string | null
  >(null);
  const [createdCompanyGoalId, setCreatedCompanyGoalId] = useState<string | null>(
    null
  );
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [createdIssueRef, setCreatedIssueRef] = useState<string | null>(null);

  useEffect(() => {
    setRouteDismissed(false);
  }, [location.pathname]);

  // Sync step and company when onboarding opens with options.
  // Keep this independent from company-list refreshes so Step 1 completion
  // doesn't get reset after creating a company.
  useEffect(() => {
    if (!effectiveOnboardingOpen) return;
    const cId = effectiveOnboardingOptions.companyId ?? null;
    setStep(effectiveOnboardingOptions.initialStep ?? 1);
    setCreatedCompanyId(cId);
    setCreatedCompanyPrefix(null);
    setCreatedCompanyGoalId(null);
    setCreatedProjectId(null);
    setCreatedAgentId(null);
    setCreatedIssueRef(null);
    setCoworkerPhase("choose");
    setToolPicks({
      code_hosting: "later_code",
      meetings: "later_meetings",
      work_tracking: "later_tracking",
      docs_wiki: "later_docs",
    });
    setConnectorSearch("");
    setCustomRoleTitle("");
    setCustomRoleCapabilities("");
  }, [
    effectiveOnboardingOpen,
    effectiveOnboardingOptions.companyId,
    effectiveOnboardingOptions.initialStep
  ]);

  // Backfill issue prefix for an existing company once companies are loaded.
  useEffect(() => {
    if (!effectiveOnboardingOpen || !createdCompanyId || createdCompanyPrefix) return;
    const company = companies.find((c) => c.id === createdCompanyId);
    if (company) setCreatedCompanyPrefix(company.issuePrefix);
  }, [effectiveOnboardingOpen, createdCompanyId, createdCompanyPrefix, companies]);

  // Resize textarea when step 3 is shown or description changes
  useEffect(() => {
    if (step === 3) autoResizeTextarea();
  }, [step, taskDescription, autoResizeTextarea]);

  const {
    data: adapterModels,
    error: adapterModelsError,
    isLoading: adapterModelsLoading,
    isFetching: adapterModelsFetching
  } = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.agents.adapterModels(createdCompanyId, adapterType)
      : ["agents", "none", "adapter-models", adapterType],
    queryFn: () => agentsApi.adapterModels(createdCompanyId!, adapterType),
    enabled:
      Boolean(createdCompanyId) &&
      effectiveOnboardingOpen &&
      step === 2 &&
      coworkerPhase === "configure"
  });
  const getCapabilities = useAdapterCapabilities();
  const adapterCaps = getCapabilities(adapterType);
  const isLocalAdapter = adapterCaps.supportsInstructionsBundle || adapterCaps.supportsSkills || adapterCaps.supportsLocalAgentJwt;

  // Build adapter grids dynamically from the UI registry + display metadata.
  // External/plugin adapters automatically appear with generic defaults.
  const { recommendedAdapters, moreAdapters } = useMemo(() => {
    const SYSTEM_ADAPTER_TYPES = new Set(["process", "http"]);
    const all = listUIAdapters()
      .filter((a) =>
        !SYSTEM_ADAPTER_TYPES.has(a.type) &&
        !disabledTypes.has(a.type) &&
        isVisualAdapterChoice(a.type)
      )
      .map((a) => ({ ...getAdapterDisplay(a.type), type: a.type }));

    return {
      recommendedAdapters: all.filter((a) => a.recommended),
      moreAdapters: all.filter((a) => !a.recommended),
    };
  }, [disabledTypes]);
  const COMMAND_PLACEHOLDERS: Record<string, string> = {
    claude_local: "claude",
    codex_local: "codex",
    gemini_local: "gemini",
    pi_local: "pi",
    cursor: "agent",
    opencode_local: "opencode",
  };
  const effectiveAdapterCommand =
    command.trim() ||
    (COMMAND_PLACEHOLDERS[adapterType] ?? adapterType.replace(/_local$/, ""));

  useEffect(() => {
    if (step !== 2) return;
    setAdapterEnvResult(null);
    setAdapterEnvError(null);
  }, [step, adapterType, model, command, args, url]);

  const selectedModel = (adapterModels ?? []).find((m) => m.id === model);
  const presetTemplate = useMemo(
    () => COWORKER_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? null,
    [selectedTemplateId],
  );
  const isCustomRole = selectedTemplateId === CUSTOM_ROLE_TEMPLATE_ID;
  const connectorDirectoryFiltered = useMemo(() => {
    if (!isCustomRole || coworkerPhase !== "configure") return TOOL_DIRECTORY;
    return filterToolDirectoryBySearch(connectorSearch);
  }, [isCustomRole, coworkerPhase, connectorSearch]);
  const hasAnthropicApiKeyOverrideCheck =
    adapterEnvResult?.checks.some(
      (check) =>
        check.code === "claude_anthropic_api_key_overrides_subscription"
    ) ?? false;
  const shouldSuggestUnsetAnthropicApiKey =
    adapterType === "claude_local" &&
    adapterEnvResult?.status === "fail" &&
    hasAnthropicApiKeyOverrideCheck;
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return (adapterModels ?? []).filter((entry) => {
      if (!query) return true;
      const provider = extractProviderIdWithFallback(entry.id, "");
      return (
        entry.id.toLowerCase().includes(query) ||
        entry.label.toLowerCase().includes(query) ||
        provider.toLowerCase().includes(query)
      );
    });
  }, [adapterModels, modelSearch]);
  const groupedModels = useMemo(() => {
    if (adapterType !== "opencode_local") {
      return [
        {
          provider: "models",
          entries: [...filteredModels].sort((a, b) => a.id.localeCompare(b.id))
        }
      ];
    }
    const groups = new Map<string, Array<{ id: string; label: string }>>();
    for (const entry of filteredModels) {
      const provider = extractProviderIdWithFallback(entry.id);
      const bucket = groups.get(provider) ?? [];
      bucket.push(entry);
      groups.set(provider, bucket);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, entries]) => ({
        provider,
        entries: [...entries].sort((a, b) => a.id.localeCompare(b.id))
      }));
  }, [filteredModels, adapterType]);

  useEffect(() => {
    if (selectedTemplateId === CUSTOM_ROLE_TEMPLATE_ID) {
      setAgentName("Custom coworker");
      setAdapterType("claude_local");
      setModel("");
      setCustomRoleTitle("");
      setCustomRoleCapabilities("");
      setConnectorSearch("");
      setTaskTitle("Kick off your custom coworker");
      setTaskDescription(
        [
          "Align on scope, connectors, and first deliverables for this role.",
          "",
          "- Confirm toolchain selections from onboarding",
          "- List 2–3 concrete outcomes for the first week",
        ].join("\n"),
      );
      return;
    }
    const template = COWORKER_TEMPLATES.find((t) => t.id === selectedTemplateId);
    if (!template) return;
    setAgentName(template.defaultName);
    setAdapterType(template.adapterType);
    if (template.adapterType === "codex_local") {
      setModel(DEFAULT_CODEX_LOCAL_MODEL);
    } else if (template.adapterType === "gemini_local") {
      setModel(DEFAULT_GEMINI_LOCAL_MODEL);
    } else if (template.adapterType === "cursor") {
      setModel(DEFAULT_CURSOR_LOCAL_MODEL);
    } else {
      setModel("");
    }
    setTaskTitle(template.launchTaskTitle);
    setTaskDescription(template.launchTaskDescription);
  }, [selectedTemplateId]);

  const companyLearningContextBlock = useMemo(() => {
    const lines: string[] = [];
    const website = companyWebsiteUrl.trim();
    const attachment = companyLearningAttachmentText.trim();
    if (website) lines.push(`Website: ${website}`);
    if (attachment) {
      const label = companyLearningAttachmentName
        ? `Attachment (${companyLearningAttachmentName})`
        : "Attachment";
      lines.push(`${label}:\n${attachment}`);
    }
    if (lines.length === 0) return "";
    return `\n\n## Company Context\n${lines.join("\n\n")}`;
  }, [companyWebsiteUrl, companyLearningAttachmentName, companyLearningAttachmentText]);

  const toolDirectorySummaryLines = useMemo(() => {
    const lines: string[] = [];
    for (const cat of TOOL_DIRECTORY) {
      const pick = toolPicks[cat.id];
      if (!pick) continue;
      if (String(pick).startsWith("later_")) {
        lines.push(`${cat.label}: decide in dashboard`);
        continue;
      }
      const label = cat.options.find((o) => o.id === pick)?.label ?? pick;
      lines.push(`${cat.label}: ${label}`);
    }
    return lines;
  }, [toolPicks]);

  function reset() {
    setStep(1);
    setLoading(false);
    setError(null);
    setCompanyName("");
    setCompanyDescription("");
    setCompanyWebsiteUrl("");
    setCompanyLearningAttachmentName(null);
    setCompanyLearningAttachmentText("");
    setCoworkerPhase("choose");
    setToolPicks({
      code_hosting: "later_code",
      meetings: "later_meetings",
      work_tracking: "later_tracking",
      docs_wiki: "later_docs",
    });
    setConnectorSearch("");
    setCustomRoleTitle("");
    setCustomRoleCapabilities("");
    setSelectedTemplateId(COWORKER_TEMPLATES[0]!.id);
    setAgentName(COWORKER_TEMPLATES[0]!.defaultName);
    setAdapterType(COWORKER_TEMPLATES[0]!.adapterType);
    setModel("");
    setCommand("");
    setArgs("");
    setUrl("");
    setAdapterEnvResult(null);
    setAdapterEnvError(null);
    setAdapterEnvLoading(false);
    setForceUnsetAnthropicApiKey(false);
    setUnsetAnthropicLoading(false);
    setTaskTitle("Hire your first engineer and create a hiring plan");
    setTaskDescription(DEFAULT_TASK_DESCRIPTION);
    setSkipInitialTask(false);
    setCreatedCompanyId(null);
    setCreatedCompanyPrefix(null);
    setCreatedCompanyGoalId(null);
    setCreatedAgentId(null);
    setCreatedProjectId(null);
    setCreatedIssueRef(null);
  }

  function handleClose() {
    reset();
    closeOnboarding();
  }

  function buildAdapterConfig(): Record<string, unknown> {
    const adapter = getUIAdapter(adapterType);
    const config = adapter.buildAdapterConfig({
      ...defaultCreateValues,
      adapterType,
      model:
        adapterType === "codex_local"
          ? model || DEFAULT_CODEX_LOCAL_MODEL
          : adapterType === "gemini_local"
            ? model || DEFAULT_GEMINI_LOCAL_MODEL
          : adapterType === "cursor"
          ? model || DEFAULT_CURSOR_LOCAL_MODEL
          : model,
      command,
      args,
      url,
      dangerouslySkipPermissions:
        adapterType === "claude_local" || adapterType === "opencode_local",
      dangerouslyBypassSandbox:
        adapterType === "codex_local"
          ? DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX
          : defaultCreateValues.dangerouslyBypassSandbox
    });
    if (adapterType === "claude_local" && forceUnsetAnthropicApiKey) {
      const env =
        typeof config.env === "object" &&
        config.env !== null &&
        !Array.isArray(config.env)
          ? { ...(config.env as Record<string, unknown>) }
          : {};
      env.ANTHROPIC_API_KEY = { type: "plain", value: "" };
      config.env = env;
    }
    return config;
  }

  async function runAdapterEnvironmentTest(
    adapterConfigOverride?: Record<string, unknown>
  ): Promise<AdapterEnvironmentTestResult | null> {
    if (!createdCompanyId) {
      setAdapterEnvError(
        "Create or select a company before testing adapter environment."
      );
      return null;
    }
    setAdapterEnvLoading(true);
    setAdapterEnvError(null);
    try {
      const result = await agentsApi.testEnvironment(
        createdCompanyId,
        adapterType,
        {
          adapterConfig: adapterConfigOverride ?? buildAdapterConfig()
        }
      );
      setAdapterEnvResult(result);
      return result;
    } catch (err) {
      setAdapterEnvError(
        err instanceof Error ? err.message : "Adapter environment test failed"
      );
      return null;
    } finally {
      setAdapterEnvLoading(false);
    }
  }

  async function handleCompanyLearningAttachment(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompanyLearningAttachmentName(file.name);
    try {
      const text = await file.text();
      const normalized = text.trim().slice(0, 12_000);
      setCompanyLearningAttachmentText(normalized);
    } catch {
      setCompanyLearningAttachmentText("");
      setError("Couldn't read that attachment. Try a text-based file.");
    }
  }

  async function handleStep1Next() {
    setLoading(true);
    setError(null);
    try {
      const trimmedDescription = companyDescription.trim();
      const trimmedWebsite = companyWebsiteUrl.trim();
      const composedDescription = [
        trimmedDescription,
        trimmedWebsite ? `Website: ${trimmedWebsite}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
        .trim();
      const company = await companiesApi.create({
        name: companyName.trim(),
        description: composedDescription || null,
      });
      setCreatedCompanyId(company.id);
      setCreatedCompanyPrefix(company.issuePrefix);
      setSelectedCompanyId(company.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      setCreatedCompanyGoalId(null);
      setCoworkerPhase("choose");
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create company");
    } finally {
      setLoading(false);
    }
  }

  async function handleStep2Next() {
    if (!createdCompanyId || coworkerPhase !== "configure") return;
    setLoading(true);
    setError(null);
    try {
      if (!toolDirectorySelectionsComplete(toolPicks)) {
        setError(
          "Choose team chat and email tools so we know which ecosystem to connect later."
        );
        setLoading(false);
        return;
      }

      if (adapterType === "opencode_local") {
        const selectedModelId = model.trim();
        if (!selectedModelId) {
          setError(
            "OpenCode requires an explicit model in provider/model format."
          );
          return;
        }
        if (adapterModelsError) {
          setError(
            adapterModelsError instanceof Error
              ? adapterModelsError.message
              : "Failed to load OpenCode models."
          );
          return;
        }
        if (adapterModelsLoading || adapterModelsFetching) {
          setError(
            "OpenCode models are still loading. Please wait and try again."
          );
          return;
        }
        const discoveredModels = adapterModels ?? [];
        if (!discoveredModels.some((entry) => entry.id === selectedModelId)) {
          setError(
            discoveredModels.length === 0
              ? "No OpenCode models discovered. Run `opencode models` and authenticate providers."
              : `Configured OpenCode model is unavailable: ${selectedModelId}`
          );
          return;
        }
      }

      if (isLocalAdapter) {
        const result = adapterEnvResult ?? (await runAdapterEnvironmentTest());
        if (!result) return;
      }

      if (isCustomRole) {
        if (!customRoleTitle.trim()) {
          setError("Add a role title for your custom coworker (e.g. Growth Engineer).");
          setLoading(false);
          return;
        }
      } else if (!presetTemplate) {
        setError("Choose a valid coworker template.");
        setLoading(false);
        return;
      }

      const hireRole = isCustomRole ? "general" : presetTemplate!.role;
      const hireTitle = isCustomRole
        ? customRoleTitle.trim()
        : presetTemplate!.title;
      const hireCapabilities = isCustomRole
        ? customRoleCapabilities.trim() ||
          "Custom coworker; refine responsibilities after launch."
        : presetTemplate!.capabilities;

      const hire = await agentsApi.hire(createdCompanyId, {
        name: agentName.trim(),
        role: hireRole,
        title: hireTitle,
        capabilities: hireCapabilities,
        adapterType,
        adapterConfig: buildAdapterConfig(),
        runtimeConfig: buildNewAgentRuntimeConfig(),
        metadata: {
          onboardingTemplateId: isCustomRole
            ? CUSTOM_ROLE_TEMPLATE_ID
            : presetTemplate!.id,
          onboardingCustomRole: isCustomRole,
          ...(isCustomRole && customRoleTitle.trim()
            ? { onboardingCustomRoleTitle: customRoleTitle.trim() }
            : {}),
          onboardingToolDirectory: serializeOnboardingToolDirectory(toolPicks),
          onboardingToolDirectoryNote:
            "Selections are saved for your workspace; OAuth and API connections happen from the dashboard.",
        },
      });
      if (hire.approval) {
        await approvalsApi.approve(
          hire.approval.id,
          "Approved during onboarding first-agent setup."
        );
        queryClient.invalidateQueries({
          queryKey: queryKeys.approvals.list(createdCompanyId)
        });
      }
      const agent = hire.agent;
      setCreatedAgentId(agent.id);
      queryClient.invalidateQueries({
        queryKey: queryKeys.agents.list(createdCompanyId)
      });
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnsetAnthropicApiKey() {
    if (!createdCompanyId || unsetAnthropicLoading) return;
    setUnsetAnthropicLoading(true);
    setError(null);
    setAdapterEnvError(null);
    setForceUnsetAnthropicApiKey(true);

    const configWithUnset = (() => {
      const config = buildAdapterConfig();
      const env =
        typeof config.env === "object" &&
        config.env !== null &&
        !Array.isArray(config.env)
          ? { ...(config.env as Record<string, unknown>) }
          : {};
      env.ANTHROPIC_API_KEY = { type: "plain", value: "" };
      config.env = env;
      return config;
    })();

    try {
      if (createdAgentId) {
        await agentsApi.update(
          createdAgentId,
          { adapterConfig: configWithUnset },
          createdCompanyId
        );
        queryClient.invalidateQueries({
          queryKey: queryKeys.agents.list(createdCompanyId)
        });
      }

      const result = await runAdapterEnvironmentTest(configWithUnset);
      if (result?.status === "fail") {
        setError(
          "Retried with ANTHROPIC_API_KEY unset in adapter config, but the environment test is still failing."
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to unset ANTHROPIC_API_KEY and retry."
      );
    } finally {
      setUnsetAnthropicLoading(false);
    }
  }

  async function handleLaunch() {
    if (!createdCompanyId || !createdAgentId) return;
    setLoading(true);
    setError(null);
    try {
      let goalId = createdCompanyGoalId;
      if (!goalId) {
        const goals = await goalsApi.list(createdCompanyId);
        goalId = selectDefaultCompanyGoalId(goals);
        setCreatedCompanyGoalId(goalId);
      }

      let projectId = createdProjectId;
      if (!projectId) {
        const project = await projectsApi.create(
          createdCompanyId,
          buildOnboardingProjectPayload(goalId)
        );
        projectId = project.id;
        setCreatedProjectId(projectId);
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.list(createdCompanyId)
        });
      }

      let issueRef = createdIssueRef;
      if (!skipInitialTask && !issueRef) {
        const finalTaskDescription = `${taskDescription}${companyLearningContextBlock}`.trim();
        const issue = await issuesApi.create(
          createdCompanyId,
          buildOnboardingIssuePayload({
            title: taskTitle,
            description: finalTaskDescription,
            assigneeAgentId: createdAgentId,
            projectId,
            goalId
          })
        );
        issueRef = issue.identifier ?? issue.id;
        setCreatedIssueRef(issueRef);
        queryClient.invalidateQueries({
          queryKey: queryKeys.issues.list(createdCompanyId)
        });
      }

      setSelectedCompanyId(createdCompanyId);
      reset();
      closeOnboarding();
      navigate(
        createdCompanyPrefix
          ? issueRef
            ? `/${createdCompanyPrefix}/issues/${issueRef}`
            : `/${createdCompanyPrefix}/dashboard`
          : issueRef
            ? `/issues/${issueRef}`
            : "/"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (step === 1 && companyName.trim()) void handleStep1Next();
      else if (step === 2 && coworkerPhase === "choose")
        setCoworkerPhase("configure");
      else if (
        step === 2 &&
        coworkerPhase === "configure" &&
        agentName.trim() &&
        (!isCustomRole || customRoleTitle.trim()) &&
        toolDirectorySelectionsComplete(toolPicks)
      )
        void handleStep2Next();
      else if (
        step === 3 &&
        createdCompanyId &&
        createdAgentId &&
        (skipInitialTask || taskTitle.trim())
      )
        void handleLaunch();
    }
  }

  if (!effectiveOnboardingOpen) return null;

  return (
    <Dialog
      open={effectiveOnboardingOpen}
      onOpenChange={(open) => {
        if (!open) {
          setRouteDismissed(true);
          handleClose();
        }
      }}
    >
      <DialogPortal>
        {/* Plain div instead of DialogOverlay — Radix's overlay wraps in
            RemoveScroll which blocks wheel events on our custom (non-DialogContent)
            scroll container. A plain div preserves the background without scroll-locking. */}
        <div className="fixed inset-0 z-50 bg-background" />
        <div className="fixed inset-0 z-50 flex" onKeyDown={handleKeyDown}>
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 left-4 z-10 rounded-sm p-1.5 text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </button>

          {/* Left half — form */}
          <div
            className={cn(
              "w-full flex flex-col overflow-y-auto transition-[width] duration-500 ease-in-out",
              step === 1 ? "md:w-1/2" : "md:w-full"
            )}
          >
            <div
              className={cn(
                "w-full mx-auto my-auto px-8 py-12 shrink-0 transition-[max-width] duration-200",
                step === 2 || step === 3 ? "max-w-xl" : "max-w-md"
              )}
            >
              {/* Progress tabs */}
              <div className="flex items-center gap-0 mb-8 border-b border-border">
                {(
                  [
                    { step: 1 as Step, label: "Company", icon: Building2 },
                    { step: 2 as Step, label: "Coworker", icon: Bot },
                    { step: 3 as Step, label: "Launch", icon: Rocket },
                  ] as const
                ).map(({ step: s, label, icon: Icon }) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStep(s)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors cursor-pointer",
                      s === step
                        ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground/70 hover:border-border"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Step content */}
              {step === 1 && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Name your company</h3>
                      <p className="text-xs text-muted-foreground">
                        This is the organization your agents will work for.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 group">
                    <label
                      className={cn(
                        "text-xs mb-1 block transition-colors",
                        companyName.trim()
                          ? "text-foreground"
                          : "text-muted-foreground group-focus-within:text-foreground"
                      )}
                    >
                      Company name
                    </label>
                    <input
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                      placeholder="Acme Corp"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="group">
                    <label
                      className={cn(
                        "text-xs mb-1 block transition-colors",
                        companyDescription.trim()
                          ? "text-foreground"
                          : "text-muted-foreground group-focus-within:text-foreground"
                      )}
                    >
                      Description (optional)
                    </label>
                    <textarea
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 resize-none min-h-[60px]"
                      placeholder="What does this company do?"
                      value={companyDescription}
                      onChange={(e) => setCompanyDescription(e.target.value)}
                    />
                  </div>
                  <div className="group">
                    <label
                      className={cn(
                        "text-xs mb-1 block transition-colors",
                        companyWebsiteUrl.trim()
                          ? "text-foreground"
                          : "text-muted-foreground group-focus-within:text-foreground"
                      )}
                    >
                      Website URL (optional)
                    </label>
                    <input
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                      placeholder="https://example.com"
                      value={companyWebsiteUrl}
                      onChange={(e) => setCompanyWebsiteUrl(e.target.value)}
                    />
                  </div>
                  <div className="group space-y-2">
                    <label className="text-xs text-muted-foreground block">
                      Attachment to learn from (optional)
                    </label>
                    <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 cursor-pointer transition-colors">
                      <Upload className="h-3.5 w-3.5" />
                      <span>
                        {companyLearningAttachmentName
                          ? `Attached: ${companyLearningAttachmentName}`
                          : "Upload text/markdown/json file"}
                      </span>
                      <input
                        type="file"
                        className="hidden"
                        accept=".txt,.md,.markdown,.json,.csv,.yaml,.yml"
                        onChange={handleCompanyLearningAttachment}
                      />
                    </label>
                  </div>
                </div>
              )}

              {step === 2 && coworkerPhase === "choose" && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <Bot className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Choose a coworker</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Real teammates live across chat, email, tickets, docs, and your coding tools.
                        Start by picking who you are hiring—next you will map the apps your company uses (saved now; integrations connect from the dashboard).
                      </p>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-2 block">
                      Roles
                    </label>
                    <div className="grid grid-cols-1 gap-2">
                      {COWORKER_TEMPLATES.map((template) => {
                        const selected = selectedTemplateId === template.id;
                        const Icon = template.RoleIcon;
                        return (
                          <button
                            key={template.id}
                            type="button"
                            className={cn(
                              "rounded-md border p-3 text-left transition-colors",
                              selected
                                ? "border-foreground bg-accent"
                                : "border-border hover:bg-accent/50",
                            )}
                            onClick={() => setSelectedTemplateId(template.id)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 gap-3">
                                <CoworkerRoleIconFrame selected={selected}>
                                  <Icon
                                    className="h-5 w-5 text-muted-foreground"
                                    aria-hidden
                                  />
                                </CoworkerRoleIconFrame>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">{template.title}</p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                                    {template.capabilities}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-[11px] text-muted-foreground line-through">
                                  ${template.featuredPriceUsd}.00/mo
                                </p>
                                <p className="text-sm font-semibold">
                                  ${template.currentPriceUsd}.00
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className={cn(
                          "rounded-md border p-3 text-left transition-colors",
                          selectedTemplateId === CUSTOM_ROLE_TEMPLATE_ID
                            ? "border-foreground bg-accent"
                            : "border-border hover:bg-accent/50",
                        )}
                        onClick={() => setSelectedTemplateId(CUSTOM_ROLE_TEMPLATE_ID)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 gap-3">
                            <CoworkerRoleIconFrame
                              selected={
                                selectedTemplateId === CUSTOM_ROLE_TEMPLATE_ID
                              }
                            >
                              <UserCog
                                className="h-5 w-5 text-muted-foreground"
                                aria-hidden
                              />
                            </CoworkerRoleIconFrame>
                            <div className="min-w-0">
                              <p className="text-sm font-medium">Custom role</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                                Define your own title and responsibilities. Next step opens the full connector directory first so you can match how your team actually works.
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[11px] text-muted-foreground line-through">
                              $39.00/mo
                            </p>
                            <p className="text-sm font-semibold">$0.00</p>
                          </div>
                        </div>
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Early access: coworker seats are free. Connectors are selected next; OAuth happens after launch.
                    </p>
                  </div>
                </div>
              )}

              {step === 2 && coworkerPhase === "configure" && (
                <div className="space-y-5">
                  <div className="flex items-start gap-3 mb-1">
                    <button
                      type="button"
                      className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => setCoworkerPhase("choose")}
                    >
                      ← Change role
                    </button>
                  </div>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <Bot className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">
                        {isCustomRole
                          ? "Custom role: connector directory"
                          : `Set up ${presetTemplate?.title ?? "coworker"}`}
                      </h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {isCustomRole ? (
                          <>
                            Start from the connector directory below—search across apps your company uses.
                            Selections are saved now; OAuth and API tokens are wired up after launch.
                            Then name the coworker and describe the role. The coding runtime is the adapter at the bottom.
                          </>
                        ) : (
                          <>
                            Map the apps this role will use day to day. We only record your choices here—like a real rollout, email/chat are required; other tools can be deferred.
                            The coding environment is the agent adapter below (CLI / IDE bridge).
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  {!isCustomRole && presetTemplate ? (
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        Coworker name
                      </label>
                      <input
                        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                        placeholder={presetTemplate.defaultName}
                        value={agentName}
                        onChange={(e) => setAgentName(e.target.value)}
                        autoFocus
                      />
                    </div>
                  ) : null}

                  <div className="rounded-md border border-border p-3 space-y-3">
                    <div className="flex flex-col gap-0.5">
                      <p className="text-xs font-medium">
                        {isCustomRole ? "Connector directory" : "Your team's toolchain"}
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {isCustomRole
                          ? "Browse or search by name. Pick one option per category—same catalog presets use, shown here first for custom roles."
                          : "Pick one option per category. Optional rows default to \"decide later\" so onboarding stays lightweight."}
                      </p>
                    </div>
                    {isCustomRole ? (
                      <div className="relative">
                        <Search
                          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                          aria-hidden
                        />
                        <input
                          className="w-full rounded-md border border-border bg-transparent py-2 pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                          placeholder="Search connectors (e.g. Slack, Jira, GitHub)…"
                          value={connectorSearch}
                          onChange={(e) => setConnectorSearch(e.target.value)}
                          autoFocus={isCustomRole}
                        />
                      </div>
                    ) : null}
                    {isCustomRole &&
                    connectorDirectoryFiltered.length === 0 &&
                    connectorSearch.trim() ? (
                      <p className="text-[11px] text-muted-foreground">
                        No connectors match &quot;{connectorSearch.trim()}&quot;. Try another keyword or clear search to see the full directory.
                      </p>
                    ) : null}
                    <div className="space-y-4">
                      {connectorDirectoryFiltered.map((cat) => (
                        <div key={cat.id} className="space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="text-xs font-medium">{cat.label}</span>
                              {cat.required ? (
                                <span className="text-[10px] text-muted-foreground ml-1.5">
                                  (required)
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{cat.blurb}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {cat.options.map((opt) => {
                              const picked = toolPicks[cat.id] === opt.id;
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  className={cn(
                                    "flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors",
                                    picked
                                      ? "border-foreground bg-accent"
                                      : "border-border hover:bg-accent/40"
                                  )}
                                  onClick={() =>
                                    setToolPicks((prev) => ({
                                      ...prev,
                                      [cat.id]: opt.id,
                                    }))
                                  }
                                >
                                  <ToolBrandIcon icon={opt.icon} />
                                  <span className="leading-snug">{opt.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3 mt-1">
                      {CONNECTORS_COMING_LATER_BLURB}
                    </p>
                  </div>

                  {isCustomRole ? (
                    <div className="space-y-4 rounded-md border border-border p-3">
                      <p className="text-xs font-medium">Coworker profile</p>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Display name
                        </label>
                        <input
                          className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                          placeholder="Custom coworker"
                          value={agentName}
                          onChange={(e) => setAgentName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Role title <span className="text-destructive">*</span>
                        </label>
                        <input
                          className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                          placeholder="e.g. Partner Engineer, RevOps Analyst"
                          value={customRoleTitle}
                          onChange={(e) => setCustomRoleTitle(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Responsibilities (optional)
                        </label>
                        <textarea
                          className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 resize-none min-h-[88px]"
                          placeholder="What they own day to day—products, stakeholders, and outcomes."
                          value={customRoleCapabilities}
                          onChange={(e) => setCustomRoleCapabilities(e.target.value)}
                        />
                      </div>
                    </div>
                  ) : null}

                  {/* Adapter type radio cards */}
                  <div>
                    <label className="text-xs text-muted-foreground mb-2 block">
                      Adapter type
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {recommendedAdapters.map((opt) => (
                        <button
                          key={opt.type}
                          className={cn(
                            "flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs transition-colors relative",
                            adapterType === opt.type
                              ? "border-foreground bg-accent"
                              : "border-border hover:bg-accent/50"
                          )}
                          onClick={() => {
                            const nextType = opt.type;
                            setAdapterType(nextType);
                            if (nextType === "codex_local" && !model) {
                              setModel(DEFAULT_CODEX_LOCAL_MODEL);
                            }
                            if (nextType !== "codex_local") {
                              setModel("");
                            }
                          }}
                        >
                          {opt.recommended && (
                            <span className="absolute -top-1.5 right-1.5 bg-green-500 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full leading-none">
                              Recommended
                            </span>
                          )}
                          <opt.icon className="h-4 w-4" />
                          <span className="font-medium">{opt.label}</span>
                          <span className="text-muted-foreground text-[10px]">
                            {opt.description}
                          </span>
                        </button>
                      ))}
                    </div>

                    <button
                      className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowMoreAdapters((v) => !v)}
                    >
                      <ChevronDown
                        className={cn(
                          "h-3 w-3 transition-transform",
                          showMoreAdapters ? "rotate-0" : "-rotate-90"
                        )}
                      />
                      More Agent Adapter Types
                    </button>

                    {showMoreAdapters && (
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {moreAdapters.map((opt) => (
                           <button
                             key={opt.type}
                             disabled={!!opt.comingSoon}
                             className={cn(
                               "flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs transition-colors relative",
                               opt.comingSoon
                                 ? "border-border opacity-40 cursor-not-allowed"
                                 : adapterType === opt.type
                                 ? "border-foreground bg-accent"
                                 : "border-border hover:bg-accent/50"
                             )}
                             onClick={() => {
                               if (opt.comingSoon) return;
                               const nextType = opt.type;
                              setAdapterType(nextType);
                              if (nextType === "gemini_local" && !model) {
                                setModel(DEFAULT_GEMINI_LOCAL_MODEL);
                                return;
                              }
                              if (nextType === "cursor" && !model) {
                                setModel(DEFAULT_CURSOR_LOCAL_MODEL);
                                return;
                              }
                              if (nextType === "opencode_local") {
                                if (!model.includes("/")) {
                                  setModel("");
                                }
                                return;
                              }
                              setModel("");
                            }}
                          >
                            <opt.icon className="h-4 w-4" />
                            <span className="font-medium">{opt.label}</span>
                            <span className="text-muted-foreground text-[10px]">
                              {opt.comingSoon
                                ? opt.disabledLabel ?? "Coming soon"
                                : opt.description}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Conditional adapter fields */}
                  {isLocalAdapter && (
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Model
                        </label>
                        <Popover
                          open={modelOpen}
                          onOpenChange={(next) => {
                            setModelOpen(next);
                            if (!next) setModelSearch("");
                          }}
                        >
                          <PopoverTrigger asChild>
                            <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-accent/50 transition-colors w-full justify-between">
                              <span
                                className={cn(
                                  !model && "text-muted-foreground"
                                )}
                              >
                                {selectedModel
                                  ? selectedModel.label
                                  : model ||
                                    (adapterType === "opencode_local"
                                      ? "Select model (required)"
                                      : "Default")}
                              </span>
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[var(--radix-popover-trigger-width)] p-1"
                            align="start"
                          >
                            <input
                              className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border mb-1 placeholder:text-muted-foreground/50"
                              placeholder="Search models..."
                              value={modelSearch}
                              onChange={(e) => setModelSearch(e.target.value)}
                              autoFocus
                            />
                            {adapterType !== "opencode_local" && (
                              <button
                                className={cn(
                                  "flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent/50",
                                  !model && "bg-accent"
                                )}
                                onClick={() => {
                                  setModel("");
                                  setModelOpen(false);
                                }}
                              >
                                Default
                              </button>
                            )}
                            <div className="max-h-[240px] overflow-y-auto">
                              {groupedModels.map((group) => (
                                <div
                                  key={group.provider}
                                  className="mb-1 last:mb-0"
                                >
                                  {adapterType === "opencode_local" && (
                                    <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                      {group.provider} ({group.entries.length})
                                    </div>
                                  )}
                                  {group.entries.map((m) => (
                                    <button
                                      key={m.id}
                                      className={cn(
                                        "flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-accent/50",
                                        m.id === model && "bg-accent"
                                      )}
                                      onClick={() => {
                                        setModel(m.id);
                                        setModelOpen(false);
                                      }}
                                    >
                                      <span
                                        className="block w-full text-left truncate"
                                        title={m.id}
                                      >
                                        {adapterType === "opencode_local"
                                          ? extractModelName(m.id)
                                          : m.label}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              ))}
                            </div>
                            {filteredModels.length === 0 && (
                              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                                No models discovered.
                              </p>
                            )}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  )}

                  {isLocalAdapter && (
                    <div className="space-y-2 rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium">
                            Adapter environment check
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Runs a live probe that asks the adapter CLI to
                            respond with hello.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs"
                          disabled={adapterEnvLoading}
                          onClick={() => void runAdapterEnvironmentTest()}
                        >
                          {adapterEnvLoading ? "Testing..." : "Test now"}
                        </Button>
                      </div>

                      {adapterEnvError && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
                          {adapterEnvError}
                        </div>
                      )}

                      {adapterEnvResult &&
                      adapterEnvResult.status === "pass" ? (
                        <div className="flex items-center gap-2 rounded-md border border-green-300 dark:border-green-500/40 bg-green-50 dark:bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-300 animate-in fade-in slide-in-from-bottom-1 duration-300">
                          <Check className="h-3.5 w-3.5 shrink-0" />
                          <span className="font-medium">Passed</span>
                        </div>
                      ) : adapterEnvResult ? (
                        <AdapterEnvironmentResult result={adapterEnvResult} />
                      ) : null}

                      {shouldSuggestUnsetAnthropicApiKey && (
                        <div className="rounded-md border border-amber-300/60 bg-amber-50/40 px-2.5 py-2 space-y-2">
                          <p className="text-[11px] text-amber-900/90 leading-relaxed">
                            Claude failed while{" "}
                            <span className="font-mono">ANTHROPIC_API_KEY</span>{" "}
                            is set. You can clear it in this Admin adapter config
                            and retry the probe.
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            disabled={
                              adapterEnvLoading || unsetAnthropicLoading
                            }
                            onClick={() => void handleUnsetAnthropicApiKey()}
                          >
                            {unsetAnthropicLoading
                              ? "Retrying..."
                              : "Unset ANTHROPIC_API_KEY"}
                          </Button>
                        </div>
                      )}

                      {adapterEnvResult && adapterEnvResult.status === "fail" && (
                        <div className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-[11px] space-y-1.5">
                          <p className="font-medium">Manual debug</p>
                          <p className="text-muted-foreground font-mono break-all">
                            {adapterType === "cursor"
                              ? `${effectiveAdapterCommand} -p --mode ask --output-format json \"Respond with hello.\"`
                              : adapterType === "codex_local"
                              ? `${effectiveAdapterCommand} exec --json -`
                              : adapterType === "gemini_local"
                                ? `${effectiveAdapterCommand} --output-format json "Respond with hello."`
                              : adapterType === "opencode_local"
                                ? `${effectiveAdapterCommand} run --format json "Respond with hello."`
                              : `${effectiveAdapterCommand} --print - --output-format stream-json --verbose`}
                          </p>
                          <p className="text-muted-foreground">
                            Prompt:{" "}
                            <span className="font-mono">Respond with hello.</span>
                          </p>
                          {adapterType === "cursor" ||
                          adapterType === "codex_local" ||
                          adapterType === "gemini_local" ||
                          adapterType === "opencode_local" ? (
                            <p className="text-muted-foreground">
                              If auth fails, set{" "}
                              <span className="font-mono">
                                {adapterType === "cursor"
                                  ? "CURSOR_API_KEY"
                                  : adapterType === "gemini_local"
                                    ? "GEMINI_API_KEY"
                                    : "OPENAI_API_KEY"}
                              </span>{" "}
                              in env or run{" "}
                              <span className="font-mono">
                                {adapterType === "cursor"
                                  ? "agent login"
                                  : adapterType === "codex_local"
                                    ? "codex login"
                                    : adapterType === "gemini_local"
                                      ? "gemini auth"
                                      : "opencode auth login"}
                              </span>
                              .
                            </p>
                          ) : (
                            <p className="text-muted-foreground">
                              If login is required, run{" "}
                              <span className="font-mono">claude login</span>{" "}
                              and retry.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {(adapterType === "http" ||
                    adapterType === "openclaw_gateway") && (
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        {adapterType === "openclaw_gateway"
                          ? "Gateway URL"
                          : "Webhook URL"}
                      </label>
                      <input
                        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                        placeholder={
                          adapterType === "openclaw_gateway"
                            ? "ws://127.0.0.1:18789"
                            : "https://..."
                        }
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <Rocket className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Launch workspace</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Optionally assign a starter task, review what we captured, then open your board.
                        Launch wakes your coworker and{" "}
                        {skipInitialTask
                          ? "opens your dashboard."
                          : "creates the starter task."}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-md border border-border p-3 space-y-4">
                    <div className="flex items-center gap-2">
                      <ListTodo className="h-4 w-4 text-muted-foreground shrink-0" />
                      <p className="text-xs font-medium">Starter task (optional)</p>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-border bg-transparent"
                        checked={skipInitialTask}
                        onChange={(e) => setSkipInitialTask(e.target.checked)}
                      />
                      Skip task for now
                    </label>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        Task title
                      </label>
                      <input
                        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                        placeholder="e.g. Research competitor pricing"
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        autoFocus
                        disabled={skipInitialTask}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        Description (optional)
                      </label>
                      <textarea
                        ref={textareaRef}
                        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 resize-none min-h-[100px] max-h-[260px] overflow-y-auto"
                        placeholder="Add more detail about what the agent should do..."
                        value={taskDescription}
                        onChange={(e) => setTaskDescription(e.target.value)}
                        disabled={skipInitialTask}
                      />
                    </div>
                  </div>

                  <div className="border border-border divide-y divide-border">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {companyName}
                        </p>
                        <p className="text-xs text-muted-foreground">Company</p>
                      </div>
                      <Check className="h-4 w-4 text-green-500 shrink-0" />
                    </div>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {agentName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {getUIAdapter(adapterType).label}
                        </p>
                      </div>
                      <Check className="h-4 w-4 text-green-500 shrink-0" />
                    </div>
                    {toolDirectorySummaryLines.length > 0 && (
                      <div className="px-3 py-2.5 border-t border-border">
                        <p className="text-xs font-medium text-foreground mb-1">
                          Toolchain (saved selections)
                        </p>
                        <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
                          {toolDirectorySummaryLines.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <ListTodo className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {skipInitialTask ? "No starter task (skipped)" : taskTitle}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {skipInitialTask ? "Task setup skipped" : "Task"}
                        </p>
                      </div>
                      <Check className="h-4 w-4 text-green-500 shrink-0" />
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mt-3">
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )}

              {/* Footer navigation */}
              <div className="flex items-center justify-between mt-8">
                <div>
                  {step > 1 && step > (onboardingOptions.initialStep ?? 1) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (step === 2 && coworkerPhase === "configure") {
                          setCoworkerPhase("choose");
                          return;
                        }
                        setStep((step - 1) as Step);
                      }}
                      disabled={loading}
                    >
                      <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                      Back
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {step === 1 && (
                    <Button
                      size="sm"
                      disabled={!companyName.trim() || loading}
                      onClick={handleStep1Next}
                    >
                      {loading ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loading ? "Creating..." : "Next"}
                    </Button>
                  )}
                  {step === 2 && coworkerPhase === "choose" && (
                    <Button
                      size="sm"
                      disabled={loading}
                      onClick={() => setCoworkerPhase("configure")}
                    >
                      <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      Continue
                    </Button>
                  )}
                  {step === 2 && coworkerPhase === "configure" && (
                    <Button
                      size="sm"
                      disabled={
                        !agentName.trim() ||
                        (isCustomRole && !customRoleTitle.trim()) ||
                        !toolDirectorySelectionsComplete(toolPicks) ||
                        loading ||
                        adapterEnvLoading
                      }
                      onClick={() => void handleStep2Next()}
                    >
                      {loading ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loading ? "Creating..." : "Next"}
                    </Button>
                  )}
                  {step === 3 && (
                    <Button
                      size="sm"
                      disabled={
                        (!skipInitialTask && !taskTitle.trim()) ||
                        loading ||
                        !createdAgentId
                      }
                      onClick={() => void handleLaunch()}
                    >
                      {loading ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loading
                        ? "Launching..."
                        : skipInitialTask
                          ? "Launch Workspace"
                          : "Create Task & Launch"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right half — ASCII art (hidden on mobile) */}
          <div
            className={cn(
              "hidden md:block overflow-hidden bg-[#1d1d1d] transition-[width,opacity] duration-500 ease-in-out",
              step === 1 ? "w-1/2 opacity-100" : "w-0 opacity-0"
            )}
          >
            <AsciiArtAnimation />
          </div>
        </div>
      </DialogPortal>
    </Dialog>
  );
}

function AdapterEnvironmentResult({
  result
}: {
  result: AdapterEnvironmentTestResult;
}) {
  const statusLabel =
    result.status === "pass"
      ? "Passed"
      : result.status === "warn"
      ? "Warnings"
      : "Failed";
  const statusClass =
    result.status === "pass"
      ? "text-green-700 dark:text-green-300 border-green-300 dark:border-green-500/40 bg-green-50 dark:bg-green-500/10"
      : result.status === "warn"
      ? "text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10"
      : "text-red-700 dark:text-red-300 border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10";

  return (
    <div className={`rounded-md border px-2.5 py-2 text-[11px] ${statusClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{statusLabel}</span>
        <span className="opacity-80">
          {new Date(result.testedAt).toLocaleTimeString()}
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        {result.checks.map((check, idx) => (
          <div
            key={`${check.code}-${idx}`}
            className="leading-relaxed break-words"
          >
            <span className="font-medium uppercase tracking-wide opacity-80">
              {check.level}
            </span>
            <span className="mx-1 opacity-60">·</span>
            <span>{check.message}</span>
            {check.detail && (
              <span className="block opacity-75 break-all">
                ({check.detail})
              </span>
            )}
            {check.hint && (
              <span className="block opacity-90 break-words">
                Hint: {check.hint}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
