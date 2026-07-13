-- Complete the authoritative game lifecycle: draw-pile based elimination,
-- deterministic results, idempotent actions, forfeits, and unanimous rematches.

alter table public.games drop constraint if exists games_room_id_key;
create unique index if not exists games_one_active_per_room_idx
  on public.games(room_id) where finished_at is null;

alter table public.game_players
  add column if not exists abandoned_at timestamptz,
  add column if not exists rematch_requested_at timestamptz,
  add column if not exists final_rank smallint,
  add column if not exists revealed_cards integer not null default 0,
  add column if not exists correct_rings integer not null default 0,
  add column if not exists wrong_rings integer not null default 0,
  add column if not exists cards_won integer not null default 0,
  add column if not exists cards_paid integer not null default 0;

alter table public.game_events add column if not exists action_id uuid;
create unique index if not exists game_events_action_id_idx
  on public.game_events(game_id, action_id) where action_id is not null;

create or replace function public.refresh_game_snapshot(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  table_cards jsonb;
  fruit_totals jsonb;
  last_result jsonb;
  player_results jsonb;
  snapshot jsonb;
  active_count integer;
  rematch_count integer;
  total_players integer;
  winner_id uuid;
  game_version integer;
  turn_id uuid;
  bell_active boolean;
  should_finish boolean;
begin
  -- card_count means drawable cards. Face-up cards stay on the table and are
  -- intentionally excluded so the client never offers an impossible reveal.
  update public.game_players gp
  set card_count = (
    select count(*) from public.game_cards c
    where c.game_id = p_game_id
      and c.holder_id = gp.user_id
      and c.zone = 'draw'
  )
  where gp.game_id = p_game_id;

  update public.game_players
  set eliminated_at = case
    when abandoned_at is not null then coalesce(eliminated_at, abandoned_at)
    when card_count = 0 then coalesce(eliminated_at, now())
    else null
  end
  where game_id = p_game_id;

  with top_cards as (
    select distinct on (c.holder_id)
      c.holder_id, c.fruit, c.fruit_count, gp.seat
    from public.game_cards c
    join public.game_players gp
      on gp.game_id = c.game_id and gp.user_id = c.holder_id
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

  bell_active := (fruit_totals->>'strawberry')::int = 5
    or (fruit_totals->>'banana')::int = 5
    or (fruit_totals->>'lime')::int = 5
    or (fruit_totals->>'plum')::int = 5;

  select jsonb_build_object(
    'type', event_type,
    'userId', user_id,
    'correct', case when event_type = 'ring' then (payload->>'correct')::boolean else null end,
    'fruit', payload->>'fruit',
    'count', case when payload ? 'count' then (payload->>'count')::integer else null end
  ) into last_result
  from public.game_events
  where game_id = p_game_id
  order by id desc
  limit 1;

  select count(*) into active_count
  from public.game_players
  where game_id = p_game_id and abandoned_at is null and card_count > 0;

  select count(*), count(*) filter (where rematch_requested_at is not null)
  into total_players, rematch_count
  from public.game_players
  where game_id = p_game_id and abandoned_at is null;

  select version, current_turn into game_version, turn_id
  from public.games where id = p_game_id;

  -- If the last reveal creates an exact five, keep the short bell window open.
  -- Otherwise one drawable player (or none) is a terminal state.
  should_finish := active_count <= 1 and not bell_active;

  if should_finish then
    select ranked.user_id into winner_id
    from (
      select gp.user_id,
        row_number() over (
          order by (gp.abandoned_at is not null),
            count(c.id) desc,
            gp.cards_won desc,
            gp.seat
        ) as rank
      from public.game_players gp
      left join public.game_cards c
        on c.game_id = gp.game_id and c.holder_id = gp.user_id
      where gp.game_id = p_game_id
      group by gp.user_id, gp.abandoned_at, gp.cards_won, gp.seat
    ) ranked
    where ranked.rank = 1;

    with rankings as (
      select gp.user_id,
        row_number() over (
          order by (gp.abandoned_at is not null),
            count(c.id) desc,
            gp.cards_won desc,
            gp.seat
        )::smallint as rank
      from public.game_players gp
      left join public.game_cards c
        on c.game_id = gp.game_id and c.holder_id = gp.user_id
      where gp.game_id = p_game_id
      group by gp.user_id, gp.abandoned_at, gp.cards_won, gp.seat
    )
    update public.game_players gp set final_rank = rankings.rank
    from rankings
    where gp.game_id = p_game_id and gp.user_id = rankings.user_id;
  else
    winner_id := null;
  end if;

  with totals as (
    select gp.user_id, count(c.id)::integer as total_owned
    from public.game_players gp
    left join public.game_cards c
      on c.game_id = gp.game_id and c.holder_id = gp.user_id
    where gp.game_id = p_game_id
    group by gp.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', gp.user_id,
    'cardCount', gp.card_count,
    'totalOwned', totals.total_owned,
    'eliminated', gp.eliminated_at is not null,
    'abandoned', gp.abandoned_at is not null,
    'rank', gp.final_rank,
    'revealedCards', gp.revealed_cards,
    'correctRings', gp.correct_rings,
    'wrongRings', gp.wrong_rings,
    'cardsWon', gp.cards_won,
    'cardsPaid', gp.cards_paid,
    'rematchRequested', gp.rematch_requested_at is not null
  ) order by gp.seat), '[]'::jsonb)
  into player_results
  from public.game_players gp
  join totals on totals.user_id = gp.user_id
  where gp.game_id = p_game_id;

  snapshot := jsonb_build_object(
    'phase', case when should_finish then 'finished' else 'playing' end,
    'round', game_version + 1,
    'version', game_version,
    'currentTurn', turn_id,
    'table', table_cards,
    'fruitTotals', fruit_totals,
    'bellActive', bell_active,
    'winnerId', winner_id,
    'lastResult', last_result,
    'playerResults', player_results,
    'rematchRequestedCount', rematch_count,
    'rematchPlayerCount', total_players
  );

  update public.games
  set state = snapshot,
      finished_at = case when should_finish then coalesce(finished_at, now()) else null end
  where id = p_game_id;

  if should_finish then
    update public.rooms set status = 'finished', updated_at = now()
    where id = (select room_id from public.games where id = p_game_id);
  end if;
  return snapshot;
end;
$$;

drop function if exists public.reveal_game_card(uuid);
create function public.reveal_game_card(p_game_id uuid, p_action_id uuid default null)
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
  if locked_game.id is null then raise exception 'game not found'; end if;
  if not public.is_game_member(p_game_id) then raise exception 'not a game member'; end if;
  if exists (
    select 1 from public.game_events
    where game_id = p_game_id and action_id = p_action_id and p_action_id is not null
  ) then return locked_game.state; end if;
  if locked_game.finished_at is not null then raise exception 'game is not active'; end if;
  if exists (
    select 1 from public.game_players
    where game_id = p_game_id and user_id = auth.uid() and abandoned_at is not null
  ) then raise exception 'player abandoned'; end if;
  if locked_game.current_turn <> auth.uid() then raise exception 'not your turn'; end if;

  select * into selected_card from public.game_cards
  where game_id = p_game_id and holder_id = auth.uid() and zone = 'draw'
  order by pile_order limit 1 for update;
  if selected_card.id is null then raise exception 'no cards to reveal'; end if;

  update public.game_cards set zone = 'face_up', pile_order = locked_game.version + 1
  where id = selected_card.id;
  update public.game_players set revealed_cards = revealed_cards + 1
  where game_id = p_game_id and user_id = auth.uid();

  select seat into current_seat from public.game_players
  where game_id = p_game_id and user_id = auth.uid();
  select gp.user_id into next_player
  from public.game_players gp
  where gp.game_id = p_game_id
    and gp.abandoned_at is null
    and exists (
      select 1 from public.game_cards c
      where c.game_id = p_game_id and c.holder_id = gp.user_id and c.zone = 'draw'
    )
  order by case when gp.seat > current_seat then 0 else 1 end, gp.seat
  limit 1;

  update public.games
  set version = version + 1, current_turn = coalesce(next_player, auth.uid())
  where id = p_game_id;
  insert into public.game_events(game_id, user_id, event_type, action_id, payload)
  values (p_game_id, auth.uid(), 'reveal', p_action_id, jsonb_build_object(
    'fruit', selected_card.fruit,
    'count', selected_card.fruit_count,
    'version', locked_game.version + 1
  ));
  snapshot := public.refresh_game_snapshot(p_game_id);
  return snapshot;
end;
$$;

drop function if exists public.attempt_ring(uuid);
create function public.attempt_ring(p_game_id uuid, p_action_id uuid default null)
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
  moved_count integer := 0;
  duplicate_correct boolean;
begin
  select * into locked_game from public.games where id = p_game_id for update;
  if locked_game.id is null then raise exception 'game not found'; end if;
  if not public.is_game_member(p_game_id) then raise exception 'not a game member'; end if;
  if exists (
    select 1 from public.game_events
    where game_id = p_game_id and action_id = p_action_id and p_action_id is not null
  ) then
    select (payload->>'correct')::boolean into duplicate_correct
    from public.game_events where game_id = p_game_id and action_id = p_action_id;
    return jsonb_build_object('accepted', true, 'duplicate', true, 'correct', duplicate_correct, 'state', locked_game.state);
  end if;
  if locked_game.finished_at is not null then raise exception 'game is not active'; end if;
  if exists (
    select 1 from public.game_players
    where game_id = p_game_id and user_id = auth.uid() and abandoned_at is not null
  ) then raise exception 'player abandoned'; end if;

  round_version := locked_game.version;
  if exists (
    select 1 from public.game_events
    where game_id = p_game_id and event_type = 'ring'
      and (payload->>'round_version')::int = round_version
  ) then
    return jsonb_build_object('accepted', false, 'reason', 'already_rung', 'state', locked_game.state);
  end if;
  is_valid := coalesce((locked_game.state->>'bellActive')::boolean, false);

  if is_valid then
    select count(*) into moved_count from public.game_cards
    where game_id = p_game_id and zone = 'face_up';
    with collected as (
      select id, row_number() over (order by pile_order, id)::integer as rn
      from public.game_cards where game_id = p_game_id and zone = 'face_up'
    ), base as (
      select coalesce(max(pile_order), 0) as max_order
      from public.game_cards
      where game_id = p_game_id and holder_id = auth.uid() and zone = 'draw'
    )
    update public.game_cards c
    set holder_id = auth.uid(), zone = 'draw', pile_order = base.max_order + collected.rn
    from collected, base where c.id = collected.id;
    update public.game_players
    set correct_rings = correct_rings + 1, cards_won = cards_won + moved_count
    where game_id = p_game_id and user_id = auth.uid();
    update public.games set current_turn = auth.uid(), version = version + 1 where id = p_game_id;
  else
    with recipients as (
      select user_id, row_number() over (order by seat)::integer as rn
      from public.game_players
      where game_id = p_game_id
        and user_id <> auth.uid()
        and abandoned_at is null
        and card_count > 0
    ), donor_cards as (
      select id, row_number() over (order by pile_order)::integer as rn
      from public.game_cards
      where game_id = p_game_id and holder_id = auth.uid() and zone = 'draw'
      order by pile_order
      limit (select count(*) from recipients)
    ), transfers as (
      select d.id, r.user_id,
        (select coalesce(max(c2.pile_order), 0) + 1
          from public.game_cards c2
          where c2.game_id = p_game_id and c2.holder_id = r.user_id and c2.zone = 'draw') as new_order
      from donor_cards d join recipients r using (rn)
    )
    update public.game_cards c
    set holder_id = transfers.user_id, pile_order = transfers.new_order
    from transfers where c.id = transfers.id;
    get diagnostics moved_count = row_count;
    update public.game_players
    set wrong_rings = wrong_rings + 1, cards_paid = cards_paid + moved_count
    where game_id = p_game_id and user_id = auth.uid();
  end if;

  insert into public.game_events(game_id, user_id, event_type, action_id, payload)
  values (p_game_id, auth.uid(), 'ring', p_action_id, jsonb_build_object(
    'correct', is_valid,
    'round_version', case when is_valid then round_version + 1 else round_version end,
    'cards_moved', moved_count
  ));
  snapshot := public.refresh_game_snapshot(p_game_id);
  return jsonb_build_object('accepted', true, 'correct', is_valid, 'state', snapshot);
end;
$$;

create or replace function public.abandon_game(p_game_id uuid, p_action_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_game public.games;
  actor_seat smallint;
  recipient_id uuid;
  recipient_base integer;
  snapshot jsonb;
begin
  select * into locked_game from public.games where id = p_game_id for update;
  if locked_game.id is null then raise exception 'game not found'; end if;
  if not public.is_game_member(p_game_id) then raise exception 'not a game member'; end if;
  if locked_game.finished_at is not null then return locked_game.state; end if;
  if exists (
    select 1 from public.game_events
    where game_id = p_game_id and action_id = p_action_id and p_action_id is not null
  ) then return locked_game.state; end if;

  select seat into actor_seat from public.game_players
  where game_id = p_game_id and user_id = auth.uid();
  update public.game_players
  set abandoned_at = coalesce(abandoned_at, now()), eliminated_at = coalesce(eliminated_at, now())
  where game_id = p_game_id and user_id = auth.uid();

  select gp.user_id into recipient_id
  from public.game_players gp
  where gp.game_id = p_game_id and gp.user_id <> auth.uid() and gp.abandoned_at is null
  order by case when gp.seat > actor_seat then 0 else 1 end, gp.seat
  limit 1;

  if recipient_id is not null then
    select coalesce(max(pile_order), 0) into recipient_base
    from public.game_cards
    where game_id = p_game_id and holder_id = recipient_id and zone = 'draw';
    with leaving_cards as (
      select id, row_number() over (order by zone, pile_order, id)::integer as rn
      from public.game_cards where game_id = p_game_id and holder_id = auth.uid()
    )
    update public.game_cards c
    set holder_id = recipient_id, zone = 'draw', pile_order = recipient_base + leaving_cards.rn
    from leaving_cards where c.id = leaving_cards.id;
  end if;

  update public.games
  set version = version + 1,
      current_turn = case when current_turn = auth.uid() then recipient_id else current_turn end
  where id = p_game_id;
  insert into public.game_events(game_id, user_id, event_type, action_id, payload)
  values (p_game_id, auth.uid(), 'abandon', p_action_id, '{}'::jsonb);
  snapshot := public.refresh_game_snapshot(p_game_id);
  return snapshot;
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
  if exists (
    select 1 from public.game_players
    where game_id = p_game_id and user_id = auth.uid() and abandoned_at is not null
  ) then raise exception 'abandoned players cannot rematch'; end if;

  update public.game_players set rematch_requested_at = coalesce(rematch_requested_at, now())
  where game_id = p_game_id and user_id = auth.uid();
  select array_agg(user_id order by seat), array_agg(seat order by seat),
    count(*), count(*) filter (where rematch_requested_at is not null)
  into player_ids, player_seats, player_count, requested_count
  from public.game_players
  where game_id = p_game_id and abandoned_at is null;

  if player_count < 2 then raise exception 'not enough players for rematch'; end if;

  if requested_count < player_count then
    update public.games
    set version = version + 1
    where id = p_game_id;
    new_snapshot := public.refresh_game_snapshot(p_game_id);
    return jsonb_build_object('ready', false, 'state', new_snapshot);
  end if;

  first_player := player_ids[1];
  insert into public.games(room_id, current_turn, state)
  values (finished_game.room_id, first_player, jsonb_build_object('phase', 'playing', 'round', 1))
  returning id into new_game_id;

  insert into public.game_players(game_id, user_id, seat, card_count)
  select new_game_id, player_ids[i], player_seats[i], 0
  from generate_subscripts(player_ids, 1) as i;

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
    player_ids[((rn - 1) % player_count) + 1],
    'draw',
    ((rn - 1) / player_count) + 1,
    fruit,
    fruit_count
  from shuffled;

  new_snapshot := public.refresh_game_snapshot(new_game_id);
  update public.games
  set version = version + 1,
      state = jsonb_set(
        jsonb_set(state, '{rematchGameId}', to_jsonb(new_game_id::text), true),
        '{rematchRequestedCount}', to_jsonb(requested_count), true
      )
  where id = p_game_id;
  update public.rooms set status = 'playing', updated_at = now()
  where id = finished_game.room_id;
  return jsonb_build_object('ready', true, 'gameId', new_game_id, 'state', new_snapshot);
end;
$$;

revoke all on function public.refresh_game_snapshot(uuid) from public;
grant execute on function public.reveal_game_card(uuid, uuid) to authenticated;
grant execute on function public.attempt_ring(uuid, uuid) to authenticated;
grant execute on function public.abandon_game(uuid, uuid) to authenticated;
grant execute on function public.request_game_rematch(uuid) to authenticated;
