/** Only same-site paths are allowed as ?next= targets, so login cannot be turned into an open redirect. */
export function safeNext(next: string | null, fallback = "/clients"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
