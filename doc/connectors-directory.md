# Bench — Connector directory

This document is the **human-readable companion** to the canonical connector catalog in code:

- TypeScript source: `packages/shared/src/connectors/catalog.ts` plus `catalog-additions.ts` (merged into `CONNECTOR_CATALOG` from `@bench/shared`).
- In-product browsing: **Connectors** in the company sidebar (`/connectors`).

Connectors are **apps and systems** a coworker may use (Slack, email, GitHub, Jira, Figma, …). Steps describe a typical IT-safe rollout; specific OAuth apps and scopes will converge as each integration ships in Bench.

---

## How to use this directory

1. **Hiring / onboarding:** Pick connectors from the same categories as onboarding toolchain setup (collaboration, mail, repos, trackers, docs). See alignment note in [`coworkers.md`](./coworkers.md) (coworker = agent — no duplicate surfaces).
2. **Governance:** Review `typicalImportance` in code (`required` | `recommended` | `optional`) — explained in prose inside each setup guide (not as row badges).
3. **Operations:** Follow `setupSteps` in the UI for each connector; keep vendor admin consoles and rotation policies in sync.
4. **Filtering:** The board UI supports **category** and **team focus** lenses; `audiences` on a connector row are hints for who usually cares, not RBAC.

---

## Categories

| Category | Intent |
|----------|--------|
| Collaboration | Presence, DMs, channels, lightweight approvals |
| Mail & calendar | Mailbox triage, invites, scheduling |
| Meetings | Links, recordings policy, calendar coupling |
| Engineering & source control | Repos, PRs, CI signals |
| Planning & delivery | Issues, boards, sprints |
| Knowledge & docs | Specs, runbooks, CMS-style content |
| Design & research | UX/UI tools, research repositories, qualitative insights |
| Infrastructure & platforms | Containers, clouds, datastores, observability, CI/CD, GTM/support APIs |
| Identity & trust | Directory context, SSO-adjacent systems (use sparingly) |

---

## Listing

The authoritative list with **connection steps** lives in the **Connectors** page in the product and in `CONNECTOR_CATALOG` (IDs are stable; use them in docs and APIs).

Prominent entries include:

- **Collaboration:** Slack, Microsoft Teams, Google Chat, Mattermost, Webex Messaging, Discord  
- **Mail/cal:** Outlook / M365, Gmail & Google Calendar, generic IMAP/SMTP (escape hatch), Calendly  
- **Meetings:** Zoom, Google Meet, Teams meetings, Loom  
- **Engineering:** GitHub, GitLab, Bitbucket, Azure Repos  
- **Delivery:** Jira, Linear, Asana, Azure Boards, GitHub Issues, ClickUp, Trello, Height, Shortcut, monday.com  
- **Knowledge:** Confluence, Notion, Google Drive & Docs, **Google Sheets** (separate from Drive so analyst presets can scope to spreadsheets only), SharePoint, Airtable, Webflow, WordPress, Sanity  
- **Design & research:** Figma, Framer, Sketch, Miro, Adobe XD, InVision, Canva, Dovetail, Hotjar, Affinity  
- **Platforms:** Docker, Kubernetes, major clouds, datastores, observability, Segment, Amplitude, CI systems, messaging/commerce APIs — see `CONNECTOR_CATALOG` for the full list.  
- **Trust:** Okta, Entra ID, Auth0, Workday (integration programs — regulated data)

---

## Maintenance

- When adding or renaming a connector, update **`catalog-additions.ts` or `catalog.ts`** and this file’s high-level summary (if the category mix changes).
