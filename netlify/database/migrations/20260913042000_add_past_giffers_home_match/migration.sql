INSERT INTO sponsorship_events (
  tenant_id, team_name, opponent, competition, venue, starts_at, time_tbd,
  external_source, external_id, price_cents, fn_supplement_cents, status, created_by
)
SELECT tenant.id,
       'FC Bösingen I',
       'FC Giffers-Tentlingen II',
       'Meisterschaft 4. Liga / Gruppe 5',
       'Sportplatz Bösingen',
       '2026-08-29 18:00 Europe/Zurich'::timestamptz,
       false,
       'aff-ffv-matchcenter',
       '134047',
       15000,
       3000,
       'draft',
       'system:matchcenter-import'
FROM tenants tenant
WHERE tenant.slug = 'fc-sense-saane'
  AND NOT EXISTS (
    SELECT 1
    FROM sponsorship_events event
    WHERE event.tenant_id = tenant.id
      AND (
        (event.external_source = 'aff-ffv-matchcenter' AND event.external_id = '134047')
        OR (
          event.team_name = 'FC Bösingen I'
          AND event.opponent = 'FC Giffers-Tentlingen II'
          AND event.starts_at = '2026-08-29 18:00 Europe/Zurich'::timestamptz
        )
      )
  )
ON CONFLICT DO NOTHING;
