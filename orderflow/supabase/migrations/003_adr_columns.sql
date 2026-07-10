-- ADR hazard classification columns on products
alter table products add column if not exists adr_class text default '';
alter table products add column if not exists adr_subsidiary text default '';
alter table products add column if not exists adr_tunnel text default '';
alter table products add column if not exists adr_psn text default '';
alter table products add column if not exists adr_transport_cat text default '';
alter table products add column if not exists adr_verified_by text default '';
alter table products add column if not exists adr_verified_at timestamptz;
