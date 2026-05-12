# Plan — Workspace terminology, RBAC alignment, and a real Hire / Connector UX

**Date:** 2026‑05‑11
**Owner:** Aashish (review with Bhawna)
**Reading order:** [`vision.md`](../vision.md) → [`roles.md`](../roles.md) → this plan → [`2026-05-11-connector-runtime.md`](./2026-05-11-connector-runtime.md) (parallel track; PR3's hire flow depends on it).

This plan sequences the work needed to bring Bench in line with `vision.md` and `roles.md` — without breaking existing customers — across several PR slices.

---

## 0. Why now

Four recurring user complaints made the gap concrete:

1. **"Why is my hire request unassigned?"** — because hire routing depended on finding an `agents.role = 'admin'` AI bot. There is no such bot in real customer data, so the request fell back to "any active coworker" and the UX felt random.
2. **"Every new issue defaults to Admin hire prep."** — because the prefilled hire-prep title persists as a draft in `NewIssueDialog`, surviving every subsequent open of the dialog.
3. **"Hire a coworker is still not the best experience."** — even with an assignee, the flow reuses the generic Issue composer, the connector implications are invisible until after onboarding, and there's no holistic story for "what does it mean to bring a new coworker in."
4. **"Strange that a manager can approve their own request now?"** — because the server's `/approvals/:id/approve|reject` route only checked workspace membership, not requester identity. The Inbox + Approvals + Approval-detail surfaces all rendered Approve / Reject buttons to the requester themselves. **This was a real privilege-escalation bug** in any workspace where the requester also had board access (most cases): the request was technically pending, but the requester could resolve it with one click. This invalidates the whole point of an approval gate.

Underneath all three is the same architectural issue: hire is a **human approval lifecycle with connector and budget side-effects**, not an Issue. Bench has been pretending it is one to avoid building a second composer. We're going to stop doing that.

In parallel, settings nomenclature drifts ("Workspace settings" in the sidebar, "Company Settings" in the H1, code paths under `/workspace/settings`), the Bench‑settings sub‑page is still labelled "Heartbeats", and there is no top‑bar way out of either settings home. This plan locks the product on **Workspace** as the tenant term, **Coworker schedules** as the renamed Heartbeats page, and `/{prefix}/settings/...` as the canonical settings URL.

---

## 1. PR1 — Terminology, role labels, docs, draft‑bug fix, settings escape hatch *(this PR)*

**Scope is intentionally small** so it merges quickly and unlocks the bigger PRs.

**Ships:**

- New canonical doc: [`doc/roles.md`](../roles.md). Settles "Workspace vs Company" explicitly.
- This plan doc.
- Cross‑links from `doc/coworkers.md`, `doc/persona.md`, `AGENTS.md`.
- `HUMAN_COMPANY_MEMBERSHIP_ROLE_LABELS` updated so UI shows **Workspace Owner / Workspace Admin / People Manager / Viewer**.
- `HUMAN_COMPANY_MEMBERSHIP_ROLE_DESCRIPTIONS` (new) provides the one‑liners shown in the Members & roles picker.
- Sidebar / breadcrumbs / menu items: consistently **"Workspace settings"** everywhere (page H1, breadcrumbs, switcher, invite landing).
- `coworker-language.ts` (CX): drops the "Admin coworker bot" framing; routes hire copy through the human Workspace Owner / Admin model.
- `RequestCoworkerHireDialog.tsx`: copy refresh.
- Bench Settings sidebar: **Heartbeats** → **Coworker schedules**; sub‑page H1, breadcrumb, and explanation text updated.
- Settings escape hatch: an **Exit settings ✕** button in the breadcrumb bar (visible only on `/bench/settings/*` and `/workspace/settings/*`); the Bench‑settings sidebar gains a "← {workspace name}" back link mirroring the workspace‑settings sidebar.
- `NewIssueDialog`: do not persist launcher‑prefilled drafts (fixes "every new issue is Admin hire prep").
- **Self-approval block** (separation of duties — see [`roles.md` §7.1](../roles.md#71-separation-of-duties-mandatory-invariant)): `POST /api/approvals/:id/approve|reject|request-revision` returns `403 self_approval_forbidden` when `req.actor.userId === approval.requestedByUserId`. UI hides the Approve / Reject buttons on the Inbox row, the standalone Approvals card, the Approval detail page, and the Issue-detail attached approval; replaces them with an inline **"Awaiting another reviewer"** badge. New server tests cover self-approve, self-reject, self-revision, and the legitimate cross-user approve.
- **First-hire bypass** (regression fix introduced by the self-approval block — see [`roles.md` §7.1](../roles.md#71-separation-of-duties-mandatory-invariant)): `POST /api/companies/:id/agent-hires` skips creating an `Approval` row when the workspace has zero non-terminated coworkers. Without this, `OnboardingWizard.handleStep2Next` would self-approve the first hire and trip the new 403. The wizard's auto-approve call is removed; it now relies on the server returning no approval for first hires. Server tests in `agent-permissions-routes.test.ts > first-hire bypass` cover (a) bypass when workspace empty + setting on, (b) gate engages for second hire, (c) no-op when setting off.
- **Decision-note plumbing** (close the "rejected with no reason" footgun): the **Decision note** textarea on Approval detail is wired to the Approve / Reject / Request revision mutations and passed as `decisionNote`. Reject and Request revision are disabled until the textarea is non-empty (with a tooltip). The Inbox quick-Reject and `ApprovalCard` inline Reject are converted to **Reject…** links that navigate to the detail page so the same enforcement applies. Approve stays one-click.
- **Onboarding "Workspace" terminology** (Step 1 was the last "Company" surface): wizard step tab, H1, label, placeholder, subtitle, error message, and the markdown header in the auto-built starter task description now use **Workspace**.

**Does not ship (deferred to PR2/PR3+):**

- DB enum rename for `operator` → `people_manager` (label remap is enough for now).
- DB table rename `companies` → `workspaces` (high blast radius; tracked as PR5).
- URL rename `/workspace/settings/*` → `/settings/*` (PR2).
- A typed `hire_request` entity (PR3).
- Hard server‑side gating of every settings sub‑page on `membershipRole` (PR2).
- The hire + connector UX redesign (see **§4 Design brief** below — needs explicit user signoff before we build).

**Risk:** label‑only; the heaviest test churn is the role‑label string in a handful of test files. No DB or API contract changes.

---

## 2. PR2 — Server‑side RBAC enforcement + URL collapse — ✅ shipped

**Goal:** every settings page and mutating endpoint enforces the role matrix in [`roles.md` §5](../roles.md#5-permission-matrix). No more "we filter on the client."

**Shipped:**

- ✅ Single source of truth for the role matrix lives in [`packages/shared/src/access/permission-matrix.ts`](../../packages/shared/src/access/permission-matrix.ts). Both server middleware and the UI hook read from this module so they cannot drift from `roles.md` §5. Unit tests in `permission-matrix.test.ts` enforce that every capability has a row and only references known roles.
- ✅ `assertWorkspaceCapability(req, companyId, capability)` and `resolveWorkspaceRole(req, companyId)` in [`server/src/routes/authz.ts`](../../server/src/routes/authz.ts) are the canonical workspace gates. They:
  1. Run `assertCompanyAccess` first (membership, agent cross-tenant, viewer-on-write).
  2. Short-circuit allow for `local_implicit` boot mode and `instance_admin`.
  3. Look up the caller's resolved workspace role in the matrix and throw `403` with `code: forbidden` and a message naming the capability (so denial logs are attributable).
  Backed by 36 unit tests in `authz-workspace-capability.test.ts` covering every rung (owner / admin / operator / viewer / instance_admin / local_implicit / agent), and the highest-value capability rows.
- ✅ Mutating endpoints migrated off ad-hoc `assertCompanyAccess`-only gating to `assertWorkspaceCapability`:
  - `companies.ts`: PATCH, branding, archive, delete, portability export/import.
  - `agents.ts`: hire (request vs direct), pause/resume (any vs roster), approve, terminate, delete, API key mint/revoke. Roster-scoped checks for People Managers via `assertCanPauseResumeAgent` + the refactored `assertCanUpdateAgent`.
  - `costs.ts`: budget policy + per-coworker budget patches; budget incident resolution.
  - `environments.ts`: environments management + sensitive config read.
  - `access.ts`: member role updates, role-and-grants, archive, permissions. Fixes the pre-existing bug where Workspace Admins were locked out of member management because the `users:manage_permissions` grant was Owner-only.
  - `secrets.ts`: workspace secret create/rotate/update/delete now require `workspace:connectors:wire` (Owner+Admin only).
  - `assets.ts`: workspace logo upload requires `workspace:branding:edit`.
  - `company-skills.ts`: workspace skills library writes require `workspace:skills:edit`.
- ✅ `usePermissions(companyId)` UI hook in [`ui/src/hooks/usePermissions.ts`](../../ui/src/hooks/usePermissions.ts) returns `{ isLoading, boardAccess, isInstanceAdmin, role, can(capability), canInstance(capability) }`, with the same matrix and the same `local_implicit` / `instance_admin` overrides as the server. 13 unit tests in `usePermissions.test.ts` cover role resolution and matrix wiring.
- ✅ `/bench/settings/*` route group gated on `instance_admin` via the new [`InstanceAdminGuard`](../../ui/src/components/access/InstanceAdminGuard.tsx). Non-admins see a friendly 403 page explaining who to ask. Profile remains accessible to all signed-in users.
- ✅ Telemetry: every mutating activity log entry on the migrated routes now records `actorRole` (`owner` / `admin` / `operator` / `viewer` / `instance_admin` / `local_implicit` / `agent`) under `details.actorRole`. The merge happens in `logActivity` itself so adding a single `actorRole:` field at each call site is the only change required. `getActorRoleForCompany(req, companyId)` is the canonical resolver; `getActorInfo(req, companyId?)` also surfaces it for convenience.

**Deferred to follow-ups (not blocking PR2):**

- URL collapse `/{prefix}/workspace/settings/*` → `/{prefix}/settings/*` — the existing `/{prefix}/settings/*` route currently redirects to `/bench/settings/general`, so flipping the canonical workspace settings URL requires either freeing that path first or breaking dozens of in-product links. Tracked as a separate UX cleanup PR.
- Migrating the remaining "ad-hoc role string compare" sites in the UI (`IssueRunLedger`, `CompanyAccess`, `InstanceAccess`, `CloudAccessGate`) to `usePermissions`. The hook is in place; the migration is mechanical.
- Backfilling `actorRole` to lower-stakes mutating endpoints (issues, comments, projects, goals, routines) — pattern is established and uniform.

**DB:** none. Still uses `operator` literal.

---

## 3. PR3 — Hire Request as a typed entity

**Goal:** stop reusing the issue composer for hires. A hire is a structured object with its own approval lifecycle.

**Ships:**

- New schema:
  ```
  hire_requests (
    id uuid pk,
    company_id uuid fk,
    requested_by user_id fk,
    role text,                       -- preset key or 'custom'
    custom_role_description text,
    requested_connectors text[],
    monthly_budget_cents int,
    justification text,
    status text,                     -- 'pending' | 'approved' | 'rejected' | 'cancelled'
    decided_by user_id fk null,
    decided_at timestamptz null,
    created_agent_id uuid fk null,   -- set when approval onboards a coworker
    created_at, updated_at
  );
  ```
- Server: `POST /api/companies/:id/hire-requests`, `GET /api/companies/:id/hire-requests`, `POST /api/hire-requests/:id/approve`, `POST /api/hire-requests/:id/reject`. Each writes an `Approval` row of type `hire_agent` so it shows up in the existing Approvals inbox.
- UI: see **§4 Design brief** below for the full hire + connector UX. The PR ships the schema and dialog skeleton; the brief defines the surface.

**Risk:** new table + migration. Behind a feature flag (`features.hireRequestEntity`) for rollout.

---

## 4. PR3 design brief — Hire & Connector UX *(needs user signoff before build)*

The current "Request a new coworker hire" dialog is a thin wrapper around the issue composer. It does the bare minimum (pick a preset, type some text, submit) but the operator and manager are then dropped into a generic ticket flow, with **no visibility into the connector and budget consequences of the hire**. Connectors are wired separately, after the coworker is already created, in a different surface. The two flows should be one story.

This section is a **design contract**, not yet code. We need user signoff on the shape before PR3 starts.

### 4.1 The hire is the contract

A hire is an **approval‑gated agreement** between three actors: the **People Manager** who wants the coworker, the **Workspace Owner / Admin** who pays for and approves it, and **Bench** which provisions the connectors and budget. The product should make all three consequences visible **at request time**, not after.

The Hire Request payload therefore captures:

1. **Role** — preset (Engineer, Designer, PM, …) or custom (free‑text role + capability bullets, same as onboarding).
2. **Tools the coworker needs** — pre‑checked from the role preset, editable. Each tool shows:
   - Connector status: ✅ already wired in this workspace, 🟡 wired but needs a scope upgrade, ❌ not wired (Admin will need to OAuth on approval).
   - Why it's needed (one line, tied to capabilities).
3. **People manager email** — defaults to the requester. Editable by Admins/Owners (e.g. CEO requesting a hire for a director).
4. **Monthly budget cap** — preset ranges by role; manager can ask for higher; Owner sees the delta vs workspace budget left.
5. **Justification** — one paragraph; what work this coworker unblocks. Required for non‑preset hires; optional for presets.

Everything above is **structured**, not free‑text in an issue body.

### 4.2 Three modes, one composer

The same dialog renders three views depending on who has it open:

- **People Manager view (Request mode):** all fields editable; connector status is **read‑only** with a green/amber/red dot — manager understands cost without controlling it. Submit button: "Send to Workspace Admin." Confirmation toast: "Sent. {Owner|Admin name} will review."
- **Workspace Admin / Owner view (Review mode):** all fields above + reviewer notes + an **"Approve & Onboard"** button that walks the connectors not‑yet‑wired in a guided OAuth flow, then creates the coworker with `metadata.benchManagerEmail = requester.email`. Reject button is destructive but supports a reason.
- **Provisioning view (after Approve):** a checklist that shows the coworker being created, each connector being wired, the budget being applied, and the manager being notified — like a short setup wizard, but for the hire as a whole. If a step fails (OAuth declined, budget cap exceeded), the wizard pauses with a clear retry / abandon affordance instead of leaving an orphaned half‑hire.

### 4.3 Connectors are first‑class in the hire flow

Today: a manager picks a Designer preset → a coworker is created → later, the Admin discovers Figma isn't wired and has to fix it. Manager waits. Coworker sits idle.

Tomorrow:

- The **role preset** declares its connector requirements (already true for `COWORKER_ONBOARDING_PRESETS`). Each preset row carries `requiredConnectors: ConnectorId[]` and `optionalConnectors: ConnectorId[]`.
- The **Hire Request dialog** computes wiring status against the workspace's existing connectors and surfaces it inline (the green/amber/red dot above).
- On **Approve**, the provisioning view walks any `❌ not wired` connectors **before** creating the coworker. The Admin clicks "Wire Figma" → standard OAuth popup → returns. Once all required connectors are green, the coworker is provisioned. (Optional connectors can be deferred without blocking.)
- The Connector Directory page (workspace settings → Connectors) keeps its standalone existence for ad‑hoc wiring, but it's no longer the primary entrypoint for "this hire needs Slack." The hire flow drives that path.

### 4.4 The "after" experience for the People Manager

When a hire is approved, the manager doesn't need to log into Bench to learn it. They get an email / Slack DM (if Slack is wired):

> **Bench: your hire is online.** Riya (Designer) joined Cisco Engineering today. She has Figma, Jira, and Slack access. Her first day is set up — say hi in #design, or open her in Bench to add specific instructions.

That email is the receipt. The dashboard is for when they explicitly want to look in.

### 4.5 Edge cases the brief calls out

- **CEO / Owner self‑hires** — bypass the manager‑request step; the same dialog opens directly in Review mode and is auto‑approved on submit (still creates the audit entry).
- **Manager has no budget headroom** — the Owner sees a clearly highlighted "this will exceed your remaining workspace cap by $X" warning at review time. Approval requires either bumping the cap or rejecting.
- **Same‑name role exists** — no de‑duplication today; the Hire Request dialog warns "you already have 2 Designers reporting to you" so the manager can confirm intentionally.
- **Pending hire visibility** — managers see their pending requests on the Dashboard ("1 hire pending Owner approval since Mon"). Admins see the count in the sidebar Approvals badge.

### 4.6 What to confirm before building

Open questions for the user:

1. **Connector wiring during approval** — are we OK forcing the Admin to OAuth all required connectors before the coworker is created, or should creation proceed and the coworker stay paused until connectors are green? *(Recommendation: force it; otherwise we ship half‑hires.)*
2. **Self‑hire by Owner** — auto‑approve on submit, or always require a second pair of eyes? *(Recommendation: auto‑approve for Owners; require a second Admin signoff only if a workspace has more than one Owner.)*
3. **Email/Slack notification dependency** — is it acceptable to ship PR3 without external notifications (Bench‑only) and add the email/Slack DM in PR4, or is the notification part of the MVP? *(Recommendation: ship Bench‑only first; add notifications in PR4 to keep PR3 reviewable.)*
4. **People manager email overrides** — should anyone other than the original requester (Owner / Admin) be able to assign the new coworker to a *different* manager during approval? *(Recommendation: yes, but with an explicit confirmation step so it's deliberate.)*
5. **Budget warnings** — soft warning + allow override, or hard block until cap is bumped? *(Recommendation: soft warning for Admins, hard block for Owners — Owners are the ones who can bump the cap right there.)*

---

## 5. PR4 — Out‑of‑Bench presence (P1, separate quarter)

The vision says **managers should not live in Bench**. This PR adds the proactive surfaces that make that real.

- Daily manager digest (email + Slack DM): yesterday's coworker activity, blocked items, pending hire requests, budget burn for their roster.
- Coworker outbound: Slack DMs and email summaries when a task changes hands.
- Per‑manager unsubscribe / cadence settings.

Tracked here for sequencing only; spec lives in a separate doc when we pick it up.

---

## 6. PR5 — Schema renames (P2, when stable)

Once PR2 is rolled out and PR3 has been live a quarter:

- Add `people_manager` as a new `companyMemberships.membershipRole` enum value alongside `operator`. New writes use `people_manager`; reads accept both. Migration backfills existing `operator` rows. Drop `operator` after one release cycle.
- Rename DB table `companies` → `workspaces` (rename + view alias for backward compat in app code, then refactor all `companyId` columns and `company` references over a release).

These are mechanical but high‑blast‑radius; sequencing them last avoids churning two large PRs simultaneously.

---

## 7. Out of scope (intentionally)

- Cross‑workspace role inheritance / group management. Bench is per‑workspace today; expanding identity to org‑level groups (a true "Cisco" tier above its workspaces) is a future project.
- Custom roles / custom permission sets. We standardize on the four product roles first; custom roles is a deliberate "later."
- Public hire approvals (e.g., a CFO who isn't a Bench user clicking an email link). Out of scope; require all approvers to be Bench users in this iteration.

---

## 8. Acceptance for PR1 (this PR)

- `pnpm -r typecheck` passes.
- `pnpm test` passes (modulo unrelated existing failures).
- Sidebar shows "Workspace settings" everywhere. Page H1 says "Workspace settings."
- Members & roles dropdown shows **"Workspace Owner / Workspace Admin / People Manager / Viewer"**.
- Bench Settings sidebar shows **"Coworker schedules"** instead of "Heartbeats"; the sub‑page H1, breadcrumb, and intro text use the new term.
- Both settings homes (`/bench/settings/*` and `/workspace/settings/*`) show an **Exit settings ✕** button in the top‑right of the breadcrumb bar that returns to `/dashboard`.
- The Bench‑settings sidebar has a "← {workspace name}" link at the top.
- Opening **Request coworker hire** never shows the old "Admin coworker bot" copy; references **Workspace Owner / Admin**.
- After opening **Hire prep: …** from `NewAgentDialog` and dismissing without submit, the next **New Issue** opens blank — not pre‑filled with hire prep text.
- **Hire requester sees a read-only "Awaiting another reviewer" badge** in their Inbox / Approvals / Approval detail / Issue detail; never the Approve / Reject buttons. Server returns `403 self_approval_forbidden` if they POST anyway.
- New docs: `doc/roles.md`, `doc/plans/2026-05-11-rbac-and-hire-requests.md`. Cross‑links updated.
- **OnboardingWizard Step 1** says **"Name your workspace"**, label "Workspace name", placeholder "Acme Engineering", subtitle references workspaces (not "your company").
- **First hire in a brand-new workspace creates the coworker without an Approval row**, even when the workspace has `requireBoardApprovalForNewAgents = true`. The activity log entry includes `firstHireBypass: true`. Subsequent hires gate normally.
- **Reject and Request revision require a non-empty decision note** in the UI; the textarea content is sent as `decisionNote` on Approve / Reject / Request revision.
- **Inbox + ApprovalCard quick-Reject is removed**; the Reject button is now a **Reject…** link to the approval detail page so a note must be captured before the reject fires.
- **Dashboard shows a "You have N pending hire request(s)" strip** for the requester, sourced from `approvalsApi.list` filtered to their own open `hire_agent` approvals, with the oldest age and a deep-link to `/approvals/:id`.
- **ApprovalDetail comments resolve to a real human label** — agent name → "You" → workspace member display name → "Member" → "System". No more `Identity name="Admin"` for legacy unattributed comments.
- **ApprovalDetail shows an Activity panel** above Comments (Filed → comments → Decision), color-coded by tone, with author + timestamp + decision note per row.
- **ApprovalCard pending approvals show an age pill** — **Stale** (amber) after 24h, **Overdue** (red) after 72h.
- **OnboardingWizard close button is in the top-right** with `aria-label`; Step 1 shows a "Skip — I'll set up manually" footer link when no workspace exists yet.
- **OnboardingWizard env-probe failure surfaces "Skip and finish — coworker will start paused"** that bypasses the env check, completes the hire, and immediately pauses the coworker so it can't run with a broken adapter.

---

## 9. PR1.5 — Approval & onboarding polish *(folded into PR1 per user request: "interleave the smaller P1 fixes")*

After the holistic audit, several non-regression UX gaps were small enough to ship alongside the P0 fixes. **All items below shipped in PR1.** Acceptance for each is captured in §8 above; the descriptions stay here as the design rationale.

**Approval surface — shipped**
- **A5 — Pending hire visibility for the requester.** ✅ Dashboard now shows an amber strip ("You have N pending hire request(s) — oldest filed X ago — awaiting a Workspace Owner or Admin reviewer") for any signed-in user with open hire requests they filed. Driven by a new `useQuery` in `Dashboard.tsx` that filters `approvalsApi.list` to `type === "hire_agent"` + `requestedByUserId === currentUserId` + status pending/revision_requested. No schema change.
- **A6 — "Admin" identity in unattributed comments.** ✅ `ApprovalDetail` now resolves human comments to a real label via `commentAuthorLabel(comment)`: agent name → "You" (when `authorUserId === currentUserId`) → workspace member display name → "Member" → "System" (truly unattributed). Members come from the new `accessApi.listMembers` query. Removes the misleading `Identity name="Admin"` from the legacy "Admin coworker" era.
- **A7 — Approval timeline.** ✅ `ApprovalDetail` renders an "Activity" panel above Comments that lists Filed → comments (interleaved chronologically) → Decision (Approved / Rejected / Requested revision) with author + timestamp + decision note per row, color-coded by status. Built from `approval.createdAt` + `comments` + `approval.decided*` for now; can swap to a real activity-log query once the server publishes `approval.created` / `approval.resubmitted` / `approval.decided` events without UI rework.
- **A8 — Age signal on pending approvals.** ✅ `ApprovalCard` shows an inline pill next to "created X ago": amber **Stale** after 24h and red **Overdue** after 72h, only for `pending` and `revision_requested` statuses. Hover title explains the threshold. The "created X ago" line itself recolors to match the tone so the signal is visible at a glance on dense Inbox lists.

**Onboarding surface — shipped**
- **B3 — Custom role title persistence.** ✅ Verified end-to-end: `OnboardingWizard.handleStep2Next` already passes `title: hireTitle` to `agentsApi.hire`; the server validator accepts it (`createAgentHireSchema.title`) and the `agentsService.create` insert spreads it into the row. `OrgChart.tsx` already prefers `agent?.title ?? roleLabel(node.role)`. No code change needed; closing the gap was a verification job. (A future `agent.customRoleLabel` column is still nice-to-have but not required.)
- **B6 — Wizard close button.** ✅ Moved from `absolute top-4 left-4` to `absolute top-4 right-4` with `aria-label="Close onboarding"` so it matches every other dialog and the settings exit ✕.
- **B7 — Skip onboarding escape.** ✅ Added a "Skip — I'll set up manually" link in the wizard footer, visible only on Step 1 when no workspace exists yet (so we don't strand a user mid-hire).
- **B8 — Adapter env check escape.** ✅ When the local-CLI env probe fails (`adapterEnvResult?.status === "fail"`), the failure block now offers a **Skip and finish — coworker will start paused** button that calls `handleStep2Next({ bypassEnvCheck: true })`. Server-side, the hire goes through normally; UI-side, immediately after `agentsApi.hire` returns we call `agentsApi.pause(agent.id, createdCompanyId)` so the coworker doesn't try to act with a broken adapter. The user fixes env later from Coworker → Configuration → Adapter and Resume.

**Still deferred (not in PR1)**
- **B5 — Connector wiring during onboarding.** Depends on CRP2/CRP3/CRP10 of the Connector Runtime. The runtime spine (CRP1) shipped in parallel; see [`2026-05-11-connector-runtime.md`](./2026-05-11-connector-runtime.md) §5.5 for the hire‑flow integration design and §7 for the CRP1‑shipped notes.
- **A9 / A10 — Hire as a typed entity, bulk approve.** Tracked in PR3 above (§3 + §4 design brief).
- **B9 — Consolidating the three first-run paths** (`OnboardingWizard`, `NewAgentDialog`, `RequestCoworkerHireDialog`). Refactor; lands in its own PR after PR3 ships.
