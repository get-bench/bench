import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { Link } from "@/lib/router";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Identity } from "./Identity";
import {
  approvalSubject,
  typeIcon,
  defaultTypeIcon,
  ApprovalPayloadRenderer,
  typeLabel,
} from "./ApprovalPayload";
import { timeAgo } from "../lib/timeAgo";
import type { Approval, Agent } from "@bench/shared";
import { cn } from "@/lib/utils";

function statusIcon(status: string) {
  if (status === "approved") return <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />;
  if (status === "rejected") return <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />;
  if (status === "revision_requested") return <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />;
  if (status === "pending") return <Clock className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />;
  return null;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const STALE_THRESHOLD_MS = 24 * ONE_HOUR_MS;
const OVERDUE_THRESHOLD_MS = 72 * ONE_HOUR_MS;

/**
 * Age signal for *open* approvals (pending / revision_requested). Returns
 * `null` for fresh requests and resolved statuses so we don't shame someone
 * for an approved hire that happens to be three weeks old.
 *
 * Thresholds match the policy in `doc/plans/2026-05-11-rbac-and-hire-requests.md`
 * §9 (P1 A8): amber after 24h, red after 72h.
 */
function approvalAgeSignal(approval: Approval): {
  tone: "amber" | "red";
  label: string;
} | null {
  if (approval.status !== "pending" && approval.status !== "revision_requested") {
    return null;
  }
  const created = new Date(approval.createdAt).getTime();
  if (!Number.isFinite(created)) return null;
  const ageMs = Date.now() - created;
  if (ageMs >= OVERDUE_THRESHOLD_MS) {
    return { tone: "red", label: "Overdue" };
  }
  if (ageMs >= STALE_THRESHOLD_MS) {
    return { tone: "amber", label: "Stale" };
  }
  return null;
}

export function ApprovalCard({
  approval,
  requesterAgent,
  viewerUserId = null,
  onApprove,
  onReject,
  onOpen,
  detailLink,
  isPending = false,
  pendingAction = null,
}: {
  approval: Approval;
  requesterAgent: Agent | null;
  /**
   * The signed-in user's ID. When provided, the Approve/Reject buttons are
   * suppressed if the viewer is the requester (separation-of-duties — see
   * `doc/roles.md`). Server enforces this with a 403; UI hides to avoid the
   * footgun.
   */
  viewerUserId?: string | null;
  onApprove?: () => void;
  onReject?: () => void;
  onOpen?: () => void;
  detailLink?: string;
  isPending?: boolean;
  pendingAction?: "approve" | "reject" | null;
}) {
  const payload = approval.payload as Record<string, unknown> | null;
  const Icon = typeIcon[approval.type] ?? defaultTypeIcon;
  const kindLabel = typeLabel[approval.type] ?? approval.type;
  const subject = approvalSubject(payload);
  const isOwnRequest =
    !!viewerUserId
    && !!approval.requestedByUserId
    && approval.requestedByUserId === viewerUserId;
  const showResolutionButtons =
    Boolean(onApprove && onReject) &&
    approval.type !== "budget_override_required" &&
    (approval.status === "pending" || approval.status === "revision_requested") &&
    !isOwnRequest;
  const showAwaitingOthersBadge =
    isOwnRequest &&
    (approval.status === "pending" || approval.status === "revision_requested");
  const ageSignal = approvalAgeSignal(approval);
  const hasFooter = showResolutionButtons || showAwaitingOthersBadge || Boolean(detailLink || onOpen);

  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/80">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-border/70 bg-background/70 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                >
                  {kindLabel}
                </Badge>
                {requesterAgent && (
                  <div className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Requested by</span>
                    <Identity name={requesterAgent.name} size="sm" className="inline-flex" />
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold leading-6 text-foreground">
                  {subject ?? kindLabel}
                </h3>
                <p
                  className={cn(
                    "flex flex-wrap items-center gap-1.5 text-xs leading-5",
                    ageSignal?.tone === "red"
                      ? "text-red-600 dark:text-red-400"
                      : ageSignal?.tone === "amber"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground",
                  )}
                >
                  <span>Approval request created {timeAgo(approval.createdAt)}</span>
                  {ageSignal && (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        ageSignal.tone === "red"
                          ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300"
                          : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300",
                      )}
                      title={
                        ageSignal.tone === "red"
                          ? "This request has been waiting more than 72 hours."
                          : "This request has been waiting more than 24 hours."
                      }
                    >
                      {ageSignal.label}
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="shrink-0">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-xs text-muted-foreground">
            {statusIcon(approval.status)}
            <span className="capitalize">{approval.status.replace(/_/g, " ")}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-border/60 pt-4">
        <ApprovalPayloadRenderer
          type={approval.type}
          payload={approval.payload}
          hidePrimaryTitle={Boolean(subject)}
        />
      </div>

      {approval.decisionNote && (
        <div className="mt-4 rounded-lg border border-border/60 bg-muted/30 px-3.5 py-3 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">Decision note.</span> {approval.decisionNote}
        </div>
      )}

      {hasFooter ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {showResolutionButtons && (
              <>
                <Button
                  size="sm"
                  className="bg-green-700 hover:bg-green-600 text-white"
                  onClick={onApprove}
                  disabled={isPending}
                >
                  {pendingAction === "approve" ? "Approving..." : "Approve"}
                </Button>
                {/*
                  Reject is destructive — the requester deserves a reason. When a
                  detailLink is available we route Reject to the approval detail
                  page so the reviewer must type a decision note (enforced in
                  ApprovalDetail). When there's no detail page (storybook, legacy
                  callers) we fall back to the inline onReject callback.
                */}
                {detailLink ? (
                  <Link
                    to={detailLink}
                    className={cn(
                      buttonVariants({ variant: "destructive", size: "sm" }),
                    )}
                    aria-label="Reject (opens detail page so you can add a note)"
                  >
                    Reject…
                  </Link>
                ) : (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={onReject}
                    disabled={isPending}
                  >
                    {pendingAction === "reject" ? "Rejecting..." : "Reject"}
                  </Button>
                )}
              </>
            )}
            {showAwaitingOthersBadge && (
              <span
                className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-300"
                title="You filed this request — another Workspace Owner or Admin must review it."
              >
                Awaiting another reviewer
              </span>
            )}
          </div>
          {(detailLink || onOpen) ? (
            detailLink ? (
              <Link
                to={detailLink}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-auto px-2 text-xs text-muted-foreground")}
              >
                View details
              </Link>
            ) : (
              <Button variant="ghost" size="sm" className="h-auto px-2 text-xs text-muted-foreground" onClick={onOpen}>
                View details
              </Button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
