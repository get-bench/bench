# Bench — "Coworker" vs agent

In **customer-facing Bench language**, a hired AI worker is a **coworker** (`doc/vision.md`). Under the hood this is still the same **agent** entity and runtime as PaperClip: one row in `agents`, same APIs under `/api/.../agents/...`, same skills and connector plumbing.

**Do not maintain a parallel "coworkers" product surface** (duplicate lists, separate detail routes, or second archetype systems). Extend **Agent** detail and existing onboarding.

> **Coworker is not a human role.** It's the AI hire. Human roles (Bench Admin / Workspace Owner / Workspace Admin / People Manager / Viewer) and their permissions are defined in [`doc/roles.md`](./roles.md). The previous "Admin coworker" framing — where a bot was treated as the founding authority for hire approvals — has been retired; hire requests now route to **human Workspace Owners and Admins**.

- **Unified activity feed:** `GET /api/companies/:companyId/agents/:agentId/activity` — merges activity log + recent runs; surfaced on the agent **Dashboard** tab in the UI.
- **Connector catalog:** `CONNECTOR_CATALOG` in `@bench/shared` and **`/connectors`** in the UI — reference list for Slack, mail, trackers, design tools (Figma, Miro, Dovetail, …), etc., aligned with onboarding toolchain categories.

- **Onboarding toolchain:** Step 3 includes **design & research** alongside chat, mail, code hosting, meetings, work tracking, and docs—so roles like **Product Designer** can select **Jira**, **Confluence**, **Figma**, and related apps in one pass (still one pick per category row; OAuth wiring happens from the board).

- **Connector access requests:** If a coworker needs a net-new integration or scope, operators use the **Dashboard** hint on the coworker's agent page to open a prefilled **issue** for the **People Manager** / owner to approve and complete OAuth in **Workspace settings → Connectors** (see `doc/vision.md`).

Role presets for onboarding include hireable roles from `HIRABLE_COWORKER_ROLES` in `@bench/shared` (Engineer, Designer, PM, …); `role` / `title` are the data model fields. The legacy `agents.role = 'admin'` literal exists only for backward-compat with imported data — new flows must not gate on it (see [`doc/roles.md` §3.6](./roles.md#36-coworker-the-ai-hire--not-a-human-role)).

## People-manager scoping (Manager view ↔ `metadata.benchManagerEmail`)

The Dashboard persona toggle has two views:

- **Admin view** — every coworker in the workspace.
- **Manager view** — only coworkers whose `agents.metadata.benchManagerEmail` matches the signed-in user's email (lowercased; see `ui/src/lib/manager-scope.ts`).

This is a strict client-side filter on a single field, which makes the contract sharp and easy to break:

- The hire form (`ui/src/pages/NewAgent.tsx`) **defaults `managerEmail` to the signed-in user's email** so coworkers a manager hires for themselves appear in their own Manager view immediately. Admins hiring on behalf of another manager simply overwrite the field; clearing it leaves the coworker unassigned (Admin view only).
- A coworker with no `metadata.benchManagerEmail` is invisible in every Manager view. Older hires created before this default existed (or hired by an admin who left it blank) are recoverable from the Manager-view empty state via the `<ManagerScopeRecovery>` card on Dashboard / Coworkers — it lists unassigned coworkers and offers a one-click "claim as my reports" action.
- The server-side `PATCH /agents/:id` endpoint **replaces `metadata` wholesale**. UI helpers must merge into the existing record — see `buildClaimManagerMetadataPatch` in `ui/src/lib/manager-scope.ts`. Sending a bare `{ metadata: { benchManagerEmail } }` will silently drop every other key (avatars, connector hints, etc.).

Tests pinning this contract live in `ui/src/lib/manager-scope.test.ts` and `ui/src/lib/new-agent-hire-payload.test.ts`.
