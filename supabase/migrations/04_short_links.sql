-- VejaSeuSIte CMS — links curtos (rastreáveis, com UTM e contagem)
-- Aplicar depois de 03_analytics_v2.sql.

create table if not exists public.short_links (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  slug text not null,
  description text,
  target_path text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, slug),
  check (length(slug) between 1 and 48 and slug ~ '^[a-z0-9-]+$'),
  check (length(target_path) between 1 and 300)
);
create index if not exists short_links_client on public.short_links(client_id);

alter table public.short_links enable row level security;
drop policy if exists "owner reads own links" on public.short_links;
create policy "owner reads own links" on public.short_links
  for select using (exists (select 1 from public.clients c where c.id = client_id and c.owner_user_id = auth.uid()));
drop policy if exists "deny insert links" on public.short_links;
create policy "deny insert links" on public.short_links for insert with check (false);
drop policy if exists "deny update links" on public.short_links;
create policy "deny update links" on public.short_links for update using (false);
drop policy if exists "deny delete links" on public.short_links;
create policy "deny delete links" on public.short_links for delete using (false);

create table if not exists public.short_link_clicks (
  id bigserial primary key,
  link_id uuid not null references public.short_links(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  referrer_host text,
  ua text
);
create index if not exists short_link_clicks_link_created on public.short_link_clicks(link_id, created_at desc);
create index if not exists short_link_clicks_client_created on public.short_link_clicks(client_id, created_at desc);

alter table public.short_link_clicks enable row level security;
drop policy if exists "owner reads own link clicks" on public.short_link_clicks;
create policy "owner reads own link clicks" on public.short_link_clicks
  for select using (exists (select 1 from public.clients c where c.id = client_id and c.owner_user_id = auth.uid()));
drop policy if exists "deny insert link clicks" on public.short_link_clicks;
create policy "deny insert link clicks" on public.short_link_clicks for insert with check (false);

create or replace function public.set_short_link_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists short_links_updated_at on public.short_links;
create trigger short_links_updated_at before update on public.short_links
  for each row execute function public.set_short_link_updated_at();

-- =============== RPC pública: resolve link, registra clique ===============
create or replace function public.resolve_short_link(p_slug text, p_link text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_link public.short_links;
  v_ua text; v_ref text;
begin
  if p_slug is null or p_link is null then
    return jsonb_build_object('error', 'missing params');
  end if;
  if length(p_link) > 48 or p_link !~ '^[a-z0-9-]+$' then
    return jsonb_build_object('error', 'invalid link');
  end if;
  select sl.* into v_link
  from public.short_links sl
  join public.clients c on c.id = sl.client_id
  where c.slug = p_slug and sl.slug = p_link and sl.active = true
  limit 1;
  if v_link.id is null then
    return jsonb_build_object('error', 'not found');
  end if;

  begin
    v_ua := nullif(left((current_setting('request.headers', true)::jsonb)->>'user-agent', 300), '');
  exception when others then v_ua := null; end;
  begin
    v_ref := nullif(left((current_setting('request.headers', true)::jsonb)->>'referer', 500), '');
  exception when others then v_ref := null; end;

  -- Bot? não conta o clique mas ainda redireciona (para não bloquear preview).
  if not public.is_bot(v_ua) then
    insert into public.short_link_clicks (link_id, client_id, referrer_host, ua)
    values (
      v_link.id,
      v_link.client_id,
      case when v_ref is null then null
           else regexp_replace(v_ref, '^https?://([^/]+).*$', '\1')
      end,
      v_ua
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'target_path', v_link.target_path,
    'utm_source', v_link.utm_source,
    'utm_medium', v_link.utm_medium,
    'utm_campaign', v_link.utm_campaign
  );
end;
$$;
revoke all on function public.resolve_short_link(text, text) from public;
grant execute on function public.resolve_short_link(text, text) to anon, authenticated;

-- =============== CRUD pro admin (authenticated) ===============
create or replace function public.list_short_links(p_slug text)
returns table(
  id uuid,
  slug text,
  description text,
  target_path text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  clicks_total bigint,
  clicks_30d bigint,
  clicks_7d bigint,
  last_click_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
begin
  if v_client is null then return; end if;
  return query
    select sl.id, sl.slug, sl.description, sl.target_path,
           sl.utm_source, sl.utm_medium, sl.utm_campaign,
           sl.active, sl.created_at, sl.updated_at,
           coalesce((select count(*) from public.short_link_clicks c where c.link_id = sl.id), 0) as clicks_total,
           coalesce((select count(*) from public.short_link_clicks c where c.link_id = sl.id and c.created_at >= now() - interval '30 days'), 0) as clicks_30d,
           coalesce((select count(*) from public.short_link_clicks c where c.link_id = sl.id and c.created_at >= now() - interval '7 days'), 0) as clicks_7d,
           (select max(c.created_at) from public.short_link_clicks c where c.link_id = sl.id) as last_click_at
    from public.short_links sl
    where sl.client_id = v_client
    order by sl.updated_at desc;
end;
$$;
grant execute on function public.list_short_links(text) to authenticated;

create or replace function public.create_short_link(
  p_slug text, p_link text, p_description text, p_target text,
  p_utm_source text default null, p_utm_medium text default null, p_utm_campaign text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_client uuid := public.analytics_check_owner(p_slug);
  v_id uuid;
begin
  if v_client is null then return jsonb_build_object('error', 'unauthorized'); end if;
  if p_link is null or p_link !~ '^[a-z0-9-]+$' or length(p_link) > 48 then
    return jsonb_build_object('error', 'slug inválido (use só letras minúsculas, números e hífen)');
  end if;
  if p_target is null or length(p_target) > 300 then
    return jsonb_build_object('error', 'destino inválido');
  end if;
  if exists (select 1 from public.short_links where client_id = v_client and slug = p_link) then
    return jsonb_build_object('error', 'já existe um link com esse atalho');
  end if;
  insert into public.short_links (
    client_id, slug, description, target_path,
    utm_source, utm_medium, utm_campaign, active
  ) values (
    v_client, p_link, nullif(left(coalesce(p_description, ''), 200), ''), left(p_target, 300),
    nullif(left(coalesce(p_utm_source, ''), 100), ''),
    nullif(left(coalesce(p_utm_medium, ''), 100), ''),
    nullif(left(coalesce(p_utm_campaign, ''), 100), ''),
    true
  ) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
grant execute on function public.create_short_link(text, text, text, text, text, text, text) to authenticated;

create or replace function public.update_short_link(
  p_slug text, p_id uuid,
  p_link text default null, p_description text default null, p_target text default null,
  p_utm_source text default null, p_utm_medium text default null, p_utm_campaign text default null,
  p_active boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
        v_link public.short_links;
begin
  if v_client is null then return jsonb_build_object('error', 'unauthorized'); end if;
  select * into v_link from public.short_links where id = p_id and client_id = v_client;
  if v_link.id is null then return jsonb_build_object('error', 'não encontrado'); end if;
  if p_link is not null then
    if p_link !~ '^[a-z0-9-]+$' or length(p_link) > 48 then
      return jsonb_build_object('error', 'slug inválido');
    end if;
    if p_link <> v_link.slug and exists (select 1 from public.short_links where client_id = v_client and slug = p_link) then
      return jsonb_build_object('error', 'já existe um link com esse atalho');
    end if;
  end if;
  update public.short_links set
    slug = coalesce(p_link, slug),
    description = coalesce(nullif(left(coalesce(p_description, ''), 200), ''), description),
    target_path = coalesce(nullif(left(coalesce(p_target, ''), 300), ''), target_path),
    utm_source = coalesce(nullif(left(coalesce(p_utm_source, ''), 100), ''), utm_source),
    utm_medium = coalesce(nullif(left(coalesce(p_utm_medium, ''), 100), ''), utm_medium),
    utm_campaign = coalesce(nullif(left(coalesce(p_utm_campaign, ''), 100), ''), utm_campaign),
    active = coalesce(p_active, active)
  where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.update_short_link(text, uuid, text, text, text, text, text, text, boolean) to authenticated;

create or replace function public.delete_short_link(p_slug text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid := public.analytics_check_owner(p_slug);
begin
  if v_client is null then return jsonb_build_object('error', 'unauthorized'); end if;
  delete from public.short_links where id = p_id and client_id = v_client;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.delete_short_link(text, uuid) to authenticated;
