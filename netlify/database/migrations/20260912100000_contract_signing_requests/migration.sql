CREATE TABLE contract_signing_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL,
  sponsor_id UUID NOT NULL,
  signer_email TEXT NOT NULL CHECK (char_length(signer_email) BETWEEN 3 AND 320),
  signer_name TEXT NOT NULL CHECK (char_length(signer_name) BETWEEN 1 AND 160),
  signer_role TEXT NOT NULL CHECK (char_length(signer_role) BETWEEN 1 AND 120),
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('account', 'one_time')),
  identity_user_id TEXT,
  token_hash TEXT UNIQUE CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'opened', 'confirmed', 'failed', 'revoked')),
  delivery_error TEXT,
  resend_email_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  access_status TEXT NOT NULL DEFAULT 'none'
    CHECK (access_status IN ('none', 'pending', 'sent', 'existing_user', 'failed', 'accepted')),
  access_error TEXT,
  access_invited_at TIMESTAMPTZ,
  access_expires_at TIMESTAMPTZ,
  access_accepted_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id),
  FOREIGN KEY (contract_id, tenant_id) REFERENCES sponsorship_contracts(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (sponsor_id, tenant_id) REFERENCES sponsors(id, tenant_id) ON DELETE CASCADE,
  CHECK ((delivery_mode = 'account' AND identity_user_id IS NOT NULL AND token_hash IS NULL)
      OR (delivery_mode = 'one_time' AND identity_user_id IS NULL AND token_hash IS NOT NULL)),
  CHECK ((status = 'confirmed' AND confirmed_at IS NOT NULL) OR status <> 'confirmed')
);

CREATE INDEX contract_signing_requests_email_idx
  ON contract_signing_requests(lower(signer_email), access_expires_at)
  WHERE access_invited_at IS NOT NULL AND access_accepted_at IS NULL;
CREATE INDEX contract_signing_requests_token_idx
  ON contract_signing_requests(token_hash)
  WHERE token_hash IS NOT NULL;

ALTER TABLE sponsorship_contract_events
  DROP CONSTRAINT sponsorship_contract_events_event_type_check;
ALTER TABLE sponsorship_contract_events
  ADD CONSTRAINT sponsorship_contract_events_event_type_check
  CHECK (event_type IN (
    'created', 'updated', 'released', 'viewed', 'downloaded', 'confirmed', 'voided',
    'signing_invited', 'access_invited', 'copy_sent'
  ));

ALTER TABLE contract_signing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_signing_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY contract_signing_requests_isolated ON contract_signing_requests
  USING (
    tenant_id = app_current_tenant_id()
    OR (
      token_hash = NULLIF(current_setting('app.contract_signing_token_hash', true), '')
      AND delivery_mode = 'one_time'
      AND expires_at > now()
      AND status IN ('sent', 'opened', 'confirmed')
    )
    OR (
      access_invited_at IS NOT NULL
      AND access_expires_at > now()
      AND access_accepted_at IS NULL
      AND lower(signer_email) = app_current_user_email()
    )
  )
  WITH CHECK (
    tenant_id = app_current_tenant_id()
    OR (
      token_hash = NULLIF(current_setting('app.contract_signing_token_hash', true), '')
      AND delivery_mode = 'one_time'
      AND expires_at > now()
      AND status IN ('sent', 'opened', 'confirmed')
    )
  );

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
    )
  )
  WITH CHECK (tenant_id = app_current_tenant_id());
