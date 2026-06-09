-- 0023_reconcile_prefill.sql
--
-- When Dad clicks "Have it" / "Future" on a matched group, we run the
-- listing text through Claude to pre-fill the new item's category, brand,
-- model, condition, title, price, and attribute slots — then hand him a
-- ready-to-review /items/new form. The resolved prefill (already mapped
-- to OUR category id / brand id / attribute codes) is stashed here so the
-- form can read it without re-calling the AI on every navigation.

ALTER TABLE reconcile_group ADD COLUMN prefill_json TEXT;
