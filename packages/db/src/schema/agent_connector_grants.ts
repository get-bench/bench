import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { connectorAccounts } from "./connector_accounts.js";

/**
 * Per-coworker scoping of a workspace connector install. A `connector_accounts`
 * row says "Cisco Engineering authorized Bench in their Slack workspace and
 * granted these scopes". An `agent_connector_grants` row says "Riya
 * (Designer) is allowed to use this Slack install with this *subset* of scopes,
 * limited to these channels".
 *
 * `resourceFilter` is the per-vendor allow-list that the runtime middleware
 * enforces server-side (channel ids for Slack, repo full names for GitHub,
 * project keys for Jira, …). The runtime never trusts a coworker-side hint;
 * the row is the source of truth.
 */
export const agentConnectorGrants = pgTable(
  "agent_connector_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    connectorAccountId: uuid("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "cascade" }),
    /** Subset of `connector_accounts.scopes`. Enforced on every outbound call. */
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    /** Vendor-specific allow-list, e.g. `{ channels: ["C0123"] }`. */
    resourceFilter: jsonb("resource_filter").$type<Record<string, unknown>>().notNull().default({}),
    /** Auth-user id of the human who created this grant (audit trail). */
    grantedByUserId: text("granted_by_user_id"),
    /** Optional expiry for time-bounded delegations. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentAccountIdx: index("agent_connector_grants_agent_account_idx").on(
      table.agentId,
      table.connectorAccountId,
    ),
    accountAgentIdx: index("agent_connector_grants_account_agent_idx").on(
      table.connectorAccountId,
      table.agentId,
    ),
    agentAccountUq: uniqueIndex("agent_connector_grants_agent_account_uq").on(
      table.agentId,
      table.connectorAccountId,
    ),
  }),
);
