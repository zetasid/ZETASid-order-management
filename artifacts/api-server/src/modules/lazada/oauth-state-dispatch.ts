export type LazadaOAuthFlow = "seller" | "im" | "ambiguous" | "unknown";

export type OAuthStateMatches = {
  seller: boolean;
  im: boolean;
};

/**
 * Resolve legacy states from their server-side records first. Namespaces are
 * only a fallback for newly-issued states whose record is no longer present;
 * legacy unrecorded states are intentionally rejected as ambiguous.
 */
export async function resolveLazadaOAuthFlow(
  state: unknown,
  lookup: (state: string) => Promise<OAuthStateMatches>,
): Promise<LazadaOAuthFlow> {
  if (typeof state !== "string" || state.length < 1 || state.length > 256) return "unknown";

  const matches = await lookup(state);
  if (matches.seller && matches.im) return "ambiguous";
  if (matches.seller) return "seller";
  if (matches.im) return "im";
  if (state.startsWith("seller1_")) return "seller";
  if (state.startsWith("im1_")) return "im";
  return "unknown";
}
