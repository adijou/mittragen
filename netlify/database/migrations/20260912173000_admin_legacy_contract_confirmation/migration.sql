ALTER TABLE sponsorship_contracts
  ADD COLUMN confirmation_mode TEXT
    CHECK (confirmation_mode IN ('authenticated_account', 'one_time_link', 'legacy_portal', 'admin_legacy')),
  ADD COLUMN confirmation_recorded_at TIMESTAMPTZ,
  ADD COLUMN confirmation_note TEXT
    CHECK (confirmation_note IS NULL OR char_length(confirmation_note) BETWEEN 1 AND 600),
  ADD CONSTRAINT sponsorship_contracts_admin_legacy_confirmation_check CHECK (
    confirmation_mode IS DISTINCT FROM 'admin_legacy'
    OR (confirmation_recorded_at IS NOT NULL AND confirmation_note IS NOT NULL)
  );

ALTER TABLE sponsorship_contract_events
  DROP CONSTRAINT sponsorship_contract_events_event_type_check;
ALTER TABLE sponsorship_contract_events
  ADD CONSTRAINT sponsorship_contract_events_event_type_check
  CHECK (event_type IN (
    'created', 'updated', 'released', 'viewed', 'downloaded', 'confirmed', 'admin_confirmed', 'voided',
    'signing_invited', 'access_invited', 'copy_sent'
  ));

COMMENT ON COLUMN sponsorship_contracts.confirmation_mode IS
  'How confirmation was recorded. admin_legacy marks a pre-existing contract entered by an authorized tenant admin.';
COMMENT ON COLUMN sponsorship_contracts.confirmation_recorded_at IS
  'When Mittragen recorded the confirmation; confirmed_at remains the original contract completion time.';
COMMENT ON COLUMN sponsorship_contracts.confirmation_note IS
  'Administrative evidence note for a pre-existing contract.';
