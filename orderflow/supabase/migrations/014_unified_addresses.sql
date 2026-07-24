-- Unified address book: one list per customer, each address with its own
-- contact. The app reads `addresses` if present, otherwise merges the legacy
-- invoice_addresses + delivery_addresses. Adding the column is enough — the
-- Customers page backfills each customer's merged list on first load.
alter table customers add column if not exists addresses jsonb default '[]';
