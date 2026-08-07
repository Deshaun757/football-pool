ALTER TABLE entries
  DROP INDEX entries_user_week_unique,
  ADD COLUMN entry_number SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER week_id,
  ADD COLUMN label VARCHAR(100) NULL AFTER entry_number,
  ADD UNIQUE KEY entries_user_week_number_unique (user_id, week_id, entry_number);
