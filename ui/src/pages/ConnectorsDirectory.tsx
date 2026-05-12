import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "@/lib/router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CONNECTOR_AUDIENCE_LABELS,
  CONNECTOR_AUDIENCE_ORDER,
  CONNECTOR_CATEGORY_LABELS,
  CONNECTOR_CATEGORY_ORDER,
  CONNECTOR_CATALOG,
  type ConnectorAudience,
  type ConnectorCategory,
  type ConnectorDefinition,
  type ConnectorTypicalImportance,
} from "@bench/shared";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { usePermissions } from "../hooks/usePermissions";
import { cn } from "../lib/utils";
import { queryKeys } from "../lib/queryKeys";
import { instanceSettingsApi } from "../api/instanceSettings";
import { connectorsApi } from "../api/connectors";
import { ApiError } from "../api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink, Eye, Loader2, Package, Plug, Search } from "lucide-react";
import StackIcon, { type IconName } from "tech-stack-icons";
import { useTheme } from "../context/ThemeContext";
import { isCatalogConnectorConnected } from "../lib/coworker-role-connector-hints";

type ConnectorStatusFilter = "all" | "connected" | "not_connected";
type ConnectorSortKey = "name" | "category" | "importance";

function rolloutPrioritySentence(v: ConnectorTypicalImportance): string {
  if (v === "required") {
    return "Most hiring flows assume this class of tool is wired early — delays here block realistic coworker tasks.";
  }
  if (v === "recommended") {
    return "Strongly advised for teams that rely on this surface day to day; you can phase it if policy demands.";
  }
  return "Optional — enable when the role clearly benefits; skip noisy vendors your company does not use.";
}

function importanceLabel(v: ConnectorTypicalImportance): string {
  if (v === "required") return "Rollout: high";
  if (v === "recommended") return "Rollout: medium";
  return "Rollout: low";
}

function importanceRank(v: ConnectorTypicalImportance): number {
  if (v === "required") return 0;
  if (v === "recommended") return 1;
  return 2;
}

function ConnectorBrandIcon({
  stackIcon,
  className,
}: {
  stackIcon?: string;
  className?: string;
}) {
  const { theme } = useTheme();
  if (!stackIcon) {
    return <Package className={cn("text-muted-foreground", className)} aria-hidden />;
  }
  return (
    <StackIcon
      name={stackIcon as IconName}
      variant={theme === "dark" ? "dark" : "light"}
      className={className}
    />
  );
}

interface ConnectorInstallerProps {
  /** Set when the user has a workspace selected (most pages). */
  companyId: string | null;
  /** True iff the instance has the connector runtime experimental flag on. */
  runtimeEnabled: boolean;
  /** True iff the caller is Owner / Admin in the selected workspace. */
  canWire: boolean;
  /** Optional path the OAuth callback should redirect to (defaults to current). */
  returnTo?: string;
  /** Provided by `ConnectorGuideSheet` so the installer knows the target. */
  connector?: ConnectorDefinition;
}

/**
 * Drives the "Install in this workspace" button on a connector's setup tab.
 *
 * Behavior:
 *   - Hidden entirely when `runtimeEnabled` is false (we don't want to dangle
 *     a button that's going to 403). The vendor-docs fallback is enough.
 *   - Renders a disabled button with explanatory help text when the caller
 *     can't act (no workspace selected, or insufficient capability).
 *   - On click: POSTs `/api/connectors/:id/install` and does a top-level
 *     navigation to the returned authorize URL. We don't open a new tab —
 *     vendors require the same browser session that holds Bench's session,
 *     and a new-tab redirect would lose `returnTo`.
 *   - Errors land in an inline message so the user can retry without
 *     leaving the sheet (vendor-side errors are surfaced separately by the
 *     callback page).
 */
function ConnectorInstaller(props: ConnectorInstallerProps) {
  const { connector, companyId, runtimeEnabled, canWire, returnTo } = props;
  const installMutation = useMutation({
    mutationFn: async () => {
      if (!connector) throw new Error("No connector selected");
      if (!companyId) throw new Error("Pick a workspace first");
      return connectorsApi.beginInstall(connector.id, {
        companyId,
        returnTo,
      });
    },
    onSuccess: (data) => {
      window.location.assign(data.authorizationUrl);
    },
  });

  if (!runtimeEnabled || !connector) {
    return null;
  }

  const blocker =
    !companyId
      ? "Select a workspace from the sidebar to enable install."
      : !canWire
        ? "Owners and Workspace Admins can wire connectors in this workspace."
        : null;

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        disabled={installMutation.isPending || blocker !== null}
        onClick={() => installMutation.mutate()}
      >
        {installMutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <Plug className="h-3.5 w-3.5 mr-1.5" />
        )}
        {installMutation.isPending ? "Redirecting…" : "Install in this workspace"}
      </Button>
      {blocker ? (
        <p className="text-[11px] text-muted-foreground">{blocker}</p>
      ) : null}
      {installMutation.isError ? (
        <p className="text-[11px] text-destructive">
          {installMutation.error instanceof ApiError
            ? installMutation.error.message
            : installMutation.error instanceof Error
              ? installMutation.error.message
              : "Install failed. Try again."}
        </p>
      ) : null}
    </div>
  );
}

function ConnectorGuideSheet({
  connector,
  open,
  onOpenChange,
  adaptersHref,
  initialTab,
  installerProps,
}: {
  connector: ConnectorDefinition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adaptersHref: string;
  initialTab: "overview" | "setup";
  installerProps: ConnectorInstallerProps;
}) {
  const [tab, setTab] = useState<"overview" | "setup">(initialTab);

  useEffect(() => {
    if (open && connector) setTab(initialTab);
  }, [open, connector?.id, initialTab]);

  if (!connector) return null;

  const auth =
    connector.authenticationNotes?.length ? (
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Authentication & access
        </p>
        <ul className="text-sm text-foreground list-disc pl-4 space-y-2">
          {connector.authenticationNotes.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
    ) : (
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Authentication & access
        </p>
        <p className="text-sm text-muted-foreground">
          Most connectors use OAuth or short-lived API tokens owned by IT. Follow vendor admin guides, enforce least
          privilege on every scope, and prefer workspace-level apps over personal tokens for production.
        </p>
      </div>
    );

  const tools = connector.sampleInvocableTools ?? [];
  const visibleTools = tools.slice(0, 8);
  const rest = tools.length - visibleTools.length;
  const connected = isCatalogConnectorConnected(connector.id);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto p-0 gap-0 flex flex-col">
        <div className="border-b border-border px-6 py-5 space-y-3 shrink-0 bg-muted/20">
          <SheetHeader className="space-y-2 text-left p-0">
            <SheetTitle className="flex items-start gap-3 pr-8 text-xl">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
                <ConnectorBrandIcon stackIcon={connector.stackIcon} className="h-8 w-8 shrink-0" />
              </span>
              <span className="leading-snug">{connector.name}</span>
            </SheetTitle>
            <SheetDescription className="text-sm leading-relaxed">{connector.description}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[11px] font-normal">
              {CONNECTOR_CATEGORY_LABELS[connector.category]}
            </Badge>
            <Badge variant="outline" className="text-[11px] font-normal">
              {importanceLabel(connector.typicalImportance)}
            </Badge>
            <Badge
              variant={connected ? "default" : "outline"}
              className={cn(
                "text-[11px] font-normal",
                connected && "bg-emerald-600 hover:bg-emerald-600 text-white border-transparent",
              )}
            >
              {connected ? "Connected" : "Not connected"}
            </Badge>
          </div>
        </div>

        <div className="flex-1 min-h-0 px-6 py-5 space-y-6">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "overview" | "setup")} className="gap-4">
            <TabsList variant="line" className="w-full justify-start rounded-none border-b border-border bg-transparent p-0 h-auto">
              <TabsTrigger
                value="overview"
                className="rounded-none flex-none border-0 data-[state=active]:shadow-none pb-2 px-3"
              >
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="setup"
                className="rounded-none flex-none border-0 data-[state=active]:shadow-none pb-2 px-3"
              >
                Setup &amp; process
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-5 mt-0">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Typical rollout priority
                </p>
                <p className="text-sm text-foreground leading-relaxed">{rolloutPrioritySentence(connector.typicalImportance)}</p>
              </div>

              {connector.setupOverview ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Operator overview</p>
                  <p className="text-sm text-foreground leading-relaxed">{connector.setupOverview}</p>
                </div>
              ) : null}

              {connector.rolloutNotes?.length ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Operator notes
                  </p>
                  <ul className="text-sm text-foreground list-disc pl-4 space-y-2">
                    {connector.rolloutNotes.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="rounded-lg border border-dashed border-border bg-muted/15 p-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Carry the process forward</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Open the vendor surface in another tab while you keep Bench open: run OAuth, paste redirect URLs, and
                  validate scopes against the checklist in <strong className="text-foreground">Setup &amp; process</strong>.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {connector.learnMoreUrl ? (
                    <Button size="sm" variant="default" asChild>
                      <a href={connector.learnMoreUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        Open vendor console / docs
                      </a>
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" asChild>
                    <Link to={adaptersHref} onClick={() => onOpenChange(false)}>
                      Configure in Adapter manager
                    </Link>
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="setup" className="space-y-5 mt-0 text-sm">
              {connector.prerequisites?.length ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Prerequisites
                  </p>
                  <ul className="text-muted-foreground list-disc pl-4 space-y-2">
                    {connector.prerequisites.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No catalog prerequisites listed — follow vendor IT guidance.</p>
              )}

              <div>{auth}</div>

              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Integration checklist
                </p>
                <ol className="text-foreground list-decimal pl-4 space-y-2">
                  {connector.setupSteps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Representative API / tool surface
                </p>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Example calls your automation might expose once wired — not a live entitlement matrix.
                </p>
                {visibleTools.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {visibleTools.map((t) => (
                      <code
                        key={t}
                        className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground"
                      >
                        {t}
                      </code>
                    ))}
                    {rest > 0 ? (
                      <span className="text-[11px] text-muted-foreground self-center px-1">+{rest} more</span>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">No sample tool list in catalog for this vendor yet.</p>
                )}
              </div>

              <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-2 border-t border-border">
                <ConnectorInstaller {...installerProps} connector={connector} />
                {connector.learnMoreUrl ? (
                  <Button size="sm" variant="secondary" asChild>
                    <a href={connector.learnMoreUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Continue in vendor docs
                    </a>
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" asChild>
                  <Link to={adaptersHref} onClick={() => onOpenChange(false)}>
                    Open Adapter manager
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(connector.id).catch(() => {});
                  }}
                >
                  Copy connector id
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function matchesAudience(connector: ConnectorDefinition, audience: ConnectorAudience | "all"): boolean {
  if (audience === "all") return true;
  const a = connector.audiences;
  if (!a?.length) return true;
  return a.includes(audience);
}

function matchesSearch(connector: ConnectorDefinition, needle: string): boolean {
  if (!needle) return true;
  const catLabel = CONNECTOR_CATEGORY_LABELS[connector.category].toLowerCase();
  const hay = [
    connector.name,
    connector.description,
    connector.id,
    catLabel,
    ...(connector.keywords ?? []),
    ...(connector.audiences?.map((x) => CONNECTOR_AUDIENCE_LABELS[x]) ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

function ConnectorTile({
  connector,
  onConnect,
  onViewDetails,
}: {
  connector: ConnectorDefinition;
  onConnect: (c: ConnectorDefinition) => void;
  onViewDetails: (c: ConnectorDefinition) => void;
}) {
  const anchor = `connector-${connector.id}`;
  const metaParts = [CONNECTOR_CATEGORY_LABELS[connector.category]];
  if (connector.audiences?.length) {
    metaParts.push(connector.audiences.map((a) => CONNECTOR_AUDIENCE_LABELS[a]).join(", "));
  }
  const connected = isCatalogConnectorConnected(connector.id);

  return (
    <div
      id={anchor}
      className={cn(
        "scroll-mt-28 flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40"
          aria-hidden
        >
          <ConnectorBrandIcon stackIcon={connector.stackIcon} className="h-6 w-6 shrink-0" />
        </div>
        {connected ? (
          <Badge className="shrink-0 text-[10px] bg-emerald-600 hover:bg-emerald-600">Connected</Badge>
        ) : null}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground leading-snug line-clamp-2">{connector.name}</h3>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-3 flex-1">{connector.description}</p>
      <p className="mt-2 text-[10px] text-muted-foreground line-clamp-2">{metaParts.join(" · ")}</p>
      <div className="mt-3">
        {connected ? (
          <Button type="button" variant="secondary" size="sm" className="w-full" onClick={() => onViewDetails(connector)}>
            <Eye className="h-3.5 w-3.5 mr-1.5" />
            View details
          </Button>
        ) : (
          <Button type="button" variant="default" size="sm" className="w-full" onClick={() => onConnect(connector)}>
            <Plug className="h-3.5 w-3.5 mr-1.5" />
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

export function ConnectorsDirectory() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { companyPrefix } = useParams<{ companyPrefix: string }>();
  const location = useLocation();
  const { selectedCompanyId } = useCompany();
  const { can } = usePermissions(selectedCompanyId);
  const canWireConnectors = can("workspace:connectors:wire");
  const experimentalQuery = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
    staleTime: 60_000,
  });
  const runtimeEnabled = experimentalQuery.data?.enableConnectorRuntime === true;
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ConnectorCategory | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ConnectorStatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState<ConnectorAudience | "all">("all");
  const [sortBy, setSortBy] = useState<ConnectorSortKey>("name");
  const [guideConnector, setGuideConnector] = useState<ConnectorDefinition | null>(null);
  const [guideInitialTab, setGuideInitialTab] = useState<"overview" | "setup">("overview");
  const [sheetOpen, setSheetOpen] = useState(false);

  const adaptersHref = "/bench/settings/adapters";

  useEffect(() => {
    setBreadcrumbs([{ label: "Connectors" }]);
  }, [setBreadcrumbs]);

  const needle = q.trim().toLowerCase();

  const filteredConnectors = useMemo(() => {
    let list = CONNECTOR_CATALOG.filter((c) => {
      if (categoryFilter !== "all" && c.category !== categoryFilter) return false;
      if (!matchesAudience(c, roleFilter)) return false;
      if (!matchesSearch(c, needle)) return false;
      if (statusFilter === "connected" && !isCatalogConnectorConnected(c.id)) return false;
      if (statusFilter === "not_connected" && isCatalogConnectorConnected(c.id)) return false;
      return true;
    });

    list = [...list];
    if (sortBy === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "category") {
      list.sort((a, b) => {
        const d = CONNECTOR_CATEGORY_ORDER.indexOf(a.category) - CONNECTOR_CATEGORY_ORDER.indexOf(b.category);
        return d !== 0 ? d : a.name.localeCompare(b.name);
      });
    } else {
      list.sort((a, b) => {
        const d = importanceRank(a.typicalImportance) - importanceRank(b.typicalImportance);
        return d !== 0 ? d : a.name.localeCompare(b.name);
      });
    }

    return list;
  }, [needle, categoryFilter, statusFilter, roleFilter, sortBy]);

  useEffect(() => {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return;
    const el = document.getElementById(raw);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [location.hash]);

  function openSheet(c: ConnectorDefinition, tab: "overview" | "setup") {
    setGuideConnector(c);
    setGuideInitialTab(tab);
    setSheetOpen(true);
  }

  const noResults =
    needle || categoryFilter !== "all" || statusFilter !== "all" || roleFilter !== "all"
      ? filteredConnectors.length === 0
      : false;

  return (
    <div className="grid min-h-[calc(100vh-12rem)] gap-0 xl:grid-cols-[19rem_minmax(0,1fr)] xl:items-stretch">
      <aside className="border-b border-border xl:border-b-0 xl:border-r flex flex-col min-h-0 max-h-[min(80vh,calc(100vh-10rem))] overflow-y-auto bg-background xl:max-h-[calc(100vh-12rem)]">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-base font-semibold text-foreground">Connectors</h1>
              <p className="text-xs text-muted-foreground">{CONNECTOR_CATALOG.length} in catalog</p>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 border-b border-border pb-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search connectors"
              className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Search connectors"
            />
          </div>

          <div className="mt-4 space-y-3">
            <FilterField label="Category">
              <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as ConnectorCategory | "all")}>
                <SelectTrigger className="w-full h-9" aria-label="Category">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {CONNECTOR_CATEGORY_ORDER.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {CONNECTOR_CATEGORY_LABELS[cat]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Status">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ConnectorStatusFilter)}>
                <SelectTrigger className="w-full h-9" aria-label="Status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="connected">Connected</SelectItem>
                  <SelectItem value="not_connected">Not connected</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Role">
              <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as ConnectorAudience | "all")}>
                <SelectTrigger className="w-full h-9" aria-label="Role">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {CONNECTOR_AUDIENCE_ORDER.map((aud) => (
                    <SelectItem key={aud} value={aud}>
                      {CONNECTOR_AUDIENCE_LABELS[aud]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Sort">
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as ConnectorSortKey)}>
                <SelectTrigger className="w-full h-9" aria-label="Sort">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="category">Category</SelectItem>
                  <SelectItem value="importance">Rollout priority</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{filteredConnectors.length}</span> shown
          </p>
        </div>
      </aside>

      <div className="min-w-0 min-h-0 py-4 px-4 md:pl-6 xl:pl-6 xl:max-h-[calc(100vh-12rem)] xl:overflow-y-auto">
        <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl mb-4">
          Filter by category, connection status, and role. Use <strong className="text-foreground">Connect</strong> to
          jump into setup, or <strong className="text-foreground">View details</strong> when the integration is already
          connected.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {filteredConnectors.map((c) => (
            <ConnectorTile
              key={c.id}
              connector={c}
              onConnect={(conn) => openSheet(conn, "setup")}
              onViewDetails={(conn) => openSheet(conn, "overview")}
            />
          ))}
        </div>

        {noResults ? (
          <p className="mt-6 text-sm text-muted-foreground">
            No connectors match your filters{needle ? ` for “${q.trim()}”` : ""}. Try clearing status or role, or broadening
            category.
          </p>
        ) : null}
      </div>

      <ConnectorGuideSheet
        connector={guideConnector}
        open={sheetOpen}
        initialTab={guideInitialTab}
        onOpenChange={(o) => {
          setSheetOpen(o);
          if (!o) setGuideConnector(null);
        }}
        adaptersHref={adaptersHref}
        installerProps={{
          companyId: selectedCompanyId,
          runtimeEnabled,
          canWire: canWireConnectors,
          // Round-trip back to the connectors directory after vendor consent
          // so the sheet pops back open on the same connector when the user
          // returns. The callback route validates this is a same-instance
          // path before honoring it.
          returnTo: `/connectors${guideConnector ? `?focus=${encodeURIComponent(guideConnector.id)}` : ""}`,
        }}
      />
    </div>
  );
}
