-- Fine Print live state. Memory of record lives on Walrus; these tables index it
-- for the UI and hold what must be strongly consistent (payment replay, prices).

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL,
  amount TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_digest TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  digest TEXT PRIMARY KEY,
  payer TEXT NOT NULL,
  amount TEXT NOT NULL,
  market TEXT NOT NULL,
  challenge_id TEXT,
  ruling_id TEXT,
  verified_via TEXT,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rulings (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL,
  question TEXT NOT NULL,
  level TEXT NOT NULL,
  verdict TEXT NOT NULL,
  p_dispute REAL NOT NULL,
  patterns TEXT NOT NULL,
  cites TEXT NOT NULL,
  reasons TEXT NOT NULL,
  clause TEXT,
  crowd_yes REAL,
  at INTEGER NOT NULL,
  price TEXT,
  payer TEXT,
  digest TEXT,
  job_id TEXT,
  blob_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  outcome TEXT,
  disputed INTEGER,
  correct INTEGER,
  refund_digest TEXT,
  grade_job_id TEXT,
  grade_blob_id TEXT,
  graded_at INTEGER
);
CREATE INDEX IF NOT EXISTS rulings_market ON rulings(market);
CREATE INDEX IF NOT EXISTS rulings_status ON rulings(status);

CREATE TABLE IF NOT EXISTS board (
  pattern TEXT PRIMARY KEY,
  correct INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  price TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_versions (
  market TEXT NOT NULL,
  n INTEGER NOT NULL,
  hash TEXT NOT NULL,
  seen INTEGER NOT NULL,
  text TEXT NOT NULL,
  job_id TEXT,
  blob_id TEXT,
  source TEXT NOT NULL,
  PRIMARY KEY (market, n)
);

CREATE TABLE IF NOT EXISTS watch (
  market TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  ends_at INTEGER,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market TEXT NOT NULL,
  question TEXT NOT NULL,
  old_ruling TEXT,
  old_verdict TEXT,
  new_ruling TEXT,
  new_verdict TEXT,
  cause_blob TEXT,
  cause TEXT,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_jobs (
  job_id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  namespace TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT,
  blob_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  done_at INTEGER
);

CREATE TABLE IF NOT EXISTS latency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL,
  method TEXT NOT NULL,
  ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS latency_at ON latency(at);
