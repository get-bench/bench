import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent } from "@bench/shared";
import { Link } from "@/lib/router";
import { Bot, UserPlus2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl } from "../lib/utils";
import {
  buildClaimManagerMetadataPatch,
  findUnassignedCoworkers,
  normalizePersonaEmail,
} from "../lib/manager-scope";

/**
 * Manager-view empty-state recovery card. Renders only when:
 *  - viewer is in Manager view AND has zero scoped coworkers, AND
 *  - viewer has a signed-in email (otherwise scoping is impossible), AND
 *  - the workspace contains coworkers whose `metadata.benchManagerEmail` is unset.
 *
 * Why this exists: the Manager view filters strictly by exact match on
 * `metadata.benchManagerEmail`. Coworkers hired before that field defaulted to
 * the signed-in user (or hired by an admin who left it blank) become silently
 * invisible here even though the workspace clearly has coworkers in Admin view.
 * This card lets the manager self-claim those orphans without filing a ticket
 * with their workspace admin.
 *
 * The PATCH /agents/:id endpoint replaces metadata wholesale, so we MUST merge
 * with each agent's existing metadata locally — see
 * `buildClaimManagerMetadataPatch`.
 */
export function ManagerScopeRecovery({
  companyId,
  agents,
  sessionEmail,
}: {
  companyId: string;
  agents: Agent[] | undefined;
  sessionEmail: string | null;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const unassigned = useMemo(
    () => (agents ? findUnassignedCoworkers(agents) : []),
    [agents],
  );

  const claimAll = useMutation({
    mutationFn: async () => {
      if (!sessionEmail) {
        throw new Error("Sign in with an email to claim coworkers.");
      }
      const normalized = normalizePersonaEmail(sessionEmail);
      // Sequential PATCHes to avoid hammering the server with N parallel
      // writes when N could be large. Each request is small (single agent).
      // If one fails we surface the partial-success state — the rest of the
      // already-claimed coworkers stay claimed and the user can retry.
      let claimed = 0;
      for (const agent of unassigned) {
        const metadataPatch = buildClaimManagerMetadataPatch(agent.metadata, normalized);
        await agentsApi.update(agent.id, { metadata: metadataPatch }, companyId);
        claimed += 1;
      }
      return claimed;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to claim coworkers.");
    },
  });

  if (!sessionEmail || unassigned.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {unassigned.length} coworker{unassigned.length === 1 ? "" : "s"} in this workspace{" "}
            {unassigned.length === 1 ? "has" : "have"} no people manager assigned
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
            Manager view only shows coworkers where{" "}
            <span className="font-mono">metadata.benchManagerEmail</span> matches your signed-in
            email. Claim them as your reports, or open a coworker to assign a different manager.
          </p>
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded border border-border bg-background/40">
        {unassigned.slice(0, 5).map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
          >
            <Link
              to={agentUrl(a)}
              className="flex min-w-0 items-center gap-2 hover:text-foreground"
            >
              <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate font-medium">{a.name}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {a.role}
              </span>
            </Link>
            <span className="shrink-0 text-[10px] text-muted-foreground">{a.status}</span>
          </li>
        ))}
        {unassigned.length > 5 ? (
          <li className="px-3 py-1.5 text-[11px] text-muted-foreground">
            +{unassigned.length - 5} more not shown
          </li>
        ) : null}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={claimAll.isPending}
          onClick={() => {
            setError(null);
            claimAll.mutate();
          }}
        >
          <UserPlus2 className="h-3.5 w-3.5" />
          {claimAll.isPending
            ? `Claiming ${unassigned.length}…`
            : `Claim ${unassigned.length} as my report${unassigned.length === 1 ? "" : "s"}`}
        </Button>
        <Link
          to="/agents"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Or assign per-coworker manually
        </Link>
        {error ? (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
