-- Let finished-game members explicitly return to their existing waiting room.
-- The operation is idempotent and refuses to rewind a room after a rematch has
-- already created another active game.

create or replace function public.return_finished_game_to_room(p_game_id uuid)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  finished_game public.games;
  target_room public.rooms;
begin
  select * into finished_game
  from public.games
  where id = p_game_id
  for update;

  if finished_game.id is null then raise exception 'game not found'; end if;
  if finished_game.finished_at is null then raise exception 'game is not finished'; end if;
  if not public.is_game_member(p_game_id) then raise exception 'not a game member'; end if;
  if finished_game.state ? 'rematchGameId' then raise exception 'rematch already started'; end if;
  if exists (
    select 1 from public.games
    where room_id = finished_game.room_id and finished_at is null
  ) then raise exception 'room already has an active game'; end if;

  update public.rooms
  set status = 'waiting', updated_at = now()
  where id = finished_game.room_id and status <> 'closed'
  returning * into target_room;

  if target_room.id is null then raise exception 'room is closed'; end if;

  update public.game_players
  set rematch_requested_at = null
  where game_id = p_game_id;
  update public.games
  set version = version + 1,
      state = jsonb_set(
        jsonb_set(state - 'rematchGameId', '{rematchRequestedCount}', '0'::jsonb, true),
        '{rematchPlayerCount}',
        to_jsonb((select count(*) from public.game_players where game_id = p_game_id and abandoned_at is null)),
        true
      )
  where id = p_game_id;

  return target_room;
end;
$$;

revoke all on function public.return_finished_game_to_room(uuid) from public;
grant execute on function public.return_finished_game_to_room(uuid) to authenticated;
