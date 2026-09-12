import type { DatabaseClient } from "./database.ts";

export type OrganizationProfileRow = {
  display_name: string;
  legal_name: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
  representative_name: string | null;
  representative_title: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  renewal_mode: "manual" | "annual_auto";
  notice_months: number | null;
  place_of_jurisdiction: string | null;
  logo_blob_key: string | null;
  logo_content_type: "image/png" | "image/jpeg" | null;
  logo_updated_at: string | null;
  brand_primary_color: string;
  brand_accent_color: string;
};

export async function getOrganizationProfile(client: DatabaseClient, tenantId: string) {
  const result = await client.query<OrganizationProfileRow>(`
    SELECT tenant.name AS display_name, settings.legal_name, settings.street, settings.postal_code,
           settings.city, COALESCE(settings.country, 'Schweiz') AS country,
           settings.representative_name, settings.representative_title,
           settings.contact_name, settings.contact_email, settings.contact_phone, settings.website,
           COALESCE(settings.renewal_mode, 'manual') AS renewal_mode,
           settings.notice_months, settings.place_of_jurisdiction,
           settings.logo_blob_key, settings.logo_content_type, settings.logo_updated_at::text,
           COALESCE(settings.brand_primary_color, '#0B2142') AS brand_primary_color,
           COALESCE(settings.brand_accent_color, '#1F6BFF') AS brand_accent_color
    FROM tenants tenant
    LEFT JOIN tenant_contract_settings settings ON settings.tenant_id = tenant.id
    WHERE tenant.id = $1 LIMIT 1
  `, [tenantId]);
  return result.rows[0] ?? null;
}

export function mapOrganizationProfile(row: OrganizationProfileRow | null) {
  if (!row) return null;
  return {
    displayName: row.display_name,
    legalName: row.legal_name,
    street: row.street,
    postalCode: row.postal_code,
    city: row.city,
    country: row.country,
    representativeName: row.representative_name,
    representativeTitle: row.representative_title,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    website: row.website,
    renewalMode: row.renewal_mode,
    noticeMonths: row.notice_months,
    placeOfJurisdiction: row.place_of_jurisdiction,
    logoAvailable: Boolean(row.logo_blob_key),
    logoUpdatedAt: row.logo_updated_at,
    brandPrimaryColor: row.brand_primary_color,
    brandAccentColor: row.brand_accent_color,
    contractComplete: Boolean(row.legal_name && row.street && row.postal_code && row.city && row.representative_name && row.representative_title && row.contact_email),
    dossierContactComplete: Boolean(row.contact_name && row.contact_email),
  };
}
