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
  update public.room_members set kicked_at = now(), seat = null
  where room_id = p_room_id and user_id = p_user_id and kicked_at is null;
  if not found then raise exception 'active member not found'; end if;
end;
$$;

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.rooms where id = p_room_id and host_id = auth.uid()) then
    update public.rooms set status = 'closed', updated_at = now() where id = p_room_id and status = 'waiting';
  else
    update public.room_members set kicked_at = now(), seat = null
    where room_id = p_room_id and user_id = auth.uid() and kicked_at is null;
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
begin
  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.host_id <> auth.uid() or target_room.status <> 'waiting' then raise exception 'only the host can start a waiting room'; end if;
  select count(*), min(user_id::text)::uuid into active_count, first_player
  from public.room_members where room_id = p_room_id and kicked_at is null;
  if active_count < 2 then raise exception 'at least two players are required'; end if;

  insert into public.games(room_id, current_turn, state)
  values (p_room_id, first_player, jsonb_build_object('phase', 'ready', 'round', 1))
  returning id into new_game_id;
  insert into public.game_players(game_id, user_id, seat, card_count)
  select new_game_id, user_id, seat, floor(56.0 / active_count)::integer
  from public.room_members where room_id = p_room_id and kicked_at is null order by seat;
  update public.rooms set status = 'playing', updated_at = now() where id = p_room_id;
  return new_game_id;
end;
$$;

grant execute on function public.kick_room_member(uuid, uuid) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.start_room_game(uuid) to authenticated;
