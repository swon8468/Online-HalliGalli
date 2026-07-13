alter table public.room_members
  add column if not exists is_ready boolean not null default false,
  add column if not exists kick_reason text;

update public.room_members set is_ready = true where role = 'host';

create or replace function public.normalize_room_member_ready()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.role = 'host' then new.is_ready := true; end if;
  return new;
end;
$$;
drop trigger if exists normalize_room_member_ready on public.room_members;
create trigger normalize_room_member_ready before insert or update of role, is_ready on public.room_members
for each row execute function public.normalize_room_member_ready();

create or replace function public.set_room_ready(p_room_id uuid, p_ready boolean)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.rooms where id = p_room_id and status = 'waiting') then
    raise exception using message = 'room_not_waiting', errcode = 'P0001';
  end if;
  update public.room_members set is_ready = case when role = 'host' then true else p_ready end, last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid() and kicked_at is null and left_at is null;
  if not found then raise exception using message = 'not_room_member', errcode = 'P0001'; end if;
  return true;
end;
$$;

create or replace function public.update_room_capacity(p_room_id uuid, p_max_players smallint)
returns public.rooms language plpgsql security definer set search_path = public
as $$
declare target_room public.rooms; member_count integer;
begin
  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.id is null or target_room.host_id <> auth.uid() then raise exception using message = 'host_only', errcode = 'P0001'; end if;
  if target_room.status <> 'waiting' then raise exception using message = 'room_not_waiting', errcode = 'P0001'; end if;
  if p_max_players not between 2 and 6 then raise exception using message = 'invalid_capacity', errcode = 'P0001'; end if;
  select count(*) into member_count from public.room_members where room_id = p_room_id and kicked_at is null and left_at is null;
  if p_max_players < member_count then raise exception using message = 'capacity_below_members', errcode = 'P0001'; end if;
  update public.rooms set max_players = p_max_players, updated_at = now() where id = p_room_id returning * into target_room;
  return target_room;
end;
$$;

create or replace function public.transfer_room_host(p_room_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare target_room public.rooms;
begin
  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.id is null or target_room.host_id <> auth.uid() then raise exception using message = 'host_only', errcode = 'P0001'; end if;
  if target_room.status <> 'waiting' then raise exception using message = 'room_not_waiting', errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_members where room_id = p_room_id and user_id = p_user_id and kicked_at is null and left_at is null) then
    raise exception using message = 'member_not_found', errcode = 'P0001';
  end if;
  if p_user_id = auth.uid() then return true; end if;
  update public.room_members set role = 'player' where room_id = p_room_id and user_id = auth.uid();
  update public.room_members set role = 'host', is_ready = true where room_id = p_room_id and user_id = p_user_id;
  update public.rooms set host_id = p_user_id, updated_at = now() where id = p_room_id;
  return true;
end;
$$;

drop function if exists public.kick_room_member(uuid, uuid);
create or replace function public.kick_room_member(p_room_id uuid, p_user_id uuid, p_reason text default '방장에 의해 강퇴됨')
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.rooms where id = p_room_id and host_id = auth.uid() and status = 'waiting') then
    raise exception using message = 'host_only', errcode = 'P0001';
  end if;
  if p_user_id = auth.uid() then raise exception using message = 'cannot_kick_host', errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 2 and 120 then raise exception using message = 'invalid_kick_reason', errcode = 'P0001'; end if;
  update public.room_members set kicked_at = now(), disconnected_at = now(), left_at = null, seat = null,
    is_ready = false, kick_reason = btrim(p_reason)
  where room_id = p_room_id and user_id = p_user_id and kicked_at is null and left_at is null;
  if not found then raise exception using message = 'member_not_found', errcode = 'P0001'; end if;
end;
$$;

create or replace function public.get_my_room_removal(p_room_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce((select jsonb_build_object('kicked', kicked_at is not null, 'reason', kick_reason, 'left', left_at is not null)
    from public.room_members where room_id = p_room_id and user_id = auth.uid()), '{}'::jsonb);
$$;

create or replace function public.close_waiting_room(p_room_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.rooms where id = p_room_id and host_id = auth.uid() and status = 'waiting' for update) then
    raise exception using message = 'host_only_or_not_waiting', errcode = 'P0001';
  end if;
  update public.rooms set status = 'closed', updated_at = now() where id = p_room_id;
  update public.room_members set left_at = now(), disconnected_at = now(), seat = null, is_ready = false where room_id = p_room_id and kicked_at is null and left_at is null;
  update public.game_invites set status = 'cancelled', updated_at = now() where room_id = p_room_id and status = 'pending';
  return true;
end;
$$;

create or replace function public.enforce_private_room_readiness()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.status = 'waiting' and new.status = 'playing' and new.kind = 'private' and exists (
    select 1 from public.room_members where room_id = new.id and kicked_at is null and left_at is null and role <> 'host' and not is_ready
  ) then raise exception using message = 'players_not_ready', errcode = 'P0001'; end if;
  return new;
end;
$$;
drop trigger if exists enforce_private_room_readiness on public.rooms;
create trigger enforce_private_room_readiness before update of status on public.rooms
for each row execute function public.enforce_private_room_readiness();

create or replace function public.reset_waiting_room_readiness()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.status <> 'waiting' and new.status = 'waiting' then
    update public.room_members set is_ready = (role = 'host') where room_id = new.id and kicked_at is null and left_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists reset_waiting_room_readiness on public.rooms;
create trigger reset_waiting_room_readiness after update of status on public.rooms
for each row execute function public.reset_waiting_room_readiness();

revoke all on function public.set_room_ready(uuid, boolean) from public;
revoke all on function public.update_room_capacity(uuid, smallint) from public;
revoke all on function public.transfer_room_host(uuid, uuid) from public;
revoke all on function public.kick_room_member(uuid, uuid, text) from public;
revoke all on function public.get_my_room_removal(uuid) from public;
revoke all on function public.close_waiting_room(uuid) from public;
grant execute on function public.set_room_ready(uuid, boolean) to authenticated;
grant execute on function public.update_room_capacity(uuid, smallint) to authenticated;
grant execute on function public.transfer_room_host(uuid, uuid) to authenticated;
grant execute on function public.kick_room_member(uuid, uuid, text) to authenticated;
grant execute on function public.get_my_room_removal(uuid) to authenticated;
grant execute on function public.close_waiting_room(uuid) to authenticated;
