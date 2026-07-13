alter table public.game_invites
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists game_invites_pending_room_pair_key
  on public.game_invites(sender_id, receiver_id, room_id) where status = 'pending';
create index if not exists game_invites_receiver_pending_idx
  on public.game_invites(receiver_id, created_at desc) where status = 'pending';
create index if not exists game_invites_sender_rate_idx
  on public.game_invites(sender_id, created_at desc);

drop policy if exists "users send invites" on public.game_invites;
drop policy if exists "receivers update invites" on public.game_invites;
revoke insert, update, delete on public.game_invites from authenticated;

create or replace function public.expire_game_invites(p_user_id uuid default auth.uid())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare affected integer;
begin
  update public.game_invites
  set status = 'cancelled', updated_at = now()
  where status = 'pending' and expires_at <= now()
    and (sender_id = p_user_id or receiver_id = p_user_id);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.get_game_invite_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare actor uuid := auth.uid(); target_room public.rooms;
begin
  if actor is null then raise exception using message = 'authentication_required', errcode = 'P0001'; end if;
  select r.* into target_room
  from public.rooms r
  join public.room_members m on m.room_id = r.id
  where m.user_id = actor and m.kicked_at is null and m.left_at is null
    and r.kind = 'private' and r.status = 'waiting'
  order by m.joined_at desc limit 1;
  if target_room.id is null then return jsonb_build_object('available', false); end if;
  return jsonb_build_object('available', true, 'roomId', target_room.id, 'roomCode', target_room.code, 'maxPlayers', target_room.max_players);
end;
$$;

create or replace function public.get_game_invites()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception using message = 'authentication_required', errcode = 'P0001'; end if;
  perform public.expire_game_invites(actor);
  return jsonb_build_object(
    'received', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'roomId', i.room_id, 'roomCode', r.code, 'roomStatus', r.status,
        'userId', p.id, 'nickname', p.nickname, 'friendTag', p.friend_tag,
        'expiresAt', i.expires_at, 'createdAt', i.created_at
      ) order by i.created_at desc)
      from public.game_invites i
      join public.rooms r on r.id = i.room_id
      join public.profiles p on p.id = i.sender_id
      where i.receiver_id = actor and i.status = 'pending' and i.expires_at > now()
    ), '[]'::jsonb),
    'sent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'roomId', i.room_id, 'roomCode', r.code, 'roomStatus', r.status,
        'userId', p.id, 'nickname', p.nickname, 'friendTag', p.friend_tag,
        'expiresAt', i.expires_at, 'createdAt', i.created_at
      ) order by i.created_at desc)
      from public.game_invites i
      join public.rooms r on r.id = i.room_id
      join public.profiles p on p.id = i.receiver_id
      where i.sender_id = actor and i.status = 'pending' and i.expires_at > now()
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.send_game_invite(p_receiver_id uuid, p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  target_room public.rooms;
  new_invite public.game_invites;
  active_count integer;
begin
  if actor is null then raise exception using message = 'authentication_required', errcode = 'P0001'; end if;
  if p_receiver_id is null or p_receiver_id = actor then raise exception using message = 'cannot_invite_self', errcode = 'P0001'; end if;
  if not public.friend_profile_is_active(actor) or not public.friend_profile_is_active(p_receiver_id) then
    raise exception using message = 'account_unavailable', errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('invite:' || actor::text || ':' || p_receiver_id::text, 0));
  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.id is null or target_room.kind <> 'private' or target_room.status <> 'waiting' then
    raise exception using message = 'room_not_invitable', errcode = 'P0001';
  end if;
  if not public.is_room_member(p_room_id, actor) then raise exception using message = 'not_room_member', errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.friendships f
    where f.user_low = least(actor, p_receiver_id) and f.user_high = greatest(actor, p_receiver_id)
  ) then raise exception using message = 'friends_only', errcode = 'P0001'; end if;
  if exists (
    select 1 from public.friend_blocks b
    where (b.blocker_id = actor and b.blocked_id = p_receiver_id)
       or (b.blocker_id = p_receiver_id and b.blocked_id = actor)
  ) then raise exception using message = 'invite_unavailable', errcode = 'P0001'; end if;
  if exists (select 1 from public.room_members m where m.room_id = p_room_id and m.user_id = p_receiver_id and m.kicked_at is not null) then
    raise exception using message = 'invitee_was_kicked', errcode = 'P0001';
  end if;
  select count(*) into active_count from public.room_members m
    where m.room_id = p_room_id and m.kicked_at is null and m.left_at is null;
  if active_count >= target_room.max_players then raise exception using message = 'room_full', errcode = 'P0001'; end if;
  if exists (
    select 1 from public.room_members m join public.rooms r on r.id = m.room_id
    where m.user_id = p_receiver_id and m.kicked_at is null and m.left_at is null
      and r.status in ('waiting', 'playing') and r.id <> p_room_id
  ) then raise exception using message = 'invitee_busy', errcode = 'P0001'; end if;
  if (select count(*) from public.game_invites i where i.sender_id = actor and i.created_at > now() - interval '1 minute') >= 5 then
    raise exception using message = 'invite_rate_limited', errcode = 'P0001';
  end if;
  perform public.expire_game_invites(actor);
  if exists (
    select 1 from public.game_invites i
    where i.sender_id = actor and i.receiver_id = p_receiver_id and i.room_id = p_room_id and i.status = 'pending'
  ) then raise exception using message = 'already_invited', errcode = 'P0001'; end if;

  insert into public.game_invites(sender_id, receiver_id, room_id)
  values (actor, p_receiver_id, p_room_id) returning * into new_invite;
  return jsonb_build_object('id', new_invite.id, 'status', 'pending', 'expiresAt', new_invite.expires_at);
end;
$$;

create or replace function public.respond_game_invite(p_invite_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  invite_row public.game_invites;
  target_room public.rooms;
  existing_member public.room_members;
  next_seat smallint;
  active_count integer;
begin
  if actor is null then raise exception using message = 'authentication_required', errcode = 'P0001'; end if;
  select * into invite_row from public.game_invites where id = p_invite_id for update;
  if invite_row.id is null or invite_row.receiver_id <> actor or invite_row.status <> 'pending' then
    raise exception using message = 'invite_not_available', errcode = 'P0001';
  end if;
  if invite_row.expires_at <= now() then
    update public.game_invites set status = 'cancelled', updated_at = now() where id = invite_row.id;
    raise exception using message = 'invite_expired', errcode = 'P0001';
  end if;
  if not p_accept then
    update public.game_invites set status = 'declined', updated_at = now() where id = invite_row.id;
    return jsonb_build_object('status', 'declined');
  end if;

  select * into target_room from public.rooms where id = invite_row.room_id for update;
  if target_room.id is null or target_room.status <> 'waiting' or target_room.kind <> 'private' then
    update public.game_invites set status = 'cancelled', updated_at = now() where id = invite_row.id;
    raise exception using message = 'room_not_invitable', errcode = 'P0001';
  end if;
  if not public.is_room_member(target_room.id, invite_row.sender_id) then
    update public.game_invites set status = 'cancelled', updated_at = now() where id = invite_row.id;
    raise exception using message = 'inviter_left_room', errcode = 'P0001';
  end if;
  if not public.friend_profile_is_active(actor) then raise exception using message = 'account_unavailable', errcode = 'P0001'; end if;
  if exists (
    select 1 from public.room_members m join public.rooms r on r.id = m.room_id
    where m.user_id = actor and m.kicked_at is null and m.left_at is null
      and r.status in ('waiting', 'playing') and r.id <> target_room.id
  ) then raise exception using message = 'active_session_exists', errcode = 'P0001'; end if;

  select * into existing_member from public.room_members m where m.room_id = target_room.id and m.user_id = actor;
  if existing_member.kicked_at is not null then raise exception using message = 'invitee_was_kicked', errcode = 'P0001'; end if;
  if existing_member.user_id is null or existing_member.left_at is not null then
    select count(*) into active_count from public.room_members m
      where m.room_id = target_room.id and m.kicked_at is null and m.left_at is null;
    if active_count >= target_room.max_players then raise exception using message = 'room_full', errcode = 'P0001'; end if;
    select coalesce(min(candidate), 1)::smallint into next_seat
    from generate_series(1, target_room.max_players - 1) candidate
    where not exists (
      select 1 from public.room_members m where m.room_id = target_room.id and m.seat = candidate
        and m.kicked_at is null and m.left_at is null
    );
    insert into public.room_members(room_id, user_id, role, seat, last_seen_at)
    values (target_room.id, actor, 'player', next_seat, now())
    on conflict (room_id, user_id) do update
      set left_at = null, disconnected_at = null, last_seen_at = now(), joined_at = now(), seat = excluded.seat;
  end if;
  update public.game_invites set status = 'accepted', updated_at = now() where id = invite_row.id;
  return jsonb_build_object('status', 'accepted', 'roomId', target_room.id, 'roomCode', target_room.code);
end;
$$;

create or replace function public.cancel_game_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.game_invites set status = 'cancelled', updated_at = now()
  where id = p_invite_id and sender_id = auth.uid() and status = 'pending';
  if not found then raise exception using message = 'invite_not_available', errcode = 'P0001'; end if;
  return true;
end;
$$;

revoke all on function public.expire_game_invites(uuid) from public;
revoke all on function public.get_game_invite_context() from public;
revoke all on function public.get_game_invites() from public;
revoke all on function public.send_game_invite(uuid, uuid) from public;
revoke all on function public.respond_game_invite(uuid, boolean) from public;
revoke all on function public.cancel_game_invite(uuid) from public;
grant execute on function public.get_game_invite_context() to authenticated;
grant execute on function public.get_game_invites() to authenticated;
grant execute on function public.send_game_invite(uuid, uuid) to authenticated;
grant execute on function public.respond_game_invite(uuid, boolean) to authenticated;
grant execute on function public.cancel_game_invite(uuid) to authenticated;
