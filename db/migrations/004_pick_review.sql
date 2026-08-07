ALTER TABLE entries MODIFY COLUMN status ENUM('draft','pending_review','submitted','rejected','checkout_pending','refunded','void') NOT NULL DEFAULT 'draft';

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  entry_id BIGINT UNSIGNED NULL,
  type ENUM('pick_review_requested','entry_approved','entry_rejected') NOT NULL,
  message VARCHAR(500) NOT NULL,
  read_at DATETIME(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY notifications_user_entry_type_unique (user_id, entry_id, type),
  KEY notifications_user_unread_idx (user_id, read_at),
  CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT notifications_entry_fk FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
) ENGINE=InnoDB;
