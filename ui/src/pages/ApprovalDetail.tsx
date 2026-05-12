import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";
import { accessApi } from "../api/access";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { StatusBadge } from "../components/StatusBadge";
import { Identity } from "../components/Identity";
import { approvalLabel, typeIcon, defaultTypeIcon, ApprovalPayloadRenderer } from "../components/ApprovalPayload";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, ChevronRight, Sparkles } from "lucide-react";
import type { ApprovalComment } from "@bench/shared";
import { MarkdownBody } from "../components/MarkdownBody";

export function ApprovalDetail() {
  const { approvalId } = useParams<{ approvalId: string }>();
  const { selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState("");
  // Distinct from `commentBody`: this is the rationale that gets attached to a
  // decision (Approve / Reject / Request revision). Required for destructive
  // actions so the requester is never told "rejected" with no reason.
  const [decisionNote, setDecisionNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showRawPayload, setShowRawPayload] = useState(false);

  const { data: approval, isLoading } = useQuery({
    queryKey: queryKeys.approvals.detail(approvalId!),
    queryFn: () => approvalsApi.get(approvalId!),
    enabled: !!approvalId,
  });
  const resolvedCompanyId = approval?.companyId ?? selectedCompanyId;

  const { data: comments } = useQuery({
    queryKey: queryKeys.approvals.comments(approvalId!),
    queryFn: () => approvalsApi.listComments(approvalId!),
    enabled: !!approvalId,
  });

  const { data: linkedIssues } = useQuery({
    queryKey: queryKeys.approvals.issues(approvalId!),
    queryFn: () => approvalsApi.listIssues(approvalId!),
    enabled: !!approvalId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(resolvedCompanyId ?? ""),
    queryFn: () => agentsApi.list(resolvedCompanyId ?? ""),
    enabled: !!resolvedCompanyId,
  });

  // Members lookup so human comments resolve to a real name instead of "Admin"
  // (P1 A6 — see doc/plans/2026-05-11-rbac-and-hire-requests.md §9).
  const { data: membersResponse } = useQuery({
    queryKey: queryKeys.access.companyMembers(resolvedCompanyId ?? ""),
    queryFn: () => accessApi.listMembers(resolvedCompanyId ?? ""),
    enabled: !!resolvedCompanyId,
  });

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId = session?.user.id ?? session?.session.userId ?? null;

  useEffect(() => {
    if (!approval?.companyId || approval.companyId === selectedCompanyId) return;
    setSelectedCompanyId(approval.companyId, { source: "route_sync" });
  }, [approval?.companyId, selectedCompanyId, setSelectedCompanyId]);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents ?? []) map.set(agent.id, agent.name);
    return map;
  }, [agents]);

  // Map principalId → display name (member.user.name → member.user.email →
  // truncated id). Used to resolve `comment.authorUserId` to a label.
  const userNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of membersResponse?.members ?? []) {
      const profile = member.user;
      if (!profile) continue;
      const label = profile.name?.trim() || profile.email?.trim() || profile.id.slice(0, 8);
      map.set(profile.id, label);
    }
    return map;
  }, [membersResponse]);

  // Resolve a userId to a display name for non-comment timeline entries
  // (e.g., the requester or the decider). Mirrors `commentAuthorLabel` but
  // takes a raw id so we can label the lifecycle events the row carries.
  function userIdLabel(userId: string | null | undefined): string {
    if (!userId) return "System";
    if (currentUserId && userId === currentUserId) return "You";
    return userNameById.get(userId) ?? "Member";
  }

  function agentIdLabel(agentId: string | null | undefined): string {
    if (!agentId) return "System";
    return agentNameById.get(agentId) ?? agentId.slice(0, 8);
  }

  /**
   * Activity timeline (P1 A7). Built from what the row reliably exposes today
   * (createdAt, decidedAt, decisionNote, requester/decider ids) plus the
   * comment thread, ordered chronologically. When the server later publishes
   * a richer activity feed for approvals (`approval.created` /
   * `approval.resubmitted` / `approval.decided`) this can be swapped to pull
   * from `/api/companies/:id/activity?entityType=approval&entityId=...`
   * without UI rework.
   */
  type ApprovalTimelineEvent = {
    id: string;
    timestamp: string;
    label: string;
    author: string;
    body?: string | null;
    tone: "neutral" | "amber" | "green" | "red";
  };

  const timelineEvents = useMemo<ApprovalTimelineEvent[]>(() => {
    if (!approval) return [];
    const events: ApprovalTimelineEvent[] = [];
    const requesterLabel = approval.requestedByAgentId
      ? agentIdLabel(approval.requestedByAgentId)
      : userIdLabel(approval.requestedByUserId);
    events.push({
      id: `${approval.id}:filed`,
      timestamp: typeof approval.createdAt === "string"
        ? approval.createdAt
        : new Date(approval.createdAt).toISOString(),
      label: "Filed request",
      author: requesterLabel,
      tone: "neutral",
    });
    for (const c of comments ?? []) {
      events.push({
        id: `comment:${c.id}`,
        timestamp: typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt).toISOString(),
        label: "Comment",
        author: commentAuthorLabel(c),
        body: c.body,
        tone: "neutral",
      });
    }
    if (approval.decidedAt) {
      const tone: ApprovalTimelineEvent["tone"] =
        approval.status === "approved"
          ? "green"
          : approval.status === "rejected"
            ? "red"
            : approval.status === "revision_requested"
              ? "amber"
              : "neutral";
      const label =
        approval.status === "approved"
          ? "Approved"
          : approval.status === "rejected"
            ? "Rejected"
            : approval.status === "revision_requested"
              ? "Requested revision"
              : `Status set to ${approval.status}`;
      events.push({
        id: `${approval.id}:decision`,
        timestamp: typeof approval.decidedAt === "string"
          ? approval.decidedAt
          : new Date(approval.decidedAt).toISOString(),
        label,
        author: userIdLabel(approval.decidedByUserId),
        body: approval.decisionNote,
        tone,
      });
    }
    return events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    // Recomputes on approval/comment refetch and when the user/agent name
    // maps load. `userIdLabel` / `agentIdLabel` / `commentAuthorLabel` close
    // over those maps so they're listed transitively below.
  }, [approval, comments, agentNameById, userNameById, currentUserId]);

  function commentAuthorLabel(comment: ApprovalComment): string {
    if (comment.authorAgentId) {
      return agentNameById.get(comment.authorAgentId) ?? comment.authorAgentId.slice(0, 8);
    }
    if (comment.authorUserId) {
      if (currentUserId && comment.authorUserId === currentUserId) return "You";
      return userNameById.get(comment.authorUserId) ?? "Member";
    }
    // Truly unattributed (legacy server-side action / system comment) — say so
    // explicitly instead of mislabeling as "Admin" (which historically read as
    // an "Admin coworker" in the old language; see doc/coworkers.md).
    return "System";
  }

  useEffect(() => {
    setBreadcrumbs([
      { label: "Approvals", href: "/approvals" },
      { label: approval?.id?.slice(0, 8) ?? approvalId ?? "Approval" },
    ]);
  }, [setBreadcrumbs, approval, approvalId]);

  const refresh = () => {
    if (!approvalId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.approvals.detail(approvalId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.approvals.comments(approvalId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.approvals.issues(approvalId) });
    if (approval?.companyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(approval.companyId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.approvals.list(approval.companyId, "pending"),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(approval.companyId) });
    }
  };

  const trimmedDecisionNote = decisionNote.trim();
  const approveMutation = useMutation({
    mutationFn: () =>
      approvalsApi.approve(approvalId!, trimmedDecisionNote || undefined),
    onSuccess: () => {
      setError(null);
      setDecisionNote("");
      refresh();
      navigate(`/approvals/${approvalId}?resolved=approved`, { replace: true });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Approve failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: () => approvalsApi.reject(approvalId!, trimmedDecisionNote),
    onSuccess: () => {
      setError(null);
      setDecisionNote("");
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Reject failed"),
  });

  const revisionMutation = useMutation({
    mutationFn: () => approvalsApi.requestRevision(approvalId!, trimmedDecisionNote),
    onSuccess: () => {
      setError(null);
      setDecisionNote("");
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Revision request failed"),
  });

  const resubmitMutation = useMutation({
    mutationFn: () => approvalsApi.resubmit(approvalId!),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Resubmit failed"),
  });

  const addCommentMutation = useMutation({
    mutationFn: () => approvalsApi.addComment(approvalId!, commentBody.trim()),
    onSuccess: () => {
      setCommentBody("");
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Comment failed"),
  });

  const deleteAgentMutation = useMutation({
    mutationFn: (agentId: string) => agentsApi.remove(agentId),
    onSuccess: () => {
      setError(null);
      refresh();
      navigate("/approvals");
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Delete failed"),
  });

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (!approval) return <p className="text-sm text-muted-foreground">Approval not found.</p>;

  const payload = approval.payload as Record<string, unknown>;
  const linkedAgentId = typeof payload.agentId === "string" ? payload.agentId : null;
  const isActionable = approval.status === "pending" || approval.status === "revision_requested";
  const isBudgetApproval = approval.type === "budget_override_required";
  // Separation of duties: requester cannot decide their own approval. Server
  // enforces with a 403; UI hides the buttons. See `doc/roles.md`.
  const isOwnRequest =
    !!currentUserId
    && !!approval.requestedByUserId
    && approval.requestedByUserId === currentUserId;
  const TypeIcon = typeIcon[approval.type] ?? defaultTypeIcon;
  const showApprovedBanner = searchParams.get("resolved") === "approved" && approval.status === "approved";
  const primaryLinkedIssue = linkedIssues?.[0] ?? null;
  const resolvedCta =
    primaryLinkedIssue
      ? {
          label:
            (linkedIssues?.length ?? 0) > 1
              ? "Review linked issues"
              : "Review linked issue",
          to: `/issues/${primaryLinkedIssue.identifier ?? primaryLinkedIssue.id}`,
        }
      : linkedAgentId
        ? {
            label: "Open hired coworker",
            to: `/agents/${linkedAgentId}`,
          }
        : {
            label: "Back to approvals",
            to: "/approvals",
          };

  return (
    <div className="space-y-6 max-w-3xl">
      {showApprovedBanner && (
        <div className="border border-green-300 dark:border-green-700/40 bg-green-50 dark:bg-green-900/20 rounded-lg px-4 py-3 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <div className="relative mt-0.5">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-300" />
                <Sparkles className="h-3 w-3 text-green-500 dark:text-green-200 absolute -right-2 -top-1 animate-pulse" />
              </div>
              <div>
                <p className="text-sm text-green-800 dark:text-green-100 font-medium">Approval confirmed</p>
                <p className="text-xs text-green-700 dark:text-green-200/90">
                  Requesting agent was notified to review this approval and linked issues.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-green-400 dark:border-green-600/50 text-green-800 dark:text-green-100 hover:bg-green-100 dark:hover:bg-green-900/30"
              onClick={() => navigate(resolvedCta.to)}
            >
              {resolvedCta.label}
            </Button>
          </div>
        </div>
      )}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TypeIcon className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <h2 className="text-lg font-semibold">{approvalLabel(approval.type, approval.payload as Record<string, unknown> | null)}</h2>
              <p className="text-xs text-muted-foreground font-mono">{approval.id}</p>
            </div>
          </div>
          <StatusBadge status={approval.status} />
        </div>
        <div className="text-sm space-y-1">
          {approval.requestedByAgentId && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Requested by</span>
              <Identity
                name={agentNameById.get(approval.requestedByAgentId) ?? approval.requestedByAgentId.slice(0, 8)}
                size="sm"
              />
            </div>
          )}
          <ApprovalPayloadRenderer type={approval.type} payload={payload} />
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-2"
            onClick={() => setShowRawPayload((v) => !v)}
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${showRawPayload ? "rotate-90" : ""}`} />
            See full request
          </button>
          {showRawPayload && (
            <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-x-auto">
              {JSON.stringify(payload, null, 2)}
            </pre>
          )}
          {approval.decisionNote && (
            <p className="text-xs text-muted-foreground">Decision note: {approval.decisionNote}</p>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {linkedIssues && linkedIssues.length > 0 && (
          <div className="pt-2 border-t border-border/60">
            <p className="text-xs text-muted-foreground mb-1.5">Linked Issues</p>
            <div className="space-y-1.5">
              {linkedIssues.map((issue) => (
                <Link
                  key={issue.id}
                  to={`/issues/${issue.identifier ?? issue.id}`}
                  className="block text-xs rounded border border-border/70 px-2 py-1.5 hover:bg-accent/20"
                >
                  <span className="font-mono text-muted-foreground mr-2">
                    {issue.identifier ?? issue.id.slice(0, 8)}
                  </span>
                  <span>{issue.title}</span>
                </Link>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Linked issues remain open until the requesting agent follows up and closes them.
            </p>
          </div>
        )}
        {isActionable && !isBudgetApproval && !isOwnRequest && (
          <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
            <label htmlFor="approval-decision-note" className="text-xs font-medium text-foreground">
              Decision note <span className="font-normal text-muted-foreground">(optional for approve, required for reject and revision requests)</span>
            </label>
            <Textarea
              id="approval-decision-note"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder="Why are you approving, rejecting, or asking for revisions? The requester will see this."
              rows={3}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {isActionable && !isBudgetApproval && !isOwnRequest && (
            <>
              <Button
                size="sm"
                className="bg-green-700 hover:bg-green-600 text-white"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
              >
                Approve
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending || !trimmedDecisionNote}
                title={
                  trimmedDecisionNote
                    ? undefined
                    : "Add a decision note above before rejecting — the requester needs to know why."
                }
              >
                Reject
              </Button>
            </>
          )}
          {isActionable && !isBudgetApproval && isOwnRequest && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-300">
              You filed this request — another <span className="font-medium">Workspace Owner</span> or
              {" "}<span className="font-medium">Workspace Admin</span> must review it.
            </p>
          )}
          {isBudgetApproval && approval.status === "pending" && (
            <p className="text-sm text-muted-foreground">
              Resolve this budget stop from the budget controls on <Link to="/costs" className="underline underline-offset-2">/costs</Link>.
            </p>
          )}
          {approval.status === "pending" && !isOwnRequest && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => revisionMutation.mutate()}
              disabled={revisionMutation.isPending || !trimmedDecisionNote}
              title={
                trimmedDecisionNote
                  ? undefined
                  : "Add a decision note above explaining what needs to change."
              }
            >
              Request revision
            </Button>
          )}
          {approval.status === "revision_requested" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => resubmitMutation.mutate()}
              disabled={resubmitMutation.isPending}
            >
              Mark resubmitted
            </Button>
          )}
          {approval.status === "rejected" && approval.type === "hire_agent" && linkedAgentId && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40"
              onClick={() => {
                if (!window.confirm("Delete this disapproved agent? This cannot be undone.")) return;
                deleteAgentMutation.mutate(linkedAgentId);
              }}
              disabled={deleteAgentMutation.isPending}
            >
              Delete disapproved agent
            </Button>
          )}
        </div>
      </div>

      <div className="border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium">Activity</h3>
        <ol className="space-y-2">
          {timelineEvents.map((evt) => (
            <li key={evt.id} className="flex items-start gap-3">
              <span
                className={
                  "mt-1.5 inline-flex h-2 w-2 shrink-0 rounded-full " +
                  (evt.tone === "green"
                    ? "bg-green-500"
                    : evt.tone === "red"
                      ? "bg-red-500"
                      : evt.tone === "amber"
                        ? "bg-amber-500"
                        : "bg-muted-foreground/60")
                }
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                  <span className="font-medium text-foreground">{evt.label}</span>
                  <span className="text-muted-foreground">by {evt.author}</span>
                  <span className="text-xs text-muted-foreground">
                    · {new Date(evt.timestamp).toLocaleString()}
                  </span>
                </div>
                {evt.body && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {evt.body}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium">Comments ({comments?.length ?? 0})</h3>
        <div className="space-y-2">
          {(comments ?? []).map((comment: ApprovalComment) => (
            <div key={comment.id} className="border border-border/60 rounded-md p-3">
              <div className="flex items-center justify-between mb-1">
                {comment.authorAgentId ? (
                  <Link to={`/agents/${comment.authorAgentId}`} className="hover:underline">
                    <Identity
                      name={commentAuthorLabel(comment)}
                      size="sm"
                    />
                  </Link>
                ) : (
                  <Identity name={commentAuthorLabel(comment)} size="sm" />
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(comment.createdAt).toLocaleString()}
                </span>
              </div>
              <MarkdownBody className="text-sm">{comment.body}</MarkdownBody>
            </div>
          ))}
        </div>
        <Textarea
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          placeholder="Add a comment..."
          rows={3}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => addCommentMutation.mutate()}
            disabled={!commentBody.trim() || addCommentMutation.isPending}
          >
            {addCommentMutation.isPending ? "Posting…" : "Post comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
