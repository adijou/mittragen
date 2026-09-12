import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { hasPermission, isResponse, json, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { isUuid, withSession, type DatabaseClient } from "./_shared/database.ts";
import { parseBookingCancellation, parseEventSponsoringSettings, parseSponsorshipEvent } from "./_shared/event-sponsoring-input.ts";
import { createEventFlyerPdf, type EventFlyerPdfData } from "./_shared/event-flyer-pdf.ts";
import { loadOrganizationPdfBrand } from "./_shared/organization-pdf-brand.ts";
import { getOrganizationProfile, mapOrganizationProfile } from "./_shared/organization-profile.ts";

type SettingsRow = {
  public_key: string;
  headline: string;
  season_label: string | null;
  introduction: string;
  terms_text: string;
  is_published: boolean;
  updated_at: string;
};

type EventRow = {
  id: string;
  team_name: string;
  opponent: string;
  competition: string | null;
  venue: string | null;
  starts_at: string;
  time_tbd: boolean;
  price_cents: number;
  fn_supplement_cents: number;
  status: "draft" | "published" | "cancelled";
  created_at: string;
  booking_id: string | null;
  booking_reference: string | null;
  booking_sponsor_name: string | null;
  booking_address: string | null;
  booking_postal_code: string | null;
  booking_city: string | null;
  booking_contact_name: string | null;
  booking_contact_email: string | null;
  booking_contact_phone: string | null;
  booking_referred_by_member: string | null;
  booking_include_fn_mention: boolean | null;
  booking_payment_mode: "invoice" | "cash" | null;
  booking_amount_cents: number | null;
  booking_submitted_at: string | null;
};

const routes = {
  collection: /^\/api\/event-sponsoring\/([0-9a-f-]+)$/i,
  settings: /^\/api\/event-sponsoring\/([0-9a-f-]+)\/settings$/i,
  events: /^\/api\/event-sponsoring\/([0-9a-f-]+)\/events$/i,
  event: /^\/api\/event-sponsoring\/([0-9a-f-]+)\/events\/([0-9a-f-]+)$/i,
  flyer: /^\/api\/event-sponsoring\/([0-9a-f-]+)\/events\/([0-9a-f-]+)\/flyer$/i,
  booking: /^\/api\/event-sponsoring\/([0-9a-f-]+)\/events\/([0-9a-f-]+)\/booking$/i,
};

async function membershipRole(client: DatabaseClient, tenantId: string, userId: string) {
  const result = await client.query<{ role: MembershipRole }>(`
    SELECT role FROM tenant_memberships WHERE tenant_id = $1 AND identity_user_id = $2 LIMIT 1
  `, [tenantId, userId]);
  return result.rows[0]?.role ?? null;
}

function verifyMutation(request: Request): Response | null {
  try {
    verifyRequestOrigin(request);
    return null;
  } catch (error) {
    return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403);
  }
}

function publicUrl(request: Request, key: string) {
  const base = Netlify.env.get("URL")?.trim() || new URL(request.url).origin;
  return new URL(`/matchball/${key}`, base).toString();
}

async function getSettings(client: DatabaseClient, tenantId: string) {
  const result = await client.query<SettingsRow>(`
    SELECT public_key, headline, season_label, introduction, terms_text, is_published, updated_at::text
    FROM tenant_event_sponsoring_settings WHERE tenant_id = $1 LIMIT 1
  `, [tenantId]);
  return result.rows[0] ?? null;
}

async function listEvents(client: DatabaseClient, tenantId: string) {
  const result = await client.query<EventRow>(`
    SELECT event.id, event.team_name, event.opponent, event.competition, event.venue,
           event.starts_at::text, event.time_tbd, event.price_cents, event.fn_supplement_cents, event.status,
           event.created_at::text,
           booking.id AS booking_id, booking.reference AS booking_reference,
           booking.sponsor_name AS booking_sponsor_name, booking.address AS booking_address,
           booking.postal_code AS booking_postal_code, booking.city AS booking_city,
           booking.contact_name AS booking_contact_name, booking.contact_email AS booking_contact_email,
           booking.contact_phone AS booking_contact_phone,
           booking.referred_by_member AS booking_referred_by_member,
           booking.include_fn_mention AS booking_include_fn_mention,
           booking.payment_mode AS booking_payment_mode, booking.amount_cents AS booking_amount_cents,
           booking.submitted_at::text AS booking_submitted_at
    FROM sponsorship_events event
    LEFT JOIN LATERAL (
      SELECT * FROM event_sponsorship_bookings
      WHERE tenant_id = event.tenant_id AND event_id = event.id AND status = 'submitted'
      ORDER BY submitted_at DESC LIMIT 1
    ) booking ON true
    WHERE event.tenant_id = $1
    ORDER BY event.starts_at, lower(event.team_name), lower(event.opponent)
  `, [tenantId]);
  return result.rows;
}

function mapSettings(row: SettingsRow, request: Request) {
  return {
    publicKey: row.public_key,
    publicUrl: publicUrl(request, row.public_key),
    headline: row.headline,
    seasonLabel: row.season_label,
    introduction: row.introduction,
    termsText: row.terms_text,
    isPublished: row.is_published,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: EventRow) {
  return {
    id: row.id,
    teamName: row.team_name,
    opponent: row.opponent,
    competition: row.competition,
    venue: row.venue,
    startsAt: row.starts_at,
    timeTbd: row.time_tbd,
    priceCents: row.price_cents,
    fnSupplementCents: row.fn_supplement_cents,
    status: row.status,
    createdAt: row.created_at,
    booking: row.booking_id ? {
      id: row.booking_id,
      reference: row.booking_reference,
      sponsorName: row.booking_sponsor_name,
      address: row.booking_address,
      postalCode: row.booking_postal_code,
      city: row.booking_city,
      contactName: row.booking_contact_name,
      contactEmail: row.booking_contact_email,
      contactPhone: row.booking_contact_phone,
      referredByMember: row.booking_referred_by_member,
      includeFnMention: Boolean(row.booking_include_fn_mention),
      paymentMode: row.booking_payment_mode,
      amountCents: row.booking_amount_cents,
      submittedAt: row.booking_submitted_at,
    } : null,
  };
}

async function loadData(client: DatabaseClient, tenantId: string, request: Request) {
  const settings = await getSettings(client, tenantId);
  if (!settings) return null;
  const tenant = await client.query<{ name: string; slug: string }>("SELECT name, slug FROM tenants WHERE id = $1 LIMIT 1", [tenantId]);
  if (!tenant.rows[0]) return null;
  return {
    tenant: tenant.rows[0],
    settings: mapSettings(settings, request),
    events: (await listEvents(client, tenantId)).map(mapEvent),
  };
}

export default async (request: Request, context: Context) => {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const pathname = new URL(request.url).pathname;
  const bookingMatch = pathname.match(routes.booking);
  const flyerMatch = pathname.match(routes.flyer);
  const eventMatch = pathname.match(routes.event);
  const eventsMatch = pathname.match(routes.events);
  const settingsMatch = pathname.match(routes.settings);
  const collectionMatch = pathname.match(routes.collection);
  const match = bookingMatch ?? flyerMatch ?? eventMatch ?? eventsMatch ?? settingsMatch ?? collectionMatch;
  const tenantId = match?.[1];
  const eventId = match?.[2];
  if (!tenantId || !isUuid(tenantId)) return json({ error: "invalid_tenant" }, 422);
  if (eventId && !isUuid(eventId)) return json({ error: "invalid_event" }, 422);

  if (collectionMatch && request.method === "GET") {
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "sponsors:read")) return { state: "denied" as const };
        return { state: "ready" as const, data: await loadData(client, tenantId, request) };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (!result.data) return json({ error: "event_sponsoring_not_found" }, 404);
      return json({ eventSponsoring: result.data });
    } catch (error) {
      console.error("event_sponsoring_load_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "event_sponsoring_load_failed", requestId: context.requestId }, 500);
    }
  }

  if (flyerMatch && request.method === "GET") {
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "sponsors:read")) return { state: "denied" as const };
        const settings = await getSettings(client, tenantId);
        const events = await listEvents(client, tenantId);
        const event = events.find((item) => item.id === eventId);
        const tenant = await client.query<{ name: string }>("SELECT name FROM tenants WHERE id = $1 LIMIT 1", [tenantId]);
        const organization = mapOrganizationProfile(await getOrganizationProfile(client, tenantId));
        if (!settings || !event || !tenant.rows[0]) return { state: "not_found" as const };
        const brand = await loadOrganizationPdfBrand(client, tenantId, context.requestId);
        const data: EventFlyerPdfData = {
          generatedAt: new Date().toISOString(),
          brand,
          organization: {
            name: tenant.rows[0].name,
            contactName: organization?.contactName ?? null,
            contactEmail: organization?.contactEmail ?? null,
            contactPhone: organization?.contactPhone ?? null,
            website: organization?.website ?? null,
          },
          event: {
            teamName: event.team_name,
            opponent: event.opponent,
            competition: event.competition,
            venue: event.venue,
            startsAt: event.starts_at,
            timeTbd: event.time_tbd,
            priceCents: event.price_cents,
          },
          booking: event.booking_id ? {
            sponsorName: event.booking_sponsor_name ?? "Matchballsponsor",
            includeFnMention: Boolean(event.booking_include_fn_mention),
            amountCents: event.booking_amount_cents ?? event.price_cents,
          } : null,
          publicUrl: publicUrl(request, settings.public_key),
          termsText: settings.terms_text,
        };
        return { state: "ready" as const, bytes: await createEventFlyerPdf(data) };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "event_not_found" }, 404);
      return new Response(Uint8Array.from(result.bytes).buffer, { headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="matchblatt-${eventId}.pdf"`,
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      } });
    } catch (error) {
      console.error("event_flyer_failed", { requestId: context.requestId, tenantId, eventId, error });
      return json({ error: "event_flyer_failed", requestId: context.requestId }, 500);
    }
  }

  if (!["POST", "PATCH"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  const invalidOrigin = verifyMutation(request);
  if (invalidOrigin) return invalidOrigin;
  const body = await request.json().catch(() => null);

  if (settingsMatch && request.method === "PATCH") {
    const parsed = parseEventSponsoringSettings(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "tenant:manage")) return { state: "denied" as const };
        const value = parsed.value;
        await client.query(`UPDATE tenant_event_sponsoring_settings SET headline = $2, season_label = $3,
          introduction = $4, terms_text = $5, is_published = $6, updated_by = $7, updated_at = now()
          WHERE tenant_id = $1`, [tenantId, value.headline, value.seasonLabel, value.introduction, value.termsText, value.isPublished, user.id]);
        await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1,$2,'event_sponsoring.settings_updated','tenant_event_sponsoring_settings',$1::text,
          jsonb_build_object('is_published',$3::boolean))`, [tenantId, user.id, value.isPublished]);
        return { state: "saved" as const, data: await loadData(client, tenantId, request) };
      }, user.email ?? undefined);
      return result.state === "denied" ? json({ error: "permission_denied" }, 403) : json({ eventSponsoring: result.data });
    } catch (error) {
      console.error("event_sponsoring_settings_save_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "event_sponsoring_settings_save_failed", requestId: context.requestId }, 500);
    }
  }

  if (eventsMatch && request.method === "POST") {
    const parsed = parseSponsorshipEvent(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "sponsors:write")) return { state: "denied" as const };
        const value = parsed.value;
        const created = await client.query<{ id: string }>(`INSERT INTO sponsorship_events
          (tenant_id, team_name, opponent, competition, venue, starts_at, time_tbd, price_cents, fn_supplement_cents, status, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [tenantId, value.teamName, value.opponent, value.competition, value.venue, value.startsAt,
          value.timeTbd, value.priceCents, value.fnSupplementCents, value.status, user.id]);
        await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1,$2,'event_sponsoring.event_created','sponsorship_event',$3::text,
          jsonb_build_object('opponent',$4::text,'starts_at',$5::text,'status',$6::text))`,
        [tenantId, user.id, created.rows[0].id, value.opponent, value.startsAt, value.status]);
        return { state: "created" as const, data: await loadData(client, tenantId, request) };
      }, user.email ?? undefined);
      return result.state === "denied" ? json({ error: "permission_denied" }, 403) : json({ eventSponsoring: result.data }, 201);
    } catch (error) {
      console.error("event_sponsoring_event_create_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "event_sponsoring_event_create_failed", requestId: context.requestId }, 500);
    }
  }

  if (eventMatch && request.method === "PATCH") {
    const parsed = parseSponsorshipEvent(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "sponsors:write")) return { state: "denied" as const };
        const value = parsed.value;
        const updated = await client.query<{ id: string }>(`UPDATE sponsorship_events SET team_name = $3,
          opponent = $4, competition = $5, venue = $6, starts_at = $7, time_tbd = $8, price_cents = $9,
          fn_supplement_cents = $10, status = $11, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, eventId, value.teamName, value.opponent, value.competition, value.venue,
          value.startsAt, value.timeTbd, value.priceCents, value.fnSupplementCents, value.status]);
        if (!updated.rows[0]) return { state: "not_found" as const };
        await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1,$2,'event_sponsoring.event_updated','sponsorship_event',$3::text,
          jsonb_build_object('status',$4::text))`, [tenantId, user.id, eventId, value.status]);
        return { state: "saved" as const, data: await loadData(client, tenantId, request) };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "event_not_found" }, 404);
      return json({ eventSponsoring: result.data });
    } catch (error) {
      console.error("event_sponsoring_event_update_failed", { requestId: context.requestId, tenantId, eventId, error });
      return json({ error: "event_sponsoring_event_update_failed", requestId: context.requestId }, 500);
    }
  }

  if (bookingMatch && request.method === "POST") {
    const parsed = parseBookingCancellation(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "sponsors:write")) return { state: "denied" as const };
        const updated = await client.query<{ id: string }>(`UPDATE event_sponsorship_bookings
          SET status = 'cancelled', cancelled_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND event_id = $2 AND status = 'submitted' RETURNING id`, [tenantId, eventId]);
        if (!updated.rows[0]) return { state: "not_found" as const };
        await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1,$2,'event_sponsoring.booking_cancelled','event_sponsorship_booking',$3::text,
          jsonb_build_object('event_id',$4::text))`, [tenantId, user.id, updated.rows[0].id, eventId]);
        return { state: "saved" as const, data: await loadData(client, tenantId, request) };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "event_booking_not_found" }, 404);
      return json({ eventSponsoring: result.data });
    } catch (error) {
      console.error("event_sponsoring_booking_cancel_failed", { requestId: context.requestId, tenantId, eventId, error });
      return json({ error: "event_sponsoring_booking_cancel_failed", requestId: context.requestId }, 500);
    }
  }

  return json({ error: "method_not_allowed" }, 405);
};

export const config: Config = {
  path: [
    "/api/event-sponsoring/:tenantId",
    "/api/event-sponsoring/:tenantId/settings",
    "/api/event-sponsoring/:tenantId/events",
    "/api/event-sponsoring/:tenantId/events/:eventId",
    "/api/event-sponsoring/:tenantId/events/:eventId/flyer",
    "/api/event-sponsoring/:tenantId/events/:eventId/booking",
  ],
};
