# Bench — Product Vision & Feature Brief

> *"Don't ask enterprises to come to your dashboard. Go where they already work."*

---

## What is Bench?

Bench is an **autonomous enterprise workforce platform**—a way for companies to hire AI coworkers who live and operate inside the tools they already use, not inside a new dashboard they have to babysit.

Where most agent platforms build a new place for AI to work (a portal, a chat interface, a separate orchestration layer), Bench flips the model: you hire a coworker, onboard them into your existing app ecosystem, and they show up in Slack, respond to emails, update Jira tickets, join meetings, and take notes—just like a contractor who started this Monday.

The Bench dashboard exists, but it is a **visibility and governance layer**, not the primary interface. Work happens where your team already works.

### Coworker identity where teams already work

Managers should not have to open Bench for every request. Day-to-day coordination stays in **email, Slack, Jira, Figma**, and the rest of your stack. Bench holds **configuration and policy**: who the coworker is, **their organizational work email** (provisioned in your tenant—Google Workspace, Microsoft 365, etc.—and recorded in Bench so IT and automations share one canonical address), **connector grants**, budgets, skills, and oversight.

**Mail handoff (target experience):** Operations Cc or routes threads to the coworker’s **company-managed address** (for example `alex.bench@yourcompany.com`). **Bench does not host inboxes**—your tenant does. A future ingestion path (connector + heartbeat or webhook) reads that mailbox, turns signals into **tasks or runs**, and the coworker executes with the adapters and skills you configured—still governed from Bench, invisible until you need it.

**Connector access:** When a coworker needs a tool that is not yet wired, operators raise a **connector access request** (tracked as work for the **people manager** or team owner), who completes OAuth or admin approval in **Board → Connectors**. The product stays honest: **identity and inbox delivery remain customer-owned**; Bench orchestrates assignments, connectors, and auditability.

---

## The Core Mental Model: Contractors, Not Agents

The language matters. Bench does not use the word "agent."

Enterprises already know how to work with contractors. They know the pattern: you define the role, you give them access to the tools they need, you check in occasionally, they deliver work. Bench maps directly to that mental model.

- You **hire** a coworker (not "deploy an agent")
- You **onboard** them (connect their apps, set their access)
- They **join your team** (Slack, email, calendar, GitHub, Jira)
- You **check their work** from a dashboard (not manage their every step)

This is not a metaphor bolted on top of an agent framework. It is the actual product experience, from the first screen to the day-to-day.

---

## How Bench Differs from PaperClip

Bench is built on top of PaperClip's orchestration infrastructure. That is a deliberate choice—PaperClip is a solid foundation for multi-agent orchestration and we should not rebuild what already works. But the product layer is fundamentally different.

| | PaperClip | Bench |
|---|---|---|
| **Primary interface** | Dashboard (inbox, issues, routines) | Your existing apps (Slack, email, etc.) |
| **Mental model** | Agent management | Contractor hiring |
| **Unit of work** | Issues / tasks you assign | Autonomous coworkers you onboard |
| **User posture** | Active management | Passive oversight |
| **Target user** | Builders and operators | Enterprise managers and teams |
| **Onboarding** | Configure agents and skills | Hire a role; map their toolchain |
| **Visibility** | Per-agent status | Per-coworker activity feed |

The key distinction: **PaperClip asks you to manage work. Bench asks you to hire people.**

PaperClip's agent runtime, skill system, and connector infrastructure are used under the hood. The Bench product layer reimagines how enterprises interact with that infrastructure.

---

## The Onboarding Flow (Stable Shape, Evolving Toolchain)

Onboarding stays **three steps** (company → coworker → launch). **Step structure should not change without an intentional product decision.** Toolchain rows are expected to **grow with the connector catalog** (e.g. design & research tools alongside engineering trackers).

### Step 1 — Company

Name the organization. Optionally add a description, website, and a document for the coworker to learn from (internal wiki, PRD, style guide, etc.).

### Step 2 — Coworker

Pick a role from a preset catalog or define a custom one. Current roles:

- **Frontend Engineer** — React/TypeScript, component architecture, design systems
- **Backend Engineer** — APIs, service integrations, schema changes
- **Product Designer** — UX flows, interaction specs, copy, IA
- **QA Automation** — Regression tests, critical path validation, UI/API boundaries
- **Custom role** — Define your own title and responsibilities

Each role has a description and is priced at $39/mo (currently $0 for early access, shown as strikethrough).

### Step 3 — Launch (Toolchain Setup)

Map the apps this coworker will use. Organized by category (pick one option per row; optional rows can defer to the dashboard):

- **Team chat** (required): Slack, Microsoft Teams, Webex/Cisco, Google Chat, Mattermost
- **Email & calendar** (required): Outlook/M365, Gmail/Google Workspace, Apple Mail
- **Code & repositories**: GitHub, GitLab, Bitbucket, Azure Repos
- **Meetings**: Google Meet, Zoom, Microsoft Teams, Webex
- **Work tracking**: Jira, Linear, Asana, Azure DevOps, GitHub Issues
- **Docs & wiki**: Confluence, Notion, Google Docs/Drive, SharePoint, other wiki/docs
- **Design & research** (optional): Figma, Miro, Dovetail, Adobe (XD / Creative Cloud), Sketch, other—so designer-led roles can combine **Jira + Confluence + Figma** (and similar) in one pass without treating design tools as an afterthought

Optional categories default to "Decide later in dashboard" so onboarding stays lightweight. Required categories (chat and email) must be selected before launch.

At the bottom: **Adapter type** (Claude Code recommended) and **Model selection** (currently gpt-5.3-codex as placeholder).

**Preset nudge:** Choosing **Product Designer** seeds sensible defaults (e.g. Figma, Jira, Confluence); operators can change any row before launch.

---

## The Dashboard (Needs to Be Built)

This is where the core product work lives. The dashboard has two audiences with different needs.

### Audience 1: Bench Admin (the person who owns the subscription)

Sees everything. All coworkers across all orgs, all activity, billing, connector health, and global settings. Think of this as the "staffing agency" view—they manage the bench of available contractors and who is assigned where.

### Audience 2: Team Manager (e.g. an Engineering Manager at a customer org)

Sees only the coworkers assigned to their team. Cannot see other orgs or other teams' coworkers. They can: view activity logs, adjust instructions, add or remove connectors, pause or terminate a coworker's access.

### Dashboard Sections

#### Home / Overview

- Active coworkers (count, roles, status indicators)
- Recent activity feed across all coworkers (what they did, in which tools, when)
- Alerts: connector errors, auth failures, flagged actions needing review

#### Coworkers

The primary section. A list of all hired coworkers. Each row shows:

- Name and role
- Assigned org/team
- Connected apps (icon strip)
- Activity status (active now / last seen X hours ago)
- Monthly cost

Clicking into a coworker opens their profile:

- **Identity**: Name, role, avatar, description
- **Skills**: Preset capabilities + custom instructions added by the team
- **Connectors**: All connected apps with auth status and last-sync time
- **Activity log**: Timestamped feed of everything this coworker has done (sent a Slack message, updated a Jira ticket, responded to an email, joined a meeting, etc.)
- **Instructions**: Free-text field for team-specific guidance ("Always tag PRs with the team label," "Do not respond to emails on weekends," etc.)
- **Access controls**: Which team members can interact with this coworker

#### Orgs

Multi-tenancy support. Each Bench customer can create multiple orgs (e.g. separate business units, clients, or subsidiaries). Coworkers are scoped to an org. Admins can move coworkers between orgs or share coworkers across orgs with read-only visibility for the non-owning org.

#### Connectors

A global connector health dashboard. Shows all OAuth connections, their status, and which coworkers depend on them. One-click re-auth for expired tokens. Connector catalog for adding new integrations.

**Access requests:** Coworkers do not silently gain production OAuth. When someone needs a net-new connector or scope expansion, the UI surfaces a **request to the manager** (task-oriented flow); the manager or admin completes wiring in Connectors and audit trails stay intact.

#### Settings

- Billing (subscription per coworker seat)
- API keys (BYOK support — customers bring their own LLM keys)
- SSO / identity (Okta, Azure AD integration for enterprise auth)
- Audit log (full exportable log of all coworker actions for compliance)
- Data residency and retention settings

---

## Enterprise-Readiness Requirements (Day One)

These are not stretch goals. They are requirements for any enterprise customer to take Bench seriously.

- **BYOK (Bring Your Own Key)**: Customers can supply their own OpenAI, Anthropic, or other model API keys. Bench never sees their prompts or data unless they opt in.
- **SSO**: Okta and Azure AD support via SAML/OIDC.
- **Audit logging**: Every coworker action logged with timestamp, actor, app, and outcome. Exportable as CSV or via API.
- **Role-based access control**: Admin, Manager, and Viewer roles. Managers only see their assigned coworkers.
- **Data isolation**: Each org's data is isolated. No cross-org leakage.
- **Connector permissions scoping**: Each coworker only gets the minimum OAuth scopes needed for their role.
- **Compliance hooks**: SOC 2 posture from day one. Data retention controls. PII handling policies.

---

## What Bench Is Not

To keep the vision sharp:

- **Not a workflow builder**: Bench coworkers are autonomous. You do not define step-by-step workflows. You give them a role and tools and they figure out the steps. (This is the key differentiator from Moveworks-style workflow automation.)
- **Not a chatbot**: You do not talk to Bench. You talk to your coworker in Slack, just like you would a real person. Bench is the infrastructure behind them.
- **Not a dashboard you live in**: The dashboard is for configuration, task overview, capacity, cost caps, connectors, and skills—not where managers spend every hour. If executive stakeholders live in Bench instead of their real tools, we have not delivered the vision (exceptions: admins, auditors, and deliberate oversight sessions).
- **Not per-task pricing**: Coworkers are hired on a monthly subscription. Predictable cost, like a real contractor retainer.

---

## Technical Foundation

Bench is forked from PaperClip. The following PaperClip primitives are reused as-is or with light modification:

- **Agent runtime**: The core execution engine that runs coworker tasks
- **Skill system**: Preset capabilities that map to role definitions
- **Connector infrastructure**: OAuth integration layer for third-party apps
- **Memory/context**: Coworker memory of past interactions and org context

The following are net-new in Bench:

- **Coworker identity layer**: Each coworker has a persistent identity (name, avatar, role) that surfaces in connected apps (e.g. a Slack bot with the coworker's name and avatar)
- **Multi-org / RBAC system**: Org scoping, team assignment, and tiered access control
- **Activity feed**: Unified log of cross-app coworker actions
- **Enterprise auth**: SSO, BYOK, audit logging
- **Onboarding flow**: The three-step hire/onboard/launch experience (already built)

---

## Immediate Build Priorities

Given the onboarding is done, the next three things to build in order:

1. **Coworker dashboard (single-org, single-coworker view)** — Get one coworker visible, showing their connected apps and a basic activity feed. This is the core loop.

2. **Slack connector + identity** — The highest-value first integration. A coworker with a name and avatar in Slack who responds to DMs and can read/post in channels. This is the demo that sells the vision.

3. **Multi-org and RBAC** — Once the single-coworker loop works, layer in org scoping and the Manager vs Admin view.

Everything else (advanced connectors, billing, SSO, audit log) follows after the core loop is working and validated with early customers.

---

## The Pitch in One Paragraph

Enterprises are not short on AI tools. They are short on AI that fits into how they already work. Bench hires autonomous coworkers into your existing team—they live in your Slack, respond to your emails, update your Jira tickets, and join your standups. You hire them like contractors, onboard them like employees, and oversee them from a dashboard you barely need to open. Built on proven agent infrastructure, enterprise-ready from day one, and priced like a seat, not a usage meter.

---

*Document version: 0.2 — May 2026*

*Share with Cursor to guide dashboard build. Keep the three-step onboarding skeleton; extend toolchain categories and dashboard surfaces as the connector catalog and enterprise flows mature.*
