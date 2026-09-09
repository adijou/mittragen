CREATE UNIQUE INDEX sponsors_id_tenant_idx ON sponsors(id, tenant_id);
CREATE UNIQUE INDEX transition_sponsors_id_tenant_idx ON transition_sponsors(id, tenant_id);

CREATE TABLE tenant_contract_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  legal_name TEXT CHECK (legal_name IS NULL OR char_length(legal_name) BETWEEN 2 AND 160),
  street TEXT CHECK (street IS NULL OR char_length(street) <= 160),
  postal_code TEXT CHECK (postal_code IS NULL OR char_length(postal_code) <= 20),
  city TEXT CHECK (city IS NULL OR char_length(city) <= 120),
  country TEXT NOT NULL DEFAULT 'Schweiz' CHECK (char_length(country) BETWEEN 2 AND 120),
  representative_name TEXT CHECK (representative_name IS NULL OR char_length(representative_name) <= 160),
  representative_title TEXT CHECK (representative_title IS NULL OR char_length(representative_title) <= 120),
  contact_email TEXT CHECK (contact_email IS NULL OR char_length(contact_email) <= 254),
  renewal_mode TEXT NOT NULL DEFAULT 'manual' CHECK (renewal_mode IN ('manual', 'annual_auto')),
  notice_months INTEGER CHECK (notice_months IS NULL OR notice_months BETWEEN 1 AND 12),
  place_of_jurisdiction TEXT CHECK (place_of_jurisdiction IS NULL OR char_length(place_of_jurisdiction) <= 160),
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((renewal_mode = 'manual' AND notice_months IS NULL) OR (renewal_mode = 'annual_auto' AND notice_months IS NOT NULL))
);

CREATE TABLE contract_number_counters (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_year INTEGER NOT NULL CHECK (contract_year BETWEEN 2020 AND 2200),
  last_value INTEGER NOT NULL CHECK (last_value > 0),
  PRIMARY KEY (tenant_id, contract_year)
);

CREATE TABLE sponsorship_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_number TEXT NOT NULL CHECK (char_length(contract_number) BETWEEN 5 AND 60),
  version_number INTEGER NOT NULL DEFAULT 1 CHECK (version_number > 0),
  parent_contract_id UUID,
  sponsor_id UUID NOT NULL,
  transition_sponsor_id UUID,
  package_version_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Sponsoringvertrag' CHECK (char_length(title) BETWEEN 2 AND 160),
  special_agreements TEXT NOT NULL DEFAULT 'Keine besonderen Vereinbarungen.' CHECK (char_length(special_agreements) BETWEEN 1 AND 5000),
  organization_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  sponsor_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  package_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  terms_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'released', 'confirmed', 'void')),
  signing_method TEXT NOT NULL DEFAULT 'click' CHECK (signing_method IN ('click', 'advanced', 'qualified')),
  snapshot_hash TEXT CHECK (snapshot_hash IS NULL OR snapshot_hash ~ '^[0-9a-f]{64}$'),
  released_at TIMESTAMPTZ,
  released_by TEXT,
  confirmed_at TIMESTAMPTZ,
  confirmed_by TEXT,
  confirmed_email TEXT,
  confirmed_name TEXT,
  confirmed_role TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, contract_number),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (parent_contract_id, tenant_id) REFERENCES sponsorship_contracts(id, tenant_id),
  FOREIGN KEY (sponsor_id, tenant_id) REFERENCES sponsors(id, tenant_id),
  FOREIGN KEY (transition_sponsor_id, tenant_id) REFERENCES transition_sponsors(id, tenant_id),
  FOREIGN KEY (package_version_id, tenant_id) REFERENCES sponsorship_package_versions(id, tenant_id),
  CHECK ((status = 'draft' AND snapshot_hash IS NULL) OR (status <> 'draft' AND snapshot_hash IS NOT NULL)),
  CHECK ((status = 'draft' AND released_at IS NULL) OR (status <> 'draft' AND released_at IS NOT NULL)),
  CHECK ((confirmed_at IS NULL AND confirmed_by IS NULL AND confirmed_email IS NULL AND confirmed_name IS NULL AND confirmed_role IS NULL) OR
         (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_email IS NOT NULL AND confirmed_name IS NOT NULL AND confirmed_role IS NOT NULL))
);

CREATE UNIQUE INDEX sponsorship_contracts_transition_active_idx
  ON sponsorship_contracts(transition_sponsor_id)
  WHERE transition_sponsor_id IS NOT NULL AND status <> 'void';
CREATE INDEX sponsorship_contracts_tenant_status_idx ON sponsorship_contracts(tenant_id, status, created_at DESC);
CREATE INDEX sponsorship_contracts_sponsor_idx ON sponsorship_contracts(tenant_id, sponsor_id, created_at DESC);

CREATE TABLE sponsorship_contract_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'updated', 'released', 'viewed', 'downloaded', 'confirmed', 'voided')),
  actor_user_id TEXT NOT NULL,
  actor_email TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (contract_id, tenant_id) REFERENCES sponsorship_contracts(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX sponsorship_contract_events_contract_idx
  ON sponsorship_contract_events(tenant_id, contract_id, created_at);

CREATE OR REPLACE FUNCTION protect_released_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'confirmed_contract_is_immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'released' AND (
    NEW.contract_number IS DISTINCT FROM OLD.contract_number OR
    NEW.sponsor_id IS DISTINCT FROM OLD.sponsor_id OR
    NEW.package_version_id IS DISTINCT FROM OLD.package_version_id OR
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.special_agreements IS DISTINCT FROM OLD.special_agreements OR
    NEW.organization_snapshot IS DISTINCT FROM OLD.organization_snapshot OR
    NEW.sponsor_snapshot IS DISTINCT FROM OLD.sponsor_snapshot OR
    NEW.package_snapshot IS DISTINCT FROM OLD.package_snapshot OR
    NEW.terms_snapshot IS DISTINCT FROM OLD.terms_snapshot OR
    NEW.signing_method IS DISTINCT FROM OLD.signing_method OR
    NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
  ) THEN
    RAISE EXCEPTION 'released_contract_is_immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sponsorship_contract_immutable
  BEFORE UPDATE ON sponsorship_contracts
  FOR EACH ROW EXECUTE FUNCTION protect_released_contract();

CREATE OR REPLACE FUNCTION prevent_contract_event_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'contract_events_are_immutable' USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER sponsorship_contract_events_immutable
  BEFORE UPDATE OR DELETE ON sponsorship_contract_events
  FOR EACH ROW EXECUTE FUNCTION prevent_contract_event_changes();

ALTER TABLE tenant_contract_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_contract_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_contract_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE contract_number_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_contracts FORCE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_contract_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_contract_settings_isolated ON tenant_contract_settings
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY contract_number_counters_isolated ON contract_number_counters
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
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
    )
  )
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY sponsorship_contract_events_isolated ON sponsorship_contract_events
  USING (
    tenant_id = app_current_tenant_id()
    AND EXISTS (SELECT 1 FROM sponsorship_contracts contract
                WHERE contract.tenant_id = sponsorship_contract_events.tenant_id
                  AND contract.id = sponsorship_contract_events.contract_id)
  )
  WITH CHECK (
    tenant_id = app_current_tenant_id()
    AND EXISTS (SELECT 1 FROM sponsorship_contracts contract
                WHERE contract.tenant_id = sponsorship_contract_events.tenant_id
                  AND contract.id = sponsorship_contract_events.contract_id)
  );
