-- 0021_reconcile_review.sql
--
-- Review stage for the reconciliation flow.
--
-- Dad scrolls the AI-matched groups and confirms them before the
-- decision wizard. Two things:
--   1. validated_at on a group = "I've checked this grouping, it's
--      correct" → the wizard treats it as golden.
--   2. reconcile_feedback captures WHY he pulled a listing out of a group
--      (a wrong merge). We keep these so future match runs can be told
--      "don't group these again" — a simple learning loop.

ALTER TABLE reconcile_group ADD COLUMN validated_at TEXT;

CREATE TABLE reconcile_feedback (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	run_id         INTEGER REFERENCES reconcile_run(id),
	listing_id     INTEGER REFERENCES reconcile_listing(id),
	listing_title  TEXT,                  -- the detached listing's title
	sibling_titles TEXT,                  -- JSON array of the titles it was wrongly grouped with
	reason         TEXT,                  -- Dad's note: what was wrong
	created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_reconcile_feedback_run ON reconcile_feedback(run_id);
