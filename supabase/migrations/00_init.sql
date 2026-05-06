-- VejaSeuSIte CMS — schema inicial (executar no SQL Editor do Supabase)
-- Project: zrpirpdsplxdyniqogq

create extension if not exists "uuid-ossp";

create table if not exists public.clients (
  id uuid primary key default uuid_generate_v4(),
  slug text unique not null,
  repo_owner text not null,
  repo_name text not null,
  display_name text,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists clients_owner_user_id_idx on public.clients(owner_user_id);

alter table public.clients enable row level security;

drop policy if exists "users read own client" on public.clients;
create policy "users read own client" on public.clients
  for select using (auth.uid() = owner_user_id);

drop policy if exists "users update own client" on public.clients;
create policy "users update own client" on public.clients
  for update using (auth.uid() = owner_user_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
