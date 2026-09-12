CREATE TABLE tenant_event_sponsoring_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex') UNIQUE
    CHECK (public_key ~ '^[0-9a-f]{36}$'),
  headline TEXT NOT NULL DEFAULT 'Matchball-Sponsoring'
    CHECK (char_length(headline) BETWEEN 2 AND 160),
  season_label TEXT CHECK (season_label IS NULL OR char_length(season_label) <= 80),
  introduction TEXT NOT NULL DEFAULT 'Unterstützen Sie ein Heimspiel als Matchballsponsor und werden Sie Teil unseres Spieltags.'
    CHECK (char_length(introduction) BETWEEN 2 AND 2000),
  terms_text TEXT NOT NULL DEFAULT 'Der Sponsor wird zum Spiel eingeladen. Der Matchball wird vom Verein geliefert und bleibt Eigentum des Vereins. Jeder Sponsor freut sich über ein persönliches Dankeschön von Team und Trainerstab.'
    CHECK (char_length(terms_text) BETWEEN 2 AND 3000),
  is_published BOOLEAN NOT NULL DEFAULT false,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sponsorship_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL CHECK (char_length(team_name) BETWEEN 1 AND 160),
  opponent TEXT NOT NULL CHECK (char_length(opponent) BETWEEN 1 AND 160),
  competition TEXT CHECK (competition IS NULL OR char_length(competition) <= 160),
  venue TEXT CHECK (venue IS NULL OR char_length(venue) <= 240),
  starts_at TIMESTAMPTZ NOT NULL,
  time_tbd BOOLEAN NOT NULL DEFAULT false,
  external_source TEXT CHECK (external_source IS NULL OR char_length(external_source) <= 80),
  external_id TEXT CHECK (external_id IS NULL OR char_length(external_id) <= 120),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0 AND price_cents <= 100000000),
  fn_supplement_cents INTEGER NOT NULL DEFAULT 3000
    CHECK (fn_supplement_cents >= 0 AND fn_supplement_cents <= 100000000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

CREATE TABLE event_sponsorship_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  sponsor_id UUID,
  reference TEXT NOT NULL CHECK (reference ~ '^MB-[0-9]{4}-[A-Z0-9]{8}$'),
  sponsor_name TEXT NOT NULL CHECK (char_length(sponsor_name) BETWEEN 2 AND 200),
  address TEXT NOT NULL CHECK (char_length(address) BETWEEN 2 AND 240),
  postal_code TEXT NOT NULL CHECK (char_length(postal_code) BETWEEN 2 AND 20),
  city TEXT NOT NULL CHECK (char_length(city) BETWEEN 1 AND 160),
  contact_name TEXT NOT NULL CHECK (char_length(contact_name) BETWEEN 2 AND 160),
  contact_email TEXT NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 320),
  contact_phone TEXT CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 80),
  referred_by_member TEXT CHECK (referred_by_member IS NULL OR char_length(referred_by_member) <= 160),
  include_fn_mention BOOLEAN NOT NULL DEFAULT false,
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('invoice', 'cash')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 100000000),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'cancelled')),
  source TEXT NOT NULL DEFAULT 'public_form' CHECK (source IN ('public_form', 'workspace')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reference),
  FOREIGN KEY (event_id, tenant_id) REFERENCES sponsorship_events(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (sponsor_id, tenant_id) REFERENCES sponsors(id, tenant_id)
);

CREATE UNIQUE INDEX event_sponsorship_one_active_booking_idx
  ON event_sponsorship_bookings(event_id)
  WHERE status = 'submitted';
CREATE INDEX sponsorship_events_tenant_date_idx
  ON sponsorship_events(tenant_id, starts_at);
CREATE UNIQUE INDEX sponsorship_events_external_source_idx
  ON sponsorship_events(tenant_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX event_sponsorship_bookings_tenant_idx
  ON event_sponsorship_bookings(tenant_id, submitted_at DESC);

INSERT INTO tenant_event_sponsoring_settings (tenant_id, headline)
SELECT id, 'Matchball-Sponsoring bei ' || name
FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

UPDATE tenant_event_sponsoring_settings settings
SET headline = 'Matchball-Sponsoring FC Bösingen I',
    season_label = 'Saison 2026/27',
    is_published = true,
    updated_by = 'system:matchcenter-import',
    updated_at = now()
FROM tenants tenant
WHERE settings.tenant_id = tenant.id
  AND tenant.slug = 'fc-sense-saane';

INSERT INTO sponsorship_events (
  tenant_id, team_name, opponent, competition, venue, starts_at, time_tbd,
  external_source, external_id, price_cents, fn_supplement_cents, status, created_by
)
SELECT tenant.id, seed.team_name, seed.opponent, seed.competition, seed.venue,
       seed.starts_at, seed.time_tbd, 'aff-ffv-matchcenter', seed.game_number,
       15000, 3000, 'published', 'system:matchcenter-import'
FROM tenants tenant
CROSS JOIN (VALUES
  ('FC Bösingen I', 'FC Cressier II', 'Meisterschaft 4. Liga / Gruppe 5', 'Sportplatz Bösingen', '2026-09-12 18:00 Europe/Zurich'::timestamptz, false, '134058'),
  ('FC Bösingen I', 'FC Rechthalten-St.Ursen', 'Meisterschaft 4. Liga / Gruppe 5', 'Sportplatz Bösingen', '2026-10-03 18:00 Europe/Zurich'::timestamptz, false, '134080'),
  ('FC Bösingen I', 'FC Sense-Oberland IIa', 'Meisterschaft 4. Liga / Gruppe 5', 'Sportplatz Bösingen', '2026-10-18 15:00 Europe/Zurich'::timestamptz, false, '134091'),
  ('FC Bösingen I', 'FC Vully-Sport', 'Meisterschaft 4. Liga / Gruppe 5', 'Sportplatz Bösingen', '2026-10-31 18:00 Europe/Zurich'::timestamptz, false, '134102'),
  ('FC Bösingen I', 'FC Ueberstorf II', 'Meisterschaft 4. Liga / Gruppe 5', 'Sportplatz Bösingen', '2027-03-20 18:00 Europe/Zurich'::timestamptz, false, '134108'),
  ('FC Bösingen I', 'FC Tafers-Alterswil II', 'Meisterschaft 4. Liga / Gruppe 5', 'Sportplatz Bösingen', '2027-04-04 12:00 Europe/Zurich'::timestamptz, true, '134121'),
  ('FC Bösingen I', 'FC Seisa 08 II', 'Meisterschaft 4. Liga / Gruppe 5', 'Sportplatz Bösingen', '2027-04-17 18:00 Europe/Zurich'::timestamptz, false, '134134'),
  ('FC Bösingen I', 'FC Gruyère-Lac Ib', 'Meisterschaft 4. Liga / Gruppe 5', 'Sportplatz Bösingen', '2027-04-24 18:00 Europe/Zurich'::timestamptz, false, '134135'),
  ('FC Bösingen I', 'SC Düdingen IIIa', 'Meisterschaft 4. Liga / Gruppe 5', 'Sportplatz Bösingen', '2027-05-08 18:00 Europe/Zurich'::timestamptz, false, '134148'),
  ('FC Bösingen I', 'FC Brünisried I', 'Meisterschaft 4. Liga / Gruppe 5', 'Sportplatz Bösingen', '2027-05-22 20:00 Europe/Zurich'::timestamptz, false, '134161')
) AS seed(team_name, opponent, competition, venue, starts_at, time_tbd, game_number)
WHERE tenant.slug = 'fc-sense-saane'
ON CONFLICT DO NOTHING;

ALTER TABLE tenant_event_sponsoring_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_sponsorship_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_event_sponsoring_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_events FORCE ROW LEVEL SECURITY;
ALTER TABLE event_sponsorship_bookings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_event_sponsoring_settings_isolated ON tenant_event_sponsoring_settings
  USING (
    tenant_id = app_current_tenant_id()
    OR (
      public_key = NULLIF(current_setting('app.event_sponsoring_public_key', true), '')
      AND is_published
    )
  )
  WITH CHECK (tenant_id = app_current_tenant_id());

CREATE POLICY sponsorship_events_isolated ON sponsorship_events
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

CREATE POLICY event_sponsorship_bookings_isolated ON event_sponsorship_bookings
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
