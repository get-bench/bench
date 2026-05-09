import { useEffect, useMemo, useState } from "react";
import { useLocation } from "@/lib/router";
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
import { cn } from "../lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { BookOpen, Cable, Package, Search } from "lucide-react";
import StackIcon, { type IconName } from "tech-stack-icons";
import { useTheme } from "../context/ThemeContext";

function rolloutPrioritySentence(v: ConnectorTypicalImportance): string {
  if (v === "required") {
    return "Most hiring flows assume this class of tool is wired early — delays here block realistic coworker tasks.";
  }
  if (v === "recommended") {
    return "Strongly advised for teams that rely on this surface day to day; you can phase it if policy demands.";
  }
  return "Optional — enable when the role clearly benefits; skip noisy vendors your company does not use.";
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

function ConnectorGuideSheet({
  connector,
  open,
  onOpenChange,
}: {
  connector: ConnectorDefinition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-start gap-3 pr-8">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40">
              <ConnectorBrandIcon stackIcon={connector.stackIcon} className="h-7 w-7 shrink-0" />
            </span>
            <span className="leading-snug">{connector.name}</span>
          </SheetTitle>
          <SheetDescription>{connector.description}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-8 text-sm">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Typical rollout priority
            </p>
            <p className="text-foreground leading-relaxed">{rolloutPrioritySentence(connector.typicalImportance)}</p>
          </div>

          {connector.setupOverview ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Overview</p>
              <p className="text-foreground leading-relaxed">{connector.setupOverview}</p>
            </div>
          ) : null}

          {connector.rolloutNotes?.length ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Operator notes
              </p>
              <ul className="text-foreground list-disc pl-4 space-y-2">
                {connector.rolloutNotes.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {connector.prerequisites?.length ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Before you start
              </p>
              <ul className="text-muted-foreground list-disc pl-4 space-y-2">
                {connector.prerequisites.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}

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

          {connector.learnMoreUrl ? (
            <p>
              <a
                href={connector.learnMoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                Open vendor documentation
              </a>
            </p>
          ) : null}
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

function ConnectorRow({
  connector,
  onOpenGuide,
}: {
  connector: ConnectorDefinition;
  onOpenGuide: (c: ConnectorDefinition) => void;
}) {
  const anchor = `connector-${connector.id}`;
  const metaParts = [CONNECTOR_CATEGORY_LABELS[connector.category]];
  if (connector.audiences?.length) {
    metaParts.push(
      `Teams: ${connector.audiences.map((a) => CONNECTOR_AUDIENCE_LABELS[a]).join(", ")}`,
    );
  }

  return (
    <div
      id={anchor}
      className="flex gap-3 px-4 py-4 border-b border-border last:border-b-0 scroll-mt-28 sm:items-start"
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40"
        aria-hidden
      >
        <ConnectorBrandIcon stackIcon={connector.stackIcon} className="h-6 w-6 shrink-0" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm font-semibold text-foreground leading-snug">{connector.name}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{connector.description}</p>
            <p className="text-xs text-muted-foreground">{metaParts.join(" · ")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 sm:mt-0.5"
            onClick={() => onOpenGuide(connector)}
          >
            <BookOpen className="h-3.5 w-3.5 mr-1.5" />
            Setup guide
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ConnectorsDirectory() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const location = useLocation();
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ConnectorCategory | "all">("all");
  const [audienceFilter, setAudienceFilter] = useState<ConnectorAudience | "all">("all");
  const [guideConnector, setGuideConnector] = useState<ConnectorDefinition | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Connectors" }]);
  }, [setBreadcrumbs]);

  const needle = q.trim().toLowerCase();

  const filteredByCategory = useMemo(() => {
    const next = new Map<ConnectorCategory, ConnectorDefinition[]>();
    for (const cat of CONNECTOR_CATEGORY_ORDER) {
      next.set(cat, []);
    }
    for (const c of CONNECTOR_CATALOG) {
      if (categoryFilter !== "all" && c.category !== categoryFilter) continue;
      if (!matchesAudience(c, audienceFilter)) continue;
      if (!matchesSearch(c, needle)) continue;
      next.get(c.category)!.push(c);
    }
    for (const cat of CONNECTOR_CATEGORY_ORDER) {
      next.get(cat)!.sort((a, b) => a.name.localeCompare(b.name));
    }
    return next;
  }, [needle, categoryFilter, audienceFilter]);

  useEffect(() => {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return;
    const el = document.getElementById(raw);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [location.hash]);

  function openGuide(c: ConnectorDefinition) {
    setGuideConnector(c);
    setSheetOpen(true);
  }

  const visibleCount = useMemo(() => {
    let n = 0;
    for (const cat of CONNECTOR_CATEGORY_ORDER) {
      n += filteredByCategory.get(cat)?.length ?? 0;
    }
    return n;
  }, [filteredByCategory]);

  const noResults =
    needle || categoryFilter !== "all" || audienceFilter !== "all"
      ? visibleCount === 0
      : false;

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-6 pb-16 space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <Cable className="h-5 w-5 shrink-0 text-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground leading-relaxed">
          Canonical integration patterns — search by vendor, filter by category or typical team. Technical wiring ships
          incrementally; guides capture IT-safe rollout expectations.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/25 p-4 space-y-2">
        <p className="text-sm font-medium text-foreground">After IT connects an app</p>
        <ul className="text-sm text-muted-foreground list-disc pl-4 space-y-1">
          <li>
            <span className="text-foreground font-medium">Manager:</span> confirm channel / repo / board membership for
            each coworker (least privilege).
          </li>
          <li>
            Open the coworker&apos;s <strong>Instructions</strong> tab for norms, prefixes, and escalation paths.
          </li>
          <li>
            Run a short <strong>test task</strong> and watch <strong>Activity</strong> for auth or scope errors.
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, category, keywords…"
            className="pl-9"
            aria-label="Search connectors"
          />
        </div>
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as ConnectorCategory | "all")}>
          <SelectTrigger className="w-full sm:w-[220px]" aria-label="Category filter">
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
        <Select value={audienceFilter} onValueChange={(v) => setAudienceFilter(v as ConnectorAudience | "all")}>
          <SelectTrigger className="w-full sm:w-[220px]" aria-label="Team focus filter">
            <SelectValue placeholder="Team focus" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All teams</SelectItem>
            {CONNECTOR_AUDIENCE_ORDER.map((aud) => (
              <SelectItem key={aud} value={aud}>
                {CONNECTOR_AUDIENCE_LABELS[aud]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing <strong className="text-foreground">{visibleCount}</strong> of {CONNECTOR_CATALOG.length} connectors.
        “Team focus” hides entries that only apply to other functions; connectors without a team tag stay visible for every
        filter.
      </p>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {CONNECTOR_CATEGORY_ORDER.map((cat) => {
          const list = filteredByCategory.get(cat) ?? [];
          if (!list.length) return null;
          return (
            <section key={cat} id={`cat-${cat}`} className="scroll-mt-24 border-b border-border last:border-b-0">
              <div className="px-4 py-3 bg-muted/40 border-b border-border">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {CONNECTOR_CATEGORY_LABELS[cat]}
                </h2>
              </div>
              <div>{list.map((c) => (
                <ConnectorRow key={c.id} connector={c} onOpenGuide={openGuide} />
              ))}</div>
            </section>
          );
        })}
      </div>

      {noResults ? (
        <p className="text-sm text-muted-foreground">
          No connectors match your filters{needle ? ` for “${q.trim()}”` : ""}. Try clearing team focus or choosing a
          broader category.
        </p>
      ) : null}

      <ConnectorGuideSheet
        connector={guideConnector}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setGuideConnector(null);
        }}
      />
    </div>
  );
}
