ALTER TABLE users
  ADD COLUMN password_hash VARCHAR(255) NULL AFTER display_name,
  ADD COLUMN role ENUM('player','admin') NOT NULL DEFAULT 'player' AFTER password_hash;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash BINARY(32) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY sessions_token_unique (token_hash),
  KEY sessions_user_idx (user_id),
  KEY sessions_expiry_idx (expires_at),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS weekly_results (
  week_id BIGINT UNSIGNED NOT NULL,
  prize_pool_cents INT UNSIGNED NOT NULL DEFAULT 0,
  winning_correct_picks TINYINT UNSIGNED NULL,
  winning_tiebreaker_difference SMALLINT UNSIGNED NULL,
  calculated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (week_id),
  CONSTRAINT weekly_results_week_fk FOREIGN KEY (week_id) REFERENCES weeks(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS weekly_winners (
  week_id BIGINT UNSIGNED NOT NULL,
  entry_id BIGINT UNSIGNED NOT NULL,
  prize_cents INT UNSIGNED NOT NULL,
  payout_status ENUM('pending','approved','paid','cancelled') NOT NULL DEFAULT 'pending',
  PRIMARY KEY (week_id, entry_id),
  CONSTRAINT weekly_winners_week_fk FOREIGN KEY (week_id) REFERENCES weeks(id),
  CONSTRAINT weekly_winners_entry_fk FOREIGN KEY (entry_id) REFERENCES entries(id)
) ENGINE=InnoDB;
