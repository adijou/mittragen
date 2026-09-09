ALTER TABLE transition_mappings
  ADD COLUMN target_package_version_id UUID,
  ADD CONSTRAINT transition_mappings_package_version_fk
    FOREIGN KEY (target_package_version_id, tenant_id)
    REFERENCES sponsorship_package_versions(id, tenant_id);

ALTER TABLE transition_sponsors
  ADD COLUMN proposed_package_version_id UUID,
  ADD CONSTRAINT transition_sponsors_package_version_fk
    FOREIGN KEY (proposed_package_version_id, tenant_id)
    REFERENCES sponsorship_package_versions(id, tenant_id);

ALTER TABLE sponsorship_package_reservations
  ADD COLUMN transition_sponsor_id UUID REFERENCES transition_sponsors(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX sponsorship_package_reservations_transition_active_idx
  ON sponsorship_package_reservations(transition_sponsor_id)
  WHERE transition_sponsor_id IS NOT NULL AND status IN ('held', 'confirmed');

CREATE TABLE sponsor_portal_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sponsor_id UUID NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  transition_sponsor_id UUID NOT NULL REFERENCES transition_sponsors(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  expires_at TIMESTAMPTZ NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  delivery_error TEXT,
  resend_email_id TEXT,
  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  invited_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transition_sponsor_id, email)
);

CREATE INDEX sponsor_portal_invitations_claim_idx
  ON sponsor_portal_invitations(lower(email), expires_at)
  WHERE accepted_at IS NULL;

CREATE TABLE sponsor_portal_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sponsor_id UUID NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  identity_user_id TEXT NOT NULL,
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sponsor_id, identity_user_id)
);

CREATE INDEX sponsor_portal_access_user_idx
  ON sponsor_portal_access(identity_user_id, tenant_id);

ALTER TABLE sponsor_portal_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_portal_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_portal_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE sponsor_portal_access FORCE ROW LEVEL SECURITY;

CREATE POLICY sponsor_portal_invitations_isolated ON sponsor_portal_invitations
  USING (
    tenant_id = app_current_tenant_id()
    OR (
      expires_at > now()
      AND lower(email) = app_current_user_email()
    )
  )
  WITH CHECK (tenant_id = app_current_tenant_id());

CREATE POLICY sponsor_portal_access_isolated ON sponsor_portal_access
  USING (
    tenant_id = app_current_tenant_id()
    OR identity_user_id = app_current_user_id()
  )
  WITH CHECK (
    tenant_id = app_current_tenant_id()
    OR identity_user_id = app_current_user_id()
  );
