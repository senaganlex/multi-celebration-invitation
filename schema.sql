CREATE TABLE IF NOT EXISTS rsvps (
  id UUID PRIMARY KEY,
  edit_token_hash TEXT NOT NULL,
  guest_name VARCHAR(120) NOT NULL,
  attendance VARCHAR(16) NOT NULL
    CHECK (attendance IN ('attending', 'declined')),
  party_size INTEGER NOT NULL DEFAULT 1
    CHECK (party_size BETWEEN 1 AND 10),
  companion_names VARCHAR(240) NOT NULL DEFAULT '',
  message VARCHAR(600) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rsvps_attendance
  ON rsvps (attendance);

CREATE TABLE IF NOT EXISTS presence_sessions (
  session_id UUID PRIMARY KEY,
  viewer_id UUID NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presence_sessions_last_seen
  ON presence_sessions (last_seen_at);

CREATE INDEX IF NOT EXISTS idx_presence_sessions_viewer_id
  ON presence_sessions (viewer_id);

