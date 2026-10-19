-- Thêm cột lưu nội dung chat (tối đa 80 ký tự đầu) để hiển thị trên Admin Dashboard
ALTER TABLE chatbot_events ADD COLUMN message_preview TEXT NOT NULL DEFAULT '';
