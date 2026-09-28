-- 신고 누적은 방을 자동으로 닫지 않고 관리자가 판단한다.
-- 관리자 페이지에서 신고된 방을 찾을 수 있도록 서로 다른 신고자 수를 색인에 둔다.
ALTER TABLE rooms_index ADD COLUMN report_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_reported ON rooms_index (report_count);
