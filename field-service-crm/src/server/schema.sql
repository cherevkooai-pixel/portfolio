-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) CHECK(length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-' AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-' AND length(replace(id, '-', '')) = 32 AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'),
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  zip TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Technicians (field workers)
CREATE TABLE IF NOT EXISTS technicians (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) CHECK(length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-' AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-' AND length(replace(id, '-', '')) = 32 AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'),
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  color TEXT NOT NULL DEFAULT '#16a34a',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Service types (configurable per vertical)
CREATE TABLE IF NOT EXISTS service_types (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) CHECK(length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-' AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-' AND length(replace(id, '-', '')) = 32 AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  default_duration INTEGER NOT NULL DEFAULT 60,
  default_price REAL NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#6b7280',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Jobs (scheduled service visits)
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) CHECK(length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-' AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-' AND length(replace(id, '-', '')) = 32 AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'),
  identifier TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT,
  technician_id TEXT REFERENCES technicians(id) ON DELETE SET NULL,
  service_type_id TEXT REFERENCES service_types(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  priority TEXT NOT NULL DEFAULT 'normal',
  scheduled_date TEXT NOT NULL DEFAULT (date('now')),
  scheduled_time TEXT DEFAULT '09:00',
  duration INTEGER NOT NULL DEFAULT 60,
  price REAL NOT NULL DEFAULT 0,
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  completion_notes TEXT DEFAULT '',
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurrence_interval TEXT DEFAULT '',
  next_recurrence_date TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Job history / activity log
CREATE TABLE IF NOT EXISTS job_notes (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) CHECK(length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-' AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-' AND length(replace(id, '-', '')) = 32 AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'),
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Checklist items per job (inspection forms, task lists)
CREATE TABLE IF NOT EXISTS job_checklist (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) CHECK(length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-' AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-' AND length(replace(id, '-', '')) = 32 AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'),
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Materials / inventory used on jobs
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) CHECK(length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-' AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-' AND length(replace(id, '-', '')) = 32 AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'),
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'ea',
  unit_cost REAL NOT NULL DEFAULT 0,
  in_stock REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_materials (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) CHECK(length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-' AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-' AND length(replace(id, '-', '')) = 32 AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'),
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  quantity REAL NOT NULL DEFAULT 1,
  unit_cost REAL NOT NULL DEFAULT 0
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) CHECK(length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-' AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-' AND length(replace(id, '-', '')) = 32 AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'),
  identifier TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  subtotal REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  paid_date TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) CHECK(length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-' AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-' AND length(replace(id, '-', '')) = 32 AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'),
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0
);

-- Auto-incrementing identifier counter
CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- The counter and prefix rows are written by the app (ensureSeeded in
-- src/server/index.ts): a deploy applies this file as DDL only, so a seed
-- row here fails the whole build.

-- Example service types are seeded by the app on first request
-- (ensureSeeded in src/server/index.ts), never here: DDL only.

CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_technician ON jobs(technician_id);
CREATE INDEX IF NOT EXISTS idx_jobs_service_type ON jobs(service_type_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_date ON jobs(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_job_notes_job ON job_notes(job_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_job_checklist_job ON job_checklist(job_id);
CREATE INDEX IF NOT EXISTS idx_job_materials_job ON job_materials(job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_job ON invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);

-- Example materials are seeded by the app on first request
-- (ensureSeeded in src/server/index.ts), never here: DDL only.

-- Optional equipment lifecycle: records are retained, equipment is retired rather than deleted.
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) CHECK(length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-' AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-' AND length(replace(id, '-', '')) = 32 AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'),
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  access_instructions TEXT NOT NULL DEFAULT '',
  safety_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_sites_customer ON sites(customer_id, name);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) CHECK(length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-' AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-' AND length(replace(id, '-', '')) = 32 AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'),
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  serial_number TEXT NOT NULL COLLATE NOCASE,
  manufacturer TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'in_service' CHECK(status IN ('in_service', 'out_of_service', 'retired')),
  installation_date TEXT NOT NULL DEFAULT '',
  commissioning_date TEXT NOT NULL DEFAULT '',
  warranty_start TEXT NOT NULL DEFAULT '',
  warranty_end TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(site_id, customer_id) REFERENCES sites(id, customer_id) ON DELETE RESTRICT,
  UNIQUE(customer_id, serial_number)
);
CREATE INDEX IF NOT EXISTS idx_assets_customer ON assets(customer_id, name);
CREATE INDEX IF NOT EXISTS idx_assets_site ON assets(site_id);
CREATE INDEX IF NOT EXISTS idx_jobs_asset ON jobs(asset_id);

-- History is captured in the same statement as a change. job_id is a logical
-- reference: the snapshot survives deletion or reassignment of the original job.
CREATE TABLE IF NOT EXISTS asset_history (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) CHECK(length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-' AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-' AND length(replace(id, '-', '')) = 32 AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'),
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  job_id TEXT,
  summary TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_history_asset ON asset_history(asset_id, created_at);

CREATE TRIGGER IF NOT EXISTS asset_registered AFTER INSERT ON assets BEGIN
  INSERT INTO asset_history(asset_id, summary, details)
  VALUES (NEW.id, 'Equipment registered', NEW.name || ' · ' || NEW.serial_number || ' · ' || (SELECT name FROM sites WHERE id = NEW.site_id));
END;
CREATE TRIGGER IF NOT EXISTS asset_moved AFTER UPDATE OF site_id ON assets
WHEN OLD.site_id != NEW.site_id BEGIN
  INSERT INTO asset_history(asset_id, summary, details)
  VALUES (NEW.id, 'Site changed', (SELECT name FROM sites WHERE id = OLD.site_id) || ' → ' || (SELECT name FROM sites WHERE id = NEW.site_id));
END;
CREATE TRIGGER IF NOT EXISTS asset_status_changed AFTER UPDATE OF status ON assets
WHEN OLD.status != NEW.status BEGIN
  INSERT INTO asset_history(asset_id, summary, details)
  VALUES (NEW.id, 'Equipment status changed', OLD.status || ' → ' || NEW.status);
END;

-- Validate both writes so changing a job's customer cannot cross-link equipment.
CREATE TRIGGER IF NOT EXISTS job_asset_customer_insert BEFORE INSERT ON jobs
WHEN NEW.asset_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM assets WHERE id = NEW.asset_id AND customer_id = NEW.customer_id
) BEGIN SELECT RAISE(ABORT, 'Equipment must belong to the job customer'); END;
CREATE TRIGGER IF NOT EXISTS job_asset_customer_update BEFORE UPDATE OF asset_id, customer_id ON jobs
WHEN NEW.asset_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM assets WHERE id = NEW.asset_id AND customer_id = NEW.customer_id
) BEGIN SELECT RAISE(ABORT, 'Equipment must belong to the job customer'); END;

CREATE TRIGGER IF NOT EXISTS asset_job_created AFTER INSERT ON jobs
WHEN NEW.asset_id IS NOT NULL BEGIN
  INSERT INTO asset_history(asset_id, job_id, summary, details)
  VALUES (NEW.asset_id, NEW.id, NEW.identifier || ' linked', NEW.status || ' · ' || NEW.scheduled_date || ' · ' || COALESCE(NEW.notes, ''));
END;
CREATE TRIGGER IF NOT EXISTS asset_job_updated AFTER UPDATE ON jobs
WHEN NEW.asset_id IS NOT NULL AND (
  OLD.asset_id IS NOT NEW.asset_id OR OLD.status IS NOT NEW.status OR
  OLD.scheduled_date IS NOT NEW.scheduled_date OR OLD.notes IS NOT NEW.notes OR
  OLD.completion_notes IS NOT NEW.completion_notes
) BEGIN
  INSERT INTO asset_history(asset_id, job_id, summary, details)
  VALUES (NEW.asset_id, NEW.id, NEW.identifier || CASE WHEN OLD.asset_id IS NOT NEW.asset_id THEN ' linked' ELSE ' updated' END,
    NEW.status || ' · ' || NEW.scheduled_date || ' · ' || COALESCE(NEW.notes, '') || ' ' || COALESCE(NEW.completion_notes, ''));
END;
CREATE TRIGGER IF NOT EXISTS asset_job_unlinked AFTER UPDATE OF asset_id ON jobs
WHEN OLD.asset_id IS NOT NULL AND OLD.asset_id IS NOT NEW.asset_id BEGIN
  INSERT INTO asset_history(asset_id, job_id, summary, details)
  VALUES (OLD.asset_id, OLD.id, OLD.identifier || ' unlinked', OLD.status || ' · ' || OLD.scheduled_date || ' · ' || COALESCE(OLD.notes, '') || ' ' || COALESCE(OLD.completion_notes, ''));
END;
CREATE TRIGGER IF NOT EXISTS asset_job_deleted BEFORE DELETE ON jobs
WHEN OLD.asset_id IS NOT NULL BEGIN
  INSERT INTO asset_history(asset_id, job_id, summary, details)
  VALUES (OLD.asset_id, OLD.id, OLD.identifier || ' deleted', OLD.status || ' · ' || OLD.scheduled_date || ' · ' || COALESCE(OLD.notes, '') || ' ' || COALESCE(OLD.completion_notes, ''));
END;
CREATE TRIGGER IF NOT EXISTS asset_job_note AFTER INSERT ON job_notes
WHEN (SELECT asset_id FROM jobs WHERE id = NEW.job_id) IS NOT NULL BEGIN
  INSERT INTO asset_history(asset_id, job_id, summary, details)
  SELECT asset_id, id, identifier || ' note added', NEW.content FROM jobs WHERE id = NEW.job_id;
END;

-- ── Solid CRM (sales side). Money = integer cents. Times = UTC ISO strings. ──

CREATE TABLE IF NOT EXISTS addresses (
  id TEXT PRIMARY KEY NOT NULL,
  line1 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  postal TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  municipality TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'postcard',
  area TEXT NOT NULL DEFAULT '',
  offer TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  pieces INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  address_id TEXT REFERENCES addresses(id),
  service TEXT NOT NULL DEFAULT '',
  size_hint TEXT NOT NULL DEFAULT '',
  timing TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'other',
  source_detail TEXT NOT NULL DEFAULT '',
  campaign_id TEXT REFERENCES campaigns(id),
  page TEXT NOT NULL DEFAULT '',
  utm TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'new',
  stage_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  later_until TEXT NOT NULL DEFAULT '',
  lost_reason TEXT NOT NULL DEFAULT '',
  value_estimate_cents INTEGER NOT NULL DEFAULT 0,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_customer ON leads(customer_id);

CREATE TABLE IF NOT EXISTS touches (
  id TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  step INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  template_key TEXT NOT NULL DEFAULT '',
  due_at TEXT NOT NULL,
  done_at TEXT,
  skipped_at TEXT,
  outcome TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_touches_due ON touches(due_at);
CREATE INDEX IF NOT EXISTS idx_touches_lead ON touches(lead_id);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL DEFAULT 'sms',
  name TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_book (
  id TEXT PRIMARY KEY NOT NULL,
  service TEXT NOT NULL,
  item TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'sq ft',
  low_cents INTEGER NOT NULL DEFAULT 0,
  high_cents INTEGER NOT NULL DEFAULT 0,
  default_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  signed_at_home INTEGER NOT NULL DEFAULT 0,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  accept_token TEXT UNIQUE,
  token_expires_at TEXT,
  sent_at TEXT,
  accepted_at TEXT,
  accepted_name TEXT NOT NULL DEFAULT '',
  cooling_off_ends TEXT NOT NULL DEFAULT '',
  waiver_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_quotes_lead ON quotes(lead_id);

CREATE TABLE IF NOT EXISTS quote_lines (
  id TEXT PRIMARY KEY NOT NULL,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  item TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT '',
  unit_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS qr_codes (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  address_id TEXT REFERENCES addresses(id),
  scans INTEGER NOT NULL DEFAULT 0,
  last_scan_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_qr_campaign ON qr_codes(campaign_id);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  channel TEXT NOT NULL,
  basis TEXT NOT NULL,
  text_shown TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  withdrawn_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY NOT NULL,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  type TEXT NOT NULL,
  lead_id TEXT,
  job_id TEXT,
  campaign_id TEXT,
  value_cents INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT,
  lead_id TEXT,
  r2_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'site',
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS job_costs (
  id TEXT PRIMARY KEY NOT NULL,
  labour_hours REAL NOT NULL DEFAULT 0,
  sub_cents INTEGER NOT NULL DEFAULT 0,
  other_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  from_addr TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  score INTEGER NOT NULL DEFAULT 0,
  reasons TEXT NOT NULL DEFAULT '',
  lead_id TEXT,
  dismissed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_emails_received ON emails(received_at);
