-- Which commission group a customer belongs to, e.g. 'Elite Farm'.
--
-- Blank for the overwhelming majority. Kept as free text rather than a boolean
-- so a second introducer can be added later without another migration.
alter table customers add column if not exists commission_group text default '';

create index if not exists customers_commission_group_idx
  on customers (commission_group) where commission_group <> '';
