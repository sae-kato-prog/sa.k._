-- TalkNest (gadget_talknest_kato) schema
-- Dedicated database: talknest_kato, owned by role talknest_app

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  department TEXT,
  role TEXT,
  avatar_color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('public','private')),
  members TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dms (
  id TEXT PRIMARY KEY,
  members TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES channels(id),
  dm_id TEXT REFERENCES dms(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]',
  reactions JSONB NOT NULL DEFAULT '{}',
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_dm ON messages(dm_id);

CREATE TABLE IF NOT EXISTS thread_replies (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL DEFAULT '',
  reactions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_thread_replies_message ON thread_replies(message_id);
