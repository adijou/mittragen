import { getStore } from "@netlify/blobs";
import type { DatabaseClient } from "./database.ts";
import { getOrganizationProfile } from "./organization-profile.ts";

export type OrganizationPdfBrand = {
  primaryColor: string;
  accentColor: string;
  logo?: { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" };
};

export async function loadOrganizationPdfBrand(
  client: DatabaseClient,
  tenantId: string,
  requestId?: string,
): Promise<OrganizationPdfBrand> {
  const profile = await getOrganizationProfile(client, tenantId);
  const brand: OrganizationPdfBrand = {
    primaryColor: profile?.brand_primary_color ?? "#0B2144",
    accentColor: profile?.brand_accent_color ?? "#1967FF",
  };
  if (!profile?.logo_blob_key || !profile.logo_content_type) return brand;

  try {
    const buffer = await getStore({ name: "tenant-brand-assets", consistency: "strong" })
      .get(profile.logo_blob_key, { type: "arrayBuffer" }) as ArrayBuffer | null;
    if (buffer) brand.logo = { bytes: new Uint8Array(buffer), contentType: profile.logo_content_type };
  } catch (error) {
    console.error("organization_pdf_logo_load_failed", { requestId, tenantId, error });
  }
  return brand;
}
