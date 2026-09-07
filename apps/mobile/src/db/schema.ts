export const createTablesStatement = `
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  source_url TEXT,
  raw_input TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  content_text TEXT,
  digest TEXT,
  ai_error TEXT,
  user_title TEXT,
  user_category TEXT,
  image_uri TEXT,
  user_deadline TEXT,
  thumbnail_url TEXT,
  ai_status TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  user_note TEXT,
  extracted_urls TEXT,
  source_type TEXT NOT NULL,
  saved_from TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 저장물을 이루는 정보 조각들.
-- 릴스에 나중에 받은 DM을 붙이는 식으로, 한 저장물이 여러 조각을 가집니다.
CREATE TABLE IF NOT EXISTS item_sources (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_url TEXT,
  raw_text TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_sources_item_id ON item_sources(item_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_item_id ON sync_jobs(item_id);
`;
