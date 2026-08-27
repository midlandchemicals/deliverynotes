-- Two unrelated tweaks bundled into one file.

-- 1) Report-month override on orders.
--    An order normally lands in the month of its dispatch/order date, but admins
--    can now choose to invoice it in an adjacent month (from the order-entry
--    popup, or by un-ticking it on the Ilex report). This holds the first day of
--    whichever month it should be reported in; NULL means "use the natural date".
--    It only moves the figure on Insights and the Ilex/sales report — it does not
--    change the order, the delivery note, or what the customer is charged.
alter table orders add column if not exists report_month date;

-- 2) Let Rob into Purchasing without making him an admin.
--    His app_users row is set to role 'purchasing' (see below). The Purchasing
--    table's RLS was admin-only; widen it to admins OR 'purchasing'. The empty-
--    table fallback is unchanged, so nothing breaks before app_users is set up.
do $$ begin
  drop policy if exists "admins only" on purchases;
  create policy "purchasing access" on purchases for all to authenticated
    using (
      exists (select 1 from app_users u
              where lower(u.email) = lower(auth.jwt() ->> 'email') and u.role in ('admin', 'purchasing'))
      or not exists (select 1 from app_users)
    )
    with check (
      exists (select 1 from app_users u
              where lower(u.email) = lower(auth.jwt() ->> 'email') and u.role in ('admin', 'purchasing'))
      or not exists (select 1 from app_users)
    );
exception when duplicate_object then null; end $$;

-- Then, in the Supabase Table Editor, set Rob's app_users.role to 'purchasing'.
-- (He keeps no other admin powers — every other pricing area still checks for
-- role = 'admin' specifically.)
