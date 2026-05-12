import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard";
import { activityApi } from "../api/activity";
import { accessApi } from "../api/access";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { approvalsApi } from "../api/approvals";
import { authApi } from "../api/auth";
import { projectsApi } from "../api/projects";
import { buildCompanyUserProfileMap } from "../lib/company-members";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { StatusIcon } from "../components/StatusIcon";

import { ActivityRow } from "../components/ActivityRow";
import { Identity } from "../components/Identity";
import { timeAgo } from "../lib/timeAgo";
import { agentUrl, cn, formatCents } from "../lib/utils";
import { Bot, CircleDot, Clock, DollarSign, ShieldCheck, LayoutDashboard, PauseCircle, Users } from "lucide-react";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { ChartCard, RunActivityChart, PriorityChart, IssueStatusChart, SuccessRateChart } from "../components/ActivityCharts";
import { PageSkeleton } from "../components/PageSkeleton";
import type { Agent, Issue } from "@bench/shared";
import { PluginSlotOutlet } from "@/plugins/slots";
import { useDashboardAgentScope, useDashboardPersona } from "../context/DashboardPersonaContext";
import {
  activityTouchesScopedAgents,
  issueTouchesScopedAgents,
  scopedAgentDashboardCounts,
  taskCountsFromIssues,
} from "../lib/manager-scope";
import { computeAdminCoworkerOverview } from "../lib/admin-coworker-stats";
import { ManagerScopeRecovery } from "../components/ManagerScopeRecovery";

const DASHBOARD_ACTIVITY_LIMIT = 10;
const DASHBOARD_ACTIVITY_LIMIT_MANAGER = 48;

function getRecentIssues(issues: Issue[]): Issue[] {
  return [...issues]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function Dashboard() {
  const { selectedCompanyId, companies } = useCompany();
  const { openOnboarding } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [animatedActivityIds, setAnimatedActivityIds] = useState<Set<string>>(new Set());
  const seenActivityIdsRef = useRef<Set<string>>(new Set());
  const hydratedActivityRef = useRef(false);
  const activityAnimationTimersRef = useRef<number[]>([]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { persona, isAdminView } = useDashboardPersona();
  const scope = useDashboardAgentScope(agents);
  const isManagerView = scope.isManagerView;

  const adminOverview = useMemo(() => computeAdminCoworkerOverview(agents ?? []), [agents]);
  const scopedAgentIds = scope.scopedAgentIds;
  const scopedAgents = scope.scopedAgents;
  const activityFetchLimit = persona === "manager" ? DASHBOARD_ACTIVITY_LIMIT_MANAGER : DASHBOARD_ACTIVITY_LIMIT;

  useEffect(() => {
    setBreadcrumbs([{ label: "Dashboard" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: activity } = useQuery({
    queryKey: [...queryKeys.activity(selectedCompanyId!), { limit: activityFetchLimit }],
    queryFn: () => activityApi.list(selectedCompanyId!, { limit: activityFetchLimit }),
    enabled: !!selectedCompanyId,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: companyMembers } = useQuery({
    queryKey: queryKeys.access.companyUserDirectory(selectedCompanyId!),
    queryFn: () => accessApi.listUserDirectory(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // Approvals for the current workspace, used to surface a "you have N
  // pending hire requests" strip to the requester (P1 A5 — see
  // doc/plans/2026-05-11-rbac-and-hire-requests.md §9).
  const { data: workspaceApprovals } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!, undefined),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId = session?.user.id ?? session?.session.userId ?? null;

  const myPendingHireRequests = useMemo(() => {
    if (!currentUserId || !workspaceApprovals) return [];
    return workspaceApprovals.filter(
      (a) =>
        a.type === "hire_agent"
        && a.requestedByUserId === currentUserId
        && (a.status === "pending" || a.status === "revision_requested"),
    );
  }, [workspaceApprovals, currentUserId]);

  const oldestMyPendingHireRequest = useMemo(() => {
    if (myPendingHireRequests.length === 0) return null;
    return myPendingHireRequests.reduce((oldest, candidate) => {
      const candidateTime = new Date(candidate.createdAt).getTime();
      const oldestTime = new Date(oldest.createdAt).getTime();
      if (!Number.isFinite(candidateTime)) return oldest;
      if (!Number.isFinite(oldestTime)) return candidate;
      return candidateTime < oldestTime ? candidate : oldest;
    });
  }, [myPendingHireRequests]);

  const userProfileMap = useMemo(
    () => buildCompanyUserProfileMap(companyMembers?.users),
    [companyMembers?.users],
  );

  const scopedIssues = useMemo(() => {
    if (!issues) return [];
    if (!isManagerView || !scopedAgentIds) return issues;
    return issues.filter((i) => issueTouchesScopedAgents(i, scopedAgentIds));
  }, [issues, isManagerView, scopedAgentIds]);

  const scopedActivity = useMemo(() => {
    if (!activity) return [];
    if (!isManagerView || !scopedAgentIds) return activity;
    return activity.filter((e) => activityTouchesScopedAgents(e, scopedAgentIds));
  }, [activity, isManagerView, scopedAgentIds]);

  const recentIssues = scopedIssues.length ? getRecentIssues(scopedIssues) : [];
  const recentActivity = useMemo(() => scopedActivity.slice(0, 10), [scopedActivity]);

  useEffect(() => {
    for (const timer of activityAnimationTimersRef.current) {
      window.clearTimeout(timer);
    }
    activityAnimationTimersRef.current = [];
    seenActivityIdsRef.current = new Set();
    hydratedActivityRef.current = false;
    setAnimatedActivityIds(new Set());
  }, [selectedCompanyId]);

  useEffect(() => {
    if (recentActivity.length === 0) return;

    const seen = seenActivityIdsRef.current;
    const currentIds = recentActivity.map((event) => event.id);

    if (!hydratedActivityRef.current) {
      for (const id of currentIds) seen.add(id);
      hydratedActivityRef.current = true;
      return;
    }

    const newIds = currentIds.filter((id) => !seen.has(id));
    if (newIds.length === 0) {
      for (const id of currentIds) seen.add(id);
      return;
    }

    setAnimatedActivityIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });

    for (const id of newIds) seen.add(id);

    const timer = window.setTimeout(() => {
      setAnimatedActivityIds((prev) => {
        const next = new Set(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
      activityAnimationTimersRef.current = activityAnimationTimersRef.current.filter((t) => t !== timer);
    }, 980);
    activityAnimationTimersRef.current.push(timer);
  }, [recentActivity]);

  useEffect(() => {
    return () => {
      for (const timer of activityAnimationTimersRef.current) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    const issueRows = isManagerView ? scopedIssues : (issues ?? []);
    for (const i of issueRows) map.set(`issue:${i.id}`, i.identifier ?? i.id.slice(0, 8));
    for (const a of agents ?? []) map.set(`agent:${a.id}`, a.name);
    for (const p of projects ?? []) map.set(`project:${p.id}`, p.name);
    return map;
  }, [issues, agents, projects, isManagerView, scopedIssues]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    const issueRows = isManagerView ? scopedIssues : (issues ?? []);
    for (const i of issueRows) map.set(`issue:${i.id}`, i.title);
    return map;
  }, [issues, isManagerView, scopedIssues]);

  const agentName = (id: string | null) => {
    if (!id || !agents) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  };

  const managerAgentCounts = useMemo(() => scopedAgentDashboardCounts(scopedAgents), [scopedAgents]);
  const managerTaskCounts = useMemo(() => taskCountsFromIssues(scopedIssues), [scopedIssues]);
  const managerMonthSpendCents = useMemo(
    () => scopedAgents.reduce((sum, a) => sum + a.spentMonthlyCents, 0),
    [scopedAgents],
  );
  const managerMonthBudgetCents = useMemo(
    () => scopedAgents.reduce((sum, a) => sum + a.budgetMonthlyCents, 0),
    [scopedAgents],
  );
  const managerBudgetUtilPercent =
    managerMonthBudgetCents > 0
      ? Math.min(100, Math.round((managerMonthSpendCents / managerMonthBudgetCents) * 100))
      : 0;
  const scopedBudgetPausedCount = useMemo(
    () => scopedAgents.filter((a) => a.pauseReason === "budget").length,
    [scopedAgents],
  );
  const managerAgentsEnabledTotal =
    managerAgentCounts.active +
    managerAgentCounts.running +
    managerAgentCounts.paused +
    managerAgentCounts.error;

  if (!selectedCompanyId) {
    if (companies.length === 0) {
      return (
        <EmptyState
          icon={LayoutDashboard}
          message="Welcome to Bench. Set up your first company and coworker to get started."
          action="Get Started"
          onAction={openOnboarding}
        />
      );
    }
    return (
      <EmptyState icon={LayoutDashboard} message="Create or select a company to view the dashboard." />
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const hasNoAgents = agents !== undefined && agents.length === 0;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {isManagerView && (!scope.sessionEmail || scopedAgents.length === 0) ? (
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            {!scope.sessionEmail ? (
              <p>
                <span className="font-medium text-foreground">Manager view</span> needs a signed-in user email to match
                coworkers assigned to you.
              </p>
            ) : (
              <p>
                No coworkers list <span className="font-medium text-foreground">{scope.sessionEmail}</span> as their
                people manager yet. New hires from now on default to you — for older coworkers, use the recovery card
                below or open the coworker and pick a manager.
              </p>
            )}
          </div>
          {selectedCompanyId ? (
            <ManagerScopeRecovery
              companyId={selectedCompanyId}
              agents={agents}
              sessionEmail={scope.sessionEmail}
            />
          ) : null}
        </div>
      ) : null}

      {hasNoAgents && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/25 dark:bg-amber-950/60">
          <div className="flex items-center gap-2.5">
            <Bot className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-amber-900 dark:text-amber-100">
              You have no coworkers yet.
            </p>
          </div>
          <button
            onClick={() => openOnboarding({ initialStep: 2, companyId: selectedCompanyId! })}
            className="text-sm font-medium text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 underline underline-offset-2 shrink-0"
          >
            Create one here
          </button>
        </div>
      )}

      {/*
        Requester-facing pending-hires strip (P1 A5). Shown to anyone (manager,
        admin, owner) who currently has open hire requests they filed; surfaces
        the oldest one's age so they can chase reviewers without digging into
        Approvals. Hidden when the viewer has no open requests of their own.
      */}
      {oldestMyPendingHireRequest ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium text-foreground">
                You have {myPendingHireRequests.length} pending hire request
                {myPendingHireRequests.length === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-muted-foreground">
                Oldest filed {timeAgo(oldestMyPendingHireRequest.createdAt)} — awaiting a
                Workspace Owner or Admin reviewer.
              </p>
            </div>
          </div>
          <Link
            to={`/approvals/${oldestMyPendingHireRequest.id}`}
            className="text-sm underline underline-offset-2 text-foreground"
          >
            View request
          </Link>
        </div>
      ) : null}

      {!isAdminView ? (
        <ActiveAgentsPanel
          companyId={selectedCompanyId!}
          scopedAgentIds={isManagerView && scopedAgentIds ? scopedAgentIds : undefined}
        />
      ) : null}

      {data && (
        <>
          {!isManagerView && data.budgets.activeIncidents > 0 ? (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-red-500/20 bg-[linear-gradient(180deg,rgba(255,80,80,0.12),rgba(255,255,255,0.02))] px-4 py-3">
              <div className="flex items-start gap-2.5">
                <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                <div>
                  <p className="text-sm font-medium text-red-50">
                    {data.budgets.activeIncidents} active budget incident{data.budgets.activeIncidents === 1 ? "" : "s"}
                  </p>
                  <p className="text-xs text-red-100/70">
                    {data.budgets.pausedAgents} coworkers paused · {data.budgets.pausedProjects} projects paused · {data.budgets.pendingApprovals} pending budget approvals
                  </p>
                </div>
              </div>
              <Link to="/costs" className="text-sm underline underline-offset-2 text-red-100">
                Open budgets
              </Link>
            </div>
          ) : null}

          {isManagerView && scopedBudgetPausedCount > 0 ? (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
              <div className="flex items-start gap-2.5">
                <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {scopedBudgetPausedCount} coworker{scopedBudgetPausedCount === 1 ? "" : "s"} paused by budget
                  </p>
                  <p className="text-xs text-muted-foreground">Spend limits apply per hire; admins manage company caps.</p>
                </div>
              </div>
              <Link to="/costs" className="text-sm underline underline-offset-2 text-foreground">
                View costs
              </Link>
            </div>
          ) : null}

          <div
            className={cn(
              "grid grid-cols-2 gap-1 sm:gap-2",
              isAdminView ? "xl:grid-cols-5" : isManagerView ? "xl:grid-cols-3" : "xl:grid-cols-3",
            )}
          >
            {isAdminView ? (
              <>
                <MetricCard
                  icon={Bot}
                  value={adminOverview.totalCoworkers}
                  label="Coworkers hired"
                  to="/agents"
                  description={<span>Active hires (not terminated)</span>}
                />
                <MetricCard
                  icon={Users}
                  value={adminOverview.managerCount}
                  label="People managers"
                  to="/agents"
                  description={<span>Distinct manager emails on hires</span>}
                />
                <MetricCard
                  icon={CircleDot}
                  value={adminOverview.unassignedCoworkers}
                  label="Unassigned hires"
                  to="/agents"
                  description={<span>Set manager email on hire or Configuration</span>}
                />
                <MetricCard
                  icon={DollarSign}
                  value={formatCents(data.costs.monthSpendCents)}
                  label="Workspace month spend"
                  to="/costs"
                  description={
                    <span>
                      {data.costs.monthBudgetCents > 0
                        ? `${data.costs.monthUtilizationPercent}% of ${formatCents(data.costs.monthBudgetCents)} cap`
                        : "No company monthly cap"}
                    </span>
                  }
                />
                <MetricCard
                  icon={ShieldCheck}
                  value={data.pendingApprovals + data.budgets.pendingApprovals}
                  label="Pending approvals"
                  to="/approvals"
                  description={
                    <span>
                      {data.budgets.pendingApprovals > 0
                        ? `${data.budgets.pendingApprovals} budget-related`
                        : "Hires and policy reviews"}
                    </span>
                  }
                />
              </>
            ) : isManagerView ? (
              <>
                <MetricCard
                  icon={Bot}
                  value={managerAgentsEnabledTotal}
                  label="Your coworkers"
                  to="/agents"
                  description={
                    <span>
                      {managerAgentCounts.running} running{", "}
                      {managerAgentCounts.paused} paused{", "}
                      {managerAgentCounts.error} errors
                    </span>
                  }
                />
                <MetricCard
                  icon={CircleDot}
                  value={managerTaskCounts.inProgress}
                  label="Tasks In Progress"
                  to="/issues"
                  description={
                    <span>
                      {managerTaskCounts.open} open{", "}
                      {managerTaskCounts.blocked} blocked
                    </span>
                  }
                />
                <MetricCard
                  icon={DollarSign}
                  value={formatCents(managerMonthSpendCents)}
                  label="Month Spend (team)"
                  to="/costs"
                  description={
                    <span>
                      {managerMonthBudgetCents > 0
                        ? `${managerBudgetUtilPercent}% of ${formatCents(managerMonthBudgetCents)} hire budgets`
                        : "No per-hire monthly cap"}
                    </span>
                  }
                />
              </>
            ) : null}
          </div>

          {isAdminView && adminOverview.managerRows.length > 0 ? (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/30">
                <h3 className="text-sm font-semibold text-foreground">Spend by people manager</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Approximation: sum of each hire&apos;s <code className="text-[10px]">spentMonthlyCents</code> grouped by{" "}
                  <code className="text-[10px]">benchManagerEmail</code>.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Manager email</th>
                      <th className="px-4 py-2 font-medium tabular-nums">Coworkers</th>
                      <th className="px-4 py-2 font-medium tabular-nums">Month spend (hires)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminOverview.managerRows.map((row) => (
                      <tr key={row.managerEmail} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-2 font-mono text-xs">{row.managerEmail}</td>
                        <td className="px-4 py-2 tabular-nums">{row.coworkerCount}</td>
                        <td className="px-4 py-2 tabular-nums">{formatCents(row.monthSpendCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {isAdminView ? (
            <div className="grid md:grid-cols-2 gap-4">
              <ChartCard title="Run activity" subtitle="Last 14 days · company">
                <RunActivityChart activity={data.runActivity} />
              </ChartCard>
              <ChartCard title="Success rate" subtitle="Last 14 days · company">
                <SuccessRateChart activity={data.runActivity} />
              </ChartCard>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <ChartCard title="Run Activity" subtitle="Last 14 days">
                {isManagerView ? (
                  <p className="text-xs text-muted-foreground">
                    Company-wide run volume is hidden in Manager view. Open a coworker to see their runs and activity.
                  </p>
                ) : (
                  <RunActivityChart activity={data.runActivity} />
                )}
              </ChartCard>
              <ChartCard title="Issues by Priority" subtitle="Last 14 days">
                <PriorityChart issues={isManagerView ? scopedIssues : (issues ?? [])} />
              </ChartCard>
              <ChartCard title="Issues by Status" subtitle="Last 14 days">
                <IssueStatusChart issues={isManagerView ? scopedIssues : (issues ?? [])} />
              </ChartCard>
              <ChartCard title="Success Rate" subtitle="Last 14 days">
                {isManagerView ? (
                  <p className="text-xs text-muted-foreground">
                    Success rates for the whole company are available in Admin view.
                  </p>
                ) : (
                  <SuccessRateChart activity={data.runActivity} />
                )}
              </ChartCard>
            </div>
          )}

          {isManagerView && scopedAgents.length > 0 && scope.sessionEmail ? (
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              Open a coworker&apos;s{" "}
              <Link
                to={`${agentUrl(scopedAgents[0]!)}/onboarding`}
                className="font-medium text-foreground underline underline-offset-2"
              >
                Onboarding tab
              </Link>{" "}
              to see what&apos;s left to wire — required connectors, per-coworker grants (Slack channels), and
              instructions bundle status.
            </div>
          ) : null}

          <PluginSlotOutlet
            slotTypes={["dashboardWidget"]}
            context={{ companyId: selectedCompanyId }}
            className="grid gap-4 md:grid-cols-2"
            itemClassName="rounded-lg border bg-card p-4 shadow-sm"
          />

          <div className={cn("grid gap-4", !isAdminView ? "md:grid-cols-2" : "md:grid-cols-1")}>
            {/* Recent Activity */}
            {recentActivity.length > 0 && (
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Recent Activity
                </h3>
                <div className="border border-border divide-y divide-border overflow-hidden">
                  {recentActivity.map((event) => (
                    <ActivityRow
                      key={event.id}
                      event={event}
                      agentMap={agentMap}
                      userProfileMap={userProfileMap}
                      entityNameMap={entityNameMap}
                      entityTitleMap={entityTitleMap}
                      className={animatedActivityIds.has(event.id) ? "activity-row-enter" : undefined}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Recent Tasks — managers & operators; admins use Approvals + hires */}
            {!isAdminView ? (
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Recent Tasks
              </h3>
              {recentIssues.length === 0 ? (
                <div className="border border-border p-4">
                  <p className="text-sm text-muted-foreground">No tasks yet.</p>
                </div>
              ) : (
                <div className="border border-border divide-y divide-border overflow-hidden">
                  {recentIssues.slice(0, 10).map((issue) => (
                    <Link
                      key={issue.id}
                      to={`/issues/${issue.identifier ?? issue.id}`}
                      className="px-4 py-3 text-sm cursor-pointer hover:bg-accent/50 transition-colors no-underline text-inherit block"
                    >
                      <div className="flex items-start gap-2 sm:items-center sm:gap-3">
                        {/* Status icon - left column on mobile */}
                        <span className="shrink-0 sm:hidden">
                          <StatusIcon status={issue.status} blockerAttention={issue.blockerAttention} />
                        </span>

                        {/* Right column on mobile: title + metadata stacked */}
                        <span className="flex min-w-0 flex-1 flex-col gap-1 sm:contents">
                          <span className="line-clamp-2 text-sm sm:order-2 sm:flex-1 sm:min-w-0 sm:line-clamp-none sm:truncate">
                            {issue.title}
                          </span>
                          <span className="flex items-center gap-2 sm:order-1 sm:shrink-0">
                            <span className="hidden sm:inline-flex"><StatusIcon status={issue.status} blockerAttention={issue.blockerAttention} /></span>
                            <span className="text-xs font-mono text-muted-foreground">
                              {issue.identifier ?? issue.id.slice(0, 8)}
                            </span>
                            {issue.assigneeAgentId && (() => {
                              const name = agentName(issue.assigneeAgentId);
                              return name
                                ? <span className="hidden sm:inline-flex"><Identity name={name} size="sm" /></span>
                                : null;
                            })()}
                            <span className="text-xs text-muted-foreground sm:hidden">&middot;</span>
                            <span className="text-xs text-muted-foreground shrink-0 sm:order-last">
                              {timeAgo(issue.updatedAt)}
                            </span>
                          </span>
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            ) : null}
          </div>

        </>
      )}
    </div>
  );
}
