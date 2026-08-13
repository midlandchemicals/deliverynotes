-- Orders that carry no VAT — exports, mainly.
--
-- Held on the order rather than the customer because it is a property of the
-- individual sale: the same customer can have a domestic order and an export
-- one. The delivery note snapshots it in `totals` at dispatch so the office
-- copy and any reprint keep the treatment the order was actually billed under.
alter table orders add column if not exists no_vat boolean not null default false;
