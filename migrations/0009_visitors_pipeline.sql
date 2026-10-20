-- Bảng visitors: nhận data từ Cloudflare Pipeline (schema giống thầy hướng dẫn)
-- Tương ứng với table 'visitors' trong Basin Catalog của thầy
CREATE TABLE IF NOT EXISTS visitors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id  TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT 'ZZ',
  device      TEXT NOT NULL DEFAULT 'unknown',
  ip          TEXT NOT NULL DEFAULT '',
  ts          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  meta        TEXT NOT NULL DEFAULT '{}',
  ingest_ts   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
