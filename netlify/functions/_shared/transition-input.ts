export const transitionSponsorStatuses = ["review", "ready", "sent", "opened", "question", "confirmed", "declined", "exception"] as const;
export const transitionCampaignStatuses = ["draft", "review", "ready"] as const;

export type TransitionSponsorStatus = typeof transitionSponsorStatuses[number];
export type TransitionCampaignStatus = typeof transitionCampaignStatuses[number];

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function normalizedText(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= minimum && normalized.length <= maximum ? normalized : null;
}

function amount(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 100_000_000_000
    ? value as number
    : null;
}

export function parseCampaignInput(body: unknown): Result<{ name: string; targetPeriod: string; responseDeadline: string | null }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const name = normalizedText(record.name, 2, 160);
  const targetPeriod = normalizedText(record.targetPeriod, 2, 80);
  if (!name) return { ok: false, error: "invalid_campaign_name" };
  if (!targetPeriod) return { ok: false, error: "invalid_target_period" };

  let responseDeadline: string | null = null;
  if (record.responseDeadline !== undefined && record.responseDeadline !== null && record.responseDeadline !== "") {
    if (typeof record.responseDeadline !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.responseDeadline)) {
      return { ok: false, error: "invalid_response_deadline" };
    }
    const parsed = new Date(`${record.responseDeadline}T00:00:00Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== record.responseDeadline) {
      return { ok: false, error: "invalid_response_deadline" };
    }
    responseDeadline = record.responseDeadline;
  }
  return { ok: true, value: { name, targetPeriod, responseDeadline } };
}

export function parseMappingInput(body: unknown): Result<{ targetPackage: string; targetValueCents: number }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const targetPackage = normalizedText(record.targetPackage, 1, 160);
  const targetValueCents = amount(record.targetValueCents);
  if (!targetPackage) return { ok: false, error: "invalid_target_package" };
  if (targetValueCents === null) return { ok: false, error: "invalid_target_value" };
  return { ok: true, value: { targetPackage, targetValueCents } };
}

export function parseTransitionSponsorInput(body: unknown): Result<{ proposedPackage: string; proposedValueCents: number; status: TransitionSponsorStatus; exceptionNote: string | null }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const proposedPackage = normalizedText(record.proposedPackage, 1, 160);
  const proposedValueCents = amount(record.proposedValueCents);
  if (!proposedPackage) return { ok: false, error: "invalid_proposed_package" };
  if (proposedValueCents === null) return { ok: false, error: "invalid_proposed_value" };
  if (typeof record.status !== "string" || !transitionSponsorStatuses.includes(record.status as TransitionSponsorStatus)) {
    return { ok: false, error: "invalid_transition_status" };
  }
  let exceptionNote: string | null = null;
  if (record.exceptionNote !== null && record.exceptionNote !== undefined && record.exceptionNote !== "") {
    exceptionNote = normalizedText(record.exceptionNote, 1, 2000);
    if (!exceptionNote) return { ok: false, error: "invalid_exception_note" };
  }
  if (record.status === "exception" && !exceptionNote) return { ok: false, error: "exception_note_required" };
  return { ok: true, value: { proposedPackage, proposedValueCents, status: record.status as TransitionSponsorStatus, exceptionNote } };
}

export function parseCampaignStatusInput(body: unknown): Result<{ status: TransitionCampaignStatus }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const status = (body as Record<string, unknown>).status;
  if (typeof status !== "string" || !transitionCampaignStatuses.includes(status as TransitionCampaignStatus)) {
    return { ok: false, error: "invalid_campaign_status" };
  }
  return { ok: true, value: { status: status as TransitionCampaignStatus } };
}
