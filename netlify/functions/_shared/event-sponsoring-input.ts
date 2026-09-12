const eventStatuses = ["draft", "published", "cancelled"] as const;
const paymentModes = ["invoice", "cash"] as const;

export type EventStatus = typeof eventStatuses[number];
export type PaymentMode = typeof paymentModes[number];

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length >= 1 && normalized.length <= maximum ? normalized : null;
}

function optionalText(value: unknown, maximum: number) {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value, maximum);
}

function cents(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100_000_000 ? Number(value) : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function email(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

export function parseEventSponsoringSettings(input: unknown) {
  const record = recordOf(input);
  if (!record) return { ok: false as const, error: "invalid_event_settings" };
  const headline = requiredText(record.headline, 160);
  const seasonLabel = optionalText(record.seasonLabel, 80);
  const introduction = requiredText(record.introduction, 2000);
  const termsText = requiredText(record.termsText, 3000);
  if (!headline) return { ok: false as const, error: "invalid_event_headline" };
  if (!introduction) return { ok: false as const, error: "invalid_event_introduction" };
  if (!termsText) return { ok: false as const, error: "invalid_event_terms" };
  if (typeof record.isPublished !== "boolean") return { ok: false as const, error: "invalid_event_publication" };
  return { ok: true as const, value: { headline, seasonLabel, introduction, termsText, isPublished: record.isPublished } };
}

export function parseSponsorshipEvent(input: unknown) {
  const record = recordOf(input);
  if (!record) return { ok: false as const, error: "invalid_sponsorship_event" };
  const teamName = requiredText(record.teamName, 160);
  const opponent = requiredText(record.opponent, 160);
  const competition = optionalText(record.competition, 160);
  const venue = optionalText(record.venue, 240);
  const timeTbd = record.timeTbd === true;
  const startsAt = typeof record.startsAt === "string" ? new Date(record.startsAt) : new Date(Number.NaN);
  const priceCents = cents(record.priceCents);
  const fnSupplementCents = cents(record.fnSupplementCents);
  const status = typeof record.status === "string" && eventStatuses.includes(record.status as EventStatus)
    ? record.status as EventStatus
    : null;
  if (!teamName) return { ok: false as const, error: "invalid_event_team" };
  if (!opponent) return { ok: false as const, error: "invalid_event_opponent" };
  if (Number.isNaN(startsAt.valueOf()) || startsAt.getUTCFullYear() < 2020 || startsAt.getUTCFullYear() > 2100) {
    return { ok: false as const, error: "invalid_event_date" };
  }
  if (priceCents === null) return { ok: false as const, error: "invalid_event_price" };
  if (fnSupplementCents === null) return { ok: false as const, error: "invalid_event_fn_supplement" };
  if (!status) return { ok: false as const, error: "invalid_event_status" };
  return {
    ok: true as const,
    value: { teamName, opponent, competition, venue, startsAt: startsAt.toISOString(), timeTbd, priceCents, fnSupplementCents, status },
  };
}

export function parseEventBooking(input: unknown, now = Date.now()) {
  const record = recordOf(input);
  if (!record) return { ok: false as const, error: "invalid_event_booking" };
  if (typeof record.website === "string" && record.website.trim()) return { ok: false as const, error: "event_booking_rejected" };
  if (typeof record.startedAt !== "number" || !Number.isFinite(record.startedAt) || now - record.startedAt < 750 || now - record.startedAt > 86_400_000) {
    return { ok: false as const, error: "event_booking_rejected" };
  }
  if (!isUuid(record.eventId)) return { ok: false as const, error: "invalid_event" };
  const sponsorName = requiredText(record.sponsorName, 200);
  const address = requiredText(record.address, 240);
  const postalCode = requiredText(record.postalCode, 20);
  const city = requiredText(record.city, 160);
  const contactName = requiredText(record.contactName, 160);
  const contactEmail = email(record.contactEmail);
  const contactPhone = optionalText(record.contactPhone, 80);
  const referredByMember = optionalText(record.referredByMember, 160);
  const includeFnMention = record.includeFnMention === true;
  const paymentMode = typeof record.paymentMode === "string" && paymentModes.includes(record.paymentMode as PaymentMode)
    ? record.paymentMode as PaymentMode
    : null;
  if (!sponsorName) return { ok: false as const, error: "invalid_booking_sponsor" };
  if (!address || !postalCode || !city) return { ok: false as const, error: "invalid_booking_address" };
  if (!contactName) return { ok: false as const, error: "invalid_booking_contact" };
  if (!contactEmail) return { ok: false as const, error: "invalid_booking_email" };
  if (!paymentMode) return { ok: false as const, error: "invalid_booking_payment" };
  if (record.termsAccepted !== true) return { ok: false as const, error: "event_booking_terms_required" };
  return {
    ok: true as const,
    value: {
      eventId: record.eventId,
      sponsorName,
      address,
      postalCode,
      city,
      contactName,
      contactEmail,
      contactPhone,
      referredByMember,
      includeFnMention,
      paymentMode,
    },
  };
}

export function parseBookingCancellation(input: unknown) {
  const record = recordOf(input);
  return record?.cancelled === true
    ? { ok: true as const, value: { cancelled: true as const } }
    : { ok: false as const, error: "invalid_booking_cancellation" };
}
