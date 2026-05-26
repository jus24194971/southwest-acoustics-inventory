-- 0004_fix_sku_backfill.sql
--
-- Hotfix for 0003. The backfill UPDATE there used `LENGTH(sku) = 21`,
-- but the actual pre-migration SKU is 20 chars long:
--   CAT(2) + BRAND(3) + MODEL(3) + COND(1) + YY(2) + SEQ(4) + 5 hyphens = 20
-- So the condition didn't match and all 112 imported items still had
-- short SKUs after 0003. Re-run with the correct length.
--
-- Idempotent: any item whose SKU is already 40 chars won't match
-- `LENGTH(sku) = 20` and won't be touched.

UPDATE item SET sku = sku || '-XXX-XXX-XXX-XXX-XXX' WHERE LENGTH(sku) = 20;
