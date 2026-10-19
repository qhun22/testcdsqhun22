-- Lưu sự kiện chatbot thô (Sink layer trong Data Lake pipeline)
-- Mỗi tin nhắn user gửi vào chatbot tạo 1 row riêng (raw, chưa aggregate)
CREATE TABLE IF NOT EXISTS chatbot_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  country     TEXT    NOT NULL DEFAULT 'ZZ',
  operating_system TEXT NOT NULL DEFAULT 'Khác',
  message_len INTEGER NOT NULL DEFAULT 0,
  has_product_result INTEGER NOT NULL DEFAULT 0 CHECK (has_product_result IN (0, 1)),
  session_id  TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_chatbot_events_ts ON chatbot_events(ts DESC);
