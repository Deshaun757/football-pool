ALTER TABLE pool_groups
  ADD COLUMN max_entries_per_member TINYINT UNSIGNED NOT NULL DEFAULT 10,
  ADD COLUMN review_submission_message VARCHAR(500) NULL;

UPDATE pool_groups
SET max_entries_per_member = CASE WHEN allow_multiple_entries THEN 10 ELSE 1 END;
