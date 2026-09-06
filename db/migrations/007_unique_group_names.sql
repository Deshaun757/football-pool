-- Match the create-group form's whitespace normalization for existing names.
UPDATE pool_groups SET name=TRIM(REGEXP_REPLACE(name,'[[:space:]]+',' '));
-- Case-insensitive, accent-sensitive uniqueness, including simultaneous requests.
ALTER TABLE pool_groups
  MODIFY COLUMN name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL,
  ADD UNIQUE KEY groups_name_unique (name);
