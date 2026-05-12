import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * Short-lived OAuth state rows used by the Connector Runtime's install flow.
 *
 * One row is created when a Workspace Owner / Admin clicks "Install" on a
 * connector; it stores the random `state` token, the PKCE `codeVerifier`, the
 * redirect URI we sent to the vendor, and the requested scopes. The vendor
 * round-trips `state` back to `/api/connectors/:id/callback`, where we look
 * the row up, validate it, and delete it.
 *
 * Why a table instead of an in-memory map:
 *   - Must survive process restarts (OAuth callbacks can take 30+ seconds in
 *     real-world consent flows; cloud Bench restarts mid-flow).
 *   - Must work across horizontally-scaled instances (any node may receive
 *     the callback regardless of which one served the install).
 *   - Gives us a built-in audit trail of attempted installs.
 *
 * Rows are single-use: the callback handler deletes the row after a
 * successful exchange. A nightly cron sweeps anything past `expiresAt` so
 * abandoned installs don't accumulate. Default lifetime: 15 minutes — long
 * enough for the slowest enterprise SSO flow, short enough to bound replay
 * windows.
 *
 * Security notes:
 *   - `state` is the dedupe + replay key; uniqueness is enforced at the DB
 *     level so two callbacks for the same state can never race.
 *   - `codeVerifier` is the PKCE S256 verifier (RFC 7636); never logged.
 *   - We do NOT store any vendor secret here — those land in `company_secrets`
 *     once the code exchange succeeds.
 */
export const connectorOauthStates = pgTable(
  "connector_oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Random opaque token (≥256 bits) sent in the OAuth `state` parameter. */
    state: text("state").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Stable connector id from `CONNECTOR_CATALOG` (e.g. "slack"). */
    connectorId: text("connector_id").notNull(),
    /** Auth-user id who initiated the install. Callback rejects mismatches. */
    initiatedByUserId: text("initiated_by_user_id").notNull(),
    /**
     * The redirect URI we sent to the vendor — vendor will reject the code
     * exchange if it doesn't match the install request. We persist it so the
     * callback handler doesn't have to re-derive it (which would race with
     * config changes mid-flow).
     */
    redirectUri: text("redirect_uri").notNull(),
    /** PKCE S256 code verifier (RFC 7636). Never log this. */
    codeVerifier: text("code_verifier").notNull(),
    /** Scopes the install asked for; we record what the user *got* on grant. */
    requestedScopes: jsonb("requested_scopes").$type<string[]>().notNull().default([]),
    /**
     * Optional opaque metadata the install flow wants to round-trip — e.g. a
     * `returnTo` UI route, a hire-flow correlation id. Sanitized on read.
     */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stateUq: uniqueIndex("connector_oauth_states_state_uq").on(table.state),
    expiresAtIdx: index("connector_oauth_states_expires_at_idx").on(table.expiresAt),
    companyConnectorIdx: index("connector_oauth_states_company_connector_idx").on(
      table.companyId,
      table.connectorId,
    ),
  }),
);
