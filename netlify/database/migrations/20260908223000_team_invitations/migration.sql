CREATE OR REPLACE FUNCTION app_current_user_email()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT lower(NULLIF(current_setting('app.user_email', true), ''))
$$;

ALTER TABLE tenant_invitations
  ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'existing_user', 'failed')),
  ADD COLUMN delivery_error TEXT,
  ADD COLUMN identity_invited_at TIMESTAMPTZ,
  ADD COLUMN revoked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX tenant_invitations_pending_email_idx
  ON tenant_invitations (tenant_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

DROP POLICY invitations_isolated ON tenant_invitations;

CREATE POLICY invitations_isolated ON tenant_invitations
  USING (
    tenant_id = app_current_tenant_id()
    OR (
      accepted_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
      AND lower(email) = app_current_user_email()
    )
  )
  WITH CHECK (tenant_id = app_current_tenant_id());
