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

grant execute on function public.attempt_ring(uuid) to authenticated;
