import { isUuid } from "./database.ts";

export const sponsorDecisions = ["accept", "alternative", "advice", "decline"] as const;
export type SponsorDecision = typeof sponsorDecisions[number];

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseSponsorDecision(body: unknown): Result<{
  decision: SponsorDecision;
  packageVersionId: string | null;
  acknowledged: boolean;
}> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  if (typeof record.decision !== "string" || !sponsorDecisions.includes(record.decision as SponsorDecision)) {
    return { ok: false, error: "invalid_sponsor_decision" };
  }
  const decision = record.decision as SponsorDecision;
  const needsPackage = decision === "accept" || decision === "alternative";
  const packageVersionId = typeof record.packageVersionId === "string" && isUuid(record.packageVersionId)
    ? record.packageVersionId
    : null;
  if (needsPackage && !packageVersionId) return { ok: false, error: "package_version_required" };
  if (needsPackage && record.acknowledged !== true) return { ok: false, error: "binding_acknowledgement_required" };
  return { ok: true, value: { decision, packageVersionId: needsPackage ? packageVersionId : null, acknowledged: record.acknowledged === true } };
}
