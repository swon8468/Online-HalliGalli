create table if not exists public.client_diagnostics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  environment text not null check (environment in ('development', 'production', 'unknown')),
  severity text not null check (severity in ('info', 'warning', 'error', 'critical')),
  category text not null check (category ~ '^[a-z0-9_]{3,64}$'),
  request_id uuid not null,
  game_id uuid references public.games(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  action_id uuid,
  card_id uuid,
  reconnect_count integer check (reconnect_count is null or reconnect_count between 0 and 10000),
  pwa_version text not null check (length(pwa_version) between 1 and 64),
  app_build_version text not null check (length(app_build_version) between 1 and 64),
  browser_family text not null check (browser_family in ('chromium', 'firefox', 'safari', 'other')),
  os_family text not null check (os_family in ('android', 'ios', 'macos', 'windows', 'linux', 'other'))
);

create index if not exists client_diagnostics_trace_idx
  on public.client_diagnostics(game_id, created_at desc);
create index if not exists client_diagnostics_category_idx
  on public.client_diagnostics(environment, severity, category, created_at desc);
alter table public.client_diagnostics enable row level security;
revoke all on table public.client_diagnostics from public, anon, authenticated;

create or replace function public.record_client_diagnostic(
  p_environment text,
  p_severity text,
  p_category text,
  p_request_id uuid,
  p_game_id uuid default null,
  p_room_id uuid default null,
  p_action_id uuid default null,
  p_card_id uuid default null,
  p_reconnect_count integer default null,
  p_pwa_version text default 'unknown',
  p_app_build_version text default 'unknown',
  p_browser_family text default 'other',
  p_os_family text default 'other'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  diagnostic_id uuid;
begin
  if auth.uid() is null or not public.profile_is_active(auth.uid()) then
    raise exception 'active authentication required';
  end if;
  if p_game_id is not null and not public.is_game_member(p_game_id) then
    raise exception 'not a game member';
  end if;
  if p_room_id is not null and not public.is_room_member(p_room_id) then
    raise exception 'not a room member';
  end if;

  insert into public.client_diagnostics(
    user_id, environment, severity, category, request_id,
    game_id, room_id, action_id, card_id, reconnect_count,
    pwa_version, app_build_version, browser_family, os_family
  ) values (
    auth.uid(),
    case when p_environment in ('development', 'production') then p_environment else 'unknown' end,
    case when p_severity in ('info', 'warning', 'error', 'critical') then p_severity else 'error' end,
    lower(regexp_replace(p_category, '[^a-zA-Z0-9_]', '_', 'g')),
    p_request_id,
    p_game_id, p_room_id, p_action_id, p_card_id, p_reconnect_count,
    left(coalesce(nullif(p_pwa_version, ''), 'unknown'), 64),
    left(coalesce(nullif(p_app_build_version, ''), 'unknown'), 64),
    case when p_browser_family in ('chromium', 'firefox', 'safari') then p_browser_family else 'other' end,
    case when p_os_family in ('android', 'ios', 'macos', 'windows', 'linux') then p_os_family else 'other' end
  )
  returning id into diagnostic_id;
  return diagnostic_id;
end;
$$;

revoke all on function public.record_client_diagnostic(text,text,text,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text) from public, anon;
grant execute on function public.record_client_diagnostic(text,text,text,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text) to authenticated;

comment on table public.client_diagnostics is
  'PII-minimized client reliability events. Never stores tokens, email addresses, passwords, free-form errors, or full user-agent strings.';
