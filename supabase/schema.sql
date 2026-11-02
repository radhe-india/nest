-- Nest: household money tracker
-- Run this once in Supabase → SQL Editor → New query → paste → Run.
-- It creates the tables, locks them so only people on the members list can
-- read or write, and adds the default categories.

-- ---------- members (who may use the app) ----------
create table if not exists public.members (
  email  text primary key,
  person text not null check (person in ('me','trisha')),
  name   text not null
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- settings (names, payment methods, skip words) ----------
create table if not exists public.settings (
  key   text primary key,
  value jsonb not null
);

-- ---------- categories ----------
create table if not exists public.categories (
  id       text primary key,
  name     text not null,
  kind     text not null check (kind in ('spent','in','saved')),
  scope    text not null default 'home' check (scope in ('home','business')),
  icon     text not null default 'dots',
  color    text not null default '#6B7394',
  budget   numeric(12,2) not null default 0,
  sort     int not null default 0,
  archived boolean not null default false
);

-- ---------- goals ----------
create table if not exists public.goals (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  target       numeric(12,2) not null default 0,
  start_amount numeric(12,2) not null default 0,
  target_date  date,
  icon         text not null default 'target',
  color        text not null default '#4A3DE0',
  sort         int not null default 0,
  archived     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ---------- entries (every rupee in, out or saved) ----------
create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default current_date,
  kind        text not null check (kind in ('spent','in','saved')),
  amount      numeric(12,2) not null check (amount > 0),
  category_id text references public.categories(id) on update cascade on delete set null,
  goal_id     uuid references public.goals(id) on delete set null,
  note        text not null default '',
  who         text not null default 'joint' check (who in ('me','trisha','joint')),
  scope       text not null default 'home' check (scope in ('home','business')),
  paid_with   text not null default '',
  source      text not null default 'manual',
  import_key  text unique,
  created_by  text default (auth.jwt() ->> 'email'),
  created_at  timestamptz not null default now()
);
create index if not exists entries_date_idx on public.entries (date);

-- ---------- quick-add presets ----------
create table if not exists public.presets (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  kind        text not null check (kind in ('spent','in','saved')),
  amount      numeric(12,2),
  category_id text references public.categories(id) on update cascade on delete cascade,
  goal_id     uuid references public.goals(id) on delete set null,
  note        text not null default '',
  who         text not null default 'joint' check (who in ('me','trisha','joint')),
  scope       text not null default 'home' check (scope in ('home','business')),
  sort        int not null default 0
);

-- ---------- auto-categorise rules (used by imports) ----------
create table if not exists public.rules (
  id          uuid primary key default gen_random_uuid(),
  match       text not null unique,
  category_id text not null references public.categories(id) on update cascade on delete cascade
);

-- ---------- security: only members can read or write ----------
alter table public.members    enable row level security;
alter table public.settings   enable row level security;
alter table public.categories enable row level security;
alter table public.goals      enable row level security;
alter table public.entries    enable row level security;
alter table public.presets    enable row level security;
alter table public.rules      enable row level security;

drop policy if exists "members read" on public.members;
create policy "members read" on public.members for select to authenticated using (public.is_member());

do $$
declare t text;
begin
  foreach t in array array['settings','categories','goals','entries','presets','rules'] loop
    execute format('drop policy if exists "members all" on public.%I', t);
    execute format('create policy "members all" on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

-- live updates, so an entry Trisha adds shows up on your phone straight away
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.entries'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.goals'; exception when others then null; end;
end $$;

-- ---------- default categories ----------
insert into public.categories (id, name, kind, scope, icon, color, sort) values
  -- spent
  ('rent','Rent & home','spent','home','home','#5A4FF0',1),
  ('groceries','Groceries','spent','home','cart','#1F9D55',2),
  ('food','Food & dining','spent','home','food','#EA6C2B',3),
  ('bills','Bills & subscriptions','spent','home','bolt','#C99412',4),
  ('transport','Transport','spent','home','car','#2F7BEA',5),
  ('shopping','Shopping','spent','home','bag','#D2459B',6),
  ('health','Health','spent','home','heart','#DF4652',7),
  ('travel','Travel','spent','home','plane','#0A95C9',8),
  ('fun','Entertainment','spent','home','film','#0E9F9A',9),
  ('isha','Isha & spiritual','spent','home','lotus','#8D5CF6',10),
  ('milo','Milo','spent','home','paw','#9C6B2E',11),
  ('gifts','Gifts & family','spent','home','gift','#D2459B',12),
  ('other','Other','spent','home','dots','#6B7394',13),
  -- came in
  ('salary','Salary','in','home','wallet','#1F9D55',20),
  ('interest','Interest & dividends','in','home','percent','#0E9F9A',21),
  ('refunds','Refunds & cashback','in','home','refund','#2F7BEA',22),
  ('other_in','Other income','in','home','dots','#6B7394',23),
  -- saved
  ('sip','SIP & mutual funds','saved','home','chart','#4A3DE0',30),
  ('stocks','Stocks','saved','home','up','#0E9F9A',31),
  ('fd','Emergency fund & FD','saved','home','key','#C99412',32),
  ('goal','Towards a goal','saved','home','target','#D2459B',33),
  -- yoga business
  ('b_fees','Class fees','in','business','lotus','#1F9D55',40),
  ('b_retreats','Retreats','in','business','leaf','#0E9F9A',41),
  ('b_modules','Online modules','in','business','phone','#2F7BEA',42),
  ('b_products','Product sales','in','business','bag','#D2459B',43),
  ('b_other_in','Other business income','in','business','dots','#6B7394',44),
  ('b_inventory','Inventory','spent','business','tag','#C99412',50),
  ('b_venue','Studio & venue','spent','business','home','#5A4FF0',51),
  ('b_marketing','Marketing','spent','business','sparkle','#EA6C2B',52),
  ('b_tools','Software & tools','spent','business','phone','#0A95C9',53),
  ('b_travel','Business travel','spent','business','plane','#8D5CF6',54),
  ('b_other','Other business costs','spent','business','dots','#6B7394',55)
on conflict (id) do nothing;
