function slugPart(value: string, maxLen: number): string {
  const s = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  return s.length > 0 ? s : "coworker";
}

/**
 * Illustrative org-scoped address for IT (not provisioned by Bench).
 * Example: `alex.bench@acme-corp.com` — replace the domain with your real mail routing.
 */
export function suggestCoworkerWorkEmail(agentName: string, companyName: string): string {
  return `${slugPart(agentName, 40)}.bench@${slugPart(companyName, 48)}.com`;
}
