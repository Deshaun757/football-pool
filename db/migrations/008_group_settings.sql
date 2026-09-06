ALTER TABLE pool_groups
  ADD COLUMN require_pick_approval BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN allow_multiple_entries BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN joining_enabled BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE entries e JOIN group_members m ON m.group_id=e.group_id AND m.user_id=e.user_id
SET e.status='submitted' WHERE m.role='commissioner' AND e.status='pending_review';
UPDATE notifications n JOIN entries e ON e.id=n.entry_id
JOIN group_members m ON m.group_id=e.group_id AND m.user_id=e.user_id
SET n.read_at=UTC_TIMESTAMP(3)
WHERE m.role='commissioner' AND e.status='submitted' AND n.type='pick_review_requested';
