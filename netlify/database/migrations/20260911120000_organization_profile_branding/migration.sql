ALTER TABLE tenant_contract_settings
  ADD COLUMN contact_name TEXT CHECK (contact_name IS NULL OR char_length(contact_name) <= 160),
  ADD COLUMN contact_phone TEXT CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 80),
  ADD COLUMN website TEXT CHECK (website IS NULL OR char_length(website) <= 500),
  ADD COLUMN logo_blob_key TEXT CHECK (logo_blob_key IS NULL OR char_length(logo_blob_key) <= 300),
  ADD COLUMN logo_content_type TEXT CHECK (logo_content_type IS NULL OR logo_content_type IN ('image/png', 'image/jpeg')),
  ADD COLUMN logo_updated_at TIMESTAMPTZ,
  ADD COLUMN brand_primary_color TEXT NOT NULL DEFAULT '#0B2144' CHECK (brand_primary_color ~ '^#[0-9A-F]{6}$'),
  ADD COLUMN brand_accent_color TEXT NOT NULL DEFAULT '#1967FF' CHECK (brand_accent_color ~ '^#[0-9A-F]{6}$');

INSERT INTO tenant_contract_settings (
  tenant_id, legal_name, contact_name, contact_email, contact_phone, website,
  renewal_mode, updated_by
)
SELECT tenant.id, tenant.name, profile.contact_name, profile.contact_email,
       profile.contact_phone, profile.website, 'manual', profile.updated_by
FROM tenants tenant
JOIN tenant_sponsoring_profiles profile ON profile.tenant_id = tenant.id
ON CONFLICT (tenant_id) DO UPDATE SET
  legal_name = COALESCE(tenant_contract_settings.legal_name, EXCLUDED.legal_name),
  contact_name = COALESCE(tenant_contract_settings.contact_name, EXCLUDED.contact_name),
  contact_email = COALESCE(tenant_contract_settings.contact_email, EXCLUDED.contact_email),
  contact_phone = COALESCE(tenant_contract_settings.contact_phone, EXCLUDED.contact_phone),
  website = COALESCE(tenant_contract_settings.website, EXCLUDED.website),
  updated_at = now();

COMMENT ON TABLE tenant_contract_settings IS
  'Zentrales Organisationsprofil für öffentliche Kontaktdaten, Vertragsangaben und Dossier-Branding.';
COMMENT ON COLUMN tenant_sponsoring_profiles.contact_email IS
  'Legacy-Feld; neue Lese- und Schreibzugriffe verwenden tenant_contract_settings.';
