import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  Clock3,
  Cpu,
  FlaskConical,
  KeyRound,
  Puzzle,
  Settings,
  Shield,
  SlidersHorizontal,
  UserRoundPen,
} from "lucide-react";
import { Link, NavLink } from "@/lib/router";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import { SIDEBAR_SCROLL_RESET_STATE } from "@/lib/navigation-scroll";
import { useCompany } from "@/context/CompanyContext";
import { useSidebar } from "@/context/SidebarContext";
import { SidebarNavItem } from "./SidebarNavItem";

export function InstanceSidebar() {
  const { selectedCompany } = useCompany();
  const { isMobile, setSidebarOpen } = useSidebar();
  const { data: plugins } = useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: () => pluginsApi.list(),
  });

  return (
    <aside className="w-60 h-full min-h-0 border-r border-border bg-background flex flex-col">
      <div className="flex flex-col gap-1 px-3 py-3 shrink-0">
        <Link
          to="/dashboard"
          onClick={() => {
            if (isMobile) setSidebarOpen(false);
          }}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{selectedCompany?.name ?? "Dashboard"}</span>
        </Link>
        <div className="flex items-center gap-2 px-2 py-1">
          <Settings className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="flex-1 truncate text-sm font-bold text-foreground">Bench settings</span>
        </div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <SidebarNavItem to="/bench/settings/profile" label="Profile" icon={UserRoundPen} end />
          <SidebarNavItem to="/bench/settings/general" label="General" icon={SlidersHorizontal} end />
          <SidebarNavItem to="/bench/settings/access" label="Access" icon={Shield} end />
          <SidebarNavItem to="/bench/settings/sso" label="SSO" icon={KeyRound} end />
          <SidebarNavItem to="/bench/settings/heartbeats" label="Coworker schedules" icon={Clock3} end />
          <SidebarNavItem to="/bench/settings/experimental" label="Experimental" icon={FlaskConical} />
          <SidebarNavItem to="/bench/settings/plugins" label="Plugins" icon={Puzzle} />
          <SidebarNavItem to="/bench/settings/adapters" label="Adapters" icon={Cpu} />
          {(plugins ?? []).length > 0 ? (
            <div className="ml-4 mt-1 flex flex-col gap-0.5 border-l border-border/70 pl-3">
              {(plugins ?? []).map((plugin) => (
                <NavLink
                  key={plugin.id}
                  to={`/bench/settings/plugins/${plugin.id}`}
                  state={SIDEBAR_SCROLL_RESET_STATE}
                  className={({ isActive }) =>
                    [
                      "rounded-md px-2 py-1.5 text-xs transition-colors",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    ].join(" ")
                  }
                >
                  {plugin.manifestJson.displayName ?? plugin.packageName}
                </NavLink>
              ))}
            </div>
          ) : null}
        </div>
      </nav>
    </aside>
  );
}
