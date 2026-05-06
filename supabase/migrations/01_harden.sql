-- Loop 1: hardening da tabela clients
-- Aplicar depois de 00_init.sql

-- Unique constraint: user só pode ter 1 cliente
create unique index if not exists clients_owner_user_id_unique
  on public.clients(owner_user_id);

-- Unique constraint: 1 cliente por (repo_owner, repo_name)
create unique index if not exists clients_repo_unique
  on public.clients(repo_owner, repo_name);

-- Trigger: impedir mudança de campos sensíveis via UPDATE
create or replace function public.guard_clients_immutable()
returns trigger language plpgsql as $$
begin
  if new.repo_owner is distinct from old.repo_owner then
    raise exception 'repo_owner is immutable';
  end if;
  if new.repo_name is distinct from old.repo_name then
    raise exception 'repo_name is immutable';
  end if;
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'owner_user_id is immutable';
  end if;
  if new.slug is distinct from old.slug then
    raise exception 'slug is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists clients_guard_immutable on public.clients;
create trigger clients_guard_immutable
  before update on public.clients
  for each row execute function public.guard_clients_immutable();

-- Audit log table (Edge Function vai escrever aqui)
create table if not exists public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  action text not null,
  path text,
  status_code int,
  message text,
  created_at timestamptz default now()
);

create index if not exists audit_logs_user_id_idx on public.audit_logs(user_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);

alter table public.audit_logs enable row level security;

-- User vê só os próprios logs
drop policy if exists "users read own audit_logs" on public.audit_logs;
create policy "users read own audit_logs" on public.audit_logs
  for select using (auth.uid() = user_id);

-- Insert apenas via service_role (Edge Function bypassa RLS)
drop policy if exists "service inserts audit_logs" on public.audit_logs;
create policy "service inserts audit_logs" on public.audit_logs
  for insert with check (false);

-- Rate limit table (per user per minute)
create table if not exists public.rate_limit_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (user_id, window_start)
);

create index if not exists rate_limit_buckets_window_idx on public.rate_limit_buckets(window_start);

-- RPC pra incrementar atomicamente
create or replace function public.bump_rate_limit(p_user_id uuid, p_max_per_minute int)
returns table(allowed boolean, current_count int) language plpgsql as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count int;
begin
  insert into public.rate_limit_buckets (user_id, window_start, count)
  values (p_user_id, v_window, 1)
  on conflict (user_id, window_start)
    do update set count = rate_limit_buckets.count + 1
  returning count into v_count;
  return query select v_count <= p_max_per_minute, v_count;
end;
$$;

-- Cleanup buckets antigos (cron diário ou manual)
create or replace function public.cleanup_rate_limit_buckets()
returns void language sql as $$
  delete from public.rate_limit_buckets where window_start < now() - interval '1 hour';
$$;
