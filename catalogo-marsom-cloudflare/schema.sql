CREATE TABLE IF NOT EXISTS montages (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '' NOT NULL,
  category TEXT DEFAULT 'estrutura' NOT NULL,
  status TEXT DEFAULT 'planejada' NOT NULL,
  client TEXT DEFAULT '' NOT NULL,
  event_name TEXT DEFAULT '' NOT NULL,
  location TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  occurred_date TEXT NOT NULL,
  occurred_time TEXT NOT NULL,
  responsible_member_id TEXT,
  responsible_name TEXT DEFAULT '' NOT NULL,
  responsible_role TEXT DEFAULT '' NOT NULL,
  cover_media_id TEXT,
  cover_kind TEXT,
  created_by_email TEXT DEFAULT '' NOT NULL,
  created_by_name TEXT DEFAULT 'Equipe Marsom' NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS montages_status_idx ON montages (status);
CREATE INDEX IF NOT EXISTS montages_category_idx ON montages (category);
CREATE INDEX IF NOT EXISTS montages_occurred_date_idx ON montages (occurred_date);

CREATE TABLE IF NOT EXISTS montage_media (
  id TEXT PRIMARY KEY NOT NULL,
  montage_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (montage_id) REFERENCES montages(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS montage_media_r2_key_unique
  ON montage_media (r2_key);
CREATE INDEX IF NOT EXISTS montage_media_montage_idx
  ON montage_media (montage_id);
CREATE INDEX IF NOT EXISTS montage_media_created_at_idx
  ON montage_media (created_at);

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT DEFAULT '' NOT NULL,
  phone TEXT DEFAULT '' NOT NULL,
  is_active INTEGER DEFAULT 1 NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS team_members_active_idx
  ON team_members (is_active);
CREATE INDEX IF NOT EXISTS team_members_name_idx
  ON team_members (name);
