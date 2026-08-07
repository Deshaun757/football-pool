CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(320) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS seasons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  year SMALLINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY seasons_year_unique (year)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS weeks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id BIGINT UNSIGNED NOT NULL,
  week_number TINYINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  picks_lock_at DATETIME(3) NOT NULL,
  status ENUM('draft','open','locked','final') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY weeks_season_number_unique (season_id, week_number),
  CONSTRAINT weeks_season_fk FOREIGN KEY (season_id) REFERENCES seasons(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teams (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  abbreviation VARCHAR(5) NOT NULL,
  city VARCHAR(100) NOT NULL,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY teams_abbreviation_unique (abbreviation)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS games (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  week_id BIGINT UNSIGNED NOT NULL,
  away_team_id BIGINT UNSIGNED NOT NULL,
  home_team_id BIGINT UNSIGNED NOT NULL,
  kickoff_at DATETIME(3) NOT NULL,
  is_monday_tiebreaker BOOLEAN NOT NULL DEFAULT FALSE,
  away_score SMALLINT UNSIGNED NULL,
  home_score SMALLINT UNSIGNED NULL,
  status ENUM('scheduled','in_progress','final','cancelled') NOT NULL DEFAULT 'scheduled',
  PRIMARY KEY (id),
  KEY games_week_kickoff_idx (week_id, kickoff_at),
  CONSTRAINT games_week_fk FOREIGN KEY (week_id) REFERENCES weeks(id),
  CONSTRAINT games_away_team_fk FOREIGN KEY (away_team_id) REFERENCES teams(id),
  CONSTRAINT games_home_team_fk FOREIGN KEY (home_team_id) REFERENCES teams(id),
  CONSTRAINT games_distinct_teams CHECK (away_team_id <> home_team_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  week_id BIGINT UNSIGNED NOT NULL,
  status ENUM('draft','checkout_pending','submitted','refunded','void') NOT NULL DEFAULT 'draft',
  tiebreaker_total SMALLINT UNSIGNED NULL,
  submitted_at DATETIME(3) NULL,
  correct_picks TINYINT UNSIGNED NULL,
  tiebreaker_difference SMALLINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY entries_user_week_unique (user_id, week_id),
  CONSTRAINT entries_user_fk FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT entries_week_fk FOREIGN KEY (week_id) REFERENCES weeks(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS picks (
  entry_id BIGINT UNSIGNED NOT NULL,
  game_id BIGINT UNSIGNED NOT NULL,
  selected_team_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (entry_id, game_id),
  CONSTRAINT picks_entry_fk FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  CONSTRAINT picks_game_fk FOREIGN KEY (game_id) REFERENCES games(id),
  CONSTRAINT picks_team_fk FOREIGN KEY (selected_team_id) REFERENCES teams(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entry_id BIGINT UNSIGNED NOT NULL,
  provider ENUM('stripe') NOT NULL DEFAULT 'stripe',
  checkout_session_id VARCHAR(255) NULL,
  payment_intent_id VARCHAR(255) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'usd',
  gross_amount_cents INT UNSIGNED NOT NULL,
  processor_fee_cents INT UNSIGNED NULL,
  net_amount_cents INT UNSIGNED NULL,
  status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
  paid_at DATETIME(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY payments_checkout_session_unique (checkout_session_id),
  UNIQUE KEY payments_intent_unique (payment_intent_id),
  KEY payments_entry_idx (entry_id),
  CONSTRAINT payments_entry_fk FOREIGN KEY (entry_id) REFERENCES entries(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  processed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id)
) ENGINE=InnoDB;
