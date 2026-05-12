/** Uploaded avatar image; public asset content path from POST /companies/:id/assets/images */
export const COWORKER_AVATAR_CONTENT_PATH_METADATA_KEY = "coworkerAvatarContentPath";

export function getCoworkerAvatarContentPath(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata[COWORKER_AVATAR_CONTENT_PATH_METADATA_KEY];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}
