create table public.game_cards (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  holder_id uuid not null references public.profiles(id) on delete cascade,
  zone text not null check (zone in ('draw', 'face_up')),
  pile_order integer not null,
  fruit text not null check (fruit in ('strawberry', 'banana', 'lime', 'plum')),
  fruit_count smallint not null check (fruit_count between 1 and 5)
);

create index game_cards_draw_idx on public.game_cards(game_id, holder_id, zone, pile_order);
alter table public.game_cards enable row level security;

create or replace function public.refresh_game_snapshot(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  table_cards jsonb;
  fruit_totals jsonb;
  snapshot jsonb;
  active_count integer;
  winner_id uuid;
  game_version integer;
  turn_id uuid;
begin
  update public.game_players gp
  set card_count = (
    select count(*) from public.game_cards c
    where c.game_id = p_game_id and c.holder_id = gp.user_id
  )
  where gp.game_id = p_game_id;

  update public.game_players
  set eliminated_at = coalesce(eliminated_at, now())
  where game_id = p_game_id and card_count = 0;

  with top_cards as (
    select distinct on (c.holder_id)
      c.holder_id, c.fruit, c.fruit_count, gp.seat
    from public.game_cards c
    join public.game_players gp on gp.game_id = c.game_id and gp.user_id = c.holder_id
    where c.game_id = p_game_id and c.zone = 'face_up'
    order by c.holder_id, c.pile_order desc
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'userId', holder_id,
      'fruit', fruit,
      'count', fruit_count
    ) order by seat), '[]'::jsonb),
    jsonb_build_object(
      'strawberry', coalesce(sum(fruit_count) filter (where fruit = 'strawberry'), 0),
      'banana', coalesce(sum(fruit_count) filter (where fruit = 'banana'), 0),
      'lime', coalesce(sum(fruit_count) filter (where fruit = 'lime'), 0),
      'plum', coalesce(sum(fruit_count) filter (where fruit = 'plum'), 0)
    )
  into table_cards, fruit_totals
  from top_cards;

  select count(*) into active_count
  from public.game_players where game_id = p_game_id and card_count > 0;
  select user_id into winner_id
  from public.game_players where game_id = p_game_id and card_count > 0 order by seat limit 1;
  select version, current_turn into game_version, turn_id
  from public.games where id = p_game_id;

  snapshot := jsonb_build_object(
    'phase', case when active_count <= 1 then 'finished' else 'playing' end,
    'round', game_version + 1,
    'version', game_version,
    'currentTurn', turn_id,
    'table', table_cards,
    'fruitTotals', fruit_totals,
    'bellActive', (fruit_totals->>'strawberry')::int = 5
      or (fruit_totals->>'banana')::int = 5
      or (fruit_totals->>'lime')::int = 5
      or (fruit_totals->>'plum')::int = 5,
    'winnerId', case when active_count <= 1 then winner_id else null end
  );

  update public.games
  set state = snapshot,
      finished_at = case when active_count <= 1 then coalesce(finished_at, now()) else null end
  where id = p_game_id;

  if active_count <= 1 then
    update public.rooms set status = 'finished', updated_at = now()
    where id = (select room_id from public.games where id = p_game_id);
  end if;
  return snapshot;
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
  from public.room_members where room_id = p_room_id and kicked_at is null;
  if active_count < 2 then raise exception 'at least two players are required'; end if;
  first_player := player_ids[1];

  insert into public.games(room_id, current_turn, state)
  values (p_room_id, first_player, jsonb_build_object('phase', 'playing', 'round', 1))
  returning id into new_game_id;

  insert into public.game_players(game_id, user_id, seat, card_count)
  select new_game_id, user_id, seat, 0
  from public.room_members where room_id = p_room_id and kicked_at is null order by seat;

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
    'draw',
    ((rn - 1) / active_count) + 1,
    fruit,
    fruit_count
  from shuffled;

  perform public.refresh_game_snapshot(new_game_id);
  update public.rooms set status = 'playing', updated_at = now() where id = p_room_id;
  return new_game_id;
end;
$$;

create or replace function public.reveal_game_card(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_game public.games;
  selected_card public.game_cards;
  current_seat smallint;
  next_player uuid;
  snapshot jsonb;
begin
  select * into locked_game from public.games where id = p_game_id for update;
  if locked_game.id is null or locked_game.finished_at is not null then raise exception 'game is not active'; end if;
  if locked_game.current_turn <> auth.uid() then raise exception 'not your turn'; end if;
  if not public.is_game_member(p_game_id) then raise exception 'not a game member'; end if;

  select * into selected_card from public.game_cards
  where game_id = p_game_id and holder_id = auth.uid() and zone = 'draw'
  order by pile_order limit 1 for update;
  if selected_card.id is null then raise exception 'no cards to reveal'; end if;

  update public.game_cards set zone = 'face_up', pile_order = locked_game.version + 1
  where id = selected_card.id;
  select seat into current_seat from public.game_players where game_id = p_game_id and user_id = auth.uid();
  select gp.user_id into next_player
  from public.game_players gp
  where gp.game_id = p_game_id and exists (
    select 1 from public.game_cards c where c.game_id = p_game_id and c.holder_id = gp.user_id and c.zone = 'draw'
  )
  order by case when gp.seat > current_seat then 0 else 1 end, gp.seat
  limit 1;

  update public.games set version = version + 1, current_turn = coalesce(next_player, auth.uid()) where id = p_game_id;
  insert into public.game_events(game_id, user_id, event_type, payload)
  values (p_game_id, auth.uid(), 'reveal', jsonb_build_object('fruit', selected_card.fruit, 'count', selected_card.fruit_count, 'version', locked_game.version + 1));
  snapshot := public.refresh_game_snapshot(p_game_id);
  return snapshot;
end;
$$;

create or replace function public.attempt_ring(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_game public.games;
  is_valid boolean;
  round_version integer;
  snapshot jsonb;
begin
  select * into locked_game from public.games where id = p_game_id for update;
  if locked_game.id is null or locked_game.finished_at is not null then raise exception 'game is not active'; end if;
  if not public.is_game_member(p_game_id) then raise exception 'not a game member'; end if;
  round_version := locked_game.version;
  if exists (select 1 from public.game_events where game_id = p_game_id and event_type = 'ring' and (payload->>'round_version')::int = round_version) then
    return jsonb_build_object('accepted', false, 'reason', 'already_rung', 'state', locked_game.state);
  end if;
  is_valid := coalesce((locked_game.state->>'bellActive')::boolean, false);

  if is_valid then
    with collected as (
      select id, row_number() over (order by random())::integer as rn
      from public.game_cards where game_id = p_game_id and zone = 'face_up'
    ), base as (
      select coalesce(max(pile_order), 0) as max_order
      from public.game_cards where game_id = p_game_id and holder_id = auth.uid() and zone = 'draw'
    )
    update public.game_cards c
    set holder_id = auth.uid(), zone = 'draw', pile_order = base.max_order + collected.rn
    from collected, base where c.id = collected.id;
    update public.games set current_turn = auth.uid(), version = version + 1 where id = p_game_id;
  else
    with recipients as (
      select user_id, row_number() over (order by seat)::integer as rn
      from public.game_players
      where game_id = p_game_id and user_id <> auth.uid() and card_count > 0
    ), donor_cards as (
      select id, row_number() over (order by pile_order)::integer as rn
      from public.game_cards
      where game_id = p_game_id and holder_id = auth.uid() and zone = 'draw'
      order by pile_order
      limit (select count(*) from recipients)
    ), transfers as (
      select d.id, r.user_id,
        (select coalesce(max(c2.pile_order), 0) + 1 from public.game_cards c2 where c2.game_id = p_game_id and c2.holder_id = r.user_id and c2.zone = 'draw') as new_order
      from donor_cards d join recipients r using (rn)
    )
    update public.game_cards c set holder_id = transfers.user_id, pile_order = transfers.new_order
    from transfers where c.id = transfers.id;
  end if;

  insert into public.game_events(game_id, user_id, event_type, payload)
  values (p_game_id, auth.uid(), 'ring', jsonb_build_object('correct', is_valid, 'round_version', round_version));
  snapshot := public.refresh_game_snapshot(p_game_id);
  return jsonb_build_object('accepted', true, 'correct', is_valid, 'state', snapshot);
end;
$$;

revoke all on function public.refresh_game_snapshot(uuid) from public;
grant execute on function public.start_room_game(uuid) to authenticated;
grant execute on function public.reveal_game_card(uuid) to authenticated;
grant execute on function public.attempt_ring(uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.game_players;
exception when duplicate_object then null;
end $$;
