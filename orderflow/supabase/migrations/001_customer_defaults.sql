-- Customer contact + pricing/delivery defaults
alter table customers add column if not exists contact_name text default '';
alter table customers add column if not exists email text default '';
alter table customers add column if not exists phone text default '';
alter table customers add column if not exists label_price numeric default 0;
alter table customers add column if not exists default_delivery_charge numeric default 0;
alter table customers add column if not exists free_delivery_above numeric default 0;
alter table customers add column if not exists default_letterhead_id uuid references letterheads(id) on delete set null;
