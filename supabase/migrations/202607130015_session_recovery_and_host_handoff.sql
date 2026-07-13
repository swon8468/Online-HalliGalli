-- Durable room/game presence, reconnect discovery, stale-player forfeits, and
-- host handoff. Heartbeats are authoritative server timestamps; clients never
-- decide that another player is disconnected.

alter table public.room_members
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists disconnected_at timestamptz,
  add column if not exists left_at timestamptz;

alter table public.game_players
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists room_members_active_session_idx
  on public.room_members(user_id, joined_at desc)
  where kicked_at is null and left_at is null;
create index if not exists game_players_connection_idx
  on public.game_players(game_id, disconnected_at)
  where abandoned_at is null;

create or replace function public.is_room_member(p_room_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = p_user_id
      and kicked_at is null and left_at is null
  );
$$;

create or replace function public.join_private_room(p_code text)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.rooms;
  existing_member public.room_members;
  next_seat smallint;
  member_count integer;
begin
  if auth.uid() is null or p_code !~ '^[A-Z]{3}[0-9]{3}$' then raise exception 'invalid room code'; end if;
  select * into target_room from public.rooms
  where code = p_code and kind = 'private' and status = 'waiting'
  for update;
  if target_room.id is null then raise exception 'room not found'; end if;

  select * into existing_member from public.room_members
  where room_id = target_room.id and user_id = auth.uid();
  if existing_member.kicked_at is not null then raise exception 'kicked users cannot rejoin'; end if;
  if existing_member.user_id is not null and existing_member.left_at is null then
    update public.room_members set last_seen_at = now(), disconnected_at = null
    where room_id = target_room.id and user_id = auth.uid();
    return target_room;
  end if;

  select count(*) into member_count from public.room_members
  where room_id = target_room.id and kicked_at is null and left_at is null;
  if member_count >= target_room.max_players then raise exception 'room is full'; end if;
  select coalesce(min(candidate), 1)::smallint into next_seat
  from generate_series(1, target_room.max_players - 1) candidate
  where not exists (
    select 1 from public.room_members m
    where m.room_id = target_room.id and m.seat = candidate
      and m.kicked_at is null and m.left_at is null
  );
  insert into public.room_members(room_id, user_id, role, seat, last_seen_at)
  values (target_room.id, auth.uid(), 'player', next_seat, now())
  on conflict (room_id, user_id) do update
  set left_at = null, disconnected_at = null, last_seen_at = now(), joined_at = now(), seat = excluded.seat;
  return target_room;
end;
$$;

create or replace function public.kick_room_member(p_room_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.rooms where id = p_room_id and host_id = auth.uid() and status = 'waiting') then
    raise exception 'only the host can remove members from a waiting room';
  end if;
  if p_user_id = auth.uid() then raise exception 'host cannot remove self'; end if;
  update public.room_members
  set kicked_at = now(), disconnected_at = now(), left_at = null, seat = null
  where room_id = p_room_id and user_id = p_user_id
    and kicked_at is null and left_at is null;
  if not found then raise exception 'active member not found'; end if;
end;
$$;

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.rooms;
  next_host uuid;
begin
  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.id is null or not public.is_room_member(p_room_id) then raise exception 'not an active room member'; end if;

  if target_room.host_id = auth.uid() then
    select user_id into next_host from public.room_members
    where room_id = p_room_id and user_id <> auth.uid()
      and kicked_at is null and left_at is null
    order by seat nulls last, joined_at
    limit 1;
    update public.room_members
    set left_at = now(), disconnected_at = now(), seat = null, role = 'player'
    where room_id = p_room_id and user_id = auth.uid();
    if next_host is null then
      update public.rooms set status = 'closed', updated_at = now() where id = p_room_id;
    else
      update public.room_members set role = 'host' where room_id = p_room_id and user_id = next_host;
      update public.rooms set host_id = next_host, updated_at = now() where id = p_room_id;
    end if;
  else
    update public.room_members
    set left_at = now(), disconnected_at = now(), seat = null
    where room_id = p_room_id and user_id = auth.uid();
  end if;
end;
$$;

create or replace function public.start_room_game(p_room_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.rooms;
  new_game_id uuid;
  first_player uuid;
  active_count integer;
  player_ids uuid[];
begin
  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.host_id <> auth.uid() or target_room.status <> 'waiting' then
    raise exception 'only the host can start a waiting room';
  end if;
  select count(*), array_agg(user_id order by seat)
  into active_count, player_ids
  from public.room_members
  where room_id = p_room_id and kicked_at is null and left_at is null;
  if active_count < 2 then raise exception 'at least two players are required'; end if;
  first_player := player_ids[1];

  insert into public.games(room_id, current_turn, state)
  values (p_room_id, first_player, jsonb_build_object('phase', 'playing', 'round', 1))
  returning id into new_game_id;
  insert into public.game_players(game_id, user_id, seat, card_count, last_seen_at)
  select new_game_id, user_id, seat, 0, now()
  from public.room_members
  where room_id = p_room_id and kicked_at is null and left_at is null
  order by seat;

  with card_types(fruit, fruit_count, copies) as (
    values
      ('strawberry', 1, 5), ('strawberry', 2, 3), ('strawberry', 3, 3), ('strawberry', 4, 2), ('strawberry', 5, 1),
      ('banana', 1, 5), ('banana', 2, 3), ('banana', 3, 3), ('banana', 4, 2), ('banana', 5, 1),
      ('lime', 1, 5), ('lime', 2, 3), ('lime', 3, 3), ('lime', 4, 2), ('lime', 5, 1),
      ('plum', 1, 5), ('plum', 2, 3), ('plum', 3, 3), ('plum', 4, 2), ('plum', 5, 1)
  ), shuffled as (
    select fruit, fruit_count, row_number() over (order by random())::integer as rn
    from card_types cross join lateral generate_series(1, copies)
  )
  insert into public.game_cards(game_id, holder_id, zone, pile_order, fruit, fruit_count)
  select new_game_id,
    player_ids[((rn - 1) % active_count) + 1],
    'draw', ((rn - 1) / active_count) + 1, fruit, fruit_count
  from shuffled;

  perform public.refresh_game_snapshot(new_game_id);
  update public.rooms set status = 'playing', updated_at = now() where id = p_room_id;
  return new_game_id;
end;
$$;

create or replace function public.forfeit_disconnected_game_player(p_game_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_game public.games;
  actor_seat smallint;
  recipient_id uuid;
  recipient_base integer;
begin
  select * into locked_game from public.games where id = p_game_id for update;
  if locked_game.id is null or locked_game.finished_at is not null then return; end if;
  if exists (select 1 from public.game_players where game_id = p_game_id and user_id = p_user_id and abandoned_at is not null) then return; end if;

  select seat into actor_seat from public.game_players where game_id = p_game_id and user_id = p_user_id;
  if actor_seat is null then return; end if;
  update public.game_players
  set abandoned_at = now(), eliminated_at = coalesce(eliminated_at, now())
  where game_id = p_game_id and user_id = p_user_id;
  select gp.user_id into recipient_id from public.game_players gp
  where gp.game_id = p_game_id and gp.user_id <> p_user_id and gp.abandoned_at is null
  order by case when gp.seat > actor_seat then 0 else 1 end, gp.seat limit 1;

  if recipient_id is not null then
    select coalesce(max(pile_order), 0) into recipient_base from public.game_cards
    where game_id = p_game_id and holder_id = recipient_id and zone = 'draw';
    with leaving_cards as (
      select id, row_number() over (order by zone, pile_order, id)::integer as rn
      from public.game_cards where game_id = p_game_id and holder_id = p_user_id
    )
    update public.game_cards c
    set holder_id = recipient_id, zone = 'draw', pile_order = recipient_base + leaving_cards.rn
    from leaving_cards where c.id = leaving_cards.id;
  end if;
  update public.games set version = version + 1,
    current_turn = case when current_turn = p_user_id then recipient_id else current_turn end
  where id = p_game_id;
  insert into public.game_events(game_id, user_id, event_type, payload)
  values (p_game_id, p_user_id, 'disconnect_forfeit', jsonb_build_object('reason', 'reconnect_timeout'));
  perform public.refresh_game_snapshot(p_game_id);
end;
$$;

create or replace function public.reconcile_room_connections(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.rooms;
  next_host uuid;
  stale_player record;
begin
  if not public.is_room_member(p_room_id) then raise exception 'not an active room member'; end if;
  select * into target_room from public.rooms where id = p_room_id for update;
  update public.room_members
  set disconnected_at = coalesce(disconnected_at, now())
  where room_id = p_room_id and kicked_at is null and left_at is null
    and last_seen_at < now() - interval '30 seconds';
  update public.game_players gp
  set disconnected_at = coalesce(gp.disconnected_at, now())
  from public.games g
  where g.id = gp.game_id and g.room_id = p_room_id and g.finished_at is null
    and gp.abandoned_at is null and gp.last_seen_at < now() - interval '30 seconds';

  if exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = target_room.host_id
      and disconnected_at < now() - interval '60 seconds'
      and kicked_at is null and left_at is null
  ) then
    select user_id into next_host from public.room_members
    where room_id = p_room_id and user_id <> target_room.host_id
      and kicked_at is null and left_at is null and disconnected_at is null
    order by seat nulls last, joined_at limit 1;
    if next_host is not null then
      update public.room_members set role = 'player'
      where room_id = p_room_id and user_id = target_room.host_id;
      update public.room_members set role = 'host'
      where room_id = p_room_id and user_id = next_host;
      update public.rooms set host_id = next_host, updated_at = now() where id = p_room_id;
    end if;
  end if;

  for stale_player in
    select gp.game_id, gp.user_id
    from public.game_players gp join public.games g on g.id = gp.game_id
    where g.room_id = p_room_id and g.finished_at is null
      and gp.abandoned_at is null
      and gp.disconnected_at < now() - interval '120 seconds'
    order by gp.seat
  loop
    perform public.forfeit_disconnected_game_player(stale_player.game_id, stale_player.user_id);
  end loop;
end;
$$;

create or replace function public.heartbeat_room_session(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.room_members set last_seen_at = now(), disconnected_at = null
  where room_id = p_room_id and user_id = auth.uid()
    and kicked_at is null and left_at is null;
  if not found then raise exception 'not an active room member'; end if;
  perform public.reconcile_room_connections(p_room_id);
  return jsonb_build_object('connected', true, 'serverTime', now());
end;
$$;

create or replace function public.heartbeat_game_session(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room_id uuid;
begin
  select room_id into target_room_id from public.games where id = p_game_id;
  if target_room_id is null or not public.is_game_member(p_game_id) then raise exception 'not a game member'; end if;
  update public.room_members set last_seen_at = now(), disconnected_at = null
  where room_id = target_room_id and user_id = auth.uid()
    and kicked_at is null and left_at is null;
  update public.game_players set last_seen_at = now(), disconnected_at = null
  where game_id = p_game_id and user_id = auth.uid() and abandoned_at is null;
  if not found then raise exception 'player cannot reconnect'; end if;
  perform public.reconcile_room_connections(target_room_id);
  return jsonb_build_object('connected', true, 'serverTime', now());
end;
$$;

create or replace function public.mark_room_session_disconnected(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.room_members set disconnected_at = coalesce(disconnected_at, now())
  where room_id = p_room_id and user_id = auth.uid()
    and kicked_at is null and left_at is null;
end;
$$;

create or replace function public.mark_game_session_disconnected(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target_room_id uuid;
begin
  select room_id into target_room_id from public.games where id = p_game_id;
  update public.room_members set disconnected_at = coalesce(disconnected_at, now())
  where room_id = target_room_id and user_id = auth.uid()
    and kicked_at is null and left_at is null;
  update public.game_players set disconnected_at = coalesce(disconnected_at, now())
  where game_id = p_game_id and user_id = auth.uid() and abandoned_at is null;
end;
$$;

create or replace function public.get_my_active_session()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  active_game record;
  active_room record;
begin
  if auth.uid() is null then return null; end if;
  select g.id as game_id, g.room_id into active_game
  from public.games g
  join public.game_players gp on gp.game_id = g.id and gp.user_id = auth.uid()
  join public.room_members rm on rm.room_id = g.room_id and rm.user_id = auth.uid()
  where g.finished_at is null and gp.abandoned_at is null
    and rm.kicked_at is null and rm.left_at is null
  order by g.started_at desc limit 1;
  if active_game.game_id is not null then
    return jsonb_build_object('type', 'game', 'gameId', active_game.game_id, 'roomId', active_game.room_id);
  end if;

  select r.id as room_id into active_room
  from public.rooms r join public.room_members rm on rm.room_id = r.id and rm.user_id = auth.uid()
  where r.status = 'waiting' and rm.kicked_at is null and rm.left_at is null
  order by rm.joined_at desc limit 1;
  if active_room.room_id is not null then
    return jsonb_build_object('type', 'room', 'roomId', active_room.room_id);
  end if;
  return null;
end;
$$;

revoke all on function public.forfeit_disconnected_game_player(uuid, uuid) from public, anon, authenticated;
grant execute on function public.join_private_room(text) to authenticated;
grant execute on function public.kick_room_member(uuid, uuid) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.start_room_game(uuid) to authenticated;
grant execute on function public.reconcile_room_connections(uuid) to authenticated;
grant execute on function public.heartbeat_room_session(uuid) to authenticated;
grant execute on function public.heartbeat_game_session(uuid) to authenticated;
grant execute on function public.mark_room_session_disconnected(uuid) to authenticated;
grant execute on function public.mark_game_session_disconnected(uuid) to authenticated;
grant execute on function public.get_my_active_session() to authenticated;
