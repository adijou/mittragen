import { createHash } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { hasPermission, isResponse, json, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { isUuid, withSession, type DatabaseClient } from "./_shared/database.ts";
import { createContractPdf, type ContractPdfData } from "./_shared/contract-pdf.ts";
import { parseContractConfirmation, parseContractCreate, parseContractRelease, parseContractSettings, parseContractUpdate, type ContractCreateInput } from "./_shared/contract-input.ts";

type ContractStatus = "draft" | "released" | "confirmed" | "void";
type ContractRow = {
  id: string;
  contract_number: string;
  version_number: number;
  sponsor_id: string;
  transition_sponsor_id: string | null;
  package_version_id: string;
  title: string;
  special_agreements: string;
  organization_snapshot: ContractPdfData["organization"];
  sponsor_snapshot: ContractPdfData["sponsor"];
  package_snapshot: ContractPdfData["package"];
  terms_snapshot: ContractPdfData["terms"];
  status: ContractStatus;
  signing_method: "click" | "advanced" | "qualified";
  snapshot_hash: string | null;
  released_at: string | null;
  confirmed_at: string | null;
  confirmed_email: string | null;
  confirmed_name: string | null;
  confirmed_role: string | null;
  created_at: string;
  updated_at: string;
  sponsor_name?: string;
  package_name?: string;
};

const contractColumns = `
  contract.id, contract.contract_number, contract.version_number, contract.sponsor_id,
  contract.transition_sponsor_id, contract.package_version_id, contract.title, contract.special_agreements,
  contract.organization_snapshot, contract.sponsor_snapshot, contract.package_snapshot, contract.terms_snapshot,
  contract.status, contract.signing_method, contract.snapshot_hash, contract.released_at::text,
  contract.confirmed_at::text, contract.confirmed_email, contract.confirmed_name, contract.confirmed_role,
  contract.created_at::text, contract.updated_at::text
`;

const routes = {
  collection: /^\/api\/contracts\/([0-9a-f-]+)$/i,
  settings: /^\/api\/contracts\/([0-9a-f-]+)\/settings$/i,
  detail: /^\/api\/contracts\/([0-9a-f-]+)\/([0-9a-f-]+)$/i,
  release: /^\/api\/contracts\/([0-9a-f-]+)\/([0-9a-f-]+)\/release$/i,
  confirm: /^\/api\/contracts\/([0-9a-f-]+)\/([0-9a-f-]+)\/confirm$/i,
  pdf: /^\/api\/contracts\/([0-9a-f-]+)\/([0-9a-f-]+)\/pdf$/i,
};

function verifyMutation(request: Request): Response | null {
  try {
    verifyRequestOrigin(request);
    return null;
  } catch (error) {
    return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403);
  }
}

async function membershipRole(client: DatabaseClient, tenantId: string, userId: string) {
  const result = await client.query<{ role: MembershipRole }>(`
    SELECT role FROM tenant_memberships WHERE tenant_id = $1 AND identity_user_id = $2 LIMIT 1
  `, [tenantId, userId]);
  return result.rows[0]?.role ?? null;
}

async function hasSponsorAccess(client: DatabaseClient, tenantId: string, sponsorId: string, userId: string) {
  const result = await client.query<{ id: string }>(`
    SELECT id FROM sponsor_portal_access
    WHERE tenant_id = $1 AND sponsor_id = $2 AND identity_user_id = $3 LIMIT 1
  `, [tenantId, sponsorId, userId]);
  return Boolean(result.rows[0]);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function snapshotHash(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

async function getSettings(client: DatabaseClient, tenantId: string) {
  const result = await client.query<{
    legal_name: string | null; street: string | null; postal_code: string | null; city: string | null;
    country: string; representative_name: string | null; representative_title: string | null;
    contact_email: string | null; renewal_mode: "manual" | "annual_auto"; notice_months: number | null;
    place_of_jurisdiction: string | null;
  }>(`
    SELECT settings.legal_name, settings.street, settings.postal_code, settings.city,
           COALESCE(settings.country, 'Schweiz') AS country, settings.representative_name,
           settings.representative_title, settings.contact_email,
           COALESCE(settings.renewal_mode, 'manual') AS renewal_mode,
           settings.notice_months, settings.place_of_jurisdiction
    FROM tenants tenant
    LEFT JOIN tenant_contract_settings settings ON settings.tenant_id = tenant.id
    WHERE tenant.id = $1 LIMIT 1
  `, [tenantId]);
  return result.rows[0] ?? null;
}

function mapSettings(settings: Awaited<ReturnType<typeof getSettings>>) {
  if (!settings) return null;
  return {
    legalName: settings.legal_name,
    street: settings.street,
    postalCode: settings.postal_code,
    city: settings.city,
    country: settings.country,
    representativeName: settings.representative_name,
    representativeTitle: settings.representative_title,
    contactEmail: settings.contact_email,
    renewalMode: settings.renewal_mode,
    noticeMonths: settings.notice_months,
    placeOfJurisdiction: settings.place_of_jurisdiction,
    complete: Boolean(settings.legal_name && settings.street && settings.postal_code && settings.city && settings.representative_name && settings.representative_title && settings.contact_email),
  };
}

type SnapshotSource = {
    sponsor_id: string; package_version_id: string; legal_name: string; street: string | null;
    postal_code: string | null; city: string | null; contact_name: string | null; contact_email: string | null;
    package_name: string; description: string | null; contract_value_cents: number; duration_months: number;
    payment_plan: string; payment_terms: string | null; valid_from: string | null; valid_until: string | null;
};

async function buildSnapshots(client: DatabaseClient, tenantId: string, selection: ContractCreateInput) {
  const sourceResult = selection.mode === "transition"
    ? await client.query<SnapshotSource>(`
      SELECT proposal.sponsor_id, proposal.proposed_package_version_id AS package_version_id,
             sponsor.legal_name, sponsor.street, sponsor.postal_code, sponsor.city, sponsor.contact_name, sponsor.contact_email,
             version.name AS package_name, version.description, proposal.proposed_value_cents AS contract_value_cents,
             version.duration_months, version.payment_plan, version.payment_terms,
             version.valid_from::text, version.valid_until::text
      FROM transition_sponsors proposal
      JOIN sponsors sponsor ON sponsor.id = proposal.sponsor_id AND sponsor.tenant_id = proposal.tenant_id
      JOIN sponsorship_package_versions version ON version.id = proposal.proposed_package_version_id AND version.tenant_id = proposal.tenant_id
      JOIN sponsorship_packages package ON package.id = version.package_id AND package.tenant_id = version.tenant_id
      WHERE proposal.tenant_id = $1 AND proposal.id = $2 AND proposal.status = 'confirmed'
        AND version.status = 'published' AND package.status = 'active'
      LIMIT 1
    `, [tenantId, selection.transitionSponsorId])
    : await client.query<SnapshotSource>(`
      SELECT sponsor.id AS sponsor_id, version.id AS package_version_id,
             sponsor.legal_name, sponsor.street, sponsor.postal_code, sponsor.city, sponsor.contact_name, sponsor.contact_email,
             version.name AS package_name, version.description, $4::integer AS contract_value_cents,
             version.duration_months, version.payment_plan, version.payment_terms,
             version.valid_from::text, version.valid_until::text
      FROM sponsors sponsor
      JOIN sponsorship_package_versions version ON version.tenant_id = sponsor.tenant_id
      JOIN sponsorship_packages package ON package.id = version.package_id AND package.tenant_id = version.tenant_id
      WHERE sponsor.tenant_id = $1 AND sponsor.id = $2 AND version.id = $3
        AND sponsor.status <> 'inactive' AND version.status = 'published' AND package.status = 'active'
      LIMIT 1
    `, [tenantId, selection.sponsorId, selection.packageVersionId, selection.annualValueCents]);
  const source = sourceResult.rows[0];
  if (!source) return null;
  const settings = await getSettings(client, tenantId);
  if (!settings) return null;
  const rights = await client.query<{
    name: string; description: string | null; quantity: number; schedule_text: string | null;
    channel: string | null; location: string | null;
  }>(`
    SELECT name, description, quantity, schedule_text, channel, location
    FROM sponsorship_rights WHERE tenant_id = $1 AND package_version_id = $2
    ORDER BY created_at, id
  `, [tenantId, source.package_version_id]);
  return {
    sponsorId: source.sponsor_id,
    packageVersionId: source.package_version_id,
    organization: {
      legalName: settings.legal_name ?? "",
      street: settings.street ?? "",
      postalCode: settings.postal_code ?? "",
      city: settings.city ?? "",
      country: settings.country,
      representativeName: settings.representative_name ?? "",
      representativeTitle: settings.representative_title ?? "",
      contactEmail: settings.contact_email ?? "",
    },
    sponsor: {
      legalName: source.legal_name,
      street: source.street,
      postalCode: source.postal_code,
      city: source.city,
      contactName: source.contact_name,
      contactEmail: source.contact_email,
    },
    package: {
      name: source.package_name,
      description: source.description,
      priceCents: source.contract_value_cents,
      durationMonths: source.duration_months,
      paymentPlan: source.payment_plan,
      paymentTerms: source.payment_terms,
      validFrom: source.valid_from,
      validUntil: source.valid_until,
      rights: rights.rows.map((right) => ({
        name: right.name, description: right.description, quantity: right.quantity,
        scheduleText: right.schedule_text, channel: right.channel, location: right.location,
      })),
    },
    terms: {
      renewalMode: settings.renewal_mode,
      noticeMonths: settings.notice_months,
      placeOfJurisdiction: settings.place_of_jurisdiction,
    },
    settingsComplete: Boolean(settings.legal_name && settings.street && settings.postal_code && settings.city && settings.representative_name && settings.representative_title && settings.contact_email),
    sponsorComplete: Boolean(source.street && source.postal_code && source.city && source.contact_name && source.contact_email),
  };
}

async function contractDetail(client: DatabaseClient, tenantId: string, contractId: string) {
  const contract = await client.query<ContractRow>(`
    SELECT ${contractColumns}, sponsor.legal_name AS sponsor_name,
           COALESCE(contract.package_snapshot->>'name', version.name) AS package_name
    FROM sponsorship_contracts contract
    JOIN sponsors sponsor ON sponsor.id = contract.sponsor_id AND sponsor.tenant_id = contract.tenant_id
    JOIN sponsorship_package_versions version ON version.id = contract.package_version_id AND version.tenant_id = contract.tenant_id
    WHERE contract.tenant_id = $1 AND contract.id = $2 LIMIT 1
  `, [tenantId, contractId]);
  if (!contract.rows[0]) return null;
  const events = await client.query<{ id: string; event_type: string; actor_email: string | null; evidence: Record<string, unknown>; created_at: string }>(`
    SELECT id, event_type, actor_email, evidence, created_at::text
    FROM sponsorship_contract_events WHERE tenant_id = $1 AND contract_id = $2
    ORDER BY created_at DESC, id DESC
  `, [tenantId, contractId]);
  return { contract: contract.rows[0], events: events.rows };
}

async function listContracts(client: DatabaseClient, tenantId: string) {
  const contracts = await client.query<ContractRow>(`
    SELECT ${contractColumns}, sponsor.legal_name AS sponsor_name,
           COALESCE(contract.package_snapshot->>'name', version.name) AS package_name
    FROM sponsorship_contracts contract
    JOIN sponsors sponsor ON sponsor.id = contract.sponsor_id AND sponsor.tenant_id = contract.tenant_id
    JOIN sponsorship_package_versions version ON version.id = contract.package_version_id AND version.tenant_id = contract.tenant_id
    WHERE contract.tenant_id = $1 ORDER BY contract.created_at DESC
  `, [tenantId]);
  const eligible = await client.query<{ transition_sponsor_id: string; sponsor_id: string; sponsor_name: string; package_name: string; proposed_value_cents: number; confirmed_at: string }>(`
    SELECT proposal.id AS transition_sponsor_id, proposal.sponsor_id, sponsor.legal_name AS sponsor_name,
           version.name AS package_name, proposal.proposed_value_cents, proposal.updated_at::text AS confirmed_at
    FROM transition_sponsors proposal
    JOIN sponsors sponsor ON sponsor.id = proposal.sponsor_id AND sponsor.tenant_id = proposal.tenant_id
    JOIN sponsorship_package_versions version ON version.id = proposal.proposed_package_version_id AND version.tenant_id = proposal.tenant_id
    WHERE proposal.tenant_id = $1 AND proposal.status = 'confirmed'
      AND NOT EXISTS (SELECT 1 FROM sponsorship_contracts contract
                      WHERE contract.tenant_id = proposal.tenant_id AND contract.transition_sponsor_id = proposal.id AND contract.status <> 'void')
    ORDER BY proposal.updated_at DESC
  `, [tenantId]);
  const sponsors = await client.query<{ id: string; legal_name: string }>(`
    SELECT id, legal_name FROM sponsors
    WHERE tenant_id = $1 AND status <> 'inactive'
    ORDER BY lower(legal_name), id
  `, [tenantId]);
  const catalog = await client.query<{ id: string; name: string; price_cents: number; duration_months: number; version_number: number }>(`
    SELECT version.id, version.name, version.price_cents, version.duration_months, version.version_number
    FROM sponsorship_package_versions version
    JOIN sponsorship_packages package ON package.id = version.package_id AND package.tenant_id = version.tenant_id
    WHERE version.tenant_id = $1 AND version.status = 'published' AND package.status = 'active'
      AND (version.valid_from IS NULL OR version.valid_from <= CURRENT_DATE)
      AND (version.valid_until IS NULL OR version.valid_until >= CURRENT_DATE)
    ORDER BY version.price_cents, lower(version.name), version.version_number DESC
  `, [tenantId]);
  return { contracts: contracts.rows, eligible: eligible.rows, sponsors: sponsors.rows, catalog: catalog.rows };
}

async function ensureDirectReservation(client: DatabaseClient, tenantId: string, sponsorId: string, packageVersionId: string, userId: string) {
  const existing = await client.query<{ id: string; status: "held" | "confirmed"; expired: boolean }>(`
    SELECT id, status, (expires_at IS NOT NULL AND expires_at <= now()) AS expired
    FROM sponsorship_package_reservations
    WHERE tenant_id = $1 AND sponsor_id = $2 AND package_version_id = $3
      AND status IN ('held', 'confirmed')
    LIMIT 1
  `, [tenantId, sponsorId, packageVersionId]);
  if (existing.rows[0]?.status === "confirmed") return true;
  if (existing.rows[0]?.status === "held" && !existing.rows[0].expired) return false;
  if (existing.rows[0]?.status === "held") {
    await client.query(`UPDATE sponsorship_package_reservations
      SET status = 'released', updated_at = now()
      WHERE tenant_id = $1 AND id = $2`, [tenantId, existing.rows[0].id]);
  }
  await client.query(`INSERT INTO sponsorship_package_reservations
    (tenant_id, package_version_id, sponsor_id, status, created_by)
    VALUES ($1, $2, $3, 'confirmed', $4)`,
    [tenantId, packageVersionId, sponsorId, userId]);
  return true;
}

function pdfData(contract: ContractRow): ContractPdfData {
  return {
    contractNumber: contract.contract_number,
    versionNumber: contract.version_number,
    title: contract.title,
    status: contract.status,
    createdAt: contract.created_at,
    releasedAt: contract.released_at,
    confirmedAt: contract.confirmed_at,
    confirmedEmail: contract.confirmed_email,
    snapshotHash: contract.snapshot_hash,
    organization: contract.organization_snapshot,
    sponsor: contract.sponsor_snapshot,
    package: contract.package_snapshot,
    terms: contract.terms_snapshot,
    specialAgreements: contract.special_agreements,
    signingAuthorityName: contract.confirmed_name,
    signingAuthorityRole: contract.confirmed_role,
  };
}

export default async (request: Request, context: Context) => {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const pathname = new URL(request.url).pathname;
  const match = routes.settings.exec(pathname) ?? routes.release.exec(pathname) ?? routes.confirm.exec(pathname)
    ?? routes.pdf.exec(pathname) ?? routes.detail.exec(pathname) ?? routes.collection.exec(pathname);
  const tenantId = match?.[1];
  const contractId = match?.[2];
  if (!tenantId || !isUuid(tenantId)) return json({ error: "invalid_tenant" }, 422);
  if (contractId && !isUuid(contractId)) return json({ error: "invalid_contract" }, 422);

  if (routes.settings.test(pathname)) {
    if (request.method === "GET") {
      try {
        const result = await withSession(user.id, tenantId, async (client) => {
          const role = await membershipRole(client, tenantId, user.id);
          if (!role || !hasPermission(role, "packages:read")) return { denied: true as const };
          return { settings: mapSettings(await getSettings(client, tenantId)) };
        });
        return "denied" in result ? json({ error: "permission_denied" }, 403) : json(result);
      } catch (error) {
        console.error("contract_settings_load_failed", { requestId: context.requestId, tenantId, error });
        return json({ error: "contract_settings_load_failed", requestId: context.requestId }, 500);
      }
    }
    if (request.method !== "PATCH") return json({ error: "method_not_allowed" }, 405);
    const invalidOrigin = verifyMutation(request);
    if (invalidOrigin) return invalidOrigin;
    const parsed = parseContractSettings(await request.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "tenant:manage")) return { denied: true as const };
        const value = parsed.value;
        await client.query(`
          INSERT INTO tenant_contract_settings (
            tenant_id, legal_name, street, postal_code, city, country, representative_name,
            representative_title, contact_email, renewal_mode, notice_months, place_of_jurisdiction, updated_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT (tenant_id) DO UPDATE SET
            legal_name = EXCLUDED.legal_name, street = EXCLUDED.street, postal_code = EXCLUDED.postal_code,
            city = EXCLUDED.city, country = EXCLUDED.country, representative_name = EXCLUDED.representative_name,
            representative_title = EXCLUDED.representative_title, contact_email = EXCLUDED.contact_email,
            renewal_mode = EXCLUDED.renewal_mode, notice_months = EXCLUDED.notice_months,
            place_of_jurisdiction = EXCLUDED.place_of_jurisdiction, updated_by = EXCLUDED.updated_by, updated_at = now()
        `, [tenantId, value.legalName, value.street, value.postalCode, value.city, value.country,
          value.representativeName, value.representativeTitle, value.contactEmail, value.renewalMode,
          value.noticeMonths, value.placeOfJurisdiction, user.id]);
        await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1,$2,'contract.settings_updated','tenant',$3,jsonb_build_object('renewal_mode',$4::text))`,
          [tenantId, user.id, tenantId, value.renewalMode]);
        return { settings: mapSettings(await getSettings(client, tenantId)) };
      });
      return "denied" in result ? json({ error: "permission_denied" }, 403) : json(result);
    } catch (error) {
      console.error("contract_settings_update_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "contract_settings_update_failed", requestId: context.requestId }, 500);
    }
  }

  if (routes.collection.test(pathname)) {
    if (request.method === "GET") {
      try {
        const result = await withSession(user.id, tenantId, async (client) => {
          const role = await membershipRole(client, tenantId, user.id);
          if (!role || !hasPermission(role, "packages:read")) return { denied: true as const };
          return { ...(await listContracts(client, tenantId)), settings: mapSettings(await getSettings(client, tenantId)) };
        });
        return "denied" in result ? json({ error: "permission_denied" }, 403) : json(result);
      } catch (error) {
        console.error("contracts_load_failed", { requestId: context.requestId, tenantId, error });
        return json({ error: "contracts_load_failed", requestId: context.requestId }, 500);
      }
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const invalidOrigin = verifyMutation(request);
    if (invalidOrigin) return invalidOrigin;
    const parsed = parseContractCreate(await request.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:write")) return { state: "denied" as const };
        const snapshots = await buildSnapshots(client, tenantId, parsed.value);
        if (!snapshots) return { state: "selection_not_found" as const };
        const year = new Date().getUTCFullYear();
        const counter = await client.query<{ last_value: number }>(`
          INSERT INTO contract_number_counters (tenant_id, contract_year, last_value) VALUES ($1,$2,1)
          ON CONFLICT (tenant_id, contract_year) DO UPDATE SET last_value = contract_number_counters.last_value + 1
          RETURNING last_value
        `, [tenantId, year]);
        const contractNumber = `MT-${year}-${String(counter.rows[0].last_value).padStart(4, "0")}`;
        const created = await client.query<{ id: string }>(`
          INSERT INTO sponsorship_contracts (
            tenant_id, contract_number, sponsor_id, transition_sponsor_id, package_version_id,
            organization_snapshot, sponsor_snapshot, package_snapshot, terms_snapshot, created_by
          ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10)
          RETURNING id
        `, [tenantId, contractNumber, snapshots.sponsorId,
          parsed.value.mode === "transition" ? parsed.value.transitionSponsorId : null,
          snapshots.packageVersionId, JSON.stringify(snapshots.organization), JSON.stringify(snapshots.sponsor),
          JSON.stringify(snapshots.package), JSON.stringify(snapshots.terms), user.id]);
        await client.query(`INSERT INTO sponsorship_contract_events
          (tenant_id, contract_id, event_type, actor_user_id, actor_email, evidence)
          VALUES ($1,$2,'created',$3,$4,jsonb_build_object('source',$5::text,'annual_value_cents',$6::integer))`,
          [tenantId, created.rows[0].id, user.id, user.email ?? null,
            parsed.value.mode === "transition" ? "confirmed_transition" : "direct_selection",
            snapshots.package.priceCents]);
        return { state: "created" as const, detail: await contractDetail(client, tenantId, created.rows[0].id) };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "selection_not_found") {
        return json({ error: parsed.value.mode === "transition" ? "confirmed_proposal_required" : "contract_selection_not_found" }, 409);
      }
      return json({ detail: result.detail }, 201);
    } catch (error) {
      console.error("contract_create_failed", { requestId: context.requestId, tenantId, error });
      return json({ error: "contract_create_failed", requestId: context.requestId }, 500);
    }
  }

  if (!contractId) return json({ error: "route_not_found" }, 404);

  if (routes.pdf.test(pathname)) {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const detail = await contractDetail(client, tenantId, contractId);
        if (!detail) return { state: "not_found" as const };
        const role = await membershipRole(client, tenantId, user.id);
        const sponsorAllowed = await hasSponsorAccess(client, tenantId, detail.contract.sponsor_id, user.id);
        if ((!role || !hasPermission(role, "packages:read")) && !sponsorAllowed) return { state: "denied" as const };
        if (sponsorAllowed && detail.contract.status === "draft") return { state: "denied" as const };
        const bytes = await createContractPdf(pdfData(detail.contract));
        await client.query(`INSERT INTO sponsorship_contract_events
          (tenant_id, contract_id, event_type, actor_user_id, actor_email, evidence)
          VALUES ($1,$2,'downloaded',$3,$4,jsonb_build_object('snapshot_hash',$5::text))`,
          [tenantId, contractId, user.id, user.email ?? null, detail.contract.snapshot_hash]);
        return { state: "ready" as const, bytes, number: detail.contract.contract_number };
      }, user.email ?? undefined);
      if (result.state === "not_found") return json({ error: "contract_not_found" }, 404);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      return new Response(Uint8Array.from(result.bytes).buffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="Sponsoringvertrag_${result.number}.pdf"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      console.error("contract_pdf_failed", { requestId: context.requestId, tenantId, contractId, error });
      return json({ error: "contract_pdf_failed", requestId: context.requestId }, 500);
    }
  }

  if (routes.detail.test(pathname) && request.method === "GET") {
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:read")) return { denied: true as const };
        return { detail: await contractDetail(client, tenantId, contractId) };
      });
      if ("denied" in result) return json({ error: "permission_denied" }, 403);
      return result.detail ? json(result) : json({ error: "contract_not_found" }, 404);
    } catch (error) {
      console.error("contract_load_failed", { requestId: context.requestId, tenantId, contractId, error });
      return json({ error: "contract_load_failed", requestId: context.requestId }, 500);
    }
  }

  if (!["POST", "PATCH"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  const invalidOrigin = verifyMutation(request);
  if (invalidOrigin) return invalidOrigin;
  const body = await request.json().catch(() => null);

  if (routes.detail.test(pathname) && request.method === "PATCH") {
    const parsed = parseContractUpdate(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:write")) return { state: "denied" as const };
        const updated = await client.query<{ id: string }>(`
          UPDATE sponsorship_contracts SET title = $3, special_agreements = $4, signing_method = $5, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'draft' RETURNING id
        `, [tenantId, contractId, parsed.value.title, parsed.value.specialAgreements, parsed.value.signingMethod]);
        if (!updated.rows[0]) return { state: "locked" as const };
        await client.query(`INSERT INTO sponsorship_contract_events
          (tenant_id, contract_id, event_type, actor_user_id, actor_email, evidence)
          VALUES ($1,$2,'updated',$3,$4,jsonb_build_object('fields',ARRAY['title','special_agreements','signing_method']))`,
          [tenantId, contractId, user.id, user.email ?? null]);
        return { state: "updated" as const, detail: await contractDetail(client, tenantId, contractId) };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "locked") return json({ error: "contract_locked" }, 409);
      return json({ detail: result.detail });
    } catch (error) {
      console.error("contract_update_failed", { requestId: context.requestId, tenantId, contractId, error });
      return json({ error: "contract_update_failed", requestId: context.requestId }, 500);
    }
  }

  if (routes.release.test(pathname) && request.method === "POST") {
    const parsed = parseContractRelease(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const role = await membershipRole(client, tenantId, user.id);
        if (!role || !hasPermission(role, "packages:write")) return { state: "denied" as const };
        const existing = await contractDetail(client, tenantId, contractId);
        if (!existing) return { state: "not_found" as const };
        if (existing.contract.status !== "draft") return { state: "locked" as const };
        if (existing.contract.signing_method !== "click") return { state: "provider_required" as const };
        const annualValueCents = Number(existing.contract.package_snapshot.priceCents);
        if (!existing.contract.transition_sponsor_id && (!Number.isSafeInteger(annualValueCents) || annualValueCents < 0)) {
          return { state: "source_missing" as const };
        }
        const source: ContractCreateInput = existing.contract.transition_sponsor_id
          ? { mode: "transition", transitionSponsorId: existing.contract.transition_sponsor_id }
          : {
            mode: "direct",
            sponsorId: existing.contract.sponsor_id,
            packageVersionId: existing.contract.package_version_id,
            annualValueCents,
          };
        const snapshots = await buildSnapshots(client, tenantId, source);
        if (!snapshots) return { state: "source_missing" as const };
        if (!snapshots.settingsComplete) return { state: "settings_incomplete" as const };
        if (!snapshots.sponsorComplete) return { state: "sponsor_incomplete" as const };
        if (source.mode === "direct" && !await ensureDirectReservation(client, tenantId, snapshots.sponsorId, snapshots.packageVersionId, user.id)) {
          return { state: "reservation_held" as const };
        }
        const hash = snapshotHash({
          contractNumber: existing.contract.contract_number, versionNumber: existing.contract.version_number,
          title: existing.contract.title, specialAgreements: existing.contract.special_agreements,
          organization: snapshots.organization, sponsor: snapshots.sponsor, package: snapshots.package,
          terms: snapshots.terms, signingMethod: existing.contract.signing_method,
        });
        await client.query(`UPDATE sponsorship_contracts SET
          organization_snapshot = $3::jsonb, sponsor_snapshot = $4::jsonb, package_snapshot = $5::jsonb,
          terms_snapshot = $6::jsonb, snapshot_hash = $7, status = 'released', released_at = now(), released_by = $8, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`, [tenantId, contractId, JSON.stringify(snapshots.organization),
          JSON.stringify(snapshots.sponsor), JSON.stringify(snapshots.package), JSON.stringify(snapshots.terms), hash, user.id]);
        await client.query(`INSERT INTO sponsorship_contract_events
          (tenant_id, contract_id, event_type, actor_user_id, actor_email, evidence)
          VALUES ($1,$2,'released',$3,$4,jsonb_build_object('snapshot_hash',$5::text,'legal_review_acknowledged',true))`,
          [tenantId, contractId, user.id, user.email ?? null, hash]);
        return { state: "released" as const, detail: await contractDetail(client, tenantId, contractId) };
      }, user.email ?? undefined);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "not_found") return json({ error: "contract_not_found" }, 404);
      if (result.state === "locked") return json({ error: "contract_locked" }, 409);
      if (result.state === "provider_required") return json({ error: "signature_provider_required" }, 409);
      if (result.state === "settings_incomplete") return json({ error: "contract_settings_incomplete" }, 409);
      if (result.state === "sponsor_incomplete") return json({ error: "contract_sponsor_data_incomplete" }, 409);
      if (result.state === "reservation_held") return json({ error: "package_reservation_held" }, 409);
      if (result.state === "source_missing") return json({ error: "contract_source_unavailable" }, 409);
      return json({ detail: result.detail });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("package_capacity_exceeded")) return json({ error: "package_capacity_exceeded" }, 409);
      if (message.includes("package_exclusivity_conflict")) return json({ error: "package_exclusivity_conflict" }, 409);
      console.error("contract_release_failed", { requestId: context.requestId, tenantId, contractId, error });
      return json({ error: "contract_release_failed", requestId: context.requestId }, 500);
    }
  }

  if (routes.confirm.test(pathname) && request.method === "POST") {
    const parsed = parseContractConfirmation(body);
    if (!parsed.ok) return json({ error: parsed.error }, 422);
    try {
      const result = await withSession(user.id, tenantId, async (client) => {
        const existing = await contractDetail(client, tenantId, contractId);
        if (!existing) return { state: "not_found" as const };
        if (!await hasSponsorAccess(client, tenantId, existing.contract.sponsor_id, user.id)) return { state: "denied" as const };
        if (existing.contract.status === "confirmed") return { state: "already_confirmed" as const };
        if (existing.contract.status !== "released" || existing.contract.signing_method !== "click") return { state: "not_released" as const };
        const email = user.email?.trim().toLowerCase();
        if (!email) return { state: "email_required" as const };
        await client.query(`UPDATE sponsorship_contracts SET status = 'confirmed', confirmed_at = now(),
          confirmed_by = $3, confirmed_email = $4, confirmed_name = $5, confirmed_role = $6, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'released'`,
          [tenantId, contractId, user.id, email, parsed.value.signingAuthorityName, parsed.value.signingAuthorityRole]);
        await client.query(`INSERT INTO sponsorship_contract_events
          (tenant_id, contract_id, event_type, actor_user_id, actor_email, evidence)
          VALUES ($1,$2,'confirmed',$3,$4,jsonb_build_object(
            'snapshot_hash',$5::text,'signing_authority_name',$6::text,'signing_authority_role',$7::text,
            'user_agent',$8::text,'acknowledged',true))`,
          [tenantId, contractId, user.id, email, existing.contract.snapshot_hash,
            parsed.value.signingAuthorityName, parsed.value.signingAuthorityRole,
            (request.headers.get("user-agent") ?? "unknown").slice(0, 500)]);
        return { state: "confirmed" as const };
      }, user.email ?? undefined);
      if (result.state === "not_found") return json({ error: "contract_not_found" }, 404);
      if (result.state === "denied") return json({ error: "permission_denied" }, 403);
      if (result.state === "already_confirmed") return json({ error: "contract_already_confirmed" }, 409);
      if (result.state === "not_released") return json({ error: "contract_not_released" }, 409);
      if (result.state === "email_required") return json({ error: "verified_email_required" }, 422);
      return json({ confirmed: true });
    } catch (error) {
      console.error("contract_confirmation_failed", { requestId: context.requestId, tenantId, contractId, error });
      return json({ error: "contract_confirmation_failed", requestId: context.requestId }, 500);
    }
  }

  return json({ error: "route_not_found" }, 404);
};

export const config: Config = {
  path: [
    "/api/contracts/:tenantId",
    "/api/contracts/:tenantId/settings",
    "/api/contracts/:tenantId/:contractId",
    "/api/contracts/:tenantId/:contractId/release",
    "/api/contracts/:tenantId/:contractId/confirm",
    "/api/contracts/:tenantId/:contractId/pdf",
  ],
};
