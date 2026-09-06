CREATE TABLE IF NOT EXISTS pool_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  invite_code CHAR(32) NOT NULL UNIQUE,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT groups_creator_fk FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS group_members (
  group_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('member','commissioner') NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (group_id,user_id),
  CONSTRAINT members_group_fk FOREIGN KEY (group_id) REFERENCES pool_groups(id),
  CONSTRAINT members_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- Preserve the original pool and all existing entries and memberships.
INSERT IGNORE INTO pool_groups (id,name,invite_code,created_by)
VALUES (1,'Original pool',LOWER(HEX(RANDOM_BYTES(16))),
  (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1));
INSERT IGNORE INTO group_members (group_id,user_id,role)
SELECT 1,u.id,IF(u.id=g.created_by,'commissioner','member')
FROM users u CROSS JOIN pool_groups g WHERE g.id=1;

ALTER TABLE entries
  ADD COLUMN group_id BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER week_id,
  DROP INDEX entries_user_week_number_unique,
  ADD KEY entries_user_idx (user_id),
  ADD UNIQUE KEY entries_group_user_week_number_unique (group_id,user_id,week_id,entry_number),
  ADD CONSTRAINT entries_group_fk FOREIGN KEY (group_id) REFERENCES pool_groups(id);

ALTER TABLE weekly_results
  ADD COLUMN group_id BIGINT UNSIGNED NOT NULL DEFAULT 1,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (week_id,group_id),
  ADD CONSTRAINT results_group_fk FOREIGN KEY (group_id) REFERENCES pool_groups(id);
