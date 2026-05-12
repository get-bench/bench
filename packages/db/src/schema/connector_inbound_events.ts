import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { connectorAccounts } from "./connector_accounts.js";

/**
 * Append-only log of webhook events received from a third-party connector.
 * The runtime writes one row per verified inbound event, idempotent on
 * `(connector_account_id, external_event_id)` so vendor retries don't
 * double-route.
 *
 * `payload` is stored after running it through the redaction path used by
 * activity logs — secrets and known-PII fields are stripped before persist.
 * Raw payloads are NEVER persisted unredacted.
 */
export const connectorInboundEvents = pgTable(
  "connector_inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    connectorAccountId: uuid("connector_account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "cascade" }),
    /** Vendor event type, e.g. "app_mention", "pull_request.opened". */
    eventType: text("event_type").notNull(),
    /** Vendor-side dedupe key (Slack `event_id`, GH `delivery` header, …). */
    externalEventId: text("external_event_id").notNull(),
    /** Redacted JSON payload. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Coworker the runtime routed this event to (null = unrouted/ignored). */
    routedAgentId: uuid("routed_agent_id").references(() => agents.id, { onDelete: "set null" }),
    routedAt: timestamp("routed_at", { withTimezone: true }),
    /** "received" | "routed" | "ignored" | "failed" | "duplicate" */
    status: text("status").notNull().default("received"),
    /** Vendor signature timestamp — used for replay-window enforcement. */
    vendorTimestamp: timestamp("vendor_timestamp", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyReceivedIdx: index("connector_inbound_events_company_received_idx").on(
      table.companyId,
      table.receivedAt,
    ),
    accountReceivedIdx: index("connector_inbound_events_account_received_idx").on(
      table.connectorAccountId,
      table.receivedAt,
    ),
    statusReceivedIdx: index("connector_inbound_events_status_received_idx").on(
      table.status,
      table.receivedAt,
    ),
    accountExternalUq: uniqueIndex("connector_inbound_events_account_external_uq").on(
      table.connectorAccountId,
      table.externalEventId,
    ),
  }),
);
