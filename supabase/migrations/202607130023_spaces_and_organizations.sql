alter table public.spaces
  add column if not exists join_code text,
  add column if not exists join_enabled boolean not null default true,
  add column if not exists archived_at timestamptz;

update public.spaces
set join_code = upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8))
where join_code is null;

alter table public.spaces
  alter column join_code set not null;

create unique index if not exists spaces_join_code_key on public.spaces(join_code);
alter table public.spaces drop constraint if exists spaces_join_code_format;
alter table public.spaces add constraint spaces_join_code_format check (join_code ~ '^[A-F0-9]{8}$');

alter table public.moderation_actions drop constraint if exists moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check
  check (action in (
    'bootstrap_super_admin', 'warn', 'suspend', 'unsuspend', 'soft_delete', 'close_room',
    'suspend_space', 'restore_space', 'role_change', 'create_admin', 'create_space',
    'update_space', 'archive_space', 'add_space_member', 'remove_space_member',
    'change_space_role', 'bulk_create_space_members'
  ));

drop policy if exists "managers update spaces" on public.spaces;
drop policy if exists "managers manage space roster" on public.space_members;

drop policy if exists "rooms readable by members or joinable code" on public.rooms;
create policy "rooms readable by participants or authorized scope"
  on public.rooms for select to authenticated
  using (
    public.is_room_member(id)
    or (status = 'waiting' and space_id is null)
    or (space_id is not null and public.is_space_member(space_id))
    or public.is_platform_admin()
  );

create policy "space managers read scoped room members"
  on public.room_members for select to authenticated
  using (
    public.is_room_member(room_id)
    or exists (
      select 1 from public.rooms r
      where r.id = room_id and r.space_id is not null and public.is_space_manager(r.space_id)
    )
  );

create policy "space managers read scoped games"
  on public.games for select to authenticated
  using (
    exists (select 1 from public.room_members m where m.room_id = room_id and m.user_id = auth.uid())
    or exists (
      select 1 from public.rooms r
      where r.id = room_id and r.space_id is not null and public.is_space_manager(r.space_id)
    )
  );

create or replace function public.join_space_by_code(p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.spaces;
begin
  if auth.uid() is null then raise exception using message = 'authentication_required', errcode = 'P0001'; end if;
  select * into target from public.spaces
  where join_code = upper(trim(p_join_code))
  for update;
  if target.id is null then raise exception using message = 'space_not_found', errcode = 'P0001'; end if;
  if target.status <> 'active' then raise exception using message = 'space_inactive', errcode = 'P0001'; end if;
  if not target.join_enabled then raise exception using message = 'space_join_disabled', errcode = 'P0001'; end if;
  insert into public.space_members(space_id, user_id, role, joined_at)
  values (target.id, auth.uid(), 'member', now())
  on conflict (space_id, user_id) do nothing;
  return jsonb_build_object('id', target.id, 'slug', target.slug, 'name', target.name, 'role', (
    select role from public.space_members where space_id = target.id and user_id = auth.uid()
  ));
end;
$$;

create or replace function public.create_space_room(p_space_id uuid, p_max_players smallint, p_card_set_id uuid default null)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  target_space public.spaces;
  new_room public.rooms;
  new_code text;
begin
  if auth.uid() is null or p_max_players not between 2 and 6 then raise exception using message = 'invalid_room_request', errcode = 'P0001'; end if;
  select * into target_space from public.spaces where id = p_space_id;
  if target_space.id is null or target_space.status <> 'active' then raise exception using message = 'space_inactive', errcode = 'P0001'; end if;
  if not public.is_space_member(p_space_id) then raise exception using message = 'space_membership_required', errcode = 'P0001'; end if;
  if p_card_set_id is not null and not exists (
    select 1 from public.card_sets where id = p_card_set_id and status = 'published' and (space_id = p_space_id or is_platform_default)
  ) then raise exception using message = 'invalid_card_set', errcode = 'P0001'; end if;
  for attempt in 1..20 loop
    new_code := public.generate_room_code();
    begin
      insert into public.rooms(code, kind, host_id, max_players, space_id, card_set_id)
      values (new_code, 'private', auth.uid(), p_max_players, p_space_id, p_card_set_id)
      returning * into new_room;
      insert into public.room_members(room_id, user_id, role, seat, is_ready, last_seen_at)
      values (new_room.id, auth.uid(), 'host', 0, true, now());
      return new_room;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception using message = 'room_code_allocation_failed', errcode = 'P0001';
end;
$$;

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
  if target_room.space_id is not null and not public.is_space_member(target_room.space_id) then
    raise exception using message = 'space_membership_required', errcode = 'P0001';
  end if;
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

revoke all on function public.join_space_by_code(text) from public;
revoke all on function public.create_space_room(uuid, smallint, uuid) from public;
grant execute on function public.join_space_by_code(text) to authenticated;
grant execute on function public.create_space_room(uuid, smallint, uuid) to authenticated;

comment on column public.spaces.join_code is '스페이스 가입 링크에 사용하는 회전 가능한 8자리 코드';
