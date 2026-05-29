-- 20260618000010_add_terminal_id_to_pos_sessions.sql
-- Session 33 / Wave 1.1 — terminal_id on POS sessions
-- Each cashier shift is opened on a specific physical terminal. NULL allowed
-- for historic rows (no backfill — terminal concept did not exist before S33).

ALTER TABLE pos_sessions
  ADD COLUMN terminal_id UUID NULL REFERENCES lan_devices(id);

CREATE INDEX idx_pos_sessions_terminal_open
  ON pos_sessions(terminal_id) WHERE status='open';

COMMENT ON COLUMN pos_sessions.terminal_id IS
  'S33 — Physical POS terminal where the shift was opened. NULL for legacy rows + when cashier did not select a terminal. FK to lan_devices(id) where device_type=''pos''.';
