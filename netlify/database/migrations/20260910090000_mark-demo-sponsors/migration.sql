ALTER TABLE sponsors
  ADD COLUMN is_demo_data BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX sponsors_tenant_demo_idx
  ON sponsors(tenant_id, is_demo_data)
  WHERE is_demo_data = true;

WITH demo_seed(legal_name, source_organization, status, proposal_package, annual_value_cents) AS (
  VALUES
    ('Bergbau AG', 'FC Bösingen', 'review', 'Gold Plus', 2500000),
    ('Solartec AG', 'beide Klubs', 'opened', 'Gold', 1500000),
    ('Fischer & Partner', 'FC Wünnewil-Flamatt', 'approved', 'Silber', 800000),
    ('Garage Sense', 'FC Bösingen', 'question', 'Bronze', 500000),
    ('Käserei Sensetal', 'FC Wünnewil-Flamatt', 'prepared', 'Silber', 800000),
    ('Bauwerk Freiburg', 'beide Klubs', 'review', 'Gold Plus', 2500000),
    ('Regionalmarkt Unterland', 'FC Bösingen', 'review', 'Bronze', 500000)
)
UPDATE sponsors sponsor
SET is_demo_data = true
FROM demo_seed seed
WHERE sponsor.legal_name = seed.legal_name
  AND sponsor.source_organization = seed.source_organization
  AND sponsor.status = seed.status
  AND sponsor.proposal_package = seed.proposal_package
  AND sponsor.annual_value_cents = seed.annual_value_cents
  AND EXISTS (
    SELECT 1
    FROM audit_events event
    WHERE event.tenant_id = sponsor.tenant_id
      AND event.action = 'tenant.created'
      AND event.metadata @> '{"demo_data": true}'::jsonb
  );
