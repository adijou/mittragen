-- A confirmed signer may discover their own unclaimed space after verifying
-- the same email through Identity. This permits discovery only; mutations still
-- require the tenant-scoped transaction and explicit account/sponsor checks.
CREATE POLICY contract_signing_requests_confirmed_signer
  ON contract_signing_requests FOR SELECT
  USING (
    status = 'confirmed'
    AND confirmed_at IS NOT NULL
    AND access_accepted_at IS NULL
    AND lower(signer_email) = app_current_user_email()
  );

CREATE INDEX contract_signing_requests_confirmed_claim_idx
  ON contract_signing_requests(lower(signer_email))
  WHERE status = 'confirmed' AND access_accepted_at IS NULL;
