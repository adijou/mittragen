import type { User } from "@netlify/identity";
import type { DatabaseClient } from "./database.ts";

export type SponsorAddress = { street: string | null; postal_code: string | null; city: string | null };
export type { SponsorContact } from "../../../shared/sponsor-contact.ts";
import { normalizeSponsorWebsite, sponsorContactFields, sponsorContactKeys as contactKeys, type SponsorContact } from "../../../shared/sponsor-contact.ts";
export type SponsorContactUpdate = Partial<SponsorContact> & { original: Partial<SponsorContact> };

export function parseSponsorContact(body: unknown):
  | { ok: true; value: SponsorContactUpdate }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => ![...contactKeys, "original"].includes(key))) {
    return { ok: false, error: "contact_fields_only" };
  }
  if (!record.original || typeof record.original !== "object" || Array.isArray(record.original)) {
    return { ok: false, error: "original_contact_required" };
  }
  const original = record.original as Record<string, unknown>;
  if (Object.keys(original).some((key) => !contactKeys.includes(key as keyof SponsorContact))) {
    return { ok: false, error: "original_contact_required" };
  }
  const fields = contactKeys.filter((field) => Object.hasOwn(record, field));
  if (fields.length === 0) return { ok: false, error: "no_changes" };
  if (Object.keys(original).some((key) => !fields.includes(key as keyof SponsorContact))) {
    return { ok: false, error: "original_contact_required" };
  }
  const value = { original: {} } as SponsorContactUpdate;
  for (const field of fields) {
    const input = record[field];
    if (input !== null && (typeof input !== "string" || input.trim().length > sponsorContactFields[field].maxLength
      || /[\u0000-\u001f\u007f]/.test(input))) return { ok: false, error: `invalid_${field}` };
    let normalized = typeof input === "string" ? input.trim() || null : null;
    if (field === "legal_name" && !normalized) return { ok: false, error: "invalid_legal_name" };
    if (field === "contact_email" && normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return { ok: false, error: "invalid_contact_email" };
    }
    if (field === "website" && normalized) {
      normalized = normalizeSponsorWebsite(normalized);
      if (!normalized || normalized.length > sponsorContactFields.website.maxLength) return { ok: false, error: "invalid_website" };
    }
    const previous = original[field];
    if (previous !== null && (typeof previous !== "string" || previous.length > sponsorContactFields[field].maxLength)
      || field === "legal_name" && (typeof previous !== "string" || !previous.trim())) {
      return { ok: false, error: "original_contact_required" };
    }
    Object.assign(value, { [field]: normalized });
    Object.assign(value.original, { [field]: previous });
  }
  return { ok: true, value };
}

export async function updateSponsorContact(
  client: DatabaseClient, tenantId: string, sponsorId: string, userId: string, value: SponsorContactUpdate,
) {
  const current = await client.query<SponsorContact>(`
    SELECT ${contactKeys.map((field) => `sponsor.${field}`).join(", ")}
    FROM sponsors sponsor
    JOIN sponsor_portal_access access ON access.tenant_id = sponsor.tenant_id AND access.sponsor_id = sponsor.id
    WHERE sponsor.tenant_id = $1 AND sponsor.id = $2 AND access.identity_user_id = $3
    LIMIT 1 FOR UPDATE OF sponsor
  `, [tenantId, sponsorId, userId]);
  const contact = current.rows[0];
  if (!contact) return { state: "denied" as const };
  const fields = contactKeys.filter((field) => Object.hasOwn(value, field));
  if (fields.some((field) => contact[field] !== value.original[field])) return { state: "conflict" as const };
  if (fields.every((field) => contact[field] === value[field])) return { state: "saved" as const, contact };
  const updated = await client.query<SponsorContact>(`UPDATE sponsors
    SET ${fields.map((field, index) => `${field} = $${index + 3}`).join(", ")}, updated_at = now()
    WHERE tenant_id = $1 AND id = $2 RETURNING ${contactKeys.join(", ")}`,
  [tenantId, sponsorId, ...fields.map((field) => value[field])]);
  await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
    VALUES ($1,$2,'sponsor.contact_updated','sponsor',$3::text,
      jsonb_build_object('source','sponsor_portal','before',$4::jsonb,'after',$5::jsonb))`,
  [tenantId, userId, sponsorId, JSON.stringify(contact), JSON.stringify(updated.rows[0])]);
  return { state: "saved" as const, contact: updated.rows[0] };
}

export type SponsorAddressUpdate = {
  street: string;
  postal_code: string;
  city: string;
  original: SponsorAddress;
};

const addressFields = { street: 200, postal_code: 30, city: 120 } as const;

export function parseSponsorAddress(body: unknown):
  | { ok: true; value: SponsorAddressUpdate }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["street", "postal_code", "city", "original"].includes(key))) {
    return { ok: false, error: "address_fields_only" };
  }
  if (!record.original || typeof record.original !== "object" || Array.isArray(record.original)) {
    return { ok: false, error: "original_address_required" };
  }
  const original = record.original as Record<string, unknown>;
  if (Object.keys(original).some((key) => !(key in addressFields))) return { ok: false, error: "original_address_required" };
  const value = { original: {} } as SponsorAddressUpdate;
  for (const field of Object.keys(addressFields) as Array<keyof SponsorAddress>) {
    const input = record[field];
    if (typeof input !== "string" || !input.trim() || input.trim().length > addressFields[field]
      || /[\u0000-\u001f\u007f]/.test(input)) return { ok: false, error: `invalid_${field}` };
    const previous = original[field];
    if (previous !== null && (typeof previous !== "string" || previous.length > addressFields[field])) {
      return { ok: false, error: "original_address_required" };
    }
    value[field] = input.trim();
    value.original[field] = previous as string | null;
  }
  return { ok: true, value };
}

export async function updateSponsorAddress(
  client: DatabaseClient, tenantId: string, sponsorId: string, userId: string, value: SponsorAddressUpdate,
) {
  const current = await client.query<SponsorAddress>(`
    SELECT sponsor.street, sponsor.postal_code, sponsor.city
    FROM sponsors sponsor
    JOIN sponsor_portal_access access ON access.tenant_id = sponsor.tenant_id AND access.sponsor_id = sponsor.id
    WHERE sponsor.tenant_id = $1 AND sponsor.id = $2 AND access.identity_user_id = $3
    LIMIT 1 FOR UPDATE OF sponsor
  `, [tenantId, sponsorId, userId]);
  const address = current.rows[0];
  if (!address) return { state: "denied" as const };
  if (Object.keys(addressFields).some((field) => address[field as keyof SponsorAddress] !== value.original[field as keyof SponsorAddress])) {
    return { state: "conflict" as const };
  }
  if (Object.keys(addressFields).every((field) => address[field as keyof SponsorAddress] === value[field as keyof SponsorAddress])) {
    return { state: "saved" as const, address };
  }
  const updated = await client.query<SponsorAddress>(`UPDATE sponsors
    SET street = $3, postal_code = $4, city = $5, updated_at = now()
    WHERE tenant_id = $1 AND id = $2 RETURNING street, postal_code, city`,
  [tenantId, sponsorId, value.street, value.postal_code, value.city]);
  await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
    VALUES ($1,$2,'sponsor.address_updated','sponsor',$3::text,
      jsonb_build_object('source','sponsor_portal','before',$4::jsonb,'after',$5::jsonb))`,
  [tenantId, userId, sponsorId, JSON.stringify(address), JSON.stringify(updated.rows[0])]);
  return { state: "saved" as const, address: updated.rows[0] };
}

// A signed contract authorizes its verified signer to activate their own space.
// The signing token itself never grants a permanent login or accepts an arbitrary email.
export async function claimContractSpaces(client: DatabaseClient, user: Pick<User, "id" | "email" | "confirmedAt">) {
  const email = user.email?.trim().toLowerCase();
  if (!email || !user.confirmedAt) return 0;
  const candidates = await client.query<{ id: string; tenant_id: string; sponsor_id: string }>(`
    SELECT id, tenant_id, sponsor_id FROM contract_signing_requests
    WHERE lower(signer_email) = $1 AND access_accepted_at IS NULL
      AND (status = 'confirmed' AND confirmed_at IS NOT NULL
        OR (access_invited_at IS NOT NULL AND access_expires_at > now()))
    ORDER BY created_at, id
  `, [email]);
  let count = 0;
  for (const candidate of candidates.rows) {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [candidate.tenant_id]);
    const claimed = await client.query<{ id: string }>(`UPDATE contract_signing_requests
      SET access_status = 'accepted', access_accepted_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND lower(signer_email) = $3 AND access_accepted_at IS NULL
        AND (status = 'confirmed' AND confirmed_at IS NOT NULL
          OR (access_invited_at IS NOT NULL AND access_expires_at > now()))
      RETURNING id`, [candidate.tenant_id, candidate.id, email]);
    if (!claimed.rows[0]) continue;
    await client.query(`INSERT INTO sponsor_portal_access (tenant_id, sponsor_id, identity_user_id, email)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (tenant_id, sponsor_id, identity_user_id) DO UPDATE SET email = EXCLUDED.email`,
    [candidate.tenant_id, candidate.sponsor_id, user.id, email]);
    await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
      VALUES ($1,$2,'sponsor.access_activated','sponsor',$3::text,
        jsonb_build_object('source','verified_signer','signing_request_id',$4::text))`,
    [candidate.tenant_id, user.id, candidate.sponsor_id, candidate.id]);
    count += 1;
  }
  return count;
}
