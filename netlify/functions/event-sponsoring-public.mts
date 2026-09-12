import { randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { json } from "./_shared/auth.ts";
import { withSession, type DatabaseClient } from "./_shared/database.ts";
import { parseEventBooking } from "./_shared/event-sponsoring-input.ts";
import { getOrganizationProfile, mapOrganizationProfile } from "./_shared/organization-profile.ts";

type PublicSettingsRow = {
  tenant_id: string;
  headline: string;
  season_label: string | null;
  introduction: string;
  terms_text: string;
};

type PublicEventRow = {
  id: string;
  team_name: string;
  opponent: string;
  competition: string | null;
  venue: string | null;
  starts_at: string;
  time_tbd: boolean;
  price_cents: number;
  fn_supplement_cents: number;
  available: boolean;
};

const routes = {
  page: /^\/api\/event-sponsoring-public\/([0-9a-f]{36})$/i,
  book: /^\/api\/event-sponsoring-public\/([0-9a-f]{36})\/book$/i,
  logo: /^\/api\/event-sponsoring-public\/([0-9a-f]{36})\/logo$/i,
};

function verifyMutation(request: Request): Response | null {
  try {
    verifyRequestOrigin(request);
    return null;
  } catch (error) {
    return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403);
  }
}

async function loadSettings(client: DatabaseClient, publicKey: string) {
  await client.query("SELECT set_config('app.event_sponsoring_public_key', $1, true)", [publicKey]);
  const settings = await client.query<PublicSettingsRow>(`
    SELECT tenant_id, headline, season_label, introduction, terms_text
    FROM tenant_event_sponsoring_settings
    WHERE public_key = $1 AND is_published
    LIMIT 1
  `, [publicKey]);
  const row = settings.rows[0];
  if (!row) return null;
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [row.tenant_id]);
  return row;
}

async function publicData(client: DatabaseClient, publicKey: string) {
  const settings = await loadSettings(client, publicKey);
  if (!settings) return null;
  const tenant = await client.query<{ name: string }>("SELECT name FROM tenants WHERE id = $1 LIMIT 1", [settings.tenant_id]);
  const organization = mapOrganizationProfile(await getOrganizationProfile(client, settings.tenant_id));
  if (!tenant.rows[0]) return null;
  const events = await client.query<PublicEventRow>(`
    SELECT event.id, event.team_name, event.opponent, event.competition, event.venue,
           event.starts_at::text, event.time_tbd, event.price_cents, event.fn_supplement_cents,
           NOT EXISTS (
             SELECT 1 FROM event_sponsorship_bookings booking
             WHERE booking.tenant_id = event.tenant_id AND booking.event_id = event.id
               AND booking.status = 'submitted'
           ) AS available
    FROM sponsorship_events event
    WHERE event.tenant_id = $1 AND event.status = 'published'
      AND event.starts_at >= now() - interval '12 hours'
    ORDER BY event.starts_at, lower(event.team_name), lower(event.opponent)
  `, [settings.tenant_id]);
  return {
    tenantId: settings.tenant_id,
    organization: {
      name: tenant.rows[0].name,
      contactName: organization?.contactName ?? null,
      contactEmail: organization?.contactEmail ?? null,
      contactPhone: organization?.contactPhone ?? null,
      website: organization?.website ?? null,
      brandPrimaryColor: organization?.brandPrimaryColor ?? "#0B2144",
      brandAccentColor: organization?.brandAccentColor ?? "#1967FF",
      logoAvailable: organization?.logoAvailable ?? false,
    },
    settings: {
      headline: settings.headline,
      seasonLabel: settings.season_label,
      introduction: settings.introduction,
      termsText: settings.terms_text,
    },
    events: events.rows.map((event) => ({
      id: event.id,
      teamName: event.team_name,
      opponent: event.opponent,
      competition: event.competition,
      venue: event.venue,
      startsAt: event.starts_at,
      timeTbd: event.time_tbd,
      priceCents: event.price_cents,
      fnSupplementCents: event.fn_supplement_cents,
      available: event.available,
    })),
  };
}

function databaseCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
}

export default async (request: Request, context: Context) => {
  const pathname = new URL(request.url).pathname;
  const bookMatch = pathname.match(routes.book);
  const logoMatch = pathname.match(routes.logo);
  const pageMatch = pathname.match(routes.page);
  const match = bookMatch ?? logoMatch ?? pageMatch;
  const publicKey = match?.[1]?.toLowerCase();
  if (!publicKey) return json({ error: "event_sponsoring_link_invalid" }, 404);

  if ((pageMatch || logoMatch) && request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (bookMatch && request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (logoMatch) {
    try {
      const result = await withSession(`event-public:${publicKey}`, null, async (client) => {
        const settings = await loadSettings(client, publicKey);
        if (!settings) return { state: "not_found" as const };
        const profile = await getOrganizationProfile(client, settings.tenant_id);
        if (!profile?.logo_blob_key || !profile.logo_content_type) return { state: "not_found" as const };
        return { state: "ready" as const, key: profile.logo_blob_key, contentType: profile.logo_content_type };
      });
      if (result.state === "not_found") return json({ error: "logo_not_found" }, 404);
      const buffer = await getStore({ name: "tenant-brand-assets", consistency: "strong" })
        .get(result.key, { type: "arrayBuffer" }) as ArrayBuffer | null;
      if (!buffer) return json({ error: "logo_not_found" }, 404);
      return new Response(buffer, { headers: {
        "Cache-Control": "public, max-age=300",
        "Content-Type": result.contentType,
        "X-Content-Type-Options": "nosniff",
      } });
    } catch (error) {
      console.error("event_sponsoring_public_logo_failed", { requestId: context.requestId, error });
      return json({ error: "event_sponsoring_public_logo_failed", requestId: context.requestId }, 500);
    }
  }

  if (pageMatch) {
    try {
      const data = await withSession(`event-public:${publicKey}`, null, (client) => publicData(client, publicKey));
      return data ? json({ eventSponsoring: data }) : json({ error: "event_sponsoring_link_invalid" }, 404);
    } catch (error) {
      console.error("event_sponsoring_public_load_failed", { requestId: context.requestId, error });
      return json({ error: "event_sponsoring_public_load_failed", requestId: context.requestId }, 500);
    }
  }

  const invalidOrigin = verifyMutation(request);
  if (invalidOrigin) return invalidOrigin;
  const parsed = parseEventBooking(await request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, 422);
  try {
    const result = await withSession(`event-public:${publicKey}`, null, async (client) => {
      const settings = await loadSettings(client, publicKey);
      if (!settings) return { state: "not_found" as const };
      const event = await client.query<{
        id: string; price_cents: number; fn_supplement_cents: number;
      }>(`SELECT id, price_cents, fn_supplement_cents FROM sponsorship_events
        WHERE tenant_id = $1 AND id = $2 AND status = 'published'
          AND starts_at >= now() - interval '12 hours'
        LIMIT 1 FOR UPDATE`, [settings.tenant_id, parsed.value.eventId]);
      if (!event.rows[0]) return { state: "event_not_found" as const };
      const occupied = await client.query<{ id: string }>(`SELECT id FROM event_sponsorship_bookings
        WHERE tenant_id = $1 AND event_id = $2 AND status = 'submitted' LIMIT 1`, [settings.tenant_id, parsed.value.eventId]);
      if (occupied.rows[0]) return { state: "occupied" as const };
      const value = parsed.value;
      const amountCents = event.rows[0].price_cents + (value.includeFnMention ? event.rows[0].fn_supplement_cents : 0);
      const year = new Date().getUTCFullYear();
      const reference = `MB-${year}-${randomBytes(4).toString("hex").toUpperCase()}`;
      const booking = await client.query<{ id: string; submitted_at: string }>(`INSERT INTO event_sponsorship_bookings
        (tenant_id, event_id, reference, sponsor_name, address, postal_code, city, contact_name,
         contact_email, contact_phone, referred_by_member, include_fn_mention, payment_mode,
         amount_cents, source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'public_form')
        RETURNING id, submitted_at::text`,
      [settings.tenant_id, value.eventId, reference, value.sponsorName, value.address, value.postalCode,
        value.city, value.contactName, value.contactEmail, value.contactPhone, value.referredByMember,
        value.includeFnMention, value.paymentMode, amountCents]);
      await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
        VALUES ($1,$2,'event_sponsoring.public_booking_created','event_sponsorship_booking',$3::text,
        jsonb_build_object('event_id',$4::text,'reference',$5::text,'amount_cents',$6::integer,'source','public_form'))`,
      [settings.tenant_id, `event-public:${booking.rows[0].id}`, booking.rows[0].id, value.eventId, reference, amountCents]);
      return { state: "booked" as const, reference, amountCents, submittedAt: booking.rows[0].submitted_at };
    });
    if (result.state === "not_found") return json({ error: "event_sponsoring_link_invalid" }, 404);
    if (result.state === "event_not_found") return json({ error: "event_not_found" }, 404);
    if (result.state === "occupied") return json({ error: "event_already_booked" }, 409);
    return json({ booking: { reference: result.reference, amountCents: result.amountCents, submittedAt: result.submittedAt } }, 201);
  } catch (error) {
    if (databaseCode(error) === "23505") return json({ error: "event_already_booked" }, 409);
    console.error("event_sponsoring_public_booking_failed", { requestId: context.requestId, error });
    return json({ error: "event_sponsoring_public_booking_failed", requestId: context.requestId }, 500);
  }
};

export const config: Config = {
  path: [
    "/api/event-sponsoring-public/:publicKey",
    "/api/event-sponsoring-public/:publicKey/book",
    "/api/event-sponsoring-public/:publicKey/logo",
  ],
};
