# Plan — Connector Runtime (Option C: Hybrid)

**Date:** 2026‑05‑11
**Owner:** Aashish (review with Bhawna)
**Reading order:** [`vision.md`](../vision.md) → [`coworkers.md`](../coworkers.md) → [`connectors-directory.md`](../connectors-directory.md) → this plan.
**Status:** **CRP1 + CRP2 shipped.** CRP1 ships the spine (4 tables, feature flag, runtime service, encrypted token storage via existing `local_encrypted` provider, redacted audit/inbound writers). CRP2 ships the OAuth scaffold (state/PKCE table, vendor adapter contract, install/callback/revoke routes gated on `workspace:connectors:wire` + `enableConnectorRuntime`, in-place reinstall, single-use replay-safe state). CRP3 (webhook ingress) is next.

---

## 0. Why this is a separate plan

The RBAC / hire‑request work and the Connector Runtime are different problems with different blast radius. RBAC is label + route + middleware churn across the existing surface; the Connector Runtime is a brand‑new server subsystem (OAuth, webhook ingress, per‑coworker scope enforcement, MCP wrapping). Mixing them would make either review an unreadable monolith.

This doc captures the audit, the architectural decision, the capability matrix, and the phased rollout — so that **PR3** of the RBAC plan (Hire as a typed entity) can ship knowing what "wire connectors during approval" actually means.

---

## 1. The honest baseline — what exists today

Audit of the connector surface as of May 2026:

| Layer | What we have | What's missing |
|---|---|---|
| Catalog metadata | `packages/shared/src/connectors/catalog.ts` lists ~80 vendors with `sampleInvocableTools` chips | Chips are `// not an enforced allow-list in V1` — they're directory copy, not a contract |
| Per‑connector interface | `integrations/types.ts` defines `MessagingIntegration`, `VCSIntegration`, `TicketingIntegration` | Aspirational shapes; not implemented end‑to‑end |
| Reference implementations | `integrations/connectors/{slack,jira,linear,github,figma,zoom,outlook,teams,google-workspace,vscode,cursor,vercel}/index.ts` | All stubs. Slack today is `postMessage` + `postThreadReply` + `postFileOrSnippet` (3 outbound methods, **zero inbound**) |
| Server runtime | — | No OAuth callback, no token store, no webhook receiver, no event router, no audit table |
| MCP servers | — | None internal; no integration with `@modelcontextprotocol/server-*` packages |
| DB schema | `company_secrets` (generic K/V vault) | No `connector_accounts`, `connector_inbound_events`, `connector_outbound_audit`, no per‑coworker scope tables |
| Coworker identity in 3rd‑party tool | — | No model for "Riya is `@riya` in Cisco‑Eng's Slack workspace `T0123`" |

**What this means for the user's question — "is this enough to replicate a real human coworker?":** No. A human Slack coworker can read mentions, search history, react to messages, join channels, see DMs. The current stub can post a message *if* an operator pastes a bot token into an env var. That's it. The same gap is true of every other connector. The catalog is a brochure, not a working integration layer.

---

## 2. Why a real Connector Runtime is on the critical path

[`vision.md`](../vision.md) elevates two ideas that depend on a real runtime:

1. **Coworkers live in customers' tools, not in Bench.** The whole "manager DMs Riya in Slack instead of opening Bench" experience requires inbound Slack events (`app_mention`, `message.im`, `message.mpim`), not outbound posting.
2. **Hire approval wires connectors as part of the hire.** [The PR3 design brief in the RBAC plan](./2026-05-11-rbac-and-hire-requests.md#4-pr3-design-brief--hire--connector-ux-needs-user-signoff-before-build) says "on Approve, walk any not‑wired connectors before creating the coworker." That step doesn't exist today because there's no OAuth flow, no token store, no per‑tenant connector account model.

Without a runtime, we ship coworkers that look hired but can't actually act in customer systems. The chip lists make it look worse than it is, because they advertise capabilities the engine cannot deliver.

---

## 3. Architectural fork — decision

| Option | What Bench builds | What Bench borrows | Trade‑off |
|---|---|---|---|
| A. Own everything | Per‑vendor MCP servers (Slack, Jira, GitHub, Notion, Linear, Figma, Drive, Outlook, …), per‑tenant OAuth, webhook receivers, scoping, audit | Nothing | Highest control, highest cost. ~80 connectors × deep work; we'd be re‑implementing what Anthropic / vendors already ship. |
| B. Pure delegation | Identity, OAuth, scoping, audit, budget, webhook fan‑out | All MCP servers (`@modelcontextprotocol/server-*`, community packages) | Lowest cost. Loses fine‑grained scoping if upstream MCP doesn't expose it. Inconsistent surface across vendors. |
| **C. Hybrid (chosen)** | Identity + OAuth + scoping + audit + webhook receivers + a *small number* of MCP servers where vendors don't ship one | Anthropic / community MCP servers where they exist and are good (Slack, GitHub, Filesystem, Postgres, Sentry, Linear) | Best ROI. Bench's value is governance and identity, not re‑implementing every vendor SDK. |

**Decision: Option C.** Bench's product wedge is the *control plane* — budget, audit, RBAC, scoping per coworker, hire approvals. Owning the inbound webhook + identity + scoping layer **above** vendor MCP servers gives us all the differentiation and almost none of the SDK churn. Where a vendor MCP doesn't exist or is too narrow, we ship our own (e.g., Figma's MCP is community, Linear has one, Notion does not yet).

---

## 4. Capability matrix — top 8 vendors

Columns:

- **Customer reality** — what the vendor actually exposes (inbound + outbound) for a fully‑functioning human/bot identity.
- **Catalog claim** — what `CONNECTOR_CATALOG` chips currently advertise.
- **Today** — what `integrations/connectors/<vendor>/index.ts` actually implements.
- **Runtime delta** — what the Connector Runtime needs to add to close the gap (focused on Phase 1, not exhaustive).
- **MCP plan** — vendor MCP we'll wrap (delegation) vs. one we'll write (own).

> Full per‑vendor scope lists live in `doc/connectors-directory.md` once each connector ships; this matrix only covers the eight Phase‑1 vendors.

| Vendor | Customer reality (≈) | Catalog claim | Today (`integrations/`) | Runtime delta | MCP plan |
|---|---|---|---|---|---|
| **Slack** | `app_mention`, `message.im`, `message.mpim`, `conversations.history/replies`, `search.messages`, `chat.postMessage/update`, `reactions.add`, `files.upload`, `users.profile.set` | `~6` chips (post, reply, file) | 3 outbound methods, zero inbound | Slack OAuth (bot + user scopes), Events API webhook with HMAC verify, channel allow‑list per coworker, identity (`@riya` mapping), scrollback fetch | **Delegate** to `@modelcontextprotocol/server-slack` for tool surface; **own** the inbound event router. |
| **GitHub** | Repo read/write, PR open/review/merge, issues read/write/assign, checks, releases, webhook events (`push`, `pull_request`, `issue_comment`, `workflow_run`) | Chips list common ops | Stub (no auth, no calls) | GitHub App install per workspace, per‑repo scope per coworker, webhook receiver with secret verify, PR comment thread tracking | **Delegate** to `@modelcontextprotocol/server-github`; own GitHub App install + webhook ingress. |
| **Jira** | Issue read/write/assign/transition, JQL search, comments, attachments, webhook events (`jira:issue_*`, `comment_*`) | Chips | Stub | Atlassian OAuth (`read:jira-work`, `write:jira-work`), per‑project scope, webhook receiver, JQL safety wrapper | **Own** an MCP server (no good vendor MCP yet); thin wrapper over `jira-rest-api`. |
| **Linear** | Issue read/write/assign/state, project, comment, GraphQL subscriptions or webhook | Chips | Stub | Linear OAuth, per‑team scope, GraphQL client, webhook receiver | **Delegate** to community Linear MCP if quality is acceptable; otherwise own. |
| **Notion** | Page/database read + write, block ops, comments, search, webhook (limited) | Chips | (No stub yet — wired only via catalog) | Notion OAuth, per‑workspace scope, page/database allow‑list per coworker; polling fallback where webhooks are absent | **Own** an MCP server; vendor MCP is missing/limited. |
| **Google Drive / Workspace** | Drive read/write, Docs/Sheets/Slides edit, Gmail read/send (separate scope), Calendar, Drive change webhooks | Chips | Stub | Google OAuth (Drive, Docs, Gmail, Calendar — separate scopes), per‑folder allow‑list, push notifications channel, send‑as identity for Gmail | **Delegate** to `@modelcontextprotocol/server-gdrive` (Drive); **own** thin Gmail/Calendar MCPs. |
| **Outlook / M365** | Mail read/send, Calendar, Files, webhook subscriptions, Teams overlap | Chips | Stub | Microsoft Graph OAuth (Mail, Calendar, Files), subscription renewal cron, send‑as identity, per‑mailbox/folder scope | **Own** a Graph‑backed MCP (no canonical vendor MCP today). |
| **Figma** | File read, comments read/write, dev‑mode specs, webhook events (`FILE_UPDATE`, `FILE_COMMENT`) | Chips | Stub | Figma OAuth, per‑team scope, comments + dev‑mode read, webhook receiver | **Delegate** to community Figma MCP; own webhook ingress. |

The pattern is consistent: **Bench builds OAuth + scope + webhook ingress + audit** for every vendor. Tool surface is delegated to vendor / community MCPs unless one doesn't exist.

---

## 5. Connector Runtime architecture

### 5.1 New tables (proposed; subject to schema review)

```
connector_accounts (
  id uuid pk,
  company_id uuid fk,
  connector_id text,                   -- 'slack' | 'github' | ...
  external_account_id text,            -- vendor-side workspace/org id
  external_account_label text,         -- 'Cisco-Engineering'
  installed_by_user_id uuid fk,
  oauth_grant_jsonb,                   -- access token + refresh token (encrypted at rest via @bench/crypto)
  scopes text[],
  webhook_secret text,                 -- HMAC verification secret (encrypted)
  status text,                         -- 'active' | 'expired' | 'revoked'
  created_at, updated_at,
  unique (company_id, connector_id, external_account_id)
);

agent_connector_grants (
  id uuid pk,
  agent_id uuid fk,
  connector_account_id uuid fk,
  scopes text[],                       -- subset of connector_accounts.scopes
  resource_filter jsonb,               -- e.g. { channels: ['C0123'] } or { repos: ['org/repo'] }
  created_at, updated_at,
  unique (agent_id, connector_account_id)
);

connector_inbound_events (
  id uuid pk,
  company_id uuid fk,
  connector_account_id uuid fk,
  event_type text,
  external_event_id text,              -- vendor-side dedupe key
  raw_payload jsonb,                   -- redacted via redactEventPayload before persist
  routed_agent_id uuid fk null,
  routed_at timestamptz null,
  status text,                         -- 'received' | 'routed' | 'ignored' | 'failed'
  received_at timestamptz default now(),
  unique (connector_account_id, external_event_id)
);

connector_outbound_audit (
  id uuid pk,
  company_id uuid fk,
  agent_id uuid fk,
  connector_account_id uuid fk,
  tool_name text,                      -- e.g. 'slack.chat.postMessage'
  request_jsonb,                       -- redacted
  response_status text,
  cost_cents int,                      -- attributed to coworker budget
  created_at timestamptz default now()
);
```

Tokens encrypted at rest via the existing `@bench/crypto` envelope (KMS‑backed in cloud, file‑backed in self‑host). Webhook secrets in the same envelope. Raw payloads run through `redactEventPayload` before persisting (same path used today for activity logs).

### 5.2 OAuth + install flow

- `GET /api/connectors/:connectorId/install` (Workspace Owner / Admin only) → vendor OAuth consent screen with state/PKCE.
- `GET /api/connectors/:connectorId/callback` → exchange code, persist `connector_accounts`, register webhook subscription.
- Reinstall flow handles scope expansion (a hire requires a scope the workspace's existing install doesn't have).
- Revoke flow tears down vendor‑side webhook subscription before deleting the row.

### 5.3 Inbound (webhooks)

- One ingress per vendor (`POST /api/connectors/slack/events`, etc.) with HMAC signature verification per vendor's spec.
- Ingress writes to `connector_inbound_events` (idempotent on `external_event_id`) and emits an internal event on the existing event bus.
- A router subscribes and dispatches to the right coworker based on `agent_connector_grants.resource_filter` (channel id, repo, project key, …).
- If multiple coworkers match (e.g., two Designers in `#design`), routing follows the same single‑assignee invariant as tasks: first to acknowledge wins.

### 5.4 Outbound (MCP)

- Each connector exposes an MCP surface to the coworker's adapter (Claude/Codex/Cursor). For delegated vendors we proxy through the vendor MCP, injecting the per‑coworker token + scope.
- Every MCP tool call is wrapped to:
  - enforce `agent_connector_grants.scopes` (server‑side, not client‑hint),
  - enforce `resource_filter` (e.g., reject `chat.postMessage` for a channel the coworker isn't granted),
  - write to `connector_outbound_audit` with cost attribution,
  - update the coworker's monthly spend.

### 5.5 Hire‑flow integration

Closes the loop with the RBAC plan's PR3 design brief:

- Each role preset declares `requiredConnectors: ConnectorId[]` and `optionalConnectors`.
- Hire dialog computes wiring status by joining `connector_accounts` for the workspace.
- On Approve, the provisioning view walks any `❌ not wired` required connector through the install flow above before creating the coworker. Optional connectors can be deferred.
- On hire, an `agent_connector_grants` row is created per required connector with the preset's default scope subset (editable post‑hire).

---

## 6. Phased rollout

The right order is not "build all 80 at once." Slack is first because [`vision.md`](../vision.md) elevates it as where managers and coworkers live, and because it forces the inbound‑event design, which is the hardest part of the runtime.

| Phase | Vendors | What this phase proves |
|---|---|---|
| **CR1** | (no vendor) — Connector Runtime spine: tables, OAuth scaffold, webhook ingress framework, MCP wrapping pattern, encryption, audit table | Runtime works end‑to‑end on a single vendor stub |
| **CR2** | Slack | Inbound events route to a coworker; outbound MCP enforces scope + audits cost; a manager can DM the coworker and get a reply |
| **CR3** | GitHub | Webhook secret verify + GitHub App install; PR comment + check thread tracking; engineering coworker can act on a real repo |
| **CR4** | Jira + Linear | Project‑scoped ticket flows; hire flow can wire a Designer hire's connectors at approval time |
| **CR5** | Google Drive + Outlook/Gmail | Send‑as identity; the email "your hire is online" notification (RBAC PR4) becomes a real surface, not a stub |
| **CR6** | Notion + Figma + everything else | Long tail; pattern is now templated |

Each phase ships behind `features.connectorRuntime.<vendor>` so we can roll back per vendor if something is broken.

---

## 7. PR slicing

Mirrors the RBAC plan's structure (small, reviewable, named):

- **CRP1 — Schema + crypto + audit** ✅: the four tables (`connector_accounts`, `agent_connector_grants`, `connector_inbound_events`, `connector_outbound_audit`), `connectorRuntimeService` with feature‑flag gating, encrypted token storage via the existing `local_encrypted` provider (no new crypto code), redacted writes through `sanitizeRecord`, idempotent inbound ingest on `(connector_account_id, external_event_id)`, outbound spend roll‑up, instance toggle UI in **Bench Settings → Experimental → Enable Connector Runtime**.
- **CRP2 — OAuth scaffold** ✅: `connector_oauth_states` table (single‑use, TTL‑bounded), `ConnectorOAuthAdapter` contract, generic install/callback/revoke routes gated on `workspace:connectors:wire` + `enableConnectorRuntime`, in‑place reinstall on duplicate `(company,connector,externalAccount)`, AES‑256‑GCM token storage reusing `local_encrypted`. PKCE S256 mandatory for every adapter. No vendor adapters registered yet — that's CRP5.
- **CRP3 — Webhook ingress framework**: HMAC verifier interface, idempotency on `external_event_id` (the table & service helper already exist; CRP3 wires the HTTP receiver), dead‑letter handling.
- **CRP4 — MCP wrapping pattern**: scope enforcement middleware, cost attribution into `cost_events`, audit writer (already shipped in CRP1; CRP4 plugs it into the MCP middleware).
- **CRP5 — Slack** (first vendor): full vertical slice using all four primitives.
- **CRP6+** — one vendor per PR.
- **CRP10 — Hire flow integration**: ties into RBAC PR3.

Each PR is independently reviewable. CRP1‑4 ship dark (no vendor wired, flag off by default). CRP5 is the first user‑visible delta.

### CRP2 implementation notes (for reviewers)

| File | What it does |
|---|---|
| `packages/db/src/schema/connector_oauth_states.ts` | Short‑lived state row holding `state`, `codeVerifier` (PKCE S256), `redirectUri`, `requestedScopes`, `initiatedByUserId`, `expiresAt`. `unique (state)` is the dedupe + replay key. Cascade‑deletes with the workspace. |
| `packages/db/src/migrations/0078_grey_wasp.sql` | Generated by `pnpm db:generate`; round‑trips clean. |
| `server/src/services/connector-oauth-adapters/types.ts` | `ConnectorOAuthAdapter` contract — every vendor exports one. Adapters are pure (no DB, no Express); the runtime supplies all I/O. PKCE is enforced at the runtime layer. |
| `server/src/services/connector-oauth-adapters/registry.ts` | Process‑local adapter map. Adapters are code, not data — runtime‑loaded adapters are deliberately out of scope. |
| `server/src/services/connector-oauth-adapters/test-stub.ts` | Test‑only adapter exercised by both service and route specs; never registered in production. |
| `server/src/services/connector-oauth.ts` | The OAuth choreography: state generation (32‑byte CSPRNG), PKCE S256 pair, redirect‑URI guard (HTTPS or loopback only), single‑use state with up‑front delete, expiry check, optional same‑user binding, code exchange via the adapter, persistence via `runtime.createConnectorAccount` or new `runtime.reinstallConnectorAccount`, and best‑effort `revoke` against the vendor. Tokens never leave the encrypted secrets vault. |
| `server/src/services/connector-runtime.ts` | Extended with `reinstallConnectorAccount` (rotates the existing encrypted secret in place + merges scopes/metadata, keeping the `(company,connector,external)` uniqueness invariant) and `readConnectorAccountToken` (used by the OAuth revoke flow; result is consumed in‑memory and never returned to the client). |
| `server/src/routes/connector-oauth.ts` | `POST /api/connectors/:id/install`, `GET /api/connectors/:id/callback`, `POST /api/connectors/accounts/:accountId/revoke`. Install + revoke gate on `workspace:connectors:wire` (Owner/Admin only per `roles.md` §5). Callback is HTML — vendors can't carry a session cookie. `returnTo` is regex‑guarded to prevent open redirects. |
| `server/src/__tests__/connector-oauth-service.test.ts` | 10 tests against embedded Postgres: feature‑flag gate, missing‑adapter 404, redirect URI guard, state row issuance + PKCE, completeInstall happy path + replay block + DB persistence + token round‑trip, expired state, user‑binding mismatch, in‑place reinstall (token rotation + scope merge), revoke (success + vendor‑error swallow), expired state sweep. |
| `server/src/__tests__/connector-oauth-routes.test.ts` | 11 tests with mocked service: anonymous + Operator denied 403 on install/revoke, feature‑flag‑disabled forwarded as 403, happy path returns authorize URL + logs `connector.install_started`, vendor error on callback returns 400 HTML without persisting, missing state/code → 400, success → 302 to round‑tripped `returnTo`, attacker `returnTo` falls back to `/`, revoke happy path. |

Two open questions from §9 are now locked:

1. **Coworker identity in vendor systems** (Q4): default to **single bot user per workspace** for CRP5 (Slack). Per‑coworker user mapping is a Phase 2 feature once we have customer demand and the operational story for vendor‑side identity provisioning. The runtime contract supports either; the CRP5 UI will not expose the per‑coworker option yet.
2. **Redirect URI stability** (Q2): self‑host instances must set `BENCH_PUBLIC_URL` env var (or trust a reverse proxy that sets `X‑Forwarded‑*`). `resolveConnectorRedirectUri` validates the result is HTTPS or a loopback URL and refuses anything else. Vendor‑side webhook re‑register for hostname changes lives with CRP3 webhook ingress.

### CRP1 implementation notes (for reviewers)

| File | What it does |
|---|---|
| `packages/db/src/schema/connector_accounts.ts` | Workspace‑level vendor install. References `companies` (cascade) and `companySecrets` for `tokenSecretId` + `webhookSecretSecretId` (set null on delete) — no inline crypto blobs. |
| `packages/db/src/schema/agent_connector_grants.ts` | Per‑coworker scope + `resourceFilter` allow‑list. Cascade‑deletes with the agent. Server is the source of truth; a coworker‑side hint is never trusted. |
| `packages/db/src/schema/connector_inbound_events.ts` | Append‑only webhook log. `unique (connector_account_id, external_event_id)` is the dedupe boundary the service relies on for idempotent ingest. |
| `packages/db/src/schema/connector_outbound_audit.ts` | Append‑only outbound MCP audit. Indexes mirror `cost_events` (`(company, occurred_at)`, `(company, agent, occurred_at)`) so the same dashboard query patterns work. |
| `packages/db/src/migrations/0077_minor_carnage.sql` | Generated by `pnpm db:generate`; round‑trips clean against the embedded test cluster. |
| `server/src/services/connector-runtime.ts` | The whole spine. Gates every write on `instanceSettings.experimental.enableConnectorRuntime`. Stores OAuth tokens + webhook secrets via `secretService.create` (`local_encrypted` provider → AES‑256‑GCM at rest, satisfies `codeguard‑0‑additional‑cryptography`). Redacts every JSONB write through `sanitizeRecord`. Translates the `23505` unique‑violation on inbound ingest into a `deduped: true` return so callers don't have to know the table layout. |
| `packages/shared/src/validators/instance.ts` + `types/instance.ts` | New `enableConnectorRuntime: boolean` field on `instanceExperimentalSettingsSchema` (default `false`). |
| `ui/src/pages/InstanceExperimentalSettings.tsx` | Toggle row "Enable Connector Runtime" under **Bench Settings → Experimental**. |
| `server/src/__tests__/connector-runtime-service.test.ts` | 6 tests against the embedded Postgres harness: feature‑flag gate, account creation + token round‑trip + idempotency, scope‑subset enforcement, cross‑workspace rejection, inbound dedupe + payload redaction, outbound audit + spend roll‑up. |

Things deliberately deferred:
- HTTP routes for install / callback / webhook ingress (CRP2 + CRP3).
- Per‑vendor MCP scope‑enforcement middleware (CRP4 — service exposes `recordOutboundCall` for it to call).
- Roll‑up of `connector_outbound_audit.costCents` into `cost_events` (waits for the unit‑economics decision in CRP4; today the audit row carries the field as a hint, the financial spend table is unaffected).

---

## 8. Out of scope (intentionally)

- **Customer‑hosted MCP servers** — initial runtime hosts everything Bench‑side. A future option is "BYO MCP" where customers point Bench at their own MCP endpoints (lower trust transfer, more enterprise control). Tracked separately.
- **Per‑message LLM cost of reading vendor inbound events** — webhook ingress only persists; LLM cost is incurred when the coworker is woken to act, attributed via the existing run‑cost path.
- **Cross‑connector workflows** (e.g., "when a Linear issue closes, comment on the Slack thread") — runtime supports this via the event bus, but explicit workflow primitives are deferred.
- **Per‑user (vs per‑workspace) OAuth** — V1 uses workspace‑level OAuth installs. Per‑user delegation (e.g., a coworker acting "as" a specific human in Drive) is a Phase 2 question.

---

## 9. Open questions

Resolved in CRP1:

1. **Token encryption envelope** ✅ — CRP1 standardized on the existing `local_encrypted` provider (AES‑256‑GCM at rest); cloud KMS swaps in via the same `secretService` interface.

Resolved in CRP2:

2. **Redirect URI stability across self‑host upgrades** ✅ — `BENCH_PUBLIC_URL` env var (preferred) or trusted reverse proxy headers (`X‑Forwarded‑*`). `resolveConnectorRedirectUri` rejects anything that isn't HTTPS or a loopback URL. Vendor‑side webhook re‑register on hostname changes is a CRP3 admin affordance.
4. **Coworker identity in vendor systems** ✅ — default to a single bot user per workspace install for CRP5; per‑coworker identity is Phase 2 once customer demand justifies the IT‑provisioning workflow.

Still open:

3. **MCP transport** — stdio vs HTTP streaming for the wrapped vendor MCPs. Recommend stdio for security (per `codeguard-0-mcp-security`); Bench server holds the connection. Decide before CRP4.
5. **Optional vs required connectors at hire approval** — confirm the design brief's recommendation that *required* connectors block approval, *optional* don't. Decide alongside RBAC PR3.

---

## 10. Acceptance for this plan doc (no code yet)

- Architectural fork is decided and documented (Option C).
- Capability matrix is complete for the eight Phase‑1 vendors and tied to today's `integrations/` stubs.
- Phased rollout sequenced; first PR (CRP1) is small enough to ship in isolation.
- Hire‑flow integration is explicitly tied to [RBAC PR3](./2026-05-11-rbac-and-hire-requests.md#3-pr3--hire-request-as-a-typed-entity).
- Open questions enumerated; none blocks CRP1.

CRP1 + CRP2 are shipped. The next step is **CRP3** — webhook ingress framework: HMAC verifier interface per vendor, idempotent receiver wired to `connector_inbound_events` (the table + service helper already exist), and dead‑letter handling. Slack (CRP5) is the first vendor that exercises the full stack end‑to‑end.
