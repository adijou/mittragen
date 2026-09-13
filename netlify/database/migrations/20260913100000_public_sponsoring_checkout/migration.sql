CREATE TABLE tenant_sponsoring_checkout_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex') UNIQUE
    CHECK (public_key ~ '^[0-9a-f]{36}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tenant_sponsoring_checkout_settings (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION create_tenant_sponsoring_checkout_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO tenant_sponsoring_checkout_settings (tenant_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_sponsoring_checkout_settings_create
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION create_tenant_sponsoring_checkout_settings();

CREATE TABLE sponsorship_package_online_settings (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  package_version_id UUID NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, package_version_id),
  FOREIGN KEY (package_version_id, tenant_id)
    REFERENCES sponsorship_package_versions(id, tenant_id) ON DELETE CASCADE,
  CHECK (
    (is_enabled AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR (NOT is_enabled AND approved_by IS NULL AND approved_at IS NULL)
  )
);

ALTER TABLE sponsorship_contracts
  ADD COLUMN source TEXT NOT NULL DEFAULT 'workspace'
    CHECK (source IN ('workspace', 'public_checkout'));

CREATE TABLE sponsorship_checkout_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  reference TEXT NOT NULL CHECK (reference ~ '^SP-[0-9]{4}-[A-Z0-9]{8}$'),
  sponsor_id UUID NOT NULL,
  package_version_id UUID NOT NULL,
  contract_id UUID NOT NULL,
  signer_email TEXT NOT NULL CHECK (char_length(signer_email) BETWEEN 3 AND 320),
  signer_name TEXT NOT NULL CHECK (char_length(signer_name) BETWEEN 1 AND 160),
  signer_role TEXT NOT NULL CHECK (char_length(signer_role) BETWEEN 1 AND 120),
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('account', 'one_time')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'delivery_failed', 'confirmed')),
  delivery_error TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, reference),
  UNIQUE (tenant_id, contract_id),
  FOREIGN KEY (sponsor_id, tenant_id) REFERENCES sponsors(id, tenant_id),
  FOREIGN KEY (package_version_id, tenant_id)
    REFERENCES sponsorship_package_versions(id, tenant_id),
  FOREIGN KEY (contract_id, tenant_id)
    REFERENCES sponsorship_contracts(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX sponsorship_checkout_submissions_tenant_idx
  ON sponsorship_checkout_submissions(tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION protect_released_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'void_contract_is_immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status IN ('released', 'confirmed') AND (
    NEW.contract_number IS DISTINCT FROM OLD.contract_number OR
    NEW.version_number IS DISTINCT FROM OLD.version_number OR
    NEW.parent_contract_id IS DISTINCT FROM OLD.parent_contract_id OR
    NEW.sponsor_id IS DISTINCT FROM OLD.sponsor_id OR
    NEW.transition_sponsor_id IS DISTINCT FROM OLD.transition_sponsor_id OR
    NEW.package_version_id IS DISTINCT FROM OLD.package_version_id OR
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.special_agreements IS DISTINCT FROM OLD.special_agreements OR
    NEW.organization_snapshot IS DISTINCT FROM OLD.organization_snapshot OR
    NEW.sponsor_snapshot IS DISTINCT FROM OLD.sponsor_snapshot OR
    NEW.package_snapshot IS DISTINCT FROM OLD.package_snapshot OR
    NEW.terms_snapshot IS DISTINCT FROM OLD.terms_snapshot OR
    NEW.signing_method IS DISTINCT FROM OLD.signing_method OR
    NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash OR
    NEW.released_at IS DISTINCT FROM OLD.released_at OR
    NEW.released_by IS DISTINCT FROM OLD.released_by OR
    NEW.source IS DISTINCT FROM OLD.source
  ) THEN
    RAISE EXCEPTION 'released_contract_is_immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'confirmed' AND (
    NEW.status NOT IN ('confirmed', 'void') OR
    NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR
    NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR
    NEW.confirmed_email IS DISTINCT FROM OLD.confirmed_email OR
    NEW.confirmed_name IS DISTINCT FROM OLD.confirmed_name OR
    NEW.confirmed_role IS DISTINCT FROM OLD.confirmed_role OR
    NEW.confirmation_mode IS DISTINCT FROM OLD.confirmation_mode OR
    NEW.confirmation_recorded_at IS DISTINCT FROM OLD.confirmation_recorded_at OR
    NEW.confirmation_note IS DISTINCT FROM OLD.confirmation_note
  ) THEN
    RAISE EXCEPTION 'confirmed_contract_is_immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'released' AND NEW.status NOT IN ('released', 'confirmed', 'void') THEN
    RAISE EXCEPTION 'released_contract_is_immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'released' AND NEW.status <> 'confirmed' AND (
    NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR
    NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR
    NEW.confirmed_email IS DISTINCT FROM OLD.confirmed_email OR
    NEW.confirmed_name IS DISTINCT FROM OLD.confirmed_name OR
    NEW.confirmed_role IS DISTINCT FROM OLD.confirmed_role OR
    NEW.confirmation_mode IS DISTINCT FROM OLD.confirmation_mode OR
    NEW.confirmation_recorded_at IS DISTINCT FROM OLD.confirmation_recorded_at OR
    NEW.confirmation_note IS DISTINCT FROM OLD.confirmation_note
  ) THEN
    RAISE EXCEPTION 'released_contract_is_immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'released' AND NEW.status = 'confirmed' AND (
    NEW.confirmed_at IS NULL OR NEW.confirmed_by IS NULL OR NEW.confirmed_email IS NULL OR
    NEW.confirmed_name IS NULL OR NEW.confirmed_role IS NULL OR NEW.confirmation_mode IS NULL OR
    NEW.confirmation_recorded_at IS NULL
  ) THEN
    RAISE EXCEPTION 'contract_confirmation_evidence_required' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'void' AND (
    NEW.voided_at IS NULL OR NEW.voided_by IS NULL OR NEW.void_reason IS NULL
  ) THEN
    RAISE EXCEPTION 'contract_void_evidence_required' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE tenant_sponsoring_checkout_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_package_online_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_checkout_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sponsoring_checkout_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_package_online_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_checkout_submissions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_sponsoring_checkout_settings_isolated ON tenant_sponsoring_checkout_settings
  USING (
    tenant_id = app_current_tenant_id()
    OR public_key = NULLIF(current_setting('app.sponsoring_checkout_public_key', true), '')
  )
  WITH CHECK (tenant_id = app_current_tenant_id());

CREATE POLICY sponsorship_package_online_settings_isolated ON sponsorship_package_online_settings
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

CREATE POLICY sponsorship_checkout_submissions_isolated ON sponsorship_checkout_submissions
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY sponsorship_contracts_isolated ON sponsorship_contracts;
CREATE POLICY sponsorship_contracts_isolated ON sponsorship_contracts
  USING (
    tenant_id = app_current_tenant_id()
    AND (
      EXISTS (SELECT 1 FROM tenant_memberships membership
              WHERE membership.tenant_id = sponsorship_contracts.tenant_id
                AND membership.identity_user_id = app_current_user_id())
      OR EXISTS (SELECT 1 FROM sponsor_portal_access access
                 WHERE access.tenant_id = sponsorship_contracts.tenant_id
                   AND access.sponsor_id = sponsorship_contracts.sponsor_id
                   AND access.identity_user_id = app_current_user_id())
      OR EXISTS (SELECT 1 FROM contract_signing_requests signing_request
                 WHERE signing_request.tenant_id = sponsorship_contracts.tenant_id
                   AND signing_request.contract_id = sponsorship_contracts.id
                   AND signing_request.token_hash = NULLIF(current_setting('app.contract_signing_token_hash', true), '')
                   AND signing_request.delivery_mode = 'one_time'
                   AND signing_request.expires_at > now()
                   AND signing_request.status IN ('sent', 'opened', 'confirmed'))
      OR (
        sponsorship_contracts.source = 'public_checkout'
        AND sponsorship_contracts.created_by = app_current_user_id()
        AND app_current_user_id() LIKE 'checkout-public:%'
      )
    )
  )
  WITH CHECK (tenant_id = app_current_tenant_id());
