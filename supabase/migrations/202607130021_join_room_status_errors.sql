create or replace function public.join_private_room(p_code text)
returns public.rooms language plpgsql security definer set search_path = public
as $$
declare
  target_room public.rooms;
  existing_member public.room_members;
  next_seat smallint;
  member_count integer;
begin
  if auth.uid() is null or p_code !~ '^[A-Z]{3}[0-9]{3}$' then raise exception using message = 'invalid_room_code', errcode = 'P0001'; end if;
  select * into target_room from public.rooms
  where code = p_code and kind = 'private'
  order by case status when 'waiting' then 0 when 'playing' then 1 else 2 end, updated_at desc
  limit 1 for update;
  if target_room.id is null then raise exception using message = 'room_not_found', errcode = 'P0001'; end if;
  if target_room.status = 'playing' then raise exception using message = 'room_started', errcode = 'P0001'; end if;
  if target_room.status in ('finished', 'closed') then raise exception using message = 'room_closed', errcode = 'P0001'; end if;

  select * into existing_member from public.room_members where room_id = target_room.id and user_id = auth.uid();
  if existing_member.kicked_at is not null then raise exception using message = 'kicked_users_cannot_rejoin', errcode = 'P0001'; end if;
  if existing_member.user_id is not null and existing_member.left_at is null then
    update public.room_members set last_seen_at = now(), disconnected_at = null where room_id = target_room.id and user_id = auth.uid();
    return target_room;
  end if;
  select count(*) into member_count from public.room_members where room_id = target_room.id and kicked_at is null and left_at is null;
  if member_count >= target_room.max_players then raise exception using message = 'room_full', errcode = 'P0001'; end if;
  select coalesce(min(candidate), 1)::smallint into next_seat from generate_series(1, target_room.max_players - 1) candidate
  where not exists (select 1 from public.room_members m where m.room_id = target_room.id and m.seat = candidate and m.kicked_at is null and m.left_at is null);
  insert into public.room_members(room_id, user_id, role, seat, last_seen_at, is_ready, kick_reason)
  values (target_room.id, auth.uid(), 'player', next_seat, now(), false, null)
  on conflict (room_id, user_id) do update set left_at = null, disconnected_at = null, last_seen_at = now(), joined_at = now(), seat = excluded.seat, is_ready = false, kick_reason = null;
  return target_room;
end;
$$;
revoke all on function public.join_private_room(text) from public;
grant execute on function public.join_private_room(text) to authenticated;
