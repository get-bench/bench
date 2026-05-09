/**
 * Central connector catalog types (Bench Phase -1).
 * UI and docs should stay aligned with {@link CONNECTOR_CATALOG}.
 */

export type ConnectorCategory =
  | "collaboration"
  | "mail_calendar"
  | "meetings"
  | "engineering"
  | "delivery"
  | "knowledge"
  | "design_research"
  | "platforms"
  | "trust";

/** Typical posture when hiring a coworker — not a hard enforcement flag in V1. */
export type ConnectorTypicalImportance = "required" | "recommended" | "optional";

/**
 * Loose “who usually cares” lens for directory filters — not RBAC.
 * Connectors without {@link ConnectorDefinition.audiences} match every audience filter.
 */
export type ConnectorAudience =
  | "engineering"
  | "design"
  | "product"
  | "data"
  | "operations"
  | "gtm"
  | "people"
  | "security"
  | "leadership";

export interface ConnectorDefinition {
  id: string;
  /**
   * Optional key for the board UI (`tech-stack-icons` `StackIcon` `name`). Omit when no brand asset exists in that set.
   */
  stackIcon?: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  typicalImportance: ConnectorTypicalImportance;
  /** Extra phrases for search (capabilities, synonyms). */
  keywords?: string[];
  /** When set, directory “Team focus” filters to these audiences; omit = relevant to any team. */
  audiences?: ConnectorAudience[];
  /** Short paragraph at top of the setup guide (operator context). */
  setupOverview?: string;
  /** Narrative bullets before prerequisites (policies, ownership). */
  rolloutNotes?: string[];
  /** Ordered checklist for IT / operator — product-specific wiring may ship incrementally. */
  setupSteps: string[];
  /** Short bullets focused on OAuth / tokens / admin consent (optional; UI falls back to generic guidance). */
  authenticationNotes?: string[];
  /** Optional vendor docs or admin consoles. */
  learnMoreUrl?: string;
  prerequisites?: string[];
}
