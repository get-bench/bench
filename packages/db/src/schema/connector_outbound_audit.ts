import { pgTable, uuid, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { connectorAccounts } from "./connector_accounts.js";

/**
 * Append-only audit of every MCP / connector tool call made on a coworker's
 * behalf. The runtime writes one row per outbound invocation *after* scope +
 * resource_filter enforcement, so this is the system-of-record for "what did
 * Riya actually do in customer Slack today" and the source for connector cost
 * attribution.
 *
 * `request` and `responseSummary` are redacted: bearer tokens, attachments,
 * full message bodies for high-PII channels are stripped before persist. The
 * shape is intentionally generic across vendors so a single audit query can
 * power the Workspace audit log, the Coworker activity feed, and the cost
 * dashboard.
 */
export const connectorOutboundAudit = pgTable(
  "connector_outbound_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    connectorAccountId: uuid("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "cascade" }),
    /** Fully-qualified tool name, e.g. "slack.chat.postMessage". */
    toolName: text("tool_name").notNull(),
    /** Redacted request payload. */
    request: jsonb("request").$type<Record<string, unknown>>().notNull().default({}),
    /** "ok" | "denied_scope" | "denied_resource" | "vendor_error" | "rate_limited" */
    outcome: text("outcome").notNull(),
    /** Vendor HTTP status code, if applicable. */
    responseStatus: integer("response_status"),
    /** Redacted summary: ts, channel, message id — never full message bodies. */
    responseSummary: jsonb("response_summary").$type<Record<string, unknown>>().notNull().default({}),
    /** Cost attributed to the coworker's monthly spend (vendor seat / API tier). */
    costCents: integer("cost_cents").notNull().default(0),
    /** When the call left Bench (vs created_at = when audit row was written). */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyOccurredIdx: index("connector_outbound_audit_company_occurred_idx").on(
      table.companyId,
      table.occurredAt,
    ),
    companyAgentOccurredIdx: index("connector_outbound_audit_company_agent_occurred_idx").on(
      table.companyId,
      table.agentId,
      table.occurredAt,
    ),
    companyAccountOccurredIdx: index("connector_outbound_audit_company_account_occurred_idx").on(
      table.companyId,
      table.connectorAccountId,
      table.occurredAt,
    ),
    outcomeOccurredIdx: index("connector_outbound_audit_outcome_occurred_idx").on(
      table.outcome,
      table.occurredAt,
    ),
  }),
);
