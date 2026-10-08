CREATE TABLE IF NOT EXISTS read_receipts (
  message_id TEXT NOT NULL REFERENCES messages(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_read_receipts_message ON read_receipts(message_id);
