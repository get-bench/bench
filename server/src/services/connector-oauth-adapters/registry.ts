import type { ConnectorOAuthAdapter } from "./types.js";

/**
 * Registry of per-vendor OAuth adapters.
 *
 * Adapters are registered at module load time via `registerConnectorOAuthAdapter`.
 * The route layer looks them up by `connectorId`. Lookup misses return `null`
 * so the route can respond with a 404 ("connector not configured") instead of
 * crashing.
 *
 * The registry is intentionally process-local: adapters are code, not data.
 * They ship with the Bench server build. Customers wiring a new connector
 * means rebuilding the server, not editing a row in the DB. This is the
 * conservative choice — runtime-loaded adapters would expand the trust
 * boundary in ways that are out of scope for CRP2.
 */
const adapters = new Map<string, ConnectorOAuthAdapter>();

export function registerConnectorOAuthAdapter(adapter: ConnectorOAuthAdapter): void {
  if (adapters.has(adapter.connectorId)) {
    throw new Error(
      `Connector OAuth adapter for "${adapter.connectorId}" is already registered`,
    );
  }
  adapters.set(adapter.connectorId, adapter);
}

export function getConnectorOAuthAdapter(connectorId: string): ConnectorOAuthAdapter | null {
  return adapters.get(connectorId) ?? null;
}

export function listRegisteredConnectorOAuthAdapters(): ConnectorOAuthAdapter[] {
  return Array.from(adapters.values());
}

/** Test-only helper. Not exported from the package barrel. */
export function __resetConnectorOAuthAdaptersForTests(): void {
  adapters.clear();
}
