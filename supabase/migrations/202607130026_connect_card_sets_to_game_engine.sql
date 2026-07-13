alter table public.games
  add column if not exists card_set_id uuid references public.card_sets(id) on delete restrict,
  add column if not exists card_set_version integer,
  add column if not exists card_set_snapshot jsonb;

create or replace function public.deal_game_card_snapshot(
  p_game_id uuid,
  p_player_ids uuid[],
  p_snapshot jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  player_count integer := coalesce(array_length(p_player_ids, 1), 0);
  dealt_count integer;
begin
  if player_count < 2 or jsonb_typeof(p_snapshot -> 'designs') <> 'array' then
    raise exception using message = 'invalid_card_set_snapshot', errcode = 'P0001';
  end if;

  with designs as (
    select
      design ->> 'fruit_type' as fruit,
      (design ->> 'fruit_count')::smallint as fruit_count,
      greatest(1, least(12, (design ->> 'quantity')::integer)) as copies
    from jsonb_array_elements(p_snapshot -> 'designs') design
    where design ->> 'fruit_type' in ('strawberry', 'banana', 'lime', 'plum')
      and (design ->> 'fruit_count')::integer between 1 and 5
      and (design ->> 'quantity')::integer between 1 and 12
  ), shuffled as (
    select fruit, fruit_count, row_number() over (order by random())::integer as rn
    from designs cross join lateral generate_series(1, copies)
  ), inserted as (
    insert into public.game_cards(game_id, holder_id, zone, pile_order, fruit, fruit_count)
    select p_game_id,
      p_player_ids[((rn - 1) % player_count) + 1],
      'draw',
      ((rn - 1) / player_count) + 1,
      fruit,
      fruit_count
    from shuffled
    returning 1
  )
  select count(*) into dealt_count from inserted;

  if dealt_count < player_count then
    raise exception using message = 'invalid_card_set_snapshot', errcode = 'P0001';
  end if;
  return dealt_count;
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
  selected_set public.card_sets;
  selected_version public.card_set_versions;
  new_game_id uuid;
  first_player uuid;
  active_count integer;
  player_ids uuid[];
begin
  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.id is null or target_room.host_id <> auth.uid() or target_room.status <> 'waiting' then
    raise exception 'only the host can start a waiting room';
  end if;

  select count(*), array_agg(user_id order by seat)
  into active_count, player_ids
  from public.room_members
  where room_id = p_room_id and kicked_at is null and left_at is null;
  if active_count < 2 then raise exception 'at least two players are required'; end if;

  if target_room.card_set_id is null then
    select * into selected_set
    from public.card_sets
    where is_platform_default and status = 'published'
    order by updated_at desc
    limit 1;
  else
    select * into selected_set
    from public.card_sets
    where id = target_room.card_set_id
      and status = 'published'
      and (is_platform_default or (target_room.space_id is not null and space_id = target_room.space_id));
  end if;
  if selected_set.id is null then raise exception using message = 'invalid_card_set', errcode = 'P0001'; end if;

  select * into selected_version
  from public.card_set_versions
  where card_set_id = selected_set.id and version = selected_set.version;
  if selected_version.id is null then raise exception using message = 'invalid_card_set_snapshot', errcode = 'P0001'; end if;

  first_player := player_ids[1];
  insert into public.games(room_id, current_turn, state, card_set_id, card_set_version, card_set_snapshot)
  values (
    p_room_id,
    first_player,
    jsonb_build_object('phase', 'playing', 'round', 1),
    selected_set.id,
    selected_version.version,
    selected_version.snapshot
  )
  returning id into new_game_id;

  insert into public.game_players(game_id, user_id, seat, card_count, last_seen_at)
  select new_game_id, user_id, seat, 0, now()
  from public.room_members
  where room_id = p_room_id and kicked_at is null and left_at is null
  order by seat;

  perform public.deal_game_card_snapshot(new_game_id, player_ids, selected_version.snapshot);
  perform public.refresh_game_snapshot(new_game_id);
  update public.rooms set status = 'playing', updated_at = now() where id = p_room_id;
  return new_game_id;
end;
$$;

create or replace function public.request_game_rematch(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  finished_game public.games;
  player_ids uuid[];
  player_seats smallint[];
  requested_count integer;
  player_count integer;
  new_game_id uuid;
  first_player uuid;
  new_snapshot jsonb;
begin
  select * into finished_game from public.games where id = p_game_id for update;
  if finished_game.id is null or finished_game.finished_at is null then raise exception 'game is not finished'; end if;
  if not public.is_game_member(p_game_id) then raise exception 'not a game member'; end if;
  if exists (select 1 from public.game_players where game_id = p_game_id and user_id = auth.uid() and abandoned_at is not null) then
    raise exception 'abandoned players cannot rematch';
  end if;

  update public.game_players set rematch_requested_at = coalesce(rematch_requested_at, now())
  where game_id = p_game_id and user_id = auth.uid();
  select array_agg(user_id order by seat), array_agg(seat order by seat), count(*), count(*) filter (where rematch_requested_at is not null)
  into player_ids, player_seats, player_count, requested_count
  from public.game_players
  where game_id = p_game_id and abandoned_at is null;

  if player_count < 2 then raise exception 'not enough players for rematch'; end if;
  if requested_count < player_count then
    update public.games set version = version + 1 where id = p_game_id;
    new_snapshot := public.refresh_game_snapshot(p_game_id);
    return jsonb_build_object('ready', false, 'state', new_snapshot);
  end if;
  if finished_game.card_set_snapshot is null then raise exception using message = 'invalid_card_set_snapshot', errcode = 'P0001'; end if;

  first_player := player_ids[1];
  insert into public.games(room_id, current_turn, state, card_set_id, card_set_version, card_set_snapshot)
  values (
    finished_game.room_id,
    first_player,
    jsonb_build_object('phase', 'playing', 'round', 1),
    finished_game.card_set_id,
    finished_game.card_set_version,
    finished_game.card_set_snapshot
  )
  returning id into new_game_id;

  insert into public.game_players(game_id, user_id, seat, card_count)
  select new_game_id, player_ids[i], player_seats[i], 0
  from generate_subscripts(player_ids, 1) as i;
  perform public.deal_game_card_snapshot(new_game_id, player_ids, finished_game.card_set_snapshot);

  new_snapshot := public.refresh_game_snapshot(new_game_id);
  update public.games
  set version = version + 1,
      state = jsonb_set(
        jsonb_set(state, '{rematchGameId}', to_jsonb(new_game_id::text), true),
        '{rematchRequestedCount}', to_jsonb(requested_count), true
      )
  where id = p_game_id;
  update public.rooms set status = 'playing', updated_at = now() where id = finished_game.room_id;
  return jsonb_build_object('ready', true, 'gameId', new_game_id, 'state', new_snapshot);
end;
$$;

revoke all on function public.deal_game_card_snapshot(uuid, uuid[], jsonb) from public;
revoke all on function public.start_room_game(uuid) from public;
revoke all on function public.request_game_rematch(uuid) from public;
grant execute on function public.start_room_game(uuid) to authenticated;
grant execute on function public.request_game_rematch(uuid) to authenticated;
