-- Small key-value state (e.g. which guest delegate key the revoke button removes next).
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
