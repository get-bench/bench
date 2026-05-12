/**
 * Product copy: domain remains `agent` / routes `/agents`; UI uses "coworker" language.
 *
 * Workspace is the product term for the tenant unit (DB table is still `companies`
 * for historical reasons — see `doc/roles.md`). Role names follow `doc/roles.md`.
 * There is no "Admin coworker bot"; hire approvals route to humans (Workspace
 * Owner / Workspace Admin).
 */

export const CX = {
  coworker: "coworker",
  coworkers: "coworkers",
  Coworkers: "Coworkers",
  newCoworker: "New coworker",
  hireCoworker: "Hire coworker",

  /** Title used when a People Manager raises a hire request. */
  requestHireTitle: "Request: hire a new coworker",

  /** Body when opening a blank hire request from a launcher shortcut. */
  requestHireDescription:
    "Describe the role, tools, and timeline. This will be reviewed by your **Workspace Owner** or **Workspace Admin**, who allocates budget and onboards the new coworker into your roster.\n\nInclude: team, systems (Slack/GitHub/etc.), access level, and urgency.",

  /** Product label for the human role responsible for approving hires in a workspace. */
  approverRoleLabel: "Workspace Owner or Admin",

  /** One-line explanation surfaced in the Request-hire dialog. */
  approverRoleBlurb:
    "Hire requests are reviewed by your Workspace Owner or Admin. They allocate budget, complete OAuth for any new connectors, and pin the new coworker to your manager view.",
} as const;
