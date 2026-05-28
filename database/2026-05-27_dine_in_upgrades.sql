-- DineFlow dine-in upgrades for Neon PostgreSQL
-- Run this once in Neon before deploying the updated Render backend.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'service_request_type') then
    create type service_request_type as enum ('waiter', 'bill', 'cash_payment');
  end if;

  if not exists (select 1 from pg_type where typname = 'service_request_status') then
    create type service_request_status as enum ('open', 'acknowledged', 'resolved');
  end if;
end $$;

alter type order_status add value if not exists 'open_tab';

alter table menu_items add column if not exists stock_count integer;
alter table menu_items add column if not exists low_stock_threshold integer not null default 5;
alter table eatery_tables add column if not exists floor_x integer not null default 0;
alter table eatery_tables add column if not exists floor_y integer not null default 0;
alter table staff_members add column if not exists pin_hash text;
alter table orders add column if not exists received_at timestamptz not null default now();
alter table orders add column if not exists preparing_at timestamptz;
alter table orders add column if not exists ready_at timestamptz;
alter table orders add column if not exists served_at timestamptz;

create table if not exists service_requests (
  id uuid primary key default gen_random_uuid(),
  eatery_id uuid not null references eateries(id) on delete cascade,
  table_id uuid not null references eatery_tables(id) on delete restrict,
  type service_request_type not null,
  status service_request_status not null default 'open',
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists split_payments (
  id uuid primary key default gen_random_uuid(),
  eatery_id uuid not null references eateries(id) on delete cascade,
  table_id uuid not null references eatery_tables(id) on delete restrict,
  payer_name text not null default 'Guest',
  amount numeric(12, 2) not null check (amount >= 0),
  method text not null default 'cash',
  item_keys jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_service_requests_eatery_status_created on service_requests(eatery_id, status, created_at desc);
create index if not exists idx_service_requests_table_created on service_requests(table_id, created_at desc);
create index if not exists idx_split_payments_table_created on split_payments(table_id, created_at desc);

drop trigger if exists set_service_requests_updated_at on service_requests;
create trigger set_service_requests_updated_at
before update on service_requests
for each row execute function set_updated_at();
