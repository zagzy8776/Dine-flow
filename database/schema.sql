-- DineFlow schema for Neon PostgreSQL
-- Production target: Vercel frontend + Render backend + Neon PostgreSQL

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum ('received', 'preparing', 'ready', 'served', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'staff_role') then
    create type staff_role as enum ('owner', 'admin', 'kitchen', 'waiter');
  end if;
end $$;

create table if not exists eateries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists eatery_tables (
  id uuid primary key default gen_random_uuid(),
  eatery_id uuid not null references eateries(id) on delete cascade,
  label text not null,
  seats integer not null default 4 check (seats > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (eatery_id, label)
);

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  eatery_id uuid not null references eateries(id) on delete cascade,
  name text not null,
  category text not null,
  description text,
  price numeric(12, 2) not null check (price >= 0),
  prep_minutes integer not null default 10 check (prep_minutes > 0),
  available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  eatery_id uuid not null references eateries(id) on delete cascade,
  table_id uuid not null references eatery_tables(id) on delete restrict,
  customer_name text not null default 'Guest',
  status order_status not null default 'received',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id) on delete set null,
  item_name text not null,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists staff_members (
  id uuid primary key default gen_random_uuid(),
  eatery_id uuid not null references eateries(id) on delete cascade,
  email text not null,
  full_name text not null,
  role staff_role not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (eatery_id, email)
);

create table if not exists staff_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_orders_eatery_status_created on orders(eatery_id, status, created_at desc);
create index if not exists idx_orders_table_created on orders(table_id, created_at desc);
create index if not exists idx_menu_items_eatery_category on menu_items(eatery_id, category);
create index if not exists idx_order_items_order on order_items(order_id);
create index if not exists idx_staff_members_eatery_email on staff_members(eatery_id, lower(email));
create index if not exists idx_staff_sessions_expires on staff_sessions(expires_at);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_menu_items_updated_at on menu_items;
create trigger trg_menu_items_updated_at
before update on menu_items
for each row
execute function set_updated_at();

drop trigger if exists trg_orders_updated_at on orders;
create trigger trg_orders_updated_at
before update on orders
for each row
execute function set_updated_at();

drop trigger if exists trg_staff_members_updated_at on staff_members;
create trigger trg_staff_members_updated_at
before update on staff_members
for each row
execute function set_updated_at();

-- Demo seed data
insert into eateries (name, slug, address)
values ('Dine Flow', 'dine-flow', 'Lagos, Nigeria')
on conflict (slug) do nothing;

with demo as (
  select id from eateries where slug = 'dine-flow'
)
insert into eatery_tables (eatery_id, label, seats)
select demo.id, table_data.label, table_data.seats
from demo,
  (values ('Table 1', 2), ('Table 2', 4), ('Table 3', 4), ('VIP 1', 6), ('Pickup Counter', 1), ('Delivery Dispatch', 1)) as table_data(label, seats)
on conflict (eatery_id, label) do nothing;

with demo as (
  select id from eateries where slug = 'dine-flow'
)
insert into menu_items (eatery_id, name, category, description, price, prep_minutes, available)
select demo.id, item.name, item.category, item.description, item.price, item.prep_minutes, true
from demo,
  (values
    ('Smoky Jollof Rice', 'Rice Meals', 'Party-style jollof served with plantain and coleslaw.', 3500, 18),
    ('Fried Rice & Chicken', 'Rice Meals', 'Vegetable fried rice with spicy grilled chicken.', 4200, 20),
    ('Amala, Ewedu & Gbegiri', 'Swallow', 'Soft amala with assorted meat and rich Yoruba soup mix.', 3000, 12),
    ('Catfish Pepper Soup', 'Soups', 'Fresh catfish in hot pepper soup spices.', 5200, 25),
    ('Chicken Shawarma', 'Quick Bites', 'Loaded wrap with chicken, sausage and creamy sauce.', 2800, 10),
    ('Chilled Zobo', 'Drinks', 'Cold hibiscus drink with ginger and pineapple.', 900, 2)
  ) as item(name, category, description, price, prep_minutes)
where not exists (
  select 1 from menu_items where menu_items.eatery_id = demo.id
);

-- Pre-generated hashes for password ChangeMe123!
with demo as (
  select id from eateries where slug = 'dine-flow'
)
insert into staff_members (eatery_id, email, full_name, role, password_hash, active)
select demo.id, staff.email, staff.full_name, staff.role::staff_role, staff.password_hash, true
from demo,
  (
    values
      ('owner@dineflow.com', 'Dine Flow Owner', 'owner', 'scrypt:63e174da6b191e83f23fa3c255d4de91:d0082932fa1e428e542099cfec2ed3ea5ac8ac6aa286b60ee1baded3a954a6d6d61daabf2aa8b88dc89c3a55c23c6f478001e1b191556f3f589a4c87c57146cf'),
      ('kitchen@dineflow.com', 'Dine Flow Kitchen', 'kitchen', 'scrypt:5415e35b68d64f8aec7acaf4a82d37e1:501e3518bd96c73b3e81348fac7c8c91ff4c2fd8ab38cf31df64221310d313cdd34953189cac57ae5657d79f6074a7891f1f4176a03a01876ebf1943b80a4666')
  ) as staff(email, full_name, role, password_hash)
where not exists (
  select 1
  from staff_members
  where staff_members.eatery_id = demo.id
    and lower(staff_members.email) = lower(staff.email)
);