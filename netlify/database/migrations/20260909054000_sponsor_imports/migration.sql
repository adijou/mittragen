CREATE TABLE sponsor_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 160),
  source_filename TEXT NOT NULL CHECK (char_length(source_filename) BETWEEN 1 AND 255),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'mapped', 'imported')),
  source_columns JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (jsonb_typeof(source_columns) = 'array'),
  mapping JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(mapping) = 'object'),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  valid_count INTEGER NOT NULL DEFAULT 0 CHECK (valid_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  imported_count INTEGER NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_at TIMESTAMPTZ
);

CREATE INDEX sponsor_import_batches_tenant_created_idx
  ON sponsor_import_batches(tenant_id, created_at DESC);

CREATE TABLE sponsor_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES sponsor_import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  raw_data JSONB NOT NULL CHECK (jsonb_typeof(raw_data) = 'object'),
  mapped_data JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(mapped_data) = 'object'),
  validation_errors JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(validation_errors) = 'array'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'valid', 'invalid', 'imported')),
  sponsor_id UUID REFERENCES sponsors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, row_number)
);

CREATE INDEX sponsor_import_rows_batch_idx ON sponsor_import_rows(tenant_id, batch_id, row_number);

ALTER TABLE sponsor_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE sponsor_import_rows FORCE ROW LEVEL SECURITY;

CREATE POLICY sponsor_import_batches_isolated ON sponsor_import_batches
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

CREATE POLICY sponsor_import_rows_isolated ON sponsor_import_rows
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
