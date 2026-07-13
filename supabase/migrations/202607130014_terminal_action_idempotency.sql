-- Idempotent retries must remain successful even when the original action was
-- the action that finished the game.

create or replace function public.reveal_game_card(p_game_id uuid, p_action_id uuid default null)
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

create or replace function public.attempt_ring(p_game_id uuid, p_action_id uuid default null)
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

grant execute on function public.reveal_game_card(uuid, uuid) to authenticated;
grant execute on function public.attempt_ring(uuid, uuid) to authenticated;
