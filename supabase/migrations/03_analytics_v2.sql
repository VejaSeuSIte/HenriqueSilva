-- VejaSeuSIte CMS — analytics v2 (bot filter, engagement, funil, hot leads, comparativos)
-- Aplicar depois de 02_analytics.sql.

-- ====== Bot detection ======
create or replace function public.is_bot(p_ua text)
returns boolean language sql immutable as $$
  select case
    when p_ua is null or length(p_ua) = 0 then false
    when p_ua ~* '(bot|spider|crawl|slurp|bingpreview|yandex|baidu|duckduckbot|facebookexternalhit|whatsapp|telegrambot|twitterbot|linkedinbot|pinterest|skypeuripreview|discordbot|googlebot|adsbot|mediapartners|semrush|ahrefs|mj12bot|dotbot|petalbot|seznambot|applebot|headlesschrome|phantomjs|puppeteer|playwright|chrome-lighthouse|httpclient|curl|wget|python-requests|axios|node-fetch|go-http-client|java/|okhttp|scrapy|chatgpt|gptbot|claude-?web|claude-?bot|anthropic-ai|perplexity|cohere-ai|amazonbot|bytespider)' then true
    else false
  end;
$$;

-- ====== Colunas derivadas (computed) em pageviews ======
-- "engaged" = sinal de visita não-rasa: leu >=10s OU rolou >=50% OU clicou algo OU veio com UTM.
-- Como precisamos do "clicou algo", deixamos active_ms+max_scroll guardando o sinal direto;
-- cliques entram via update separado. Por simplicidade aqui, defino engaged como
-- expression VIEW separada — generated cols não podem referenciar outras tabelas.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'analytics_pageviews' and column_name = 'device') then
    alter table public.analytics_pageviews
      add column device text generated always as (
        case
          when viewport_w is null then null
          when viewport_w < 720 then 'mobile'
          when viewport_w < 1100 then 'tablet'
          else 'desktop'
        end
      ) stored;
    create index if not exists analytics_pageviews_device on public.analytics_pageviews(client_id, device);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'analytics_pageviews' and column_name = 'is_bot') then
    alter table public.analytics_pageviews
      add column is_bot boolean generated always as (public.is_bot(ua)) stored;
    create index if not exists analytics_pageviews_isbot on public.analytics_pageviews(client_id, is_bot);
  end if;
end $$;

-- ====== Ingest atualizado: aceita kind=lead, filtra bots ======
-- Re-cria a função inteira mantendo a assinatura.
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

  begin
    v_ua := nullif(left((current_setting('request.headers', true)::jsonb)->>'user-agent', 300), '');
  exception when others then
    v_ua := null;
  end;

  -- Bot filter cedo: se UA bate na regex, descarta tudo silenciosamente.
  if public.is_bot(v_ua) then
    return jsonb_build_object('ok', true, 'inserted', 0, 'bot', true);
  end if;

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
      elsif v_kind in ('click', 'scroll', 'lead') then
        -- 'lead' usa a mesma tabela com kind dedicado; tratamos no check da analytics_events.
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

-- Atualiza o check de kind pra incluir 'lead'
alter table public.analytics_events drop constraint if exists analytics_events_kind_check;
alter table public.analytics_events add constraint analytics_events_kind_check
  check (kind in ('click','scroll','lead'));

-- ====== View auxiliar: pageview com flag de engajamento ======
create or replace view public.analytics_pageviews_enriched as
select
  pv.*,
  (
    coalesce(pv.active_ms, 0) >= 10000
    or coalesce(pv.max_scroll_pct, 0) >= 50
    or pv.utm_source is not null
    or exists (
      select 1 from public.analytics_events ev
      where ev.page_id = pv.page_id and ev.kind in ('click','lead')
    )
  ) as engaged
from public.analytics_pageviews pv;

-- ====== Atualizar RPCs existentes para filtrar bots ======
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
    (select count(*) from public.analytics_pageviews where client_id = v_client and created_at >= v_since and not coalesce(is_bot, false)),
    (select count(distinct session_id) from public.analytics_pageviews where client_id = v_client and created_at >= v_since and not coalesce(is_bot, false)),
    (select count(distinct visitor_id) from public.analytics_pageviews where client_id = v_client and created_at >= v_since and not coalesce(is_bot, false)),
    (select count(*) from public.analytics_events where client_id = v_client and kind = 'click' and created_at >= v_since),
    (select round(avg(active_ms)::numeric / 1000, 1) from public.analytics_pageviews where client_id = v_client and created_at >= v_since and active_ms is not null and not coalesce(is_bot, false)),
    (select round(avg(max_scroll_pct)::numeric, 0) from public.analytics_pageviews where client_id = v_client and created_at >= v_since and max_scroll_pct is not null and not coalesce(is_bot, false));
end;
$$;

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
    where pv.client_id = v_client and pv.created_at >= v_since and not coalesce(pv.is_bot, false)
    group by pv.path
    order by views desc
    limit greatest(least(p_limit, 100), 1);
end;
$$;

create or replace function public.analytics_top_sources(p_slug text, p_days int default 30, p_limit int default 20)
returns table(source text, kind text, visits bigint, visitors bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_since timestamptz := now() - (greatest(least(p_days, 365), 1) || ' days')::interval;
begin
  if v_client is null then return; end if;
  return query
    select
      coalesce(nullif(pv.utm_source, ''), nullif(pv.referrer_host, ''), '(direto)') as source,
      case
        when pv.utm_source is not null and pv.utm_source <> '' then 'utm'
        when pv.referrer_host is not null and pv.referrer_host <> '' then 'referrer'
        else 'direct'
      end as kind,
      count(*)::bigint as visits,
      count(distinct pv.visitor_id)::bigint as visitors
    from public.analytics_pageviews pv
    where pv.client_id = v_client and pv.created_at >= v_since and not coalesce(pv.is_bot, false)
    group by 1, 2
    order by visits desc
    limit greatest(least(p_limit, 100), 1);
end;
$$;

create or replace function public.analytics_daily(p_slug text, p_days int default 30)
returns table(day date, views bigint, visitors bigint, engaged bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_since timestamptz := now() - (greatest(least(p_days, 365), 1) || ' days')::interval;
begin
  if v_client is null then return; end if;
  return query
    with d as (
      select generate_series(date_trunc('day', v_since)::date, date_trunc('day', now())::date, interval '1 day')::date as day
    )
    select d.day,
           coalesce(count(pv.id), 0)::bigint as views,
           coalesce(count(distinct pv.visitor_id), 0)::bigint as visitors,
           coalesce(count(*) filter (where
             coalesce(pv.active_ms, 0) >= 10000 or coalesce(pv.max_scroll_pct, 0) >= 50 or pv.utm_source is not null
           ), 0)::bigint as engaged
    from d
    left join public.analytics_pageviews pv
      on pv.client_id = v_client
      and date_trunc('day', pv.created_at)::date = d.day
      and not coalesce(pv.is_bot, false)
    group by d.day
    order by d.day asc;
end;
$$;

create or replace function public.analytics_recent(p_slug text, p_limit int default 30)
returns table(
  created_at timestamptz,
  path text,
  title text,
  referrer_host text,
  utm_source text,
  active_ms int,
  max_scroll_pct int,
  visitor_id uuid,
  device text
)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
begin
  if v_client is null then return; end if;
  return query
    select pv.created_at, pv.path, pv.title, pv.referrer_host, pv.utm_source,
           pv.active_ms, pv.max_scroll_pct, pv.visitor_id, pv.device
    from public.analytics_pageviews pv
    where pv.client_id = v_client and not coalesce(pv.is_bot, false)
    order by pv.created_at desc
    limit greatest(least(p_limit, 200), 1);
end;
$$;

-- ====== Novas RPCs ======

-- Funil: visitas → engajadas → clique de conversão (WhatsApp/tel/email/lead)
create or replace function public.analytics_funnel(p_slug text, p_days int default 30)
returns table(
  visits bigint,
  visitors bigint,
  engaged bigint,
  conv_whatsapp bigint,
  conv_tel bigint,
  conv_email bigint,
  conv_lead bigint
)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_since timestamptz := now() - (greatest(least(p_days, 365), 1) || ' days')::interval;
begin
  if v_client is null then return; end if;
  return query
    select
      (select count(*) from public.analytics_pageviews where client_id = v_client and created_at >= v_since and not coalesce(is_bot, false)),
      (select count(distinct visitor_id) from public.analytics_pageviews where client_id = v_client and created_at >= v_since and not coalesce(is_bot, false)),
      (select count(distinct pv.visitor_id) from public.analytics_pageviews pv
        where pv.client_id = v_client and pv.created_at >= v_since and not coalesce(pv.is_bot, false)
          and (
            coalesce(pv.active_ms, 0) >= 10000
            or coalesce(pv.max_scroll_pct, 0) >= 50
            or pv.utm_source is not null
            or exists(select 1 from public.analytics_events ev where ev.page_id = pv.page_id and ev.kind in ('click','lead'))
          )),
      (select count(distinct visitor_id) from public.analytics_events
        where client_id = v_client and created_at >= v_since and kind = 'click' and click_kind = 'whatsapp'),
      (select count(distinct visitor_id) from public.analytics_events
        where client_id = v_client and created_at >= v_since and kind = 'click' and click_kind = 'tel'),
      (select count(distinct visitor_id) from public.analytics_events
        where client_id = v_client and created_at >= v_since and kind = 'click' and click_kind = 'email'),
      (select count(distinct visitor_id) from public.analytics_events
        where client_id = v_client and created_at >= v_since and kind = 'lead');
end;
$$;
grant execute on function public.analytics_funnel(text, int) to authenticated;

-- Hot leads: visitantes que voltaram ≥2x ou clicaram em conversão.
create or replace function public.analytics_hot_leads(p_slug text, p_days int default 30, p_limit int default 30)
returns table(
  visitor_id uuid,
  first_seen timestamptz,
  last_seen timestamptz,
  visits bigint,
  pages_read bigint,
  total_active_seconds numeric,
  max_scroll_pct int,
  wa_clicks bigint,
  tel_clicks bigint,
  email_clicks bigint,
  leads bigint,
  top_source text,
  top_path text,
  score numeric
)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_since timestamptz := now() - (greatest(least(p_days, 365), 1) || ' days')::interval;
begin
  if v_client is null then return; end if;
  return query
    with pv as (
      select * from public.analytics_pageviews
      where client_id = v_client and created_at >= v_since and not coalesce(is_bot, false)
    ),
    ev as (
      select * from public.analytics_events
      where client_id = v_client and created_at >= v_since
    ),
    agg as (
      select
        pv.visitor_id,
        min(pv.created_at) as first_seen,
        max(pv.created_at) as last_seen,
        count(distinct pv.session_id)::bigint as visits,
        count(*)::bigint as pages_read,
        round(coalesce(sum(pv.active_ms), 0)::numeric / 1000, 1) as total_active_seconds,
        coalesce(max(pv.max_scroll_pct), 0) as max_scroll_pct,
        (select count(*) from ev where ev.visitor_id = pv.visitor_id and ev.kind = 'click' and ev.click_kind = 'whatsapp') as wa_clicks,
        (select count(*) from ev where ev.visitor_id = pv.visitor_id and ev.kind = 'click' and ev.click_kind = 'tel') as tel_clicks,
        (select count(*) from ev where ev.visitor_id = pv.visitor_id and ev.kind = 'click' and ev.click_kind = 'email') as email_clicks,
        (select count(*) from ev where ev.visitor_id = pv.visitor_id and ev.kind = 'lead') as leads
      from pv
      group by pv.visitor_id
    )
    select
      a.visitor_id,
      a.first_seen,
      a.last_seen,
      a.visits,
      a.pages_read,
      a.total_active_seconds,
      a.max_scroll_pct,
      a.wa_clicks,
      a.tel_clicks,
      a.email_clicks,
      a.leads,
      (
        select coalesce(nullif(pv2.utm_source, ''), nullif(pv2.referrer_host, ''), '(direto)')
        from public.analytics_pageviews pv2
        where pv2.client_id = v_client and pv2.visitor_id = a.visitor_id
        order by pv2.created_at asc limit 1
      ) as top_source,
      (
        select pv3.path
        from public.analytics_pageviews pv3
        where pv3.client_id = v_client and pv3.visitor_id = a.visitor_id
        group by pv3.path order by count(*) desc limit 1
      ) as top_path,
      (
        a.leads * 40
        + a.wa_clicks * 25
        + a.tel_clicks * 20
        + a.email_clicks * 15
        + greatest(a.visits - 1, 0) * 8
        + least(a.pages_read, 10) * 2
        + (case when a.max_scroll_pct >= 75 then 5 else 0 end)
      )::numeric as score
    from agg a
    where a.visits >= 2 or a.wa_clicks > 0 or a.tel_clicks > 0 or a.email_clicks > 0 or a.leads > 0
    order by score desc, a.last_seen desc
    limit greatest(least(p_limit, 100), 1);
end;
$$;
grant execute on function public.analytics_hot_leads(text, int, int) to authenticated;

-- Comparativo período atual vs período anterior (deltas %).
create or replace function public.analytics_compare(p_slug text, p_days int default 30)
returns table(
  metric text,
  current_value numeric,
  previous_value numeric,
  delta_pct numeric
)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_days int := greatest(least(p_days, 365), 1);
        v_cur_since timestamptz := now() - (v_days || ' days')::interval;
        v_prev_since timestamptz := now() - ((v_days * 2) || ' days')::interval;
        v_prev_until timestamptz := now() - (v_days || ' days')::interval;
        v_cur_views numeric;
        v_prev_views numeric;
        v_cur_vis numeric;
        v_prev_vis numeric;
        v_cur_wa numeric;
        v_prev_wa numeric;
        v_cur_active numeric;
        v_prev_active numeric;
begin
  if v_client is null then return; end if;

  select count(*) into v_cur_views from public.analytics_pageviews
    where client_id = v_client and created_at >= v_cur_since and not coalesce(is_bot, false);
  select count(*) into v_prev_views from public.analytics_pageviews
    where client_id = v_client and created_at >= v_prev_since and created_at < v_prev_until and not coalesce(is_bot, false);
  select count(distinct visitor_id) into v_cur_vis from public.analytics_pageviews
    where client_id = v_client and created_at >= v_cur_since and not coalesce(is_bot, false);
  select count(distinct visitor_id) into v_prev_vis from public.analytics_pageviews
    where client_id = v_client and created_at >= v_prev_since and created_at < v_prev_until and not coalesce(is_bot, false);
  select count(*) into v_cur_wa from public.analytics_events
    where client_id = v_client and created_at >= v_cur_since and kind = 'click' and click_kind = 'whatsapp';
  select count(*) into v_prev_wa from public.analytics_events
    where client_id = v_client and created_at >= v_prev_since and created_at < v_prev_until and kind = 'click' and click_kind = 'whatsapp';
  select coalesce(avg(active_ms), 0)/1000 into v_cur_active from public.analytics_pageviews
    where client_id = v_client and created_at >= v_cur_since and not coalesce(is_bot, false);
  select coalesce(avg(active_ms), 0)/1000 into v_prev_active from public.analytics_pageviews
    where client_id = v_client and created_at >= v_prev_since and created_at < v_prev_until and not coalesce(is_bot, false);

  return query select 'views'::text, v_cur_views, v_prev_views,
                      case when v_prev_views = 0 then null else round((v_cur_views - v_prev_views) / v_prev_views * 100, 1) end;
  return query select 'visitors'::text, v_cur_vis, v_prev_vis,
                      case when v_prev_vis = 0 then null else round((v_cur_vis - v_prev_vis) / v_prev_vis * 100, 1) end;
  return query select 'whatsapp_clicks'::text, v_cur_wa, v_prev_wa,
                      case when v_prev_wa = 0 then null else round((v_cur_wa - v_prev_wa) / v_prev_wa * 100, 1) end;
  return query select 'avg_active_seconds'::text, round(v_cur_active, 1), round(v_prev_active, 1),
                      case when v_prev_active = 0 then null else round((v_cur_active - v_prev_active) / v_prev_active * 100, 1) end;
end;
$$;
grant execute on function public.analytics_compare(text, int) to authenticated;

-- Geo aproximada via timezone + lang
create or replace function public.analytics_geo(p_slug text, p_days int default 30, p_limit int default 12)
returns table(label text, visits bigint, visitors bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_since timestamptz := now() - (greatest(least(p_days, 365), 1) || ' days')::interval;
begin
  if v_client is null then return; end if;
  return query
    select
      case
        when tz is null or tz = '' then '(desconhecido)'
        else tz
      end as label,
      count(*)::bigint,
      count(distinct visitor_id)::bigint
    from public.analytics_pageviews
    where client_id = v_client and created_at >= v_since and not coalesce(is_bot, false)
    group by 1
    order by 2 desc
    limit greatest(least(p_limit, 50), 1);
end;
$$;
grant execute on function public.analytics_geo(text, int, int) to authenticated;

-- Split por dispositivo
create or replace function public.analytics_devices(p_slug text, p_days int default 30)
returns table(device text, visits bigint, visitors bigint, avg_active_seconds numeric, avg_scroll_pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_since timestamptz := now() - (greatest(least(p_days, 365), 1) || ' days')::interval;
begin
  if v_client is null then return; end if;
  return query
    select coalesce(device, '(?)') as device,
           count(*)::bigint as visits,
           count(distinct visitor_id)::bigint as visitors,
           round(avg(active_ms)::numeric / 1000, 1) as avg_active_seconds,
           round(avg(max_scroll_pct)::numeric, 0) as avg_scroll_pct
    from public.analytics_pageviews
    where client_id = v_client and created_at >= v_since and not coalesce(is_bot, false)
    group by device
    order by visits desc;
end;
$$;
grant execute on function public.analytics_devices(text, int) to authenticated;

-- Detalhes de uma página específica (drill-down)
create or replace function public.analytics_page_detail(p_slug text, p_path text, p_days int default 30)
returns table(
  total_views bigint,
  unique_visitors bigint,
  avg_active_seconds numeric,
  avg_scroll_pct numeric,
  scroll_25 bigint,
  scroll_50 bigint,
  scroll_75 bigint,
  scroll_90 bigint,
  top_referrer text,
  top_utm text,
  total_clicks bigint,
  whatsapp_clicks bigint,
  mobile_pct numeric
)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_since timestamptz := now() - (greatest(least(p_days, 365), 1) || ' days')::interval;
        v_total numeric;
begin
  if v_client is null or p_path is null then return; end if;
  select count(*) into v_total from public.analytics_pageviews
    where client_id = v_client and path = p_path and created_at >= v_since and not coalesce(is_bot, false);
  return query
    select
      v_total::bigint,
      (select count(distinct visitor_id) from public.analytics_pageviews
        where client_id = v_client and path = p_path and created_at >= v_since and not coalesce(is_bot, false)),
      (select round(avg(active_ms)::numeric / 1000, 1) from public.analytics_pageviews
        where client_id = v_client and path = p_path and created_at >= v_since and not coalesce(is_bot, false)),
      (select round(avg(max_scroll_pct)::numeric, 0) from public.analytics_pageviews
        where client_id = v_client and path = p_path and created_at >= v_since and not coalesce(is_bot, false)),
      (select count(*) from public.analytics_pageviews
        where client_id = v_client and path = p_path and created_at >= v_since and max_scroll_pct >= 25 and not coalesce(is_bot, false)),
      (select count(*) from public.analytics_pageviews
        where client_id = v_client and path = p_path and created_at >= v_since and max_scroll_pct >= 50 and not coalesce(is_bot, false)),
      (select count(*) from public.analytics_pageviews
        where client_id = v_client and path = p_path and created_at >= v_since and max_scroll_pct >= 75 and not coalesce(is_bot, false)),
      (select count(*) from public.analytics_pageviews
        where client_id = v_client and path = p_path and created_at >= v_since and max_scroll_pct >= 90 and not coalesce(is_bot, false)),
      (select coalesce(nullif(referrer_host,''), '(direto)') from public.analytics_pageviews
        where client_id = v_client and path = p_path and created_at >= v_since and not coalesce(is_bot, false)
        group by referrer_host order by count(*) desc limit 1),
      (select utm_source from public.analytics_pageviews
        where client_id = v_client and path = p_path and created_at >= v_since and utm_source is not null and utm_source <> '' and not coalesce(is_bot, false)
        group by utm_source order by count(*) desc limit 1),
      (select count(*) from public.analytics_events
        where client_id = v_client and path = p_path and created_at >= v_since and kind = 'click'),
      (select count(*) from public.analytics_events
        where client_id = v_client and path = p_path and created_at >= v_since and kind = 'click' and click_kind = 'whatsapp'),
      (select case when v_total > 0 then round((count(*) filter (where device = 'mobile'))::numeric / v_total * 100, 0) else 0 end
        from public.analytics_pageviews
        where client_id = v_client and path = p_path and created_at >= v_since and not coalesce(is_bot, false));
end;
$$;
grant execute on function public.analytics_page_detail(text, text, int) to authenticated;

-- Export CSV de visitas individuais (até 5000 linhas)
create or replace function public.analytics_export(p_slug text, p_days int default 30, p_limit int default 5000)
returns table(
  created_at timestamptz,
  path text,
  device text,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  lang text,
  tz text,
  active_seconds numeric,
  max_scroll_pct int,
  visitor_id uuid
)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_since timestamptz := now() - (greatest(least(p_days, 365), 1) || ' days')::interval;
begin
  if v_client is null then return; end if;
  return query
    select pv.created_at, pv.path, pv.device,
           pv.referrer_host, pv.utm_source, pv.utm_medium, pv.utm_campaign,
           pv.lang, pv.tz,
           round(coalesce(pv.active_ms, 0)::numeric / 1000, 1),
           coalesce(pv.max_scroll_pct, 0),
           pv.visitor_id
    from public.analytics_pageviews pv
    where pv.client_id = v_client and pv.created_at >= v_since and not coalesce(pv.is_bot, false)
    order by pv.created_at desc
    limit greatest(least(p_limit, 5000), 1);
end;
$$;
grant execute on function public.analytics_export(text, int, int) to authenticated;
