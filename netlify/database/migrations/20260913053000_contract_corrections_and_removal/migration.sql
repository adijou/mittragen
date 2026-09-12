ALTER TABLE sponsorship_contracts
  ADD COLUMN voided_at TIMESTAMPTZ,
  ADD COLUMN voided_by TEXT,
  ADD COLUMN void_reason TEXT
    CHECK (void_reason IS NULL OR char_length(void_reason) BETWEEN 1 AND 600);

CREATE UNIQUE INDEX sponsorship_contracts_one_active_revision_idx
  ON sponsorship_contracts(parent_contract_id)
  WHERE parent_contract_id IS NOT NULL AND status <> 'void';

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

  IF OLD.status = 'confirmed' AND NEW.status NOT IN ('confirmed', 'void') THEN
    RAISE EXCEPTION 'confirmed_contract_is_immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'released' AND NEW.status NOT IN ('released', 'confirmed', 'void') THEN
    RAISE EXCEPTION 'released_contract_is_immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'void' AND (
    NEW.voided_at IS NULL OR NEW.voided_by IS NULL OR NEW.void_reason IS NULL
  ) THEN
    RAISE EXCEPTION 'contract_void_evidence_required' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_contract_event_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM sponsorship_contracts contract
    WHERE contract.id = OLD.contract_id
      AND contract.tenant_id = OLD.tenant_id
      AND contract.status = 'draft'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'contract_events_are_immutable' USING ERRCODE = 'check_violation';
END;
$$;

COMMENT ON COLUMN sponsorship_contracts.void_reason IS
  'Audited reason for voiding a released or confirmed contract. Drafts are physically deleted.';
