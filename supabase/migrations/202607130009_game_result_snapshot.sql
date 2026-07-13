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
    coalesce(jsonb_agg(jsonb_build_object('userId', holder_id, 'fruit', fruit, 'count', fruit_count) order by seat), '[]'::jsonb),
    jsonb_build_object(
      'strawberry', coalesce(sum(fruit_count) filter (where fruit = 'strawberry'), 0),
      'banana', coalesce(sum(fruit_count) filter (where fruit = 'banana'), 0),
      'lime', coalesce(sum(fruit_count) filter (where fruit = 'lime'), 0),
      'plum', coalesce(sum(fruit_count) filter (where fruit = 'plum'), 0)
    )
  into table_cards, fruit_totals
  from top_cards;

  select jsonb_build_object(
    'type', event_type,
    'userId', user_id,
    'correct', case when event_type = 'ring' then (payload->>'correct')::boolean else null end,
    'fruit', payload->>'fruit',
    'count', case when payload ? 'count' then (payload->>'count')::integer else null end
  ) into last_result
  from public.game_events where game_id = p_game_id order by id desc limit 1;

  select count(*) into active_count from public.game_players where game_id = p_game_id and card_count > 0;
  select user_id into winner_id from public.game_players where game_id = p_game_id and card_count > 0 order by seat limit 1;
  select version, current_turn into game_version, turn_id from public.games where id = p_game_id;

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
    'winnerId', case when active_count <= 1 then winner_id else null end,
    'lastResult', last_result
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

revoke all on function public.refresh_game_snapshot(uuid) from public;
