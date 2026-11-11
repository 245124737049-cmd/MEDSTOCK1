-- Run this entire script in Supabase Dashboard > SQL Editor.
-- Each row belongs to the authenticated user who created it.
create table if not exists public.medicines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null,
  batch text not null,
  manufacturer text default '',
  purchase numeric(12,2) not null default 0,
  price numeric(12,2) not null default 0,
  quantity integer not null default 0,
  minimum integer not null default 10,
  manufacture date,
  expiry date not null,
  created_at timestamptz not null default now(),
  unique(user_id, name, batch)
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  company text default '',
  phone text default '',
  email text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_no text not null,
  customer text not null default 'Walk-in Customer',
  sale_date date not null default current_date,
  items jsonb not null default '[]'::jsonb,
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.medicines enable row level security;
alter table public.suppliers enable row level security;
alter table public.sales enable row level security;

drop policy if exists "Users manage own medicines" on public.medicines;
create policy "Users manage own medicines" on public.medicines
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own suppliers" on public.suppliers;
create policy "Users manage own suppliers" on public.suppliers
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own sales" on public.sales;
create policy "Users manage own sales" on public.sales
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists medicines_user_id_idx on public.medicines(user_id);
create index if not exists suppliers_user_id_idx on public.suppliers(user_id);
create index if not exists sales_user_id_idx on public.sales(user_id);


-- Supplier verification and multiple medicine-offer comparison.
alter table public.suppliers add column if not exists drug_license text not null default '';
alter table public.suppliers add column if not exists gst_number text not null default '';
alter table public.suppliers add column if not exists verification_status text not null default 'pending'
  check (verification_status in ('pending','verified','unverified'));

create table if not exists public.supplier_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  medicine_name text not null,
  composition text not null,
  strength text not null,
  dosage_form text not null,
  manufacturer text not null default '',
  pack_size text not null,
  purchase_price numeric(12,2) not null check (purchase_price >= 0),
  available_stock integer not null default 0 check (available_stock >= 0),
  expiry_date date not null,
  decision_status text not null default 'pending'
    check (decision_status in ('pending','selected','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.supplier_offers enable row level security;
drop policy if exists "Users manage own supplier offers" on public.supplier_offers;
create policy "Users manage own supplier offers" on public.supplier_offers
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists supplier_offers_user_medicine_idx
  on public.supplier_offers(user_id, medicine_name, strength);
create index if not exists supplier_offers_supplier_idx
  on public.supplier_offers(supplier_id);
