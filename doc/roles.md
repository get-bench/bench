# Bench — Roles & Access (canonical)

This document is the single source of truth for **who can do what** in Bench. Product copy, persona docs, RBAC code, and onboarding flows must agree with this file. If you change a role's powers, update this document **first**, then code.

> Related reading
> - [`vision.md`](./vision.md) — product vision; managers should not live in Bench.
> - [`persona.md`](./persona.md) — narrative human personas; this doc is the formal contract.
> - [`coworkers.md`](./coworkers.md) — coworker (AI hire) is **not** a human role.
> - [`plans/2026-05-11-rbac-and-hire-requests.md`](./plans/2026-05-11-rbac-and-hire-requests.md) — implementation plan & PR sequencing.
>
> **Implementation:** the `§5 Permission matrix` below is enforced from a single typed source — [`packages/shared/src/access/permission-matrix.ts`](../packages/shared/src/access/permission-matrix.ts). Server gates use `assertWorkspaceCapability` in [`server/src/routes/authz.ts`](../server/src/routes/authz.ts); the UI uses [`usePermissions()`](../ui/src/hooks/usePermissions.ts). Both read the same matrix, so they cannot drift. **If you change a row in the table below, also update `permission-matrix.ts` in the same PR — and the `permission-matrix.test.ts` suite enforces that every capability has a row.**

---

## 1. The model in one paragraph

Bench has **two scopes** (instance and workspace) and **five roles** (one instance, four workspace). The patterns are intentionally familiar from Slack, Atlassian, and GitHub: a tenant‑level superuser handles SSO and platform identity; each workspace has an owner with billing authority, delegated admins, people managers who own a roster, and members who file work. **Coworkers are AI hires, not humans, and never appear in the human RBAC matrix.**

---

## 2. "Workspace" vs "Company" — terminology

Customers think of their parent organisation as the **company** (Cisco, Google, Microsoft — there is exactly one) and of operational units inside it as **workspaces** (Cisco Engineering, Google Cloud Team, Microsoft Azure GTM — there can be many). Bench's tenant unit behaves like a workspace: a customer typically runs more than one of them.

The product therefore uses **Workspace** consistently in user‑facing copy.

The DB table that stores these tenants is still named `companies` for historical reasons (and renaming a table is a separate, riskier project tracked in [the RBAC plan](./plans/2026-05-11-rbac-and-hire-requests.md) as PR5). **Code may reference `company`; product copy never does.** UI labels are sourced from `HUMAN_COMPANY_MEMBERSHIP_ROLE_LABELS` in `@bench/shared` so this mapping has exactly one place to drift.

A **Bench instance** sits above all workspaces and is administered by a **Bench Admin**. We do not yet model "organisation" as a tier between instance and workspace — when a real customer needs that (e.g. Cisco wants Cisco‑Eng and Cisco‑Sales workspaces under one billing umbrella), they create multiple workspaces in the same Bench instance and an internal org tier is sequenced as a future project.

---

## 3. Tiers

```
Bench instance (tenant)
└── Workspace (product surface; DB table: companies)
    └── Coworker roster (subset of a workspace, scoped per People Manager)
```

- **Bench instance** — the deployment (self‑hosted server or cloud tenant). One instance can host many workspaces.
- **Workspace** — the product unit a customer hires coworkers into. Code calls this `company`; product copy says **"Workspace"**.
- **Roster** — a People Manager's slice of a workspace's coworkers, derived from `agents.metadata.benchManagerEmail`.

---

## 4. Roles

### 4.1 Bench Admin (instance scope)

**Real‑world analogue:** Atlassian Org Admin · Slack Org Owner · GitHub Enterprise Owner.

**Who:** the operator who owns the Bench deployment (self‑hosted IT lead, or the customer's account owner in cloud).

**Can:**
- Configure SSO / SAML / OIDC, identity, SCIM (when available).
- Manage the Adapter Manager (which LLM adapters are available).
- Manage Plugins.
- Define who is allowed to create new workspaces.
- View instance‑wide audit log; configure data residency and retention defaults.
- View and manage **Coworker schedules** (recurring runs across all workspaces).
- Promote / demote other Bench Admins.

**Cannot (without also being a workspace member):**
- See per‑workspace operational data — coworkers, tasks, costs, activity. This is intentional separation of duties.

**Code:** `instanceUserRoles.role = 'instance_admin'`. Already present.

---

### 4.2 Workspace Owner (workspace scope)

**Real‑world analogue:** Slack Workspace Owner · GitHub Org Owner · Atlassian Site Admin (for billing).

**Who:** the founder / billing principal of a workspace. Usually whoever created it during onboarding. Typically one or a small set per workspace.

**Can:**
- Everything a Workspace Admin can.
- Approve hire requests and allocate workspace budget.
- Set the workspace's monthly cost cap and per‑coworker default budget.
- Transfer workspace ownership.
- Delete or archive the workspace.

**Cannot:**
- Configure instance‑level identity (SSO, adapters). Belongs to Bench Admin.

**Code:** `companyMemberships.membershipRole = 'owner'`.

---

### 4.3 Workspace Admin (workspace scope)

**Real‑world analogue:** Slack Workspace Admin · Atlassian Site Admin · GitHub Org Admin.

**Who:** delegated authority within a workspace. Day‑to‑day operator.

**Can:**
- Hire and terminate coworkers.
- **Approve hire requests** raised by People Managers.
- Wire connectors (OAuth, scopes) and run the Connector Directory.
- Manage members and invite humans; assign Workspace Admin / People Manager / Viewer.
- Edit any coworker's identity, instructions, environments.
- View and export the workspace audit log.
- Configure workspace‑level skills library.

**Cannot:**
- Transfer ownership or delete the workspace.
- Set the workspace‑wide budget cap (Owner only).

**Code:** `companyMemberships.membershipRole = 'admin'`.

---

### 4.4 People Manager (workspace scope)

**Real‑world analogue:** Atlassian Project Admin · GitHub Team Maintainer · Slack Channel Manager.

**Who:** a human leader who owns outcomes for a slice of the workforce. The vision's primary "I should not live in Bench" persona — they configure and verify, then carry on in Slack / email / Jira.

**Can:**
- See and operate **only their own roster** — coworkers whose `metadata.benchManagerEmail` matches their signed‑in email.
- **Request a coworker hire** (Hire Request, routed to Workspace Owners + Admins for approval).
- Set instructions, skills, and connector‑access requests for their roster.
- Pause / resume their own coworkers within budget policy.
- File and assign tasks to their roster.
- View activity for their roster; receive **out‑of‑Bench digests** (email / Slack — coming soon) so they don't have to log in daily.

**Cannot:**
- Hire or terminate coworkers directly (must request).
- Approve hire requests.
- Manage members or roles.
- Wire connectors at the workspace level (must request; an Admin completes OAuth).
- See coworkers outside their roster, or the full workspace audit log.

**Code:** `companyMemberships.membershipRole = 'operator'` *(legacy literal; product label is "People Manager"; tracked for rename in [the RBAC plan](./plans/2026-05-11-rbac-and-hire-requests.md))*.

---

### 4.5 Viewer (workspace scope)

**Real‑world analogue:** Slack Single‑Channel Guest · GitHub Outside Collaborator (read) · Atlassian Project Viewer.

**Who:** read‑only stakeholders — legal, compliance auditors, executive assistants, finance reviewers.

**Can:**
- View the workspace dashboard, coworker roster, activity, costs, audit log (within their scope).
- File tasks (default), but cannot assign or close.

**Cannot:**
- Mutate any coworker, connector, or policy.
- See identity / SSO settings.

**Code:** `companyMemberships.membershipRole = 'viewer'`.

---

### 4.6 Coworker (the AI hire — not a human role)

A **coworker** is an AI hire (`agents` table). Its `agents.role` is its **job description** (Engineer, Designer, PM, QA, …) — that has nothing to do with the human RBAC matrix above.

**There is no "Admin coworker."** Earlier copy used that term to mean "the bot that hire requests get assigned to." That was a workaround; in the new model, hire requests route to **human Workspace Owners / Admins**, not to a bot. The previous `agents.role = 'admin'` literal is retained only for backward‑compat with existing data; new flows must not depend on it.

---

## 5. Permission matrix

| Capability | Bench Admin | Workspace Owner | Workspace Admin | People Manager | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| **Bench Settings** |  |  |  |  |  |
| Identity / SSO / SAML / SCIM | ✅ | ❌ | ❌ | ❌ | ❌ |
| Adapter Manager | ✅ | ❌ | ❌ | ❌ | ❌ |
| Plugins | ✅ | ❌ | ❌ | ❌ | ❌ |
| Coworker schedules (instance‑wide) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Who can create workspaces | ✅ | ❌ | ❌ | ❌ | ❌ |
| Instance audit log | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Workspace Settings** |  |  |  |  |  |
| General (name, description, prefix) | view | ✅ | ✅ | view | view |
| Members & roles | ✅ | ✅ | ✅ | ❌ | ❌ |
| Transfer / delete workspace | ✅ | ✅ | ❌ | ❌ | ❌ |
| Set workspace budget cap | ✅ | ✅ | ❌ | ❌ | ❌ |
| Approve hire requests | ✅ | ✅ | ✅ | ❌ | ❌ |
| Wire connectors (OAuth) | ✅ | ✅ | ✅ | request only | ❌ |
| Coworker roster & instructions | ✅ | ✅ | ✅ | their roster | view |
| Skills library | ✅ | ✅ | ✅ | view | view |
| Environments | ✅ | ✅ | ✅ | ❌ | ❌ |
| Workspace audit log | ✅ | ✅ | ✅ | scoped | view |
| **Work** |  |  |  |  |  |
| Hire / terminate coworkers | ✅ | ✅ | ✅ | request only | ❌ |
| **Request** a coworker hire | ✅ | ✅ | ✅ | ✅ | ❌ |
| File tasks | ✅ | ✅ | ✅ | ✅ | ✅ |
| Assign tasks | ✅ | ✅ | ✅ | their roster | ❌ |
| Pause / resume coworker | ✅ | ✅ | ✅ | their roster | ❌ |

`view` = read‑only. `scoped` = subset (only roster‑touching events). `request only` = surfaces a request that an Admin/Owner approves.

---

## 6. Settings IA

There are exactly **two** settings homes. Each is gated by the role(s) listed.

### 6.1 Workspace settings — `/{workspacePrefix}/settings/...`

Visible to: **Workspace Owner, Workspace Admin** (full); **People Manager / Viewer** see read‑only "Profile" sub‑page only.

Sub‑pages:

- General (name, description, prefix)
- Members & roles (was "Access")
- Hire requests & budget
- Connectors
- Coworkers (alias for `/agents`; lives here for discoverability)
- Skills
- Environments
- Audit log
- Export / Import

URL: today the route is `/{prefix}/workspace/settings/...` — the `workspace/` infix is redundant. Plan: collapse to `/{prefix}/settings/...` with redirects. Tracked in the RBAC plan.

### 6.2 Bench settings — `/bench/settings/...`

Visible to: **Bench Admin only**. People Manager / Workspace Admin / Viewer get a 403, never a half‑rendered page they can poke.

Sub‑pages:

- General (instance name, branding)
- Identity (SSO / SAML / OIDC / SCIM)
- Access (manage other Bench Admins)
- Adapter Manager
- Plugins
- **Coworker schedules** (was "Heartbeats" — internal jargon)
- Experimental
- Profile (the signed‑in user's personal preferences — visible to everyone)

Both settings pages have an **Exit settings** (✕) affordance in the breadcrumb bar that takes the operator straight back to the workspace dashboard. The Bench‑settings sidebar also has a "← {workspace name}" link at the top so the side rail isn't a dead end.

---

## 7. Lifecycle: a hire request walks through the model

1. **People Manager** opens **Request coworker hire** (in‑product or via email handoff later).
2. UI submits a typed `hire_request` (not an Issue) with: role preset, justification, monthly cost, requesting manager.
3. Server creates an `Approval` of type `hire_agent`, scoped to the workspace. **Routed to all Workspace Owners + Admins** by email/Slack notification.
4. A Workspace Owner or Admin reviews in **Approvals** (Inbox for managers; Approvals for admins). They click **Approve & Onboard** → opens onboarding wizard prefilled with the request → on launch, the new coworker is created with `metadata.benchManagerEmail` = requester's email so it appears in the requester's roster automatically.
5. Manager is notified outside Bench; coworker is now in their tools.

No bot in the loop. No "first active coworker fallback." No issue composer reuse.

### 7.1 Separation of duties (mandatory invariant)

> **The user who filed an approval can never be the user who decides it.** Period.

This applies to every approval type — `hire_agent`, `request_board_approval`, connector wiring, member promotion. The product enforces it at three layers so it can't be bypassed:

- **Server (definitive):** `POST /api/approvals/:id/approve|reject|request-revision` returns **`403 self_approval_forbidden`** when `req.actor.userId === approval.requestedByUserId`.
- **UI (Inbox + Approvals + Approval detail + Issue detail):** the Approve / Reject buttons are suppressed when the viewer is the requester; an inline **"Awaiting another reviewer"** badge shows instead. This avoids the footgun of a button that 403s on click.
- **Tests:** `server/src/__tests__/approval-routes-idempotency.test.ts` covers self-approve, self-reject, self-revision-request, and the legitimate "different reviewer approves" path.

**Single-Owner self-hosted edge case:** when a workspace literally has one Owner and no other reviewers, the rule still holds (Owner can't self-decide their own request) — but per [the RBAC plan](./plans/2026-05-11-rbac-and-hire-requests.md) §4.6 q2, the **request entry point** auto-approves on submit for sole Owners so they never sit in pending. This is policy, not bypass: the act of opening the request and submitting it counts as the decision and is logged with `actorRole = owner`.

**Local-board (no signed-in user) deployment:** if `req.actor.userId` is null (`"board"`), there's no real identity to compare against; the operator is the only operator that exists, so the gate is intentionally not applied. Cloud and SSO deployments always have a `userId` and so are always gated.

**First-hire bypass (carve-out — `agent-hires` route only):** when a workspace has zero existing non-terminated coworkers, `POST /api/companies/:id/agent-hires` skips creating an `Approval` row entirely and the agent is created in `idle` status, regardless of `companies.requireBoardApprovalForNewAgents`. Rationale: nobody else exists in the workspace yet, so any approval would either sit pending forever or force the requester to self-approve (which §7.1 just blocked). The first hire is therefore a known carve-out, written to the activity log as `agent.hire_created` with `details.firstHireBypass = true` so the audit trail is explicit. Subsequent hires honor the workspace setting normally — once there is at least one peer who could review, the gate engages. This is implemented in `server/src/routes/agents.ts` (the agent-hires route's pre-create existing-agent count) and covered by `server/src/__tests__/agent-permissions-routes.test.ts > first-hire bypass`.

**Why a decision note is required for Reject and Request revision (UX layer):** the Approve / Reject / Request revision actions in `ApprovalDetail` share a single **Decision note** textarea. The textarea is optional for Approve (a clean approval needs no rationale) but required (UI-disabled, plus a tooltip) for the two destructive paths so the requester is never told "rejected" with no explanation. The same destructive-action discipline is enforced in the Inbox + ApprovalCard quick-flow by routing the **Reject…** button to the detail page rather than firing a one-click rejection. Server still accepts an optional `decisionNote` for backwards compatibility; UI enforces presence for hire-style approvals.

---

## 8. Mapping table — product names ↔ DB literals

| Product name | DB literal (today) | Notes |
|---|---|---|
| Bench Admin | `instanceUserRoles.role = 'instance_admin'` | already in DB |
| Workspace | `companies` table | DB table rename deferred (PR5 in plan); product copy uses **Workspace** |
| Workspace Owner | `companyMemberships.membershipRole = 'owner'` | already in DB |
| Workspace Admin | `companyMemberships.membershipRole = 'admin'` | already in DB |
| People Manager | `companyMemberships.membershipRole = 'operator'` | label remap; future rename to `people_manager` is tracked in the RBAC plan |
| Viewer | `companyMemberships.membershipRole = 'viewer'` | already in DB |
| (Member — legacy) | `companyMemberships.membershipRole = 'member'` | normalized to `operator` server‑side; do not use for new code |
| Coworker (AI hire — **not** a human role) | row in `agents` table; `agents.role` is the *job* (engineer, designer, …) | `agents.role = 'admin'` is legacy and must not gate human flows |

Code can keep using the literal names; **product copy must use the product names** above. UI labels are sourced from `HUMAN_COMPANY_MEMBERSHIP_ROLE_LABELS` in `@bench/shared`.

---

## 9. What this replaces

- The old "Admin coworker" framing for hire routing (a bot acting as superior authority). Replaced by **Workspace Owner / Admin** humans.
- The free‑typing dashboard persona toggle (`bench.dashboardPersona` in `localStorage`) as a permission boundary. The toggle remains a UI lens for development convenience; **enforcement is server‑side from `companyMemberships.membershipRole`**.
- The implicit "Operator" jargon. Product copy uses **People Manager** consistently.
- The "Heartbeats" page name in Bench settings. Now **Coworker schedules**.
- The "Company" framing for the tenant unit. Now **Workspace** in product copy (DB schema unchanged).

---

*Document version: 0.2 — May 2026. When changing role powers, update this doc, then `HUMAN_COMPANY_MEMBERSHIP_ROLE_LABELS`, then `grantsForHumanRole`, then UI gating. In that order.*
