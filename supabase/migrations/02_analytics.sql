-- VejaSeuSIte CMS — analytics próprio (pageviews, eventos)
-- Aplicar depois de 00_init.sql + 01_harden.sql

-- Tabela de pageviews — uma linha por carregamento de página.
-- O 'pageend' atualiza a mesma linha (ended_at, active_ms, total_ms, max_scroll_pct).
create table if not exists public.analytics_pageviews (
  id bigserial primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  page_id uuid not null,
  session_id uuid not null,
  visitor_id uuid not null,
  path text not null,
  title text,
  referrer text,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  screen_w int,
  screen_h int,
  viewport_w int,
  viewport_h int,
  lang text,
  tz text,
  ua text,
  active_ms int,
  total_ms int,
  max_scroll_pct int,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index if not exists analytics_pageviews_page_id_uniq on public.analytics_pageviews(page_id);
create index if not exists analytics_pageviews_client_created on public.analytics_pageviews(client_id, created_at desc);
create index if not exists analytics_pageviews_path on public.analytics_pageviews(client_id, path);
create index if not exists analytics_pageviews_session on public.analytics_pageviews(client_id, session_id);

-- Tabela de eventos — clicks e marcos de scroll.
create table if not exists public.analytics_events (
  id bigserial primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  page_id uuid,
  session_id uuid not null,
  visitor_id uuid not null,
  path text not null,
  kind text not null check (kind in ('click','scroll')),
  click_kind text,
  click_text text,
  click_href text,
  scroll_pct int,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_client_created on public.analytics_events(client_id, created_at desc);
create index if not exists analytics_events_kind on public.analytics_events(client_id, kind);
create index if not exists analytics_events_path on public.analytics_events(client_id, path);

-- RLS: cliente só lê os próprios dados. Insert é via RPC security definer.
alter table public.analytics_pageviews enable row level security;
alter table public.analytics_events enable row level security;

drop policy if exists "owner reads own pageviews" on public.analytics_pageviews;
create policy "owner reads own pageviews" on public.analytics_pageviews
  for select using (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_user_id = auth.uid())
  );

drop policy if exists "owner reads own events" on public.analytics_events;
create policy "owner reads own events" on public.analytics_events
  for select using (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_user_id = auth.uid())
  );

-- Bloqueia escrita direta — só RPC ingest_analytics escreve (security definer).
drop policy if exists "deny insert pageviews" on public.analytics_pageviews;
create policy "deny insert pageviews" on public.analytics_pageviews for insert with check (false);
drop policy if exists "deny insert events" on public.analytics_events;
create policy "deny insert events" on public.analytics_events for insert with check (false);

-- Rate limit por visitor_id (não dá pra confiar 100%, mas detém spam casual).
create table if not exists public.analytics_rate (
  visitor_id uuid not null,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (visitor_id, window_start)
);
create index if not exists analytics_rate_window on public.analytics_rate(window_start);
alter table public.analytics_rate enable row level security;
drop policy if exists "deny all analytics_rate" on public.analytics_rate;
create policy "deny all analytics_rate" on public.analytics_rate for all using (false) with check (false);

-- RPC pública pra ingestão. Recebe slug do site + array de eventos.
create or replace function public.ingest_analytics(
  p_slug text,
  p_events jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_count int;
  v_event jsonb;
  v_inserted int := 0;
  v_first_visitor uuid;
  v_window timestamptz := date_trunc('minute', now());
  v_rate_count int;
  v_ua text;
begin
  if p_slug is null or length(p_slug) > 64 then
    return jsonb_build_object('error', 'invalid slug');
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return jsonb_build_object('error', 'events must be an array');
  end if;
  v_count := jsonb_array_length(p_events);
  if v_count = 0 or v_count > 50 then
    return jsonb_build_object('error', 'invalid batch size');
  end if;

  select id into v_client_id from public.clients where slug = p_slug;
  if v_client_id is null then
    return jsonb_build_object('error', 'unknown slug');
  end if;

  -- Rate limit pelo visitor_id do primeiro evento (heurística simples — 240 req/min/visitor).
  begin
    v_first_visitor := (p_events->0->>'visitor_id')::uuid;
  exception when others then
    v_first_visitor := null;
  end;
  if v_first_visitor is not null then
    insert into public.analytics_rate (visitor_id, window_start, count)
    values (v_first_visitor, v_window, 1)
    on conflict (visitor_id, window_start)
      do update set count = analytics_rate.count + 1
    returning count into v_rate_count;
    if v_rate_count > 240 then
      return jsonb_build_object('error', 'rate limit');
    end if;
  end if;

  -- User-Agent vem do header da requisição (PostgREST expõe em request.headers).
  begin
    v_ua := nullif(left((current_setting('request.headers', true)::jsonb)->>'user-agent', 300), '');
  exception when others then
    v_ua := null;
  end;

  for v_event in select * from jsonb_array_elements(p_events) loop
    declare
      v_kind text := v_event->>'kind';
      v_path text := nullif(left(v_event->>'path', 500), '');
      v_session uuid;
      v_visitor uuid;
      v_page_id uuid;
    begin
      begin v_session := (v_event->>'session_id')::uuid; exception when others then v_session := null; end;
      begin v_visitor := (v_event->>'visitor_id')::uuid; exception when others then v_visitor := null; end;
      begin v_page_id := nullif(v_event->>'page_id','')::uuid; exception when others then v_page_id := null; end;

      if v_path is null or v_session is null or v_visitor is null then
        continue;
      end if;

      if v_kind = 'pageview' then
        insert into public.analytics_pageviews (
          client_id, page_id, session_id, visitor_id, path, title,
          referrer, referrer_host,
          utm_source, utm_medium, utm_campaign, utm_term, utm_content,
          screen_w, screen_h, viewport_w, viewport_h, lang, tz, ua
        ) values (
          v_client_id, v_page_id, v_session, v_visitor, v_path,
          nullif(left(v_event->>'title', 300), ''),
          nullif(left(v_event->>'referrer', 500), ''),
          nullif(left(v_event->>'referrer_host', 200), ''),
          nullif(left(v_event->>'utm_source', 200), ''),
          nullif(left(v_event->>'utm_medium', 200), ''),
          nullif(left(v_event->>'utm_campaign', 200), ''),
          nullif(left(v_event->>'utm_term', 200), ''),
          nullif(left(v_event->>'utm_content', 200), ''),
          nullif((v_event->>'screen_w')::int, 0),
          nullif((v_event->>'screen_h')::int, 0),
          nullif((v_event->>'viewport_w')::int, 0),
          nullif((v_event->>'viewport_h')::int, 0),
          nullif(left(v_event->>'lang', 16), ''),
          nullif(left(v_event->>'tz', 64), ''),
          v_ua
        )
        on conflict (page_id) do nothing;
        v_inserted := v_inserted + 1;
      elsif v_kind = 'pageend' then
        if v_page_id is not null then
          update public.analytics_pageviews set
            active_ms = least(greatest(coalesce((v_event->>'active_ms')::int, 0), 0), 7200000),
            total_ms = least(greatest(coalesce((v_event->>'total_ms')::int, 0), 0), 7200000),
            max_scroll_pct = least(greatest(coalesce((v_event->>'max_scroll_pct')::int, 0), 0), 100),
            ended_at = now()
          where page_id = v_page_id and client_id = v_client_id;
          v_inserted := v_inserted + 1;
        end if;
      elsif v_kind in ('click', 'scroll') then
        insert into public.analytics_events (
          client_id, page_id, session_id, visitor_id, path, kind,
          click_kind, click_text, click_href, scroll_pct
        ) values (
          v_client_id, v_page_id, v_session, v_visitor, v_path, v_kind,
          nullif(left(v_event->>'click_kind', 32), ''),
          nullif(left(v_event->>'click_text', 200), ''),
          nullif(left(v_event->>'click_href', 500), ''),
          nullif(least(greatest(coalesce((v_event->>'scroll_pct')::int, 0), 0), 100), 0)
        );
        v_inserted := v_inserted + 1;
      end if;
    exception when others then
      continue;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'inserted', v_inserted);
end;
$$;

revoke all on function public.ingest_analytics(text, jsonb) from public;
grant execute on function public.ingest_analytics(text, jsonb) to anon, authenticated;

-- Limpeza periódica (retém 90 dias)
create or replace function public.cleanup_analytics()
returns void language sql as $$
  delete from public.analytics_pageviews where created_at < now() - interval '90 days';
  delete from public.analytics_events where created_at < now() - interval '90 days';
  delete from public.analytics_rate where window_start < now() - interval '1 hour';
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('hsa-cleanup-analytics', '37 4 * * *', 'select public.cleanup_analytics()');
  end if;
exception when others then
  null;
end;
$$;

-- ====== Funções de agregação para o painel admin ======
-- Todas exigem que auth.uid() = clients.owner_user_id (cliente só vê o próprio).

create or replace function public.analytics_check_owner(p_slug text)
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.clients c
  where c.slug = p_slug and c.owner_user_id = auth.uid()
  limit 1;
$$;
revoke all on function public.analytics_check_owner(text) from public;
grant execute on function public.analytics_check_owner(text) to authenticated;

create or replace function public.analytics_summary(p_slug text, p_days int default 30)
returns table(
  total_pageviews bigint,
  total_sessions bigint,
  total_visitors bigint,
  total_clicks bigint,
  avg_active_seconds numeric,
  avg_scroll_pct numeric
)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_since timestamptz := now() - (greatest(least(p_days, 365), 1) || ' days')::interval;
begin
  if v_client is null then return; end if;
  return query
  select
    (select count(*) from public.analytics_pageviews where client_id = v_client and created_at >= v_since),
    (select count(distinct session_id) from public.analytics_pageviews where client_id = v_client and created_at >= v_since),
    (select count(distinct visitor_id) from public.analytics_pageviews where client_id = v_client and created_at >= v_since),
    (select count(*) from public.analytics_events where client_id = v_client and kind = 'click' and created_at >= v_since),
    (select round(avg(active_ms)::numeric / 1000, 1) from public.analytics_pageviews where client_id = v_client and created_at >= v_since and active_ms is not null),
    (select round(avg(max_scroll_pct)::numeric, 0) from public.analytics_pageviews where client_id = v_client and created_at >= v_since and max_scroll_pct is not null);
end;
$$;
grant execute on function public.analytics_summary(text, int) to authenticated;

create or replace function public.analytics_top_paths(p_slug text, p_days int default 30, p_limit int default 20)
returns table(path text, views bigint, visitors bigint, avg_active_seconds numeric, avg_scroll_pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_since timestamptz := now() - (greatest(least(p_days, 365), 1) || ' days')::interval;
begin
  if v_client is null then return; end if;
  return query
    select pv.path,
           count(*)::bigint as views,
           count(distinct pv.visitor_id)::bigint as visitors,
           round(avg(pv.active_ms)::numeric / 1000, 1) as avg_active_seconds,
           round(avg(pv.max_scroll_pct)::numeric, 0) as avg_scroll_pct
    from public.analytics_pageviews pv
    where pv.client_id = v_client and pv.created_at >= v_since
    group by pv.path
    order by views desc
    limit greatest(least(p_limit, 100), 1);
end;
$$;
grant execute on function public.analytics_top_paths(text, int, int) to authenticated;

create or replace function public.analytics_top_sources(p_slug text, p_days int default 30, p_limit int default 20)
returns table(source text, kind text, visits bigint, visitors bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_since timestamptz := now() - (greatest(least(p_days, 365), 1) || ' days')::interval;
begin
  if v_client is null then return; end if;
  return query
    select
      coalesce(
        nullif(pv.utm_source, ''),
        nullif(pv.referrer_host, ''),
        '(direto)'
      ) as source,
      case
        when pv.utm_source is not null and pv.utm_source <> '' then 'utm'
        when pv.referrer_host is not null and pv.referrer_host <> '' then 'referrer'
        else 'direct'
      end as kind,
      count(*)::bigint as visits,
      count(distinct pv.visitor_id)::bigint as visitors
    from public.analytics_pageviews pv
    where pv.client_id = v_client and pv.created_at >= v_since
    group by 1, 2
    order by visits desc
    limit greatest(least(p_limit, 100), 1);
end;
$$;
grant execute on function public.analytics_top_sources(text, int, int) to authenticated;

create or replace function public.analytics_top_clicks(p_slug text, p_days int default 30, p_limit int default 30)
returns table(click_kind text, click_text text, click_href text, hits bigint, visitors bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_since timestamptz := now() - (greatest(least(p_days, 365), 1) || ' days')::interval;
begin
  if v_client is null then return; end if;
  return query
    select
      coalesce(ev.click_kind, 'outro') as click_kind,
      coalesce(nullif(ev.click_text, ''), '(sem texto)') as click_text,
      coalesce(ev.click_href, '') as click_href,
      count(*)::bigint as hits,
      count(distinct ev.visitor_id)::bigint as visitors
    from public.analytics_events ev
    where ev.client_id = v_client and ev.kind = 'click' and ev.created_at >= v_since
    group by 1, 2, 3
    order by hits desc
    limit greatest(least(p_limit, 200), 1);
end;
$$;
grant execute on function public.analytics_top_clicks(text, int, int) to authenticated;

create or replace function public.analytics_daily(p_slug text, p_days int default 30)
returns table(day date, views bigint, visitors bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_since timestamptz := now() - (greatest(least(p_days, 365), 1) || ' days')::interval;
begin
  if v_client is null then return; end if;
  return query
    select date_trunc('day', pv.created_at)::date as day,
           count(*)::bigint as views,
           count(distinct pv.visitor_id)::bigint as visitors
    from public.analytics_pageviews pv
    where pv.client_id = v_client and pv.created_at >= v_since
    group by 1
    order by 1 asc;
end;
$$;
grant execute on function public.analytics_daily(text, int) to authenticated;

create or replace function public.analytics_recent(p_slug text, p_limit int default 30)
returns table(
  created_at timestamptz,
  path text,
  title text,
  referrer_host text,
  utm_source text,
  active_ms int,
  max_scroll_pct int,
  visitor_id uuid
)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
begin
  if v_client is null then return; end if;
  return query
    select pv.created_at, pv.path, pv.title, pv.referrer_host, pv.utm_source,
           pv.active_ms, pv.max_scroll_pct, pv.visitor_id
    from public.analytics_pageviews pv
    where pv.client_id = v_client
    order by pv.created_at desc
    limit greatest(least(p_limit, 200), 1);
end;
$$;
grant execute on function public.analytics_recent(text, int) to authenticated;
