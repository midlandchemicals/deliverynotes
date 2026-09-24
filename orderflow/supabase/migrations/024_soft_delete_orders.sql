-- Soft-delete for orders (a recoverable Trash).
--
-- Deleting an order no longer destroys it. Instead it's stamped deleted_at and
-- drops out of every list, report and figure — but the row (and its delivery
-- notes) stay in the database, so it can be restored from the Order Book's
-- Trash. A permanent delete is still available from there for when it's really
-- meant. NULL deleted_at = a live order.
alter table orders add column if not exists deleted_at timestamptz;
alter table orders add column if not exists deleted_by text;

-- Most queries ask only for live orders, so index those.
create index if not exists orders_active_idx on orders (created_at desc) where deleted_at is null;
