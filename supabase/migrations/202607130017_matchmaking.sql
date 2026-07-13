-- Atomic, recoverable matchmaking. Queue mutations are RPC-only so clients
-- cannot forge matched room/game identifiers.

alter table public.matchmaking_queue
  add column if not exists status text not null default 'waiting'
    check (status in ('waiting', 'matched')),
  add column if not exists matched_room_id uuid references public.rooms(id) on delete set null,
  add column if not exists matched_game_id uuid references public.games(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists matchmaking_queue_group_idx
  on public.matchmaking_queue(player_count, status, created_at)
  where status = 'waiting';
create index if not exists matchmaking_queue_stale_idx
  on public.matchmaking_queue(heartbeat_at)
  where status = 'waiting';

revoke insert, update, delete on public.matchmaking_queue from authenticated;

create or replace function public.matchmaking_status_for(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'status', q.status,
      'playerCount', q.player_count,
      'queueCount', case when q.status = 'waiting' then (
        select count(*) from public.matchmaking_queue peers
        where peers.player_count = q.player_count and peers.status = 'waiting'
          and peers.heartbeat_at >= now() - interval '30 seconds'
      ) else q.player_count end,
      'roomId', q.matched_room_id,
      'gameId', q.matched_game_id,
      'members', case when q.status = 'matched' then coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', rm.user_id,
          'nickname', p.nickname,
          'seat', rm.seat
        ) order by rm.seat)
        from public.room_members rm
        join public.profiles p on p.id = rm.user_id
        where rm.room_id = q.matched_room_id
          and rm.kicked_at is null and rm.left_at is null
      ), '[]'::jsonb) else '[]'::jsonb end,
      'heartbeatAt', q.heartbeat_at
    )
    from public.matchmaking_queue q where q.user_id = p_user_id
  ), jsonb_build_object('status', 'idle', 'queueCount', 0, 'members', '[]'::jsonb));
$$;

create or replace function public.get_matchmaking_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  return public.matchmaking_status_for(auth.uid());
end;
$$;

create or replace function public.join_matchmaking(p_player_count smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  opponent_ids uuid[];
  player_ids uuid[];
  new_room_id uuid;
  new_game_id uuid;
  current_status jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if p_player_count not between 2 and 6 then raise exception 'invalid player count'; end if;

  perform pg_advisory_xact_lock(hashtext('matchmaking:' || p_player_count::text));

  delete from public.matchmaking_queue
  where status = 'waiting' and heartbeat_at < now() - interval '30 seconds';

  select public.matchmaking_status_for(actor) into current_status;
  if current_status->>'status' = 'matched' and current_status->>'gameId' is not null
     and exists (select 1 from public.games where id = (current_status->>'gameId')::uuid and finished_at is null) then
    return current_status;
  end if;

  if exists (
    select 1 from public.room_members rm
    join public.rooms r on r.id = rm.room_id
    where rm.user_id = actor and rm.kicked_at is null and rm.left_at is null
      and r.status in ('waiting', 'playing')
  ) or exists (
    select 1 from public.game_players gp
    join public.games g on g.id = gp.game_id
    where gp.user_id = actor and gp.abandoned_at is null and g.finished_at is null
  ) then
    raise exception 'active room or game already exists';
  end if;

  insert into public.matchmaking_queue(
    user_id, player_count, status, heartbeat_at, created_at, updated_at,
    matched_room_id, matched_game_id
  ) values (actor, p_player_count, 'waiting', now(), now(), now(), null, null)
  on conflict (user_id) do update set
    player_count = excluded.player_count,
    status = 'waiting',
    heartbeat_at = now(),
    created_at = case
      when public.matchmaking_queue.player_count = excluded.player_count
        and public.matchmaking_queue.status = 'waiting'
      then public.matchmaking_queue.created_at else now() end,
    updated_at = now(), matched_room_id = null, matched_game_id = null;

  select coalesce(array_agg(candidate.user_id order by candidate.created_at), array[]::uuid[])
  into opponent_ids
  from (
    select q.user_id, q.created_at
    from public.matchmaking_queue q
    where q.player_count = p_player_count and q.status = 'waiting'
      and q.user_id <> actor and q.heartbeat_at >= now() - interval '30 seconds'
    order by q.created_at
    limit p_player_count - 1
    for update
  ) candidate;

  if coalesce(array_length(opponent_ids, 1), 0) < p_player_count - 1 then
    return public.matchmaking_status_for(actor);
  end if;

  player_ids := array[actor] || opponent_ids;
  insert into public.rooms(code, kind, status, host_id, max_players)
  values (null, 'matchmaking', 'waiting', actor, p_player_count)
  returning id into new_room_id;

  insert into public.room_members(room_id, user_id, role, seat, last_seen_at)
  select new_room_id, member_id,
    case when ordinal = 1 then 'host'::public.member_role else 'player'::public.member_role end,
    (ordinal - 1)::smallint, now()
  from unnest(player_ids) with ordinality as members(member_id, ordinal);

  new_game_id := public.start_room_game(new_room_id);

  update public.matchmaking_queue set
    status = 'matched', matched_room_id = new_room_id,
    matched_game_id = new_game_id, heartbeat_at = now(), updated_at = now()
  where user_id = any(player_ids);

  return public.matchmaking_status_for(actor);
end;
$$;

create or replace function public.heartbeat_matchmaking()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  queued public.matchmaking_queue;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into queued from public.matchmaking_queue where user_id = auth.uid();
  if queued.user_id is null then return public.matchmaking_status_for(auth.uid()); end if;
  if queued.status = 'matched' then return public.matchmaking_status_for(auth.uid()); end if;
  update public.matchmaking_queue set heartbeat_at = now(), updated_at = now()
  where user_id = auth.uid() and status = 'waiting';
  return public.join_matchmaking(queued.player_count);
end;
$$;

create or replace function public.cancel_matchmaking()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  queued public.matchmaking_queue;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into queued from public.matchmaking_queue where user_id = auth.uid() for update;
  if queued.user_id is null then return public.matchmaking_status_for(auth.uid()); end if;
  if queued.status = 'matched' then raise exception 'match already created'; end if;
  delete from public.matchmaking_queue where user_id = auth.uid();
  return public.matchmaking_status_for(auth.uid());
end;
$$;

grant execute on function public.get_matchmaking_status() to authenticated;
grant execute on function public.join_matchmaking(smallint) to authenticated;
grant execute on function public.heartbeat_matchmaking() to authenticated;
grant execute on function public.cancel_matchmaking() to authenticated;
revoke all on function public.matchmaking_status_for(uuid) from public;
