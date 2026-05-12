import { useEffect, useId, useMemo, useState } from "react";
import type { Agent } from "@bench/shared";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { roleLabels } from "./agent-config-primitives";
import { AgentIcon } from "./AgentIconPicker";
import { getCoworkerAvatarContentPath } from "../lib/coworker-avatar-metadata";
import { normalizePersonaEmail } from "../lib/manager-scope";

export function UnifiedManagerPicker({
  agents,
  excludeAgentIds = [],
  reportsToId,
  onReportsToChange,
  benchManagerEmail,
  onBenchManagerEmailChange,
  knownManagerEmails,
  disabled = false,
}: {
  agents: Agent[];
  excludeAgentIds?: string[];
  reportsToId: string | null;
  onReportsToChange: (id: string | null) => void;
  benchManagerEmail: string | null;
  onBenchManagerEmailChange: (email: string | null) => void;
  knownManagerEmails: string[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [addingEmail, setAddingEmail] = useState(false);
  const [draftEmail, setDraftEmail] = useState("");
  const emailInputId = useId();

  const exclude = useMemo(() => new Set(excludeAgentIds), [excludeAgentIds]);
  const rows = useMemo(
    () => agents.filter((a) => a.status !== "terminated" && !exclude.has(a.id)),
    [agents, exclude],
  );

  const currentReport = reportsToId ? agents.find((a) => a.id === reportsToId) : null;
  const terminatedManager = currentReport?.status === "terminated";
  const unknownManager = Boolean(reportsToId && !currentReport);

  const emailOptions = useMemo(() => {
    const set = new Set(knownManagerEmails);
    if (benchManagerEmail) set.add(benchManagerEmail);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [knownManagerEmails, benchManagerEmail]);

  useEffect(() => {
    if (!open) {
      setAddingEmail(false);
      setDraftEmail("");
    }
  }, [open]);

  useEffect(() => {
    if (open && addingEmail) {
      queueMicrotask(() => {
        const el = document.getElementById(emailInputId);
        if (el instanceof HTMLInputElement) el.focus();
      });
    }
  }, [open, addingEmail, emailInputId]);

  function commitDraftEmail() {
    const t = draftEmail.trim();
    if (!t) {
      setAddingEmail(false);
      return;
    }
    onBenchManagerEmailChange(normalizePersonaEmail(t));
    setAddingEmail(false);
    setDraftEmail("");
    setOpen(false);
  }

  const reportSummary = unknownManager ? (
    <span className="min-w-0 truncate text-muted-foreground">Unknown coworker (stale ID)</span>
  ) : currentReport ? (
    <span
      className={cn(
        "min-w-0 truncate",
        terminatedManager && "text-amber-900 dark:text-amber-200",
      )}
    >
      {currentReport.name}
      {terminatedManager ? " (terminated)" : ""}
    </span>
  ) : (
    <span className="min-w-0 truncate text-muted-foreground">No coworker manager</span>
  );

  const emailSummary = benchManagerEmail ? (
    <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{benchManagerEmail}</span>
  ) : (
    <span className="text-[11px] text-muted-foreground">People manager not set</span>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full min-w-0 items-start gap-2 rounded-md border border-border px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50",
            (terminatedManager || unknownManager) && "border-amber-600/45 bg-amber-500/5",
            disabled && "cursor-not-allowed opacity-60",
          )}
          disabled={disabled}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Coworker reporting line
            </span>
            <div className="flex min-w-0 items-center gap-1.5">
              {unknownManager ? (
                <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : currentReport ? (
                <AgentIcon
                  icon={currentReport.icon}
                  avatarContentPath={getCoworkerAvatarContentPath(currentReport.metadata)}
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                />
              ) : (
                <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              {reportSummary}
            </div>
            <span className="pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              People manager (email)
            </span>
            {emailSummary}
          </div>
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(28rem,calc(100vw-1.5rem))] p-0"
        align="start"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command className="rounded-lg border-0 shadow-none">
          <CommandInput placeholder="Search names, roles, or emails…" />
          <CommandList className="max-h-[min(60vh,22rem)]">
            <CommandEmpty>No matches.</CommandEmpty>

            <CommandGroup heading="Coworker reporting line">
              <CommandItem
                value="no manager reporting line clear"
                onSelect={() => {
                  onReportsToChange(null);
                  setOpen(false);
                }}
              >
                <User className="h-3.5 w-3.5" />
                <span>No coworker manager</span>
              </CommandItem>
              {terminatedManager && currentReport && (
                <div className="flex min-w-0 items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground">
                  <AgentIcon
                    icon={currentReport.icon}
                    avatarContentPath={getCoworkerAvatarContentPath(currentReport.metadata)}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="min-w-0 truncate">
                    Current: {currentReport.name} (terminated) — pick another or clear
                  </span>
                </div>
              )}
              {unknownManager && (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  Saved manager is missing from this company. Choose a new manager or clear.
                </div>
              )}
              {rows.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`${a.name} ${roleLabels[a.role] ?? a.role} ${a.id} ${a.coworkerEmail ?? ""}`}
                  onSelect={() => {
                    onReportsToChange(a.id);
                    setOpen(false);
                  }}
                >
                  <AgentIcon
                    icon={a.icon}
                    avatarContentPath={getCoworkerAvatarContentPath(a.metadata)}
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 truncate">{a.name}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                    {roleLabels[a.role] ?? a.role}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="People manager (human email)">
              {benchManagerEmail ? (
                <CommandItem
                  value="clear bench manager email people"
                  onSelect={() => {
                    onBenchManagerEmailChange(null);
                    setOpen(false);
                  }}
                >
                  Clear people manager email
                </CommandItem>
              ) : null}
              {emailOptions.map((email) => (
                <CommandItem
                  key={email}
                  value={email}
                  onSelect={() => {
                    onBenchManagerEmailChange(email);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 truncate font-mono text-[11px]">{email}</span>
                  {benchManagerEmail === email ? (
                    <span className="ml-auto text-[10px] text-muted-foreground">Selected</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Actions">
              <CommandItem
                value="add new manager email plus"
                onSelect={() => {
                  setAddingEmail(true);
                  setDraftEmail("");
                }}
              >
                + Add people manager email
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>

        {addingEmail ? (
          <div className="border-border border-t px-3 py-2">
            <p className="mb-2 text-[11px] text-muted-foreground leading-snug">
              Used for Manager dashboard scope. Normalized to lowercase when saved.
            </p>
            <Input
              id={emailInputId}
              type="email"
              autoComplete="email"
              placeholder="people.manager@company.com"
              className="font-mono text-xs"
              value={draftEmail}
              onChange={(e) => setDraftEmail(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitDraftEmail();
                }
              }}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" className="h-8 text-xs" onClick={commitDraftEmail}>
                Save email
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setAddingEmail(false);
                  setDraftEmail("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
