-- A sponsor can be invited without a transition proposal or signed contract.
ALTER TABLE sponsor_portal_invitations ALTER COLUMN transition_sponsor_id DROP NOT NULL;

CREATE UNIQUE INDEX sponsor_portal_invitations_direct_email_idx
  ON sponsor_portal_invitations (tenant_id, sponsor_id, lower(email))
  WHERE transition_sponsor_id IS NULL;
