import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@bench/db";
import {
  agentConnectorGrants,
  agents,
  connectorAccounts,
  connectorInboundEvents,
  connectorOutboundAudit,
} from "@bench/db";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { sanitizeRecord } from "../redaction.js";
import { instanceSettingsService } from "./instance-settings.js";
import { secretService } from "./secrets.js";

/**
 * Stable status set for `connector_accounts.status`. Kept narrow on purpose;
 * vendor-specific reasons go into `metadata.statusReason`.
 */
export type ConnectorAccountStatus = "active" | "expired" | "revoked" | "needs_reauth";

/**
 * Stable outcome set for `connector_outbound_audit.outcome`. Avoid free-form
 * strings — these drive dashboards and the security audit log.
 */
export type ConnectorOutboundOutcome =
  | "ok"
  | "denied_scope"
  | "denied_resource"
  | "denied_runtime_disabled"
  | "vendor_error"
  | "rate_limited";

/**
 * Stable status set for `connector_inbound_events.status`.
 */
export type ConnectorInboundStatus = "received" | "routed" | "ignored" | "failed" | "duplicate";

export interface RecordInboundEventInput {
  companyId: string;
  connectorAccountId: string;
  eventType: string;
  externalEventId: string;
  payload: Record<string, unknown>;
  vendorTimestamp?: Date | null;
  routedAgentId?: string | null;
  status?: ConnectorInboundStatus;
}

export interface RecordOutboundCallInput {
  companyId: string;
  agentId: string;
  connectorAccountId: string;
  toolName: string;
  request: Record<string, unknown>;
  outcome: ConnectorOutboundOutcome;
  responseStatus?: number | null;
  responseSummary?: Record<string, unknown>;
  costCents?: number;
  occurredAt?: Date;
}

export interface CreateConnectorAccountInput {
  companyId: string;
  connectorId: string;
  externalAccountId: string;
  externalAccountLabel?: string | null;
  installedByUserId?: string | null;
  scopes: string[];
  /** OAuth grant payload (access_token, refresh_token, …). Encrypted at rest. */
  tokenPayload: Record<string, unknown>;
  /** Vendor webhook signing key. Encrypted at rest. */
  webhookSecret?: string | null;
  metadata?: Record<string, unknown>;
  expiresAt?: Date | null;
}

export interface CreateAgentGrantInput {
  agentId: string;
  connectorAccountId: string;
  scopes: string[];
  resourceFilter?: Record<string, unknown>;
  grantedByUserId?: string | null;
  expiresAt?: Date | null;
}

/**
 * Connector Runtime service — CRP1 spine.
 *
 * Responsibilities in this slice:
 *   - Gate every write on the instance feature flag (`enableConnectorRuntime`).
 *   - Persist OAuth grants + webhook secrets through the existing AES-256-GCM
 *     `local_encrypted` secret provider; never store raw tokens inline.
 *   - Idempotent inbound-event ingest keyed on `(connectorAccountId,
 *     externalEventId)` so vendor retries don't double-route.
 *   - Append-only outbound audit with redacted request/response.
 *
 * What this slice does NOT do (deferred to CRP2+):
 *   - OAuth install/callback HTTP routes
 *   - Webhook ingress HMAC verification
 *   - MCP wrapping / scope enforcement on outbound calls
 *   - Cost roll-up into `cost_events` (the audit row carries `costCents` as a
 *     hint; CRP4 wires it to financial spend once unit economics are decided).
 */
export function connectorRuntimeService(db: Db) {
  const settings = instanceSettingsService(db);
  const secrets = secretService(db);

  async function requireEnabled(): Promise<void> {
    const experimental = await settings.getExperimental();
    if (!experimental.enableConnectorRuntime) {
      throw forbidden("Connector Runtime is disabled (instance setting `enableConnectorRuntime`).");
    }
  }

  async function isEnabled(): Promise<boolean> {
    const experimental = await settings.getExperimental();
    return experimental.enableConnectorRuntime === true;
  }

  function uniqueScopes(input: string[]): string[] {
    const out = new Set<string>();
    for (const raw of input) {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (trimmed.length === 0 || trimmed.length > 256) continue;
      out.add(trimmed);
    }
    return Array.from(out).sort();
  }

  async function assertAccountInCompany(companyId: string, connectorAccountId: string) {
    const account = await db
      .select()
      .from(connectorAccounts)
      .where(eq(connectorAccounts.id, connectorAccountId))
      .then((rows) => rows[0] ?? null);
    if (!account) throw notFound("Connector account not found");
    if (account.companyId !== companyId) {
      throw forbidden("Connector account belongs to a different workspace");
    }
    return account;
  }

  async function assertAgentInCompany(companyId: string, agentId: string) {
    const agent = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);
    if (!agent) throw notFound("Coworker not found");
    if (agent.companyId !== companyId) {
      throw forbidden("Coworker belongs to a different workspace");
    }
    return agent;
  }

  function buildSecretName(connectorId: string, externalAccountId: string, suffix: "token" | "webhook"): string {
    const safeConnector = connectorId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
    const safeExternal = externalAccountId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    return `connector.${safeConnector}.${safeExternal}.${suffix}`;
  }

  /**
   * Create a workspace-level connector install. Stores OAuth grant + webhook
   * secret as `company_secrets` rows (encrypted) and writes the
   * `connector_accounts` row pointing at them. Idempotent on
   * `(companyId, connectorId, externalAccountId)`.
   */
  async function createConnectorAccount(input: CreateConnectorAccountInput) {
    await requireEnabled();

    const existing = await db
      .select()
      .from(connectorAccounts)
      .where(
        and(
          eq(connectorAccounts.companyId, input.companyId),
          eq(connectorAccounts.connectorId, input.connectorId),
          eq(connectorAccounts.externalAccountId, input.externalAccountId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (existing) {
      throw conflict(
        `Connector ${input.connectorId} is already installed for external account ${input.externalAccountId}`,
        { connectorAccountId: existing.id },
      );
    }

    const tokenSecretName = buildSecretName(input.connectorId, input.externalAccountId, "token");
    const tokenSecret = await secrets.create(
      input.companyId,
      {
        name: tokenSecretName,
        provider: "local_encrypted",
        value: JSON.stringify(input.tokenPayload),
        description: `OAuth grant for ${input.connectorId} install ${input.externalAccountId}`,
      },
      { userId: input.installedByUserId ?? null, agentId: null },
    );

    let webhookSecretId: string | null = null;
    if (input.webhookSecret && input.webhookSecret.trim().length > 0) {
      const webhookSecretName = buildSecretName(
        input.connectorId,
        input.externalAccountId,
        "webhook",
      );
      const webhookSecretRow = await secrets.create(
        input.companyId,
        {
          name: webhookSecretName,
          provider: "local_encrypted",
          value: input.webhookSecret,
          description: `Webhook signing key for ${input.connectorId} install ${input.externalAccountId}`,
        },
        { userId: input.installedByUserId ?? null, agentId: null },
      );
      webhookSecretId = webhookSecretRow.id;
    }

    const [created] = await db
      .insert(connectorAccounts)
      .values({
        companyId: input.companyId,
        connectorId: input.connectorId,
        externalAccountId: input.externalAccountId,
        externalAccountLabel: input.externalAccountLabel ?? null,
        installedByUserId: input.installedByUserId ?? null,
        tokenSecretId: tokenSecret.id,
        webhookSecretSecretId: webhookSecretId,
        scopes: uniqueScopes(input.scopes),
        status: "active",
        metadata: sanitizeRecord(input.metadata ?? {}),
        expiresAt: input.expiresAt ?? null,
      })
      .returning();

    return created;
  }

  /**
   * Idempotent install: rotates token + webhook secrets in place and re-asserts
   * scopes / metadata. Used by the OAuth callback when a workspace clicks
   * "Install" on a connector it already has — vendors handle this by issuing
   * fresh tokens (and optionally expanded scopes), so the right move is to
   * rotate the encrypted secret rather than spawn a duplicate row.
   *
   * Callers should fall back to `createConnectorAccount` if the
   * `(companyId, connectorId, externalAccountId)` combo doesn't already
   * exist; this helper deliberately throws `notFound` rather than upserting,
   * so the route layer keeps explicit control over the create-vs-update
   * branch (which matters for the "first install" activity-log signal).
   */
  async function reinstallConnectorAccount(input: CreateConnectorAccountInput) {
    await requireEnabled();

    const existing = await db
      .select()
      .from(connectorAccounts)
      .where(
        and(
          eq(connectorAccounts.companyId, input.companyId),
          eq(connectorAccounts.connectorId, input.connectorId),
          eq(connectorAccounts.externalAccountId, input.externalAccountId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (!existing) {
      throw notFound(
        `No existing install for ${input.connectorId}/${input.externalAccountId}; call createConnectorAccount first`,
      );
    }

    if (existing.tokenSecretId) {
      await secrets.rotate(
        existing.tokenSecretId,
        { value: JSON.stringify(input.tokenPayload) },
        { userId: input.installedByUserId ?? null, agentId: null },
      );
    } else {
      const tokenSecretName = buildSecretName(
        input.connectorId,
        input.externalAccountId,
        "token",
      );
      const tokenSecret = await secrets.create(
        input.companyId,
        {
          name: tokenSecretName,
          provider: "local_encrypted",
          value: JSON.stringify(input.tokenPayload),
          description: `OAuth grant for ${input.connectorId} install ${input.externalAccountId}`,
        },
        { userId: input.installedByUserId ?? null, agentId: null },
      );
      await db
        .update(connectorAccounts)
        .set({ tokenSecretId: tokenSecret.id })
        .where(eq(connectorAccounts.id, existing.id));
    }

    if (input.webhookSecret && input.webhookSecret.trim().length > 0) {
      if (existing.webhookSecretSecretId) {
        await secrets.rotate(
          existing.webhookSecretSecretId,
          { value: input.webhookSecret },
          { userId: input.installedByUserId ?? null, agentId: null },
        );
      } else {
        const webhookSecretName = buildSecretName(
          input.connectorId,
          input.externalAccountId,
          "webhook",
        );
        const webhookSecretRow = await secrets.create(
          input.companyId,
          {
            name: webhookSecretName,
            provider: "local_encrypted",
            value: input.webhookSecret,
            description: `Webhook signing key for ${input.connectorId} install ${input.externalAccountId}`,
          },
          { userId: input.installedByUserId ?? null, agentId: null },
        );
        await db
          .update(connectorAccounts)
          .set({ webhookSecretSecretId: webhookSecretRow.id })
          .where(eq(connectorAccounts.id, existing.id));
      }
    }

    const mergedScopes = uniqueScopes([...(existing.scopes ?? []), ...input.scopes]);
    const mergedMetadata = sanitizeRecord({
      ...(existing.metadata ?? {}),
      ...(input.metadata ?? {}),
    });

    const [updated] = await db
      .update(connectorAccounts)
      .set({
        scopes: mergedScopes,
        externalAccountLabel: input.externalAccountLabel ?? existing.externalAccountLabel,
        installedByUserId: input.installedByUserId ?? existing.installedByUserId,
        metadata: mergedMetadata,
        status: "active",
        revokedAt: null,
        expiresAt: input.expiresAt ?? existing.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(connectorAccounts.id, existing.id))
      .returning();

    return updated;
  }

  async function listConnectorAccounts(companyId: string) {
    return db
      .select()
      .from(connectorAccounts)
      .where(eq(connectorAccounts.companyId, companyId))
      .orderBy(desc(connectorAccounts.createdAt));
  }

  async function getConnectorAccount(companyId: string, connectorAccountId: string) {
    return assertAccountInCompany(companyId, connectorAccountId);
  }

  /**
   * Decrypt the workspace install's OAuth grant payload. Used by the OAuth
   * service when calling the vendor's revoke endpoint, and by the future
   * outbound MCP middleware (CRP4). NEVER expose the result to the client —
   * call sites must consume the token in-memory and discard.
   */
  async function readConnectorAccountToken(
    companyId: string,
    connectorAccountId: string,
  ): Promise<Record<string, unknown> | null> {
    const account = await assertAccountInCompany(companyId, connectorAccountId);
    if (!account.tokenSecretId) return null;
    const raw = await secrets.resolveSecretValue(companyId, account.tokenSecretId, "latest");
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async function updateConnectorAccountStatus(
    companyId: string,
    connectorAccountId: string,
    status: ConnectorAccountStatus,
    statusReason?: string,
  ) {
    await requireEnabled();
    const account = await assertAccountInCompany(companyId, connectorAccountId);
    const nextMetadata = {
      ...(account.metadata ?? {}),
      ...(statusReason ? { statusReason } : {}),
    };
    const [updated] = await db
      .update(connectorAccounts)
      .set({
        status,
        metadata: nextMetadata,
        revokedAt: status === "revoked" ? new Date() : account.revokedAt,
        updatedAt: new Date(),
      })
      .where(eq(connectorAccounts.id, account.id))
      .returning();
    return updated;
  }

  /**
   * Per-coworker grant of a workspace install. The runtime middleware (CRP4)
   * reads these to enforce scope + resource_filter on every outbound call.
   */
  async function createAgentGrant(companyId: string, input: CreateAgentGrantInput) {
    await requireEnabled();
    const agent = await assertAgentInCompany(companyId, input.agentId);
    const account = await assertAccountInCompany(companyId, input.connectorAccountId);

    const accountScopes = new Set(account.scopes ?? []);
    const grantScopes = uniqueScopes(input.scopes);
    for (const scope of grantScopes) {
      if (!accountScopes.has(scope)) {
        throw unprocessable(
          `Scope "${scope}" is not granted on the workspace install; reinstall to expand scopes.`,
        );
      }
    }

    const existing = await db
      .select()
      .from(agentConnectorGrants)
      .where(
        and(
          eq(agentConnectorGrants.agentId, agent.id),
          eq(agentConnectorGrants.connectorAccountId, account.id),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (existing) {
      throw conflict("Coworker already has a grant for this connector install", {
        agentConnectorGrantId: existing.id,
      });
    }

    const [created] = await db
      .insert(agentConnectorGrants)
      .values({
        agentId: agent.id,
        connectorAccountId: account.id,
        scopes: grantScopes,
        resourceFilter: sanitizeRecord(input.resourceFilter ?? {}),
        grantedByUserId: input.grantedByUserId ?? null,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();

    return created;
  }

  async function listAgentGrants(companyId: string, agentId: string) {
    await assertAgentInCompany(companyId, agentId);
    return db
      .select()
      .from(agentConnectorGrants)
      .where(eq(agentConnectorGrants.agentId, agentId))
      .orderBy(desc(agentConnectorGrants.createdAt));
  }

  /**
   * Upsert a per-coworker grant. Distinct from `createAgentGrant` because the
   * per-coworker UI flows (Slack channel picker, Sheets sheet picker, …) are
   * fundamentally idempotent: the manager picks a set, clicks Save, and we
   * persist that set, replacing whatever was there before. Returning a 409
   * "grant already exists" would force the UI to do a delete-then-create
   * dance and would race against concurrent edits.
   *
   * The contract:
   *   - If no grant exists for `(agentId, connectorAccountId)`, create one.
   *   - If a grant exists, replace its `scopes` and `resourceFilter` wholesale
   *     with the input. We deliberately *replace* rather than merge, because
   *     the UI semantics are "this is the new desired set" — merging would
   *     make it impossible to remove a channel the manager untoggled.
   *   - Scopes are still validated against the parent install's granted
   *     scopes, identical to `createAgentGrant`.
   */
  async function upsertAgentGrant(companyId: string, input: CreateAgentGrantInput) {
    await requireEnabled();
    const agent = await assertAgentInCompany(companyId, input.agentId);
    const account = await assertAccountInCompany(companyId, input.connectorAccountId);

    const accountScopes = new Set(account.scopes ?? []);
    const grantScopes = uniqueScopes(input.scopes);
    for (const scope of grantScopes) {
      if (!accountScopes.has(scope)) {
        throw unprocessable(
          `Scope "${scope}" is not granted on the workspace install; reinstall to expand scopes.`,
        );
      }
    }

    const existing = await db
      .select()
      .from(agentConnectorGrants)
      .where(
        and(
          eq(agentConnectorGrants.agentId, agent.id),
          eq(agentConnectorGrants.connectorAccountId, account.id),
        ),
      )
      .then((rows) => rows[0] ?? null);

    const sanitizedFilter = sanitizeRecord(input.resourceFilter ?? {});

    if (existing) {
      const [updated] = await db
        .update(agentConnectorGrants)
        .set({
          scopes: grantScopes,
          resourceFilter: sanitizedFilter,
          grantedByUserId: input.grantedByUserId ?? existing.grantedByUserId,
          expiresAt: input.expiresAt ?? existing.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(agentConnectorGrants.id, existing.id))
        .returning();
      return { row: updated, created: false as const };
    }

    const [created] = await db
      .insert(agentConnectorGrants)
      .values({
        agentId: agent.id,
        connectorAccountId: account.id,
        scopes: grantScopes,
        resourceFilter: sanitizedFilter,
        grantedByUserId: input.grantedByUserId ?? null,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    return { row: created, created: true as const };
  }

  /**
   * Idempotent inbound-event ingest. Returns the existing row if the same
   * `(connectorAccountId, externalEventId)` pair has already been seen — this
   * is the central dedupe boundary for vendor retries.
   *
   * Caller MUST verify the vendor signature *before* calling this. The runtime
   * does not do signature verification here because the verifier is per-vendor
   * (CRP3 plumbs that in).
   */
  async function recordInboundEvent(input: RecordInboundEventInput) {
    await requireEnabled();
    const account = await assertAccountInCompany(input.companyId, input.connectorAccountId);

    const sanitizedPayload = sanitizeRecord(input.payload ?? {});

    try {
      const [created] = await db
        .insert(connectorInboundEvents)
        .values({
          companyId: account.companyId,
          connectorAccountId: account.id,
          eventType: input.eventType,
          externalEventId: input.externalEventId,
          payload: sanitizedPayload,
          status: input.status ?? "received",
          routedAgentId: input.routedAgentId ?? null,
          routedAt: input.routedAgentId ? new Date() : null,
          vendorTimestamp: input.vendorTimestamp ?? null,
        })
        .returning();
      return { row: created, deduped: false as const };
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "23505") throw err;
      const existing = await db
        .select()
        .from(connectorInboundEvents)
        .where(
          and(
            eq(connectorInboundEvents.connectorAccountId, account.id),
            eq(connectorInboundEvents.externalEventId, input.externalEventId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!existing) throw err;
      return { row: existing, deduped: true as const };
    }
  }

  /**
   * Mark an inbound event as routed/ignored/failed after the dispatcher has
   * decided what to do with it.
   */
  async function setInboundEventStatus(
    companyId: string,
    eventId: string,
    status: ConnectorInboundStatus,
    routedAgentId?: string | null,
  ) {
    await requireEnabled();
    const event = await db
      .select()
      .from(connectorInboundEvents)
      .where(eq(connectorInboundEvents.id, eventId))
      .then((rows) => rows[0] ?? null);
    if (!event) throw notFound("Connector inbound event not found");
    if (event.companyId !== companyId) {
      throw forbidden("Inbound event belongs to a different workspace");
    }
    if (routedAgentId) {
      await assertAgentInCompany(companyId, routedAgentId);
    }
    const [updated] = await db
      .update(connectorInboundEvents)
      .set({
        status,
        routedAgentId: routedAgentId ?? event.routedAgentId,
        routedAt: routedAgentId ? new Date() : event.routedAt,
      })
      .where(eq(connectorInboundEvents.id, event.id))
      .returning();
    return updated;
  }

  /**
   * Append an outbound audit row. Always called *after* scope + resource
   * enforcement; the runtime middleware (CRP4) decides the `outcome` value.
   * The audit row is the system-of-record for "what did this coworker actually
   * do in customer systems."
   */
  async function recordOutboundCall(input: RecordOutboundCallInput) {
    await requireEnabled();
    await assertAgentInCompany(input.companyId, input.agentId);
    await assertAccountInCompany(input.companyId, input.connectorAccountId);

    const occurredAt = input.occurredAt ?? new Date();
    const [created] = await db
      .insert(connectorOutboundAudit)
      .values({
        companyId: input.companyId,
        agentId: input.agentId,
        connectorAccountId: input.connectorAccountId,
        toolName: input.toolName,
        request: sanitizeRecord(input.request ?? {}),
        outcome: input.outcome,
        responseStatus: input.responseStatus ?? null,
        responseSummary: sanitizeRecord(input.responseSummary ?? {}),
        costCents: Math.max(0, Math.trunc(input.costCents ?? 0)),
        occurredAt,
      })
      .returning();

    return created;
  }

  async function getOutboundSpend(
    companyId: string,
    agentId: string,
    sinceMs: number,
  ): Promise<{ costCents: number; calls: number }> {
    const since = new Date(sinceMs);
    const [row] = await db
      .select({
        costCents: sql<number>`coalesce(sum(${connectorOutboundAudit.costCents}), 0)::int`,
        calls: sql<number>`count(*)::int`,
      })
      .from(connectorOutboundAudit)
      .where(
        and(
          eq(connectorOutboundAudit.companyId, companyId),
          eq(connectorOutboundAudit.agentId, agentId),
          gte(connectorOutboundAudit.occurredAt, since),
        ),
      );
    return {
      costCents: Number(row?.costCents ?? 0),
      calls: Number(row?.calls ?? 0),
    };
  }

  return {
    isEnabled,
    requireEnabled,
    createConnectorAccount,
    reinstallConnectorAccount,
    listConnectorAccounts,
    getConnectorAccount,
    readConnectorAccountToken,
    updateConnectorAccountStatus,
    createAgentGrant,
    upsertAgentGrant,
    listAgentGrants,
    recordInboundEvent,
    setInboundEventStatus,
    recordOutboundCall,
    getOutboundSpend,
  };
}
