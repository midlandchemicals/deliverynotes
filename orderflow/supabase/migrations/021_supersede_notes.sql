-- Auto-supersede older delivery-note copies.
--
-- Regenerating a delivery note (after editing an order) adds a fresh row rather
-- than replacing the last one, so copies used to pile up on the order. Now, when
-- a new copy is generated, the previous ones are stamped superseded: they drop
-- out of view (tucked behind an "earlier versions" line), never print and never
-- count — but they are kept, not deleted, so the record of what was sent before
-- an edit is never lost. NULL = the current, live copy.
alter table dispatch_notes add column if not exists superseded_at timestamptz;

create index if not exists dispatch_notes_current_idx
  on dispatch_notes (order_id) where superseded_at is null;
