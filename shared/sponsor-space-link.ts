export type SponsorTarget = { tenantId: string; sponsorId: string };

// A navigation hint, never an access credential. The API checks the signed-in
// account's actual access before returning anything for this target.
export function sponsorSpacePath(target: SponsorTarget) {
  return `/sponsor?${sponsorTargetQuery(target)}`;
}

export function sponsorTargetQuery(target: SponsorTarget) {
  return new URLSearchParams({ tenant: target.tenantId, sponsor: target.sponsorId }).toString();
}

export function readSponsorTarget(search: string): SponsorTarget | undefined {
  const params = new URLSearchParams(search);
  if (!params.has("tenant") && !params.has("sponsor")) return undefined;
  // Preserve incomplete/invalid targets so they fail closed at the API instead
  // of silently turning into an ordinary visit to another sponsor's space.
  return { tenantId: (params.get("tenant") ?? "").toLowerCase(), sponsorId: (params.get("sponsor") ?? "").toLowerCase() };
}
