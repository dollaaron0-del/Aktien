-- Users
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  username       TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  approved       BOOLEAN NOT NULL DEFAULT FALSE,
  approval_token TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_token TEXT;
-- Existing users (registered before approval system) are auto-approved
UPDATE users SET approved=true WHERE approved=false AND approval_token IS NULL;

-- Subjects (Fächer)
CREATE TABLE IF NOT EXISTS subjects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '📚',
  color       TEXT NOT NULL DEFAULT '#5856d6',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#5856d6';
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS custom_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE;

-- Documents (uploaded PDFs / text)
CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  subject_id  TEXT REFERENCES subjects(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  content     TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages per subject (chat history)
CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  subject_id  TEXT REFERENCES subjects(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Flashcards (SRS Karteikarten)
CREATE TABLE IF NOT EXISTS flashcards (
  id          SERIAL PRIMARY KEY,
  subject_id  TEXT REFERENCES subjects(id) ON DELETE CASCADE,
  front       TEXT NOT NULL,
  back        TEXT NOT NULL,
  ef          FLOAT DEFAULT 2.5,
  interval    INT DEFAULT 1,
  repetitions INT DEFAULT 0,
  due         BIGINT DEFAULT 0,
  batch       TEXT,
  weak        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Quiz results (for progress chart)
CREATE TABLE IF NOT EXISTS quiz_results (
  id          SERIAL PRIMARY KEY,
  subject_id  TEXT REFERENCES subjects(id) ON DELETE CASCADE,
  score       INT NOT NULL,
  total       INT NOT NULL,
  taken_at    TIMESTAMPTZ DEFAULT NOW()
);

-- User streak: siehe Tabelle user_streaks (pro Nutzer), in server.js via initTables()
-- angelegt. Die alte globale streak-Tabelle (id=1) war ungenutzt und wurde entfernt.

-- Daily API usage tracking
CREATE TABLE IF NOT EXISTS daily_usage (
  date       TEXT PRIMARY KEY,
  cost_eur   FLOAT DEFAULT 0,
  calls      INT DEFAULT 0,
  tokens_in  INT DEFAULT 0,
  tokens_out INT DEFAULT 0
);

-- Glossar terms
CREATE TABLE IF NOT EXISTS glossar (
  id          SERIAL PRIMARY KEY,
  subject_id  TEXT REFERENCES subjects(id) ON DELETE CASCADE,
  term        TEXT NOT NULL,
  definition  TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Admin flag on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- App settings (dynamic daily limit etc.)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('daily_limit_eur', '1.00') ON CONFLICT DO NOTHING;

-- Track whether 90% notification was already sent today
ALTER TABLE daily_usage ADD COLUMN IF NOT EXISTS notified_90pct BOOLEAN NOT NULL DEFAULT FALSE;

-- Persistenter Cache für Themen-Namen-Embeddings (semantisches Re-Scan-Matching)
CREATE TABLE IF NOT EXISTS topic_vectors (
  subject_id TEXT NOT NULL,
  norm_name  TEXT NOT NULL,
  embedding  JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (subject_id, norm_name)
);

-- Grant all permissions to app user (safe to run repeatedly)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO nachhilfe_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO nachhilfe_user;
