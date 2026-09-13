import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { json } from "./_shared/auth.ts";
import { absoluteSiteUrl, contractEmailConfig } from "./_shared/contract-delivery.ts";
import { contractSnapshotHash } from "./_shared/contract-hash.ts";
import { ensureDirectReservation, nextContractNumber } from "./_shared/contract-reservations.ts";
import type { ContractPdfData } from "./_shared/contract-pdf.ts";
import { withSession, type DatabaseClient } from "./_shared/database.ts";
import { findIdentityUserByEmail } from "./_shared/identity-user-lookup.ts";
import { getOrganizationProfile, mapOrganizationProfile } from "./_shared/organization-profile.ts";
import { sendContractSigningEmail } from "./_shared/resend-contract-email.ts";
import { parseSponsoringCheckout } from "./_shared/sponsoring-checkout-input.ts";

type CheckoutPackageRow = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  duration_months: number;
  payment_plan: string;
  payment_terms: string | null;
  capacity: number | null;
  reserved_quantity: string;
  approved_by: string;
  approved_at: string;
  contract_start: string;
  contract_end: string;
};

type CheckoutRightRow = {
  package_version_id: string;
  name: string;
  description: string | null;
  quantity: number;
  schedule_text: string | null;
  channel: string | null;
  location: string | null;
};

const routes = {
  page: /^\/api\/sponsoring-checkout\/([0-9a-f]{36})$/i,
  submit: /^\/api\/sponsoring-checkout\/([0-9a-f]{36})\/submit$/i,
  logo: /^\/api\/sponsoring-checkout\/([0-9a-f]{36})\/logo$/i,
};

function verifyMutation(request: Request): Response | null {
  try {
    verifyRequestOrigin(request);
    return null;
  } catch (error) {
    return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403);
  }
}

async function loadPublicSettings(client: DatabaseClient, publicKey: string) {
  await client.query("SELECT set_config('app.sponsoring_checkout_public_key', $1, true)", [publicKey]);
  const result = await client.query<{ tenant_id: string }>(`
    SELECT tenant_id FROM tenant_sponsoring_checkout_settings
    WHERE public_key = $1 LIMIT 1
  `, [publicKey]);
  const settings = result.rows[0];
  if (!settings) return null;
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [settings.tenant_id]);
  return settings;
}

async function checkoutPackages(client: DatabaseClient, tenantId: string) {
  const packages = await client.query<CheckoutPackageRow>(`
    SELECT version.id, version.name, version.description, version.price_cents,
           version.duration_months, version.payment_plan, version.payment_terms, version.capacity,
           online.approved_by, online.approved_at::text,
           (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Zurich')::date::text AS contract_start,
           (((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Zurich')::date
             + make_interval(months => version.duration_months)) - interval '1 day')::date::text AS contract_end,
           COALESCE((SELECT sum(reservation.quantity)::text
             FROM sponsorship_package_reservations reservation
             WHERE reservation.tenant_id = version.tenant_id
               AND reservation.package_version_id = version.id
               AND reservation.status IN ('held', 'confirmed')
               AND (reservation.status = 'confirmed' OR reservation.expires_at IS NULL OR reservation.expires_at > now())), '0') AS reserved_quantity
    FROM sponsorship_package_versions version
    JOIN sponsorship_packages package
      ON package.id = version.package_id AND package.tenant_id = version.tenant_id
    JOIN sponsorship_package_online_settings online
      ON online.tenant_id = version.tenant_id AND online.package_version_id = version.id AND online.is_enabled
    WHERE version.tenant_id = $1 AND version.status = 'published' AND version.visibility = 'public'
      AND package.status = 'active'
      AND (version.valid_from IS NULL OR version.valid_from <= CURRENT_DATE)
      AND (version.valid_until IS NULL OR version.valid_until >= CURRENT_DATE)
    ORDER BY version.price_cents, lower(version.name), version.version_number DESC
  `, [tenantId]);
  const rights = packages.rows.length ? await client.query<CheckoutRightRow>(`
    SELECT package_version_id, name, description, quantity, schedule_text, channel, location
    FROM sponsorship_rights
    WHERE tenant_id = $1 AND package_version_id = ANY($2::uuid[])
    ORDER BY package_version_id, created_at, id
  `, [tenantId, packages.rows.map((item) => item.id)]) : { rows: [] as CheckoutRightRow[] };
  return packages.rows.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    priceCents: item.price_cents,
    durationMonths: item.duration_months,
    paymentPlan: item.payment_plan,
    paymentTerms: item.payment_terms,
    contractStart: item.contract_start,
    contractEnd: item.contract_end,
    availableQuantity: item.capacity === null ? null : Math.max(0, item.capacity - Number(item.reserved_quantity)),
    rights: rights.rows.filter((right) => right.package_version_id === item.id).map((right) => ({
      name: right.name,
      description: right.description,
      quantity: right.quantity,
      scheduleText: right.schedule_text,
      channel: right.channel,
      location: right.location,
    })),
  }));
}

async function publicData(client: DatabaseClient, publicKey: string) {
  const settings = await loadPublicSettings(client, publicKey);
  if (!settings) return null;
  const organizationRow = await getOrganizationProfile(client, settings.tenant_id);
  const organization = mapOrganizationProfile(organizationRow);
  if (!organizationRow || !organization) return null;
  const profile = await client.query<{
    headline: string | null; season_label: string | null; introduction: string | null;
    club_portrait: string | null; sponsorship_impact: string | null; audience: string | null;
  }>(`SELECT headline, season_label, introduction, club_portrait, sponsorship_impact, audience
      FROM tenant_sponsoring_profiles WHERE tenant_id = $1 LIMIT 1`, [settings.tenant_id]);
  return {
    organization: {
      name: organization.displayName,
      contactName: organization.contactName,
      contactEmail: organization.contactEmail,
      contactPhone: organization.contactPhone,
      website: organization.website,
      legalName: organization.legalName,
      street: organization.street,
      postalCode: organization.postalCode,
      city: organization.city,
      representativeName: organization.representativeName,
      representativeTitle: organization.representativeTitle,
      brandPrimaryColor: organization.brandPrimaryColor,
      brandAccentColor: organization.brandAccentColor,
      logoAvailable: organization.logoAvailable,
    },
    profile: {
      headline: profile.rows[0]?.headline ?? `Sponsoring bei ${organization.displayName}`,
      seasonLabel: profile.rows[0]?.season_label ?? null,
      introduction: profile.rows[0]?.introduction ?? "Entdecken Sie unsere Sponsoringmöglichkeiten und werden Sie Teil unserer Gemeinschaft.",
      clubPortrait: profile.rows[0]?.club_portrait ?? null,
      sponsorshipImpact: profile.rows[0]?.sponsorship_impact ?? null,
      audience: profile.rows[0]?.audience ?? null,
    },
    contractReady: organization.contractComplete,
    terms: {
      renewalMode: organization.renewalMode,
      noticeMonths: organization.noticeMonths,
      placeOfJurisdiction: organization.placeOfJurisdiction,
    },
    packages: organization.contractComplete ? await checkoutPackages(client, settings.tenant_id) : [],
  };
}

function organizationSnapshot(row: NonNullable<Awaited<ReturnType<typeof getOrganizationProfile>>>) {
  return {
    legalName: row.legal_name ?? "",
    street: row.street ?? "",
    postalCode: row.postal_code ?? "",
    city: row.city ?? "",
    country: row.country,
    representativeName: row.representative_name ?? "",
    representativeTitle: row.representative_title ?? "",
    contactEmail: row.contact_email ?? "",
  } satisfies ContractPdfData["organization"];
}

function packageSnapshot(item: CheckoutPackageRow, rights: CheckoutRightRow[]) {
  return {
    name: item.name,
    description: item.description,
    priceCents: item.price_cents,
    durationMonths: item.duration_months,
    paymentPlan: item.payment_plan,
    paymentTerms: item.payment_terms,
    validFrom: item.contract_start,
    validUntil: item.contract_end,
    rights: rights.map((right) => ({
      name: right.name,
      description: right.description,
      quantity: right.quantity,
      scheduleText: right.schedule_text,
      channel: right.channel,
      location: right.location,
    })),
  } satisfies ContractPdfData["package"];
}

export default async (request: Request, context: Context) => {
  const pathname = new URL(request.url).pathname;
  const submitMatch = pathname.match(routes.submit);
  const logoMatch = pathname.match(routes.logo);
  const pageMatch = pathname.match(routes.page);
  const publicKey = (submitMatch ?? logoMatch ?? pageMatch)?.[1]?.toLowerCase();
  if (!publicKey) return json({ error: "sponsoring_checkout_link_invalid" }, 404);
  if ((pageMatch || logoMatch) && request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (submitMatch && request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (logoMatch) {
    try {
      const result = await withSession(`checkout-public:${publicKey}`, null, async (client) => {
        const settings = await loadPublicSettings(client, publicKey);
        if (!settings) return null;
        const profile = await getOrganizationProfile(client, settings.tenant_id);
        return profile?.logo_blob_key && profile.logo_content_type
          ? { key: profile.logo_blob_key, contentType: profile.logo_content_type }
          : null;
      });
      if (!result) return json({ error: "logo_not_found" }, 404);
      const buffer = await getStore({ name: "tenant-brand-assets", consistency: "strong" }).get(result.key, { type: "arrayBuffer" }) as ArrayBuffer | null;
      if (!buffer) return json({ error: "logo_not_found" }, 404);
      return new Response(buffer, { headers: {
        "Cache-Control": "public, max-age=300",
        "Content-Type": result.contentType,
        "X-Content-Type-Options": "nosniff",
      } });
    } catch (error) {
      console.error("sponsoring_checkout_logo_failed", { requestId: context.requestId, error });
      return json({ error: "sponsoring_checkout_logo_failed", requestId: context.requestId }, 500);
    }
  }

  if (pageMatch) {
    try {
      const data = await withSession(`checkout-public:${publicKey}`, null, (client) => publicData(client, publicKey));
      return data ? json({ checkout: data }) : json({ error: "sponsoring_checkout_link_invalid" }, 404);
    } catch (error) {
      console.error("sponsoring_checkout_load_failed", { requestId: context.requestId, error });
      return json({ error: "sponsoring_checkout_load_failed", requestId: context.requestId }, 500);
    }
  }

  const invalidOrigin = verifyMutation(request);
  if (invalidOrigin) return invalidOrigin;
  const parsed = parseSponsoringCheckout(await request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, 422);

  let identityUser;
  try {
    identityUser = await findIdentityUserByEmail(parsed.value.signerEmail);
  } catch (error) {
    console.error("sponsoring_checkout_identity_lookup_failed", { requestId: context.requestId, error });
    return json({ error: "contract_identity_lookup_failed", requestId: context.requestId }, 503);
  }

  const deliveryMode = identityUser ? "account" as const : "one_time" as const;
  const rawToken = identityUser ? null : randomBytes(32).toString("base64url");
  const tokenHash = rawToken ? createHash("sha256").update(rawToken).digest("hex") : null;
  const actorId = `checkout-public:${publicKey}`;

  try {
    const result = await withSession(actorId, null, async (client) => {
      const settings = await loadPublicSettings(client, publicKey);
      if (!settings) return { state: "not_found" as const };
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`checkout:${settings.tenant_id}:${parsed.value.idempotencyKey}`]);
      const existingSubmission = await client.query<{
        reference: string; status: string; delivery_mode: "account" | "one_time"; contract_number: string;
      }>(`SELECT submission.reference, submission.status, submission.delivery_mode, contract.contract_number
          FROM sponsorship_checkout_submissions submission
          JOIN sponsorship_contracts contract ON contract.id = submission.contract_id AND contract.tenant_id = submission.tenant_id
          WHERE submission.tenant_id = $1 AND submission.idempotency_key = $2 LIMIT 1`,
      [settings.tenant_id, parsed.value.idempotencyKey]);
      if (existingSubmission.rows[0]) return { state: "existing" as const, submission: existingSubmission.rows[0] };
      const recentSubmissions = await client.query<{ email_count: string; tenant_count: string }>(`
        SELECT
          count(*) FILTER (WHERE lower(signer_email) = $2 AND created_at > now() - interval '1 hour')::text AS email_count,
          count(*) FILTER (WHERE created_at > now() - interval '1 hour')::text AS tenant_count
        FROM sponsorship_checkout_submissions WHERE tenant_id = $1
      `, [settings.tenant_id, parsed.value.signerEmail]);
      if (Number(recentSubmissions.rows[0]?.email_count ?? 0) >= 3 || Number(recentSubmissions.rows[0]?.tenant_count ?? 0) >= 50) {
        return { state: "rate_limited" as const };
      }

      const packages = await client.query<CheckoutPackageRow>(`
        SELECT version.id, version.name, version.description, version.price_cents,
               version.duration_months, version.payment_plan, version.payment_terms, version.capacity,
               online.approved_by, online.approved_at::text,
               (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Zurich')::date::text AS contract_start,
               (((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Zurich')::date
                 + make_interval(months => version.duration_months)) - interval '1 day')::date::text AS contract_end,
               COALESCE((SELECT sum(reservation.quantity)::text FROM sponsorship_package_reservations reservation
                 WHERE reservation.tenant_id = version.tenant_id AND reservation.package_version_id = version.id
                   AND reservation.status IN ('held', 'confirmed')
                   AND (reservation.status = 'confirmed' OR reservation.expires_at IS NULL OR reservation.expires_at > now())), '0') AS reserved_quantity
        FROM sponsorship_package_versions version
        JOIN sponsorship_packages package ON package.id = version.package_id AND package.tenant_id = version.tenant_id
        JOIN sponsorship_package_online_settings online
          ON online.tenant_id = version.tenant_id AND online.package_version_id = version.id AND online.is_enabled
        WHERE version.tenant_id = $1 AND version.id = $2
          AND version.status = 'published' AND version.visibility = 'public' AND package.status = 'active'
          AND (version.valid_from IS NULL OR version.valid_from <= CURRENT_DATE)
          AND (version.valid_until IS NULL OR version.valid_until >= CURRENT_DATE)
        LIMIT 1
      `, [settings.tenant_id, parsed.value.packageVersionId]);
      const selected = packages.rows[0];
      if (!selected) return { state: "package_not_available" as const };

      const organization = await getOrganizationProfile(client, settings.tenant_id);
      if (!organization || !mapOrganizationProfile(organization)?.contractComplete) return { state: "settings_incomplete" as const };
      const rights = await client.query<CheckoutRightRow>(`
        SELECT package_version_id, name, description, quantity, schedule_text, channel, location
        FROM sponsorship_rights WHERE tenant_id = $1 AND package_version_id = $2
        ORDER BY created_at, id
      `, [settings.tenant_id, selected.id]);

      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `sponsor:${settings.tenant_id}:${parsed.value.legalName.toLocaleLowerCase("de-CH")}:${parsed.value.contactEmail}`,
      ]);
      const matchedSponsor = await client.query<{ id: string; status: string }>(`
        SELECT id, status FROM sponsors
        WHERE tenant_id = $1 AND lower(legal_name) = lower($2) AND lower(contact_email) = $3
        ORDER BY created_at LIMIT 1
      `, [settings.tenant_id, parsed.value.legalName, parsed.value.contactEmail]);
      if (matchedSponsor.rows[0]?.status === "inactive") return { state: "sponsor_inactive" as const };
      let sponsorId = matchedSponsor.rows[0]?.id;
      if (!sponsorId) {
        const createdSponsor = await client.query<{ id: string }>(`
          INSERT INTO sponsors (
            tenant_id, legal_name, contact_name, contact_email, phone, street, postal_code, city,
            website, status, annual_value_cents, notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',0,'Über öffentlichen Direktabschluss erfasst.')
          RETURNING id
        `, [settings.tenant_id, parsed.value.legalName, parsed.value.contactName, parsed.value.contactEmail,
          parsed.value.contactPhone, parsed.value.street, parsed.value.postalCode, parsed.value.city, parsed.value.website]);
        sponsorId = createdSponsor.rows[0].id;
      }

      const existingContract = await client.query<{ id: string }>(`
        SELECT id FROM sponsorship_contracts
        WHERE tenant_id = $1 AND sponsor_id = $2 AND package_version_id = $3 AND status <> 'void'
        LIMIT 1 FOR UPDATE
      `, [settings.tenant_id, sponsorId, selected.id]);
      if (existingContract.rows[0]) return { state: "contract_exists" as const };
      const existingReservation = await client.query<{ status: "held" | "confirmed"; expired: boolean }>(`
        SELECT status, (expires_at IS NOT NULL AND expires_at <= now()) AS expired
        FROM sponsorship_package_reservations
        WHERE tenant_id = $1 AND sponsor_id = $2 AND package_version_id = $3
          AND status IN ('held', 'confirmed') LIMIT 1
      `, [settings.tenant_id, sponsorId, selected.id]);
      if (existingReservation.rows[0]?.status === "confirmed") return { state: "contract_exists" as const };
      if (!await ensureDirectReservation(client, settings.tenant_id, sponsorId, selected.id, actorId)) {
        return { state: "reservation_held" as const };
      }

      const contractNumber = await nextContractNumber(client, settings.tenant_id);
      const sponsorSnapshot = {
        legalName: parsed.value.legalName,
        street: parsed.value.street,
        postalCode: parsed.value.postalCode,
        city: parsed.value.city,
        contactName: parsed.value.contactName,
        contactEmail: parsed.value.contactEmail,
      } satisfies ContractPdfData["sponsor"];
      const selectedPackage = packageSnapshot(selected, rights.rows);
      const terms = {
        renewalMode: organization.renewal_mode,
        noticeMonths: organization.notice_months,
        placeOfJurisdiction: organization.place_of_jurisdiction,
      } satisfies ContractPdfData["terms"];
      const organizationData = organizationSnapshot(organization);
      const title = "Sponsoringvertrag";
      const specialAgreements = "Keine besonderen Vereinbarungen.";
      const hash = contractSnapshotHash({
        contractNumber, versionNumber: 1, title, specialAgreements,
        organization: organizationData, sponsor: sponsorSnapshot, package: selectedPackage,
        terms, signingMethod: "click",
      });
      const contractId = randomUUID();
      await client.query(`
        INSERT INTO sponsorship_contracts (
          id, tenant_id, contract_number, sponsor_id, package_version_id, title, special_agreements,
          organization_snapshot, sponsor_snapshot, package_snapshot, terms_snapshot,
          status, signing_method, snapshot_hash, released_at, released_by, created_by, source
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,
          'released','click',$12,now(),$13,$13,'public_checkout')
      `, [contractId, settings.tenant_id, contractNumber, sponsorId, selected.id, title, specialAgreements,
        JSON.stringify(organizationData), JSON.stringify(sponsorSnapshot), JSON.stringify(selectedPackage),
        JSON.stringify(terms), hash, actorId]);
      const reference = `SP-${new Date().getUTCFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;
      const signing = await client.query<{ id: string; expires_at: string }>(`
        INSERT INTO contract_signing_requests (
          tenant_id, contract_id, sponsor_id, signer_email, signer_name, signer_role,
          delivery_mode, identity_user_id, token_hash, status, expires_at, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',now() + interval '7 days',$10)
        RETURNING id, expires_at::text
      `, [settings.tenant_id, contractId, sponsorId, parsed.value.signerEmail, parsed.value.signerName,
        parsed.value.signerRole, deliveryMode, identityUser?.id ?? null, tokenHash, actorId]);
      if (identityUser) {
        await client.query(`INSERT INTO sponsor_portal_access (tenant_id, sponsor_id, identity_user_id, email)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (tenant_id, sponsor_id, identity_user_id) DO UPDATE SET email = EXCLUDED.email`,
        [settings.tenant_id, sponsorId, identityUser.id, parsed.value.signerEmail]);
        await client.query(`UPDATE contract_signing_requests SET access_status = 'existing_user',
          access_invited_at = now(), access_accepted_at = now(), updated_at = now()
          WHERE id = $1`, [signing.rows[0].id]);
      }
      await client.query(`INSERT INTO sponsorship_checkout_submissions (
        tenant_id, idempotency_key, reference, sponsor_id, package_version_id, contract_id,
        signer_email, signer_name, signer_role, delivery_mode
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [settings.tenant_id, parsed.value.idempotencyKey, reference, sponsorId, selected.id, contractId,
        parsed.value.signerEmail, parsed.value.signerName, parsed.value.signerRole, deliveryMode]);
      await client.query(`INSERT INTO sponsorship_contract_events
        (tenant_id, contract_id, event_type, actor_user_id, actor_email, evidence)
        VALUES
          ($1,$2,'created',$3,$4,jsonb_build_object('source','public_checkout','reference',$5::text,'annual_value_cents',$6::integer)),
          ($1,$2,'released',$3,$4,jsonb_build_object('snapshot_hash',$7::text,'online_direct_package_approved_by',$8::text,'online_direct_package_approved_at',$9::text,'contract_terms_accepted',true,'authority_confirmed',true,'user_agent',$10::text))`,
      [settings.tenant_id, contractId, actorId, parsed.value.signerEmail, reference, selected.price_cents,
        hash, selected.approved_by, selected.approved_at, (request.headers.get("user-agent") ?? "unknown").slice(0, 500)]);
      await client.query(`INSERT INTO audit_events
        (tenant_id, actor_user_id, action, object_type, object_id, metadata)
        VALUES ($1,$2,'contract.public_checkout_created','sponsorship_contract',$3,
          jsonb_build_object('reference',$4::text,'sponsor_id',$5::text,'package_version_id',$6::text,'snapshot_hash',$7::text))`,
      [settings.tenant_id, actorId, contractId, reference, sponsorId, selected.id, hash]);
      return {
        state: "created" as const,
        tenantId: settings.tenant_id,
        tenantName: organization.display_name,
        contractId,
        contractNumber,
        sponsorId,
        sponsorName: parsed.value.legalName,
        packageName: selected.name,
        annualValueCents: selected.price_cents,
        reference,
        expiresAt: signing.rows[0].expires_at,
      };
    });

    if (result.state === "not_found") return json({ error: "sponsoring_checkout_link_invalid" }, 404);
    if (result.state === "rate_limited") return json({ error: "checkout_rate_limited" }, 429);
    if (result.state === "package_not_available") return json({ error: "checkout_package_not_available" }, 409);
    if (result.state === "settings_incomplete") return json({ error: "contract_settings_incomplete" }, 409);
    if (result.state === "sponsor_inactive") return json({ error: "checkout_sponsor_inactive" }, 409);
    if (result.state === "contract_exists") return json({ error: "checkout_contract_exists" }, 409);
    if (result.state === "reservation_held") return json({ error: "package_reservation_held" }, 409);
    if (result.state === "existing") {
      const status = result.submission.status;
      return status === "sent" || status === "confirmed"
        ? json({ checkout: {
          reference: result.submission.reference,
          contractNumber: result.submission.contract_number,
          deliveryMode: result.submission.delivery_mode,
          alreadySubmitted: true,
        } })
        : json({ error: status === "delivery_failed" ? "checkout_delivery_failed" : "checkout_processing", reference: result.submission.reference }, 409);
    }

    const confirmationUrl = deliveryMode === "account"
      ? absoluteSiteUrl(request, "/sponsor")
      : absoluteSiteUrl(request, `/unterzeichnen?token=${encodeURIComponent(rawToken!)}`);
    let resendEmailId: string;
    try {
      resendEmailId = await sendContractSigningEmail({
        email: parsed.value.signerEmail,
        signerName: parsed.value.signerName,
        organizationName: result.tenantName,
        sponsorName: result.sponsorName,
        contractNumber: result.contractNumber,
        packageName: result.packageName,
        annualValueCents: result.annualValueCents,
        confirmationUrl,
        deliveryMode,
        expiresAt: result.expiresAt,
      }, contractEmailConfig());
    } catch (error) {
      await withSession(actorId, result.tenantId, async (client) => {
        const detail = error instanceof Error ? error.message.slice(0, 500) : "delivery_failed";
        await client.query(`UPDATE contract_signing_requests
          SET status = 'failed', delivery_error = $3, updated_at = now()
          WHERE tenant_id = $1 AND contract_id = $2`, [result.tenantId, result.contractId, detail]);
        await client.query(`UPDATE sponsorship_checkout_submissions
          SET status = 'delivery_failed', delivery_error = $3, updated_at = now()
          WHERE tenant_id = $1 AND contract_id = $2`, [result.tenantId, result.contractId, detail]);
      });
      console.error("sponsoring_checkout_delivery_failed", { requestId: context.requestId, contractId: result.contractId, error });
      return json({ error: "checkout_delivery_failed", reference: result.reference, requestId: context.requestId }, 502);
    }

    await withSession(actorId, result.tenantId, async (client) => {
      await client.query(`UPDATE contract_signing_requests
        SET status = 'sent', delivery_error = NULL, resend_email_id = $3, sent_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND contract_id = $2`, [result.tenantId, result.contractId, resendEmailId]);
      await client.query(`UPDATE sponsorship_checkout_submissions
        SET status = 'sent', delivery_error = NULL, updated_at = now()
        WHERE tenant_id = $1 AND contract_id = $2`, [result.tenantId, result.contractId]);
      await client.query(`INSERT INTO sponsorship_contract_events
        (tenant_id, contract_id, event_type, actor_user_id, actor_email, evidence)
        VALUES ($1,$2,'signing_invited',$3,$4,jsonb_build_object(
          'delivery_mode',$5::text,'signer_email',$4::text,'expires_at',$6::text,'source','public_checkout'))`,
      [result.tenantId, result.contractId, actorId, parsed.value.signerEmail, deliveryMode, result.expiresAt]);
    });
    return json({ checkout: {
      reference: result.reference,
      contractNumber: result.contractNumber,
      deliveryMode,
      signerEmail: parsed.value.signerEmail,
      alreadySubmitted: false,
    } }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("package_capacity_exceeded")) return json({ error: "package_capacity_exceeded" }, 409);
    if (message.includes("package_exclusivity_conflict")) return json({ error: "package_exclusivity_conflict" }, 409);
    console.error("sponsoring_checkout_submit_failed", { requestId: context.requestId, error });
    return json({ error: "sponsoring_checkout_submit_failed", requestId: context.requestId }, 500);
  }
};

export const config: Config = {
  path: [
    "/api/sponsoring-checkout/:publicKey",
    "/api/sponsoring-checkout/:publicKey/submit",
    "/api/sponsoring-checkout/:publicKey/logo",
  ],
};
