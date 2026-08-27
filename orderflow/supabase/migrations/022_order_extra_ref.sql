-- Optional third reference on an order.
--
-- Orders already carry two references: the Customer No (po_ref) and the
-- delivery-note number (order_no). Some customers need one more — a project,
-- contract or scheme number — printed alongside the others on their paperwork.
-- It is entirely optional; left blank, nothing extra prints.
alter table orders add column if not exists ref2 text;
