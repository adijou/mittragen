-- Administrative evidence may explicitly lack the historical date or signer.
-- Electronic confirmations still require their complete original evidence.
DO $$
DECLARE item RECORD;
BEGIN
  FOR item IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'sponsorship_contracts'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%confirmed_at IS NULL%'
  LOOP
    EXECUTE format('ALTER TABLE sponsorship_contracts DROP CONSTRAINT %I', item.conname);
  END LOOP;
END $$;

ALTER TABLE sponsorship_contracts ADD CONSTRAINT sponsorship_contracts_confirmation_evidence_check CHECK (
  (confirmed_at IS NULL AND confirmed_by IS NULL AND confirmed_email IS NULL AND confirmed_name IS NULL AND confirmed_role IS NULL)
  OR (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_email IS NOT NULL AND confirmed_name IS NOT NULL AND confirmed_role IS NOT NULL)
  OR (confirmation_mode IS NOT DISTINCT FROM 'admin_legacy' AND confirmed_by IS NOT NULL AND confirmed_email IS NOT NULL
      AND confirmed_role IS NOT NULL AND confirmation_recorded_at IS NOT NULL AND confirmation_note IS NOT NULL)
);

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
    (NEW.confirmation_mode IS DISTINCT FROM 'admin_legacy' AND (NEW.confirmed_at IS NULL OR NEW.confirmed_name IS NULL)) OR
    NEW.confirmed_by IS NULL OR NEW.confirmed_email IS NULL OR NEW.confirmed_role IS NULL OR NEW.confirmation_mode IS NULL OR
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
