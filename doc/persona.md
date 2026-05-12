# Bench — User personas

This document describes **human** personas who interact with Bench (the control plane, approvals, and governance) — narrative stories used to guide UX, docs, and product copy. AI hires are called **coworkers** in product copy but use the same **agent** domain as PaperClip — see [`coworkers.md`](./coworkers.md).

> **For the formal RBAC contract** (which role can do what, settings IA, mapping to DB literals), see [`doc/roles.md`](./roles.md). Personas below are the stories; roles.md is the source of truth for permissions. When the two disagree, roles.md wins.

### Dashboard view selector (UI prototype)

The board top bar includes **View as → Admin | Manager** (stored in `localStorage` as `bench.dashboardPersona`). This is a **client-side lens** for tailoring dashboards and lists; the API still returns company-wide data until server RBAC exists.

#### Admin lens (company operator / people ops)

**Navigation emphasis:** oversight, not day-to-day task work.

- **Shown:** Dashboard (org-wide metrics: total coworkers, managers with hires, unassigned hires, spend rollups), **Hire coworker**, **Approvals**, **Coworkers** list (same `/agents` routes), **Connectors**, **Costs**, **Activity**, **Settings**, and full **Company** affordances (Org, Skills when not in manager-only mode).
- **Hidden / de-emphasized:** New Issue, Inbox, Work section (Issues, Routines, Goals, Projects, Workspaces), and sidebar plugin slots aimed at execution. Product copy uses **coworker** language; domain types remain `agent`.

**Typical flows**

1. **Hire:** Open hire dialog or **New coworker** → advanced form → set optional **people manager email** (`metadata.benchManagerEmail`, normalized) so the hire appears in the right manager’s scoped view.
2. **Re-assign:** On a coworker’s **Configuration** tab, edit **People manager** and save (same metadata key).
3. **Manager request:** Managers use **Request coworker hire** — a dialog to pick a **standard Bench role** (with capability blurbs), or describe a **custom role**. Today both paths generate an **issue ticket** with id `HIRE-…` in the title/body, routed to the workspace's human **Workspace Owner / Workspace Admin** for review. The Owner/Admin fulfills by approving onboarding and pinning **benchManagerEmail** to the requester so the new coworker lands in their roster. The hire flow is being moved to a typed `hire_request` entity (see [`doc/plans/2026-05-11-rbac-and-hire-requests.md`](./plans/2026-05-11-rbac-and-hire-requests.md)).

#### Manager lens (people leader)

- **Scoped data:** Coworkers whose metadata `benchManagerEmail` matches the signed-in user’s email (normalized). Same filtering applies to relevant lists (e.g. coworkers page, dashboard agents) where implemented.
- **Navigation:** Manager sees **New Issue**, **Request coworker hire**, **Inbox**, **Work** (Issues, Routines, Goals, Projects, …), **Coworkers** (scoped), **Connectors**, **Costs**, **Activity**, **Settings**. Org/Skills may be hidden when the UI treats them as admin-led.
- **After assignment:** Dashboard and docs should highlight **next steps**: confirm connector access for that hire’s tools, set instructions/skills, assign first issue or routine, watch inbox/approvals.

---

## 1. Bench platform administrator

**Who:** Operator at the Bench vendor or a dedicated IT owner at a large customer managing the instance.

**Goals**

- Keep the Bench deployment healthy, upgraded, and compliant.
- Manage instance-wide settings (auth modes, backups, experimental flags, adapter plugins).
- Respond to cross-company support and audit requests.

**Typical actions**

- Instance settings, adapter manager, database backups, logs.
- Define policies that apply to every company on the instance (where applicable).

**Success criteria**

- Predictable upgrades, clear audit trail, fast recovery from misconfiguration.

---

## 2. Organization owner / billing admin

**Who:** Executive or ops lead who owns the commercial relationship for their org on Bench.

**Goals**

- Understand spend and seat usage per coworker / company.
- Add or remove companies (business units) and approve high-impact hires.

**Typical actions**

- Company creation, export/import, billing views (as exposed in product).
- Approvals for sensitive hires or budget overrides.

**Success criteria**

- Costs are explainable; no surprise charges; clear ownership of each company scope.

---

## 3. Team manager (engineering, product, GTM, etc.)

**Who:** People leader who **does not** need global Bench admin powers but owns outcomes for a slice of the workforce.

**Goals**

- Onboard and steer **coworkers** assigned via `benchManagerEmail` (product copy); technical domain remains **agent**.
- Adjust instructions, connectors, and pause/resume behavior within policy.
- Scan activity to trust but verify — without micromanaging every task.
- **Request** additional hires via **Request coworker hire** (role picker or custom role → ticket for Admin / CEO hire) when they cannot create hires themselves.

**Typical actions**

- Scoped **Coworkers** list and coworker detail, connector directory (including **setup guide** sheets: auth prerequisites, numbered steps, vendor docs), activity feeds, issue/routine oversight.
- Edit natural-language instructions and escalate approvals.

**After IT connects a connector centrally**

- Manager verifies the hire can use the integration (scopes, test message, repo access), attaches the right skills/instructions, and routes real work through Issues/Routines.

**Success criteria**

- Hires stay aligned with team norms; incidents surface early; dashboard time stays low.

---

## 4. Individual contributor (IC) teammate

**Who:** Engineer, designer, PM, analyst — interacts with coworkers **primarily in Slack, email, calendar, and trackers**, not in Bench daily.

**Goals**

- Get fast draft responses, summaries, and artifact updates where they already work.
- Know when a coworker needs approval or clarification.

**Typical actions**

- Chat/DM with coworker surfaces; occasional Bench deep-link for context or approvals.

**Success criteria**

- Low friction; clear handoff to humans for commitments and external sends.

---

## 5. Security & compliance stakeholder

**Who:** CISO office, IT governance, or internal audit partner.

**Goals**

- Verify least-privilege connector scopes and retention posture.
- Export or review activity suitable for SOC 2 / customer diligence.

**Typical actions**

- Read-only or elevated views of activity, connector catalog, policies; coordination with Bench admin.

**Success criteria**

- Evidence is obtainable without custom scripts; scopes are explainable per coworker.

---

## 6. Finance / procurement partner

**Who:** FP&A or procurement reviewing Bench alongside other SaaS.

**Goals**

- Map Bench seats to org structure and renewal forecasting.

**Typical actions**

- Costs views, export; aligns with org owner on seat adds/removals.

**Success criteria**

- Seat model matches how the business thinks about “hires.”

---

## 7. Viewer / auditor (read-only)

**Who:** Extended stakeholder who must observe without mutating (legal, PMO, executive assistant).

**Goals**

- See status and history without risking accidental policy changes.

**Typical actions**

- Read dashboards, activity, connector directory; no hire/terminate/patch.

**Success criteria**

- Clear UI affordances that mutating controls are unavailable or hidden.

---

## Design principles across personas

1. **Contractor metaphor:** Language favors “coworker,” “hire,” “onboard,” “pause,” not “agent deployment.”
2. **Dashboard is oversight:** Daily work happens in existing apps; Bench explains what happened and whether it is safe.
3. **Deny by default:** Higher-impact personas get fewer ambient powers; cross-org visibility is exceptional, not default.

When user stories conflict, prefer **Team manager + IC** workflows for V1 polish, with **Security + Org owner** requirements as gates for enterprise readiness.
