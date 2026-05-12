import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@/lib/router";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { useDashboardPersona } from "../context/DashboardPersonaContext";
import { agentsApi } from "../api/agents";
import { adaptersApi } from "../api/adapters";
import { queryKeys } from "@/lib/queryKeys";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listUIAdapters } from "../adapters";
import { isVisualAdapterChoice } from "../adapters/metadata";
import { getAdapterDisplay } from "../adapters/adapter-display-registry";
import { useDisabledAdaptersSync } from "../adapters/use-disabled-adapters";
import { CX } from "../lib/coworker-language";
import { COWORKER_ROLE_LABELS, HIRABLE_COWORKER_ROLES } from "@bench/shared";
import {
  buildAdminHirePrepIssueBody,
  resolveRoleConnectorRows,
  type HirableCoworkerRole,
} from "../lib/coworker-role-connector-hints";
import { ROLE_HIRE_CAPABILITY_SUMMARY } from "../lib/coworker-role-hire-request";

/**
 * Adapter types that are suitable for agent creation (excludes internal
 * system adapters like "process" and "http").
 */
const SYSTEM_ADAPTER_TYPES = new Set(["process", "http"]);

function isAgentAdapterType(type: string): boolean {
  return !SYSTEM_ADAPTER_TYPES.has(type);
}

export function NewAgentDialog() {
  const { newAgentOpen, closeNewAgent, openNewIssue } = useDialog();
  const { selectedCompanyId } = useCompany();
  const { companyPrefix } = useParams<{ companyPrefix: string }>();
  const { isAdminView } = useDashboardPersona();
  const navigate = useNavigate();
  const [showAdvancedCards, setShowAdvancedCards] = useState(false);
  const [adminHireRole, setAdminHireRole] = useState<HirableCoworkerRole | null>(null);
  const disabledTypes = useDisabledAdaptersSync();

  useEffect(() => {
    if (!newAgentOpen) return;
    setShowAdvancedCards(false);
    setAdminHireRole(null);
  }, [newAgentOpen]);

  // Fetch registered adapters from server (syncs disabled store + provides data)
  const { data: serverAdapters } = useQuery({
    queryKey: queryKeys.adapters.all,
    queryFn: () => adaptersApi.list(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && newAgentOpen,
  });

  const adminAgent = (agents ?? []).find((a) => a.role === "admin");

  const adapterGrid = useMemo(() => {
    const registered = listUIAdapters()
      .filter((a) =>
        isAgentAdapterType(a.type) &&
        !disabledTypes.has(a.type) &&
        isVisualAdapterChoice(a.type)
      );

    return registered
      .map((a) => {
        const display = getAdapterDisplay(a.type);
        return {
          value: a.type,
          label: display.label,
          desc: display.description,
          icon: display.icon,
          recommended: display.recommended,
          comingSoon: display.comingSoon,
          disabledLabel: display.disabledLabel,
        };
      })
      .sort((a, b) => {
        if (a.recommended && !b.recommended) return -1;
        if (!a.recommended && b.recommended) return 1;
        return a.label.localeCompare(b.label);
      });
  }, [disabledTypes, serverAdapters]);

  const connectorRows = adminHireRole ? resolveRoleConnectorRows(adminHireRole) : [];
  const adaptersHref = "/bench/settings/adapters";
  const connectorsHref = companyPrefix ? `/${companyPrefix}/connectors` : "/connectors";

  function handleAskAdmin() {
    closeNewAgent();
    openNewIssue({
      assigneeAgentId: adminAgent?.id,
      title: CX.requestHireTitle,
      description: CX.requestHireDescription,
    });
  }

  function handleAdminCreatePrepTicket() {
    if (!adminHireRole) return;
    const rows = resolveRoleConnectorRows(adminHireRole);
    const roleLabel = COWORKER_ROLE_LABELS[adminHireRole];
    closeNewAgent();
    openNewIssue({
      assigneeAgentId: adminAgent?.id,
      title: `Hire prep: ${roleLabel} coworker`,
      description: buildAdminHirePrepIssueBody({ role: adminHireRole, connectorRows: rows }),
    });
  }

  function handleAdvancedConfig() {
    setShowAdvancedCards(true);
  }

  function handleAdvancedAdapterPick(adapterType: string) {
    closeNewAgent();
    setShowAdvancedCards(false);
    navigate(`/agents/new?adapterType=${encodeURIComponent(adapterType)}`);
  }

  const dialogWidthClass =
    isAdminView && !showAdvancedCards ? "sm:max-w-lg md:max-w-xl" : "sm:max-w-md";

  return (
    <Dialog
      open={newAgentOpen}
      onOpenChange={(open) => {
        if (!open) {
          setShowAdvancedCards(false);
          setAdminHireRole(null);
          closeNewAgent();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn("p-0 gap-0 overflow-hidden", dialogWidthClass)}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <span className="text-sm text-muted-foreground">Add a new coworker</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => {
              setShowAdvancedCards(false);
              setAdminHireRole(null);
              closeNewAgent();
            }}
          >
            <span className="text-lg leading-none">&times;</span>
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {!showAdvancedCards ? (
            isAdminView ? (
              adminHireRole === null ? (
                <>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">Which role are you hiring for?</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Pick a Bench role, then review typical connectors and what already shows as connected in the
                      connector directory before you open a prep ticket or run advanced adapter setup.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[min(52vh,420px)] overflow-y-auto pr-1">
                    {HIRABLE_COWORKER_ROLES.map((role) => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => setAdminHireRole(role)}
                        className="rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/50"
                      >
                        <span className="font-medium text-foreground">{COWORKER_ROLE_LABELS[role]}</span>
                        <p className="text-[11px] text-muted-foreground mt-1 leading-snug line-clamp-3">
                          {ROLE_HIRE_CAPABILITY_SUMMARY[role]}
                        </p>
                      </button>
                    ))}
                  </div>
                  <div className="pt-1 border-t border-border space-y-2">
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                      onClick={handleAdvancedConfig}
                    >
                      I want advanced configuration myself
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setAdminHireRole(null)}
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Change role
                    </button>
                    <p className="text-sm font-medium text-foreground">
                      {COWORKER_ROLE_LABELS[adminHireRole]} — connectors to line up
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Typical integrations for this role in Bench guidance. &quot;Authorized&quot; follows the same
                      connected snapshot as the directory — verify credentials in Adapter manager before production hires.
                    </p>
                  </div>

                  <ul className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-sm max-h-[min(40vh,320px)] overflow-y-auto">
                    {connectorRows.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-start justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{row.name}</p>
                          <p className="text-[11px] text-muted-foreground font-mono truncate">{row.id}</p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            row.authorized
                              ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                              : "bg-amber-500/10 text-amber-900 dark:text-amber-100",
                          )}
                        >
                          {row.authorized ? (
                            <>
                              <CheckCircle2 className="h-3 w-3" />
                              Authorized
                            </>
                          ) : (
                            <>
                              <CircleDashed className="h-3 w-3" />
                              Needs setup
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-col gap-2">
                    <Button className="w-full" size="lg" onClick={handleAdminCreatePrepTicket}>
                      Create hire prep ticket
                    </Button>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link to={adaptersHref} onClick={() => closeNewAgent()}>
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                          Adapter manager
                        </Link>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link to={connectorsHref} onClick={() => closeNewAgent()}>
                          Connector directory
                        </Link>
                      </Button>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors text-center"
                      onClick={handleAdvancedConfig}
                    >
                      I want advanced configuration myself
                    </button>
                  </div>
                </>
              )
            ) : (
              <>
                <div className="text-center space-y-3">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent">
                    <Bot className="h-6 w-6 text-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    We recommend routing hires through your company <strong>Admin</strong> coworker.
                    They align reporting lines, permissions, and adapters. Managers use{" "}
                    <strong>Request coworker hire</strong> in the sidebar to open a structured ticket.
                  </p>
                </div>

                <Button className="w-full" size="lg" onClick={handleAskAdmin}>
                  <Bot className="h-4 w-4 mr-2" />
                  Ask Admin to hire a coworker
                </Button>

                <div className="text-center">
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                    onClick={handleAdvancedConfig}
                  >
                    I want advanced configuration myself
                  </button>
                </div>
              </>
            )
          ) : (
            <>
              <div className="space-y-2">
                <button
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowAdvancedCards(false)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <p className="text-sm text-muted-foreground">
                  Choose your adapter type for advanced setup.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {adapterGrid.map((opt) => (
                  <button
                    key={opt.value}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-md border border-border p-3 text-xs transition-colors hover:bg-accent/50 relative",
                      opt.comingSoon && "opacity-40 cursor-not-allowed",
                    )}
                    disabled={!!opt.comingSoon}
                    title={opt.comingSoon ? opt.disabledLabel : undefined}
                    onClick={() => {
                      if (!opt.comingSoon) handleAdvancedAdapterPick(opt.value);
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
                      {opt.desc}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
