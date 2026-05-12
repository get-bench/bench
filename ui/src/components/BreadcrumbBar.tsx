import { Link, useLocation } from "@/lib/router";
import { Menu, X } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useSidebar } from "../context/SidebarContext";
import { useCompany } from "../context/CompanyContext";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Fragment, useMemo } from "react";
import { PluginSlotOutlet, usePluginSlots } from "@/plugins/slots";
import { PluginLauncherOutlet, usePluginLaunchers } from "@/plugins/launchers";

type GlobalToolbarContext = { companyId: string | null; companyPrefix: string | null };

/**
 * "Exit settings" affordance in the top-right of the breadcrumb bar.
 * Settings views previously had no top-bar way out — only a chevron tucked into
 * the workspace-settings sidebar (and nothing at all in Bench settings). This
 * button takes the operator straight back to their dashboard.
 */
function ExitSettingsButton({ pathname }: { pathname: string }) {
  const isInstanceSettings =
    pathname.startsWith("/bench/settings") || pathname.startsWith("/instance/settings");
  const isCompanySettings =
    pathname.includes("/workspace/settings") || pathname.includes("/company/settings");
  if (!isInstanceSettings && !isCompanySettings) return null;
  return (
    <Button asChild variant="ghost" size="icon-sm" aria-label="Exit settings" title="Exit settings">
      <Link to="/dashboard">
        <X className="h-4 w-4" />
      </Link>
    </Button>
  );
}

function GlobalToolbarPlugins({ context }: { context: GlobalToolbarContext }) {
  const { slots } = usePluginSlots({ slotTypes: ["globalToolbarButton"], companyId: context.companyId });
  const { launchers } = usePluginLaunchers({ placementZones: ["globalToolbarButton"], companyId: context.companyId, enabled: !!context.companyId });
  if (slots.length === 0 && launchers.length === 0) return null;
  return (
    <div className="flex items-center gap-1 ml-auto shrink-0 pl-2">
      <PluginSlotOutlet slotTypes={["globalToolbarButton"]} context={context} className="flex items-center gap-1" />
      <PluginLauncherOutlet placementZones={["globalToolbarButton"]} context={context} className="flex items-center gap-1" />
    </div>
  );
}

export function BreadcrumbBar() {
  const { breadcrumbs, mobileToolbar } = useBreadcrumbs();
  const { toggleSidebar, isMobile } = useSidebar();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const location = useLocation();

  const globalToolbarSlotContext = useMemo(
    () => ({
      companyId: selectedCompanyId ?? null,
      companyPrefix: selectedCompany?.issuePrefix ?? null,
    }),
    [selectedCompanyId, selectedCompany?.issuePrefix],
  );

  const globalToolbarSlots = <GlobalToolbarPlugins context={globalToolbarSlotContext} />;
  const exitSettings = <ExitSettingsButton pathname={location.pathname} />;

  if (isMobile && mobileToolbar) {
    return (
      <div className="border-b border-border px-2 h-12 shrink-0 flex items-center gap-2">
        <div className="min-w-0 flex-1">{mobileToolbar}</div>
        {exitSettings}
      </div>
    );
  }

  if (breadcrumbs.length === 0) {
    return (
      <div className="border-b border-border px-4 md:px-6 h-12 shrink-0 flex items-center justify-end gap-2">
        {globalToolbarSlots}
        {exitSettings}
      </div>
    );
  }

  const menuButton = isMobile && (
    <Button
      variant="ghost"
      size="icon-sm"
      className="mr-2 shrink-0"
      onClick={toggleSidebar}
      aria-label="Open sidebar"
    >
      <Menu className="h-5 w-5" />
    </Button>
  );

  // Single breadcrumb = page title (uppercase)
  if (breadcrumbs.length === 1) {
    return (
      <div className="border-b border-border px-4 md:px-6 h-12 shrink-0 flex items-center">
        {menuButton}
        <div className="min-w-0 overflow-hidden flex-1">
          <h1 className="text-sm font-semibold uppercase tracking-wider truncate">
            {breadcrumbs[0].label}
          </h1>
        </div>
        {globalToolbarSlots}
        {exitSettings}
      </div>
    );
  }

  // Multiple breadcrumbs = breadcrumb trail
  return (
    <div className="border-b border-border px-4 md:px-6 h-12 shrink-0 flex items-center">
      {menuButton}
      <div className="min-w-0 overflow-hidden flex-1">
        <Breadcrumb className="min-w-0 overflow-hidden">
          <BreadcrumbList className="flex-nowrap">
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return (
                <Fragment key={i}>
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem className={isLast ? "min-w-0" : "shrink-0"}>
                    {isLast || !crumb.href ? (
                      <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link to={crumb.href}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      {globalToolbarSlots}
      {exitSettings}
    </div>
  );
}
