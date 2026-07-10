-- Duplicate DN-number protection.
--
-- STEP 1 — check for existing duplicates first (run this SELECT alone):
--   select order_no, count(*) from orders group by order_no having count(*) > 1;
--
-- If it returns rows, rename those duplicates (e.g. add a -B suffix) in the
-- Order Book before running step 2, otherwise the index creation will fail.
--
-- STEP 2 — enforce uniqueness from now on:
create unique index if not exists orders_order_no_unique on orders (order_no);
