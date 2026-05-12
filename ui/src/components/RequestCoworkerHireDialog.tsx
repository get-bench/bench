import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CoworkerRole } from "@bench/shared";
import { COWORKER_ROLE_LABELS } from "@bench/shared";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { CX } from "../lib/coworker-language";
import {
  HIRE_REQUEST_STANDARD_ROLES,
  ROLE_HIRE_CAPABILITY_SUMMARY,
  buildHireRequestIssueBody,
  generateHireRequestTicketId,
} from "../lib/coworker-role-hire-request";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "../lib/utils";

type HireKind = "standard" | "custom";

export function RequestCoworkerHireDialog() {
  const {
    requestCoworkerHireOpen,
    closeRequestCoworkerHire,
    openNewIssue,
  } = useDialog();
  const { selectedCompanyId } = useCompany();

  const [kind, setKind] = useState<HireKind>("standard");
  const [selectedRole, setSelectedRole] = useState<Exclude<CoworkerRole, "admin"> | null>(null);
  const [customRoleName, setCustomRoleName] = useState("");
  const [customCapabilities, setCustomCapabilities] = useState("");
  const [notes, setNotes] = useState("");

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    enabled: requestCoworkerHireOpen,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && requestCoworkerHireOpen,
  });

  const adminAgent = useMemo(() => (agents ?? []).find((a) => a.role === "admin"), [agents]);

  const managerEmail = session?.user?.email ?? null;

  useEffect(() => {
    if (!requestCoworkerHireOpen) {
      setKind("standard");
      setSelectedRole(null);
      setCustomRoleName("");
      setCustomCapabilities("");
      setNotes("");
    }
  }, [requestCoworkerHireOpen]);

  const canSubmit =
    kind === "standard"
      ? selectedRole != null
      : Boolean(customRoleName.trim() && customCapabilities.trim());

  function submit() {
    if (!selectedCompanyId || !canSubmit) return;
    const ticketId = generateHireRequestTicketId();
    const title = `${CX.requestHireTitle} (${ticketId})`;

    const description =
      kind === "standard" && selectedRole
        ? buildHireRequestIssueBody({
            ticketId,
            managerEmail,
            kind: "standard",
            role: selectedRole,
            notes,
          })
        : buildHireRequestIssueBody({
            ticketId,
            managerEmail,
            kind: "custom",
            customRoleName,
            customCapabilities,
            notes,
          });

    closeRequestCoworkerHire();
    queueMicrotask(() => {
      openNewIssue({
        assigneeAgentId: adminAgent?.id,
        title,
        description,
      });
    });
  }

  return (
    <Dialog
      open={requestCoworkerHireOpen}
      onOpenChange={(open) => {
        if (!open) closeRequestCoworkerHire();
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[min(90vh,720px)] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b border-border">
          <DialogTitle>Request a new coworker hire</DialogTitle>
          <DialogDescription className="text-left">
            Pick a standard Bench role (with typical capabilities) or describe a custom role. This opens an{" "}
            <strong>issue ticket</strong> with id <span className="font-mono">HIRE-…</span> assigned to your company{" "}
            <strong>{CX.approverRoleLabel}</strong> for review.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div className="flex rounded-md border border-border p-0.5 bg-muted/40 text-xs">
            <button
              type="button"
              className={cn(
                "flex-1 rounded px-2 py-1.5 font-medium transition-colors",
                kind === "standard" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground",
              )}
              onClick={() => {
                setKind("standard");
                setCustomRoleName("");
                setCustomCapabilities("");
              }}
            >
              Standard role
            </button>
            <button
              type="button"
              className={cn(
                "flex-1 rounded px-2 py-1.5 font-medium transition-colors",
                kind === "custom" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground",
              )}
              onClick={() => {
                setKind("custom");
                setSelectedRole(null);
              }}
            >
              Custom role
            </button>
          </div>

          {kind === "standard" ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Select the role that best matches the hire. {CX.approverRoleBlurb}
              </p>
              <div className="grid gap-2 max-h-[240px] overflow-y-auto pr-1">
                {HIRE_REQUEST_STANDARD_ROLES.map((role) => {
                  const active = selectedRole === role;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setSelectedRole(role)}
                      className={cn(
                        "text-left rounded-lg border px-3 py-2 transition-colors",
                        active
                          ? "border-foreground/40 bg-accent/40"
                          : "border-border hover:bg-accent/30",
                      )}
                    >
                      <div className="text-sm font-medium text-foreground">{COWORKER_ROLE_LABELS[role]}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                        {ROLE_HIRE_CAPABILITY_SUMMARY[role]}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="custom-role-name" className="text-xs">
                  Proposed role name
                </Label>
                <input
                  id="custom-role-name"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                  placeholder="e.g. Legal analyst, Sales ops"
                  value={customRoleName}
                  onChange={(e) => setCustomRoleName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="custom-role-cap" className="text-xs">
                  Capabilities & responsibilities
                </Label>
                <Textarea
                  id="custom-role-cap"
                  className="min-h-[100px] text-sm resize-y"
                  placeholder="What should this coworker own? Tools, systems, approval needs, cadence…"
                  value={customCapabilities}
                  onChange={(e) => setCustomCapabilities(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="hire-notes" className="text-xs">
              Additional context (optional)
            </Label>
            <Textarea
              id="hire-notes"
              className="min-h-[72px] text-sm resize-y"
              placeholder="Timeline, Slack channels, repos, urgency, budget hints…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {!adminAgent ? (
            <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-md px-3 py-2">
              No Admin coworker found in this company yet. The ticket will still be created; assign it to your{" "}
              {CX.approverRoleLabel} manually if needed.
            </p>
          ) : null}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border shrink-0 gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => closeRequestCoworkerHire()}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit || !selectedCompanyId} onClick={submit}>
            Create hire ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
