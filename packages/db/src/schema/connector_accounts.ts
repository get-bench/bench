import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";

/**
 * Workspace-scoped install of a third-party connector (Slack workspace, GitHub
 * org, Jira site, …). Owns identity + scope at the *workspace* boundary; per-
 * coworker scoping lives in `agent_connector_grants`.
 *
 * Tokens are NOT stored inline. `tokenSecretId` and `webhookSecretSecretId`
 * reference rows in `company_secrets`, which are AES-256-GCM-encrypted at rest
 * via the existing `local_encrypted` secret provider. This avoids reinventing
 * key management and gives versioning/rotation for free.
 */
export const connectorAccounts = pgTable(
  "connector_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Stable connector id from `CONNECTOR_CATALOG` (e.g. "slack", "github"). */
    connectorId: text("connector_id").notNull(),
    /** Vendor-side workspace/org id (e.g. Slack team `T0123`, GH org login). */
    externalAccountId: text("external_account_id").notNull(),
    /** Human-readable label shown in the UI ("Cisco Engineering"). */
    externalAccountLabel: text("external_account_label"),
    /** Auth-user id of the human (Workspace Owner / Admin) who installed it. */
    installedByUserId: text("installed_by_user_id"),
    /** Reference to a `company_secrets` row holding the OAuth grant payload. */
    tokenSecretId: uuid("token_secret_id").references(() => companySecrets.id, {
      onDelete: "set null",
    }),
    /** Reference to a `company_secrets` row holding the webhook signing key. */
    webhookSecretSecretId: uuid("webhook_secret_secret_id").references(() => companySecrets.id, {
      onDelete: "set null",
    }),
    /** Workspace-level OAuth scopes granted by the user. */
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    /** "active" | "expired" | "revoked" | "needs_reauth" */
    status: text("status").notNull().default("active"),
    /** Vendor-specific opaque metadata (org urls, install id, region, …). */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyConnectorIdx: index("connector_accounts_company_connector_idx").on(
      table.companyId,
      table.connectorId,
    ),
    companyConnectorExternalUq: uniqueIndex("connector_accounts_company_connector_external_uq").on(
      table.companyId,
      table.connectorId,
      table.externalAccountId,
    ),
  }),
);
