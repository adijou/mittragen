ALTER TABLE sponsor_import_batches
  ADD COLUMN package_mapping JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(package_mapping) = 'object'),
  ADD COLUMN package_mapping_complete BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE sponsors
  ADD COLUMN assigned_package_version_id UUID;

ALTER TABLE sponsors
  ADD CONSTRAINT sponsors_assigned_package_tenant_fk
  FOREIGN KEY (assigned_package_version_id, tenant_id)
  REFERENCES sponsorship_package_versions(id, tenant_id)
  ON DELETE RESTRICT;

CREATE INDEX sponsors_assigned_package_idx
  ON sponsors(tenant_id, assigned_package_version_id)
  WHERE assigned_package_version_id IS NOT NULL;

CREATE TABLE tenant_sponsoring_profiles (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  headline TEXT CHECK (headline IS NULL OR char_length(headline) BETWEEN 2 AND 160),
  season_label TEXT CHECK (season_label IS NULL OR char_length(season_label) <= 80),
  introduction TEXT CHECK (introduction IS NULL OR char_length(introduction) <= 2000),
  club_portrait TEXT CHECK (club_portrait IS NULL OR char_length(club_portrait) <= 5000),
  sponsorship_impact TEXT CHECK (sponsorship_impact IS NULL OR char_length(sponsorship_impact) <= 5000),
  audience TEXT CHECK (audience IS NULL OR char_length(audience) <= 3000),
  contact_name TEXT CHECK (contact_name IS NULL OR char_length(contact_name) <= 160),
  contact_email TEXT CHECK (contact_email IS NULL OR char_length(contact_email) <= 254),
  contact_phone TEXT CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 80),
  website TEXT CHECK (website IS NULL OR char_length(website) <= 500),
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_sponsoring_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sponsoring_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_sponsoring_profiles_isolated ON tenant_sponsoring_profiles
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
