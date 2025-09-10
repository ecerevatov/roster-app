-- ========= Rozšíření =========
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ========= Tabulky =========
create table if not exists profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text unique,
  full_name  text,
  role       text not null check (role in ('manager','staff')) default 'staff',
  created_at timestamptz default now()
);

create table if not exists change_log (
  id          bigserial primary key,
  table_name  text not null,
  row_id      text,
  changed_by  uuid,
  before      jsonb,
  after       jsonb,
  changed_at  timestamptz default now()
);

create or replace function log_changes() returns trigger
language plpgsql as $$
declare key text;
begin
  key := coalesce(
    to_jsonb(new)->>'id',
    to_jsonb(old)->>'id',
    to_jsonb(new)->>'date_iso',
    to_jsonb(old)->>'date_iso'
  );
  insert into change_log(table_name,row_id,changed_by,before,after)
  values (TG_TABLE_NAME, key, auth.uid(), to_jsonb(old), to_jsonb(new));
  if TG_OP = 'DELETE' then return old; else return new; end if;
end $$;

create table if not exists roster_days (
  date_iso   date primary key,
  header     text,
  published  boolean default false,
  updated_at timestamptz default now()
);

create table if not exists roster_rows (
  id         uuid primary key default gen_random_uuid(),
  date_iso   date not null references roster_days(date_iso) on delete cascade,
  time       text,
  worker     text,
  client     text,
  address    text,
  note       text,
  "group"    text,
  sort_no    int default 0,
  updated_at timestamptz default now()
);

-- ========= Triggery =========
drop trigger if exists trg_roster_days_log on roster_days;
create trigger trg_roster_days_log
after insert or update or delete on roster_days
for each row execute function log_changes();

drop trigger if exists trg_roster_rows_log on roster_rows;
create trigger trg_roster_rows_log
after insert or update or delete on roster_rows
for each row execute function log_changes();

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_days_updated_at on roster_days;
create trigger trg_days_updated_at
before update on roster_days
for each row execute function set_updated_at();

drop trigger if exists trg_rows_updated_at on roster_rows;
create trigger trg_rows_updated_at
before update on roster_rows
for each row execute function set_updated_at();

-- ========= Indexy =========
create index if not exists idx_rows_date_sort on roster_rows(date_iso, sort_no);
create index if not exists idx_rows_date_time on roster_rows(date_iso, time);
create index if not exists idx_days_published on roster_days(published);

-- ========= RLS ON =========
alter table profiles     enable row level security;
alter table roster_days  enable row level security;
alter table roster_rows  enable row level security;
alter table change_log   enable row level security;

-- ========= Politiky =========
-- profiles: číst jen přihlášení
drop policy if exists read_profiles on profiles;
create policy read_profiles on profiles
for select using (auth.role() = 'authenticated');

-- roster_days: manažeři čtou vše
drop policy if exists days_read_managers on roster_days;
create policy days_read_managers on roster_days
for select using (
  exists(select 1 from profiles p where p.user_id = auth.uid() and p.role='manager')
);

-- roster_days: veřejné čtení jen published
drop policy if exists days_read_public_published on roster_days;
create policy days_read_public_published on roster_days
for select using (published = true);

-- roster_rows: manažeři čtou vše
drop policy if exists rows_read_managers on roster_rows;
create policy rows_read_managers on roster_rows
for select using (
  exists(select 1 from profiles p where p.user_id = auth.uid() and p.role='manager')
);

-- roster_rows: veřejné čtení jen pokud den je published
drop policy if exists rows_read_public_published on roster_rows;
create policy rows_read_public_published on roster_rows
for select using (
  exists(select 1 from roster_days d
         where d.date_iso = roster_rows.date_iso and d.published = true)
);

-- ======= Zápis (otevřeno pro anon, ať funguje realtime/autosave) =======
drop policy if exists public_rows_insert on roster_rows;
drop policy if exists public_rows_update on roster_rows;
drop policy if exists public_rows_delete on roster_rows;

create policy public_rows_insert on roster_rows
for insert with check (true);

create policy public_rows_update on roster_rows
for update using (true) with check (true);

create policy public_rows_delete on roster_rows
for delete using (true);

-- roster_days: upsert (ensureDay) potřebuje insert+update
drop policy if exists public_days_insert on roster_days;
drop policy if exists public_days_update on roster_days;

create policy public_days_insert on roster_days
for insert with check (true);

create policy public_days_update on roster_days
for update using (true) with check (true);

-- change_log: trigger smí vkládat, číst jen manažeři
drop policy if exists change_log_insert_any on change_log;
create policy change_log_insert_any on change_log
for insert with check (true);

drop policy if exists change_log_read_managers on change_log;
create policy change_log_read_managers on change_log
for select using (
  exists(select 1 from profiles p where p.user_id = auth.uid() and p.role='manager')
);

-- ========= Realtime =========
do $$ begin
  alter publication supabase_realtime add table roster_days;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table roster_rows;
exception when duplicate_object then null; end $$;