-- Exclude a single order from the Ilex / sales report without moving it.
--
-- Un-ticking an order on the Ilex report used to force it into another month.
-- Sometimes it just needs to come off the report while staying in its own
-- month (e.g. a sample, or a line invoiced elsewhere). This flag does exactly
-- that: true = leave it where it is on Insights, but drop it from the sales
-- report. It has no effect on the customer's paperwork.
alter table orders add column if not exists report_exclude boolean not null default false;
