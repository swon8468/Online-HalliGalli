create table if not exists public.friend_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists friend_requests_receiver_pending_idx
  on public.friend_requests(receiver_id, created_at desc) where status = 'pending';
create index if not exists friend_requests_sender_pending_idx
  on public.friend_requests(sender_id, created_at desc) where status = 'pending';
create index if not exists friendships_user_high_idx on public.friendships(user_high);
create index if not exists friend_blocks_blocked_idx on public.friend_blocks(blocked_id);

alter table public.friend_blocks enable row level security;

drop policy if exists "users create friend requests" on public.friend_requests;
drop policy if exists "users update received or sent requests" on public.friend_requests;
create policy "users read own blocks" on public.friend_blocks for select to authenticated
  using (blocker_id = auth.uid());

revoke insert, update, delete on public.friend_requests from authenticated;
revoke insert, update, delete on public.friendships from authenticated;
revoke insert, update, delete on public.friend_blocks from authenticated;
grant select on public.friend_blocks to authenticated;

create or replace function public.friend_profile_is_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.deleted_at is null
      and (p.suspended_until is null or p.suspended_until <= now())
  );
$$;

create or replace function public.friend_activity(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when exists (
    select 1
    from public.game_players gp
    join public.games g on g.id = gp.game_id
    where gp.user_id = p_user_id
      and g.finished_at is null
      and gp.abandoned_at is null
  ) then 'in_game' else 'idle' end;
$$;

create or replace function public.get_friends_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception using message = 'authentication_required', errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', p.id,
        'nickname', p.nickname,
        'friendTag', p.friend_tag,
        'avatarSeed', p.avatar_seed,
        'activity', public.friend_activity(p.id),
        'friendsSince', f.created_at
      ) order by lower(p.nickname), p.friend_tag)
      from public.friendships f
      join public.profiles p
        on p.id = case when f.user_low = actor then f.user_high else f.user_low end
      where actor in (f.user_low, f.user_high)
        and public.friend_profile_is_active(p.id)
        and not exists (
          select 1 from public.friend_blocks b
          where (b.blocker_id = actor and b.blocked_id = p.id)
             or (b.blocker_id = p.id and b.blocked_id = actor)
        )
    ), '[]'::jsonb),
    'received', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'userId', p.id,
        'nickname', p.nickname,
        'friendTag', p.friend_tag,
        'avatarSeed', p.avatar_seed,
        'createdAt', r.created_at
      ) order by r.created_at desc)
      from public.friend_requests r
      join public.profiles p on p.id = r.sender_id
      where r.receiver_id = actor and r.status = 'pending'
        and public.friend_profile_is_active(p.id)
    ), '[]'::jsonb),
    'sent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'userId', p.id,
        'nickname', p.nickname,
        'friendTag', p.friend_tag,
        'avatarSeed', p.avatar_seed,
        'createdAt', r.created_at
      ) order by r.created_at desc)
      from public.friend_requests r
      join public.profiles p on p.id = r.receiver_id
      where r.sender_id = actor and r.status = 'pending'
        and public.friend_profile_is_active(p.id)
    ), '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', p.id,
        'nickname', p.nickname,
        'friendTag', p.friend_tag,
        'avatarSeed', p.avatar_seed,
        'createdAt', b.created_at
      ) order by b.created_at desc)
      from public.friend_blocks b
      join public.profiles p on p.id = b.blocked_id
      where b.blocker_id = actor
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.search_friend_users(p_query text)
returns table (
  user_id uuid,
  nickname text,
  friend_tag text,
  avatar_seed text,
  relationship text,
  activity text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  normalized text := lower(btrim(coalesce(p_query, '')));
begin
  if actor is null then
    raise exception using message = 'authentication_required', errcode = 'P0001';
  end if;
  if char_length(normalized) < 2 or char_length(normalized) > 40 then
    raise exception using message = 'invalid_search_query', errcode = 'P0001';
  end if;

  return query
  select p.id, p.nickname, p.friend_tag, p.avatar_seed,
    case
      when p.id = actor then 'self'
      when exists (select 1 from public.friendships f where f.user_low = least(actor, p.id) and f.user_high = greatest(actor, p.id)) then 'friend'
      when exists (select 1 from public.friend_requests r where r.sender_id = actor and r.receiver_id = p.id and r.status = 'pending') then 'sent'
      when exists (select 1 from public.friend_requests r where r.sender_id = p.id and r.receiver_id = actor and r.status = 'pending') then 'received'
      else 'none'
    end,
    public.friend_activity(p.id)
  from public.profiles p
  where public.friend_profile_is_active(p.id)
    and (position(normalized in lower(p.nickname)) > 0 or position(normalized in lower(p.friend_tag)) > 0)
    and not exists (
      select 1 from public.friend_blocks b
      where (b.blocker_id = actor and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = actor)
    )
  order by case when lower(p.friend_tag) = normalized then 0 when lower(p.nickname) = normalized then 1 else 2 end,
    lower(p.nickname), p.friend_tag
  limit 20;
end;
$$;

create or replace function public.send_friend_request(p_receiver_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  reverse_request public.friend_requests;
  new_request public.friend_requests;
begin
  if actor is null then raise exception using message = 'authentication_required', errcode = 'P0001'; end if;
  if p_receiver_id is null or p_receiver_id = actor then raise exception using message = 'cannot_friend_self', errcode = 'P0001'; end if;
  if not public.friend_profile_is_active(actor) or not public.friend_profile_is_active(p_receiver_id) then
    raise exception using message = 'account_unavailable', errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(least(actor, p_receiver_id)::text || ':' || greatest(actor, p_receiver_id)::text, 0));

  if exists (
    select 1 from public.friend_blocks b
    where (b.blocker_id = actor and b.blocked_id = p_receiver_id)
       or (b.blocker_id = p_receiver_id and b.blocked_id = actor)
  ) then raise exception using message = 'friend_unavailable', errcode = 'P0001'; end if;

  if exists (select 1 from public.friendships f where f.user_low = least(actor, p_receiver_id) and f.user_high = greatest(actor, p_receiver_id)) then
    raise exception using message = 'already_friends', errcode = 'P0001';
  end if;
  if exists (select 1 from public.friend_requests r where r.sender_id = actor and r.receiver_id = p_receiver_id and r.status = 'pending') then
    raise exception using message = 'already_requested', errcode = 'P0001';
  end if;

  select * into reverse_request
  from public.friend_requests r
  where r.sender_id = p_receiver_id and r.receiver_id = actor and r.status = 'pending'
  for update;

  if reverse_request.id is not null then
    update public.friend_requests set status = 'accepted', updated_at = now() where id = reverse_request.id;
    insert into public.friendships(user_low, user_high) values (least(actor, p_receiver_id), greatest(actor, p_receiver_id))
      on conflict do nothing;
    return jsonb_build_object('status', 'accepted', 'requestId', reverse_request.id, 'crossRequest', true);
  end if;

  insert into public.friend_requests(sender_id, receiver_id)
  values (actor, p_receiver_id) returning * into new_request;
  return jsonb_build_object('status', 'pending', 'requestId', new_request.id, 'crossRequest', false);
end;
$$;

create or replace function public.respond_friend_request(p_request_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  request_row public.friend_requests;
begin
  if actor is null then raise exception using message = 'authentication_required', errcode = 'P0001'; end if;
  select * into request_row from public.friend_requests where id = p_request_id for update;
  if request_row.id is null or request_row.receiver_id <> actor or request_row.status <> 'pending' then
    raise exception using message = 'request_not_available', errcode = 'P0001';
  end if;
  if not public.friend_profile_is_active(actor) or not public.friend_profile_is_active(request_row.sender_id) then
    raise exception using message = 'account_unavailable', errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.friend_blocks b
    where (b.blocker_id = actor and b.blocked_id = request_row.sender_id)
       or (b.blocker_id = request_row.sender_id and b.blocked_id = actor)
  ) then raise exception using message = 'friend_unavailable', errcode = 'P0001'; end if;

  if p_accept then
    insert into public.friendships(user_low, user_high)
    values (least(actor, request_row.sender_id), greatest(actor, request_row.sender_id)) on conflict do nothing;
    update public.friend_requests set status = 'accepted', updated_at = now() where id = request_row.id;
    return jsonb_build_object('status', 'accepted');
  end if;

  update public.friend_requests set status = 'declined', updated_at = now() where id = request_row.id;
  return jsonb_build_object('status', 'declined');
end;
$$;

create or replace function public.cancel_friend_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.friend_requests
  set status = 'cancelled', updated_at = now()
  where id = p_request_id and sender_id = auth.uid() and status = 'pending';
  if not found then raise exception using message = 'request_not_available', errcode = 'P0001'; end if;
  return true;
end;
$$;

create or replace function public.remove_friend(p_friend_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_friend_id is null or p_friend_id = auth.uid() then
    raise exception using message = 'invalid_friend', errcode = 'P0001';
  end if;
  delete from public.friendships
  where user_low = least(auth.uid(), p_friend_id) and user_high = greatest(auth.uid(), p_friend_id);
  if not found then raise exception using message = 'friendship_not_found', errcode = 'P0001'; end if;
  return true;
end;
$$;

create or replace function public.block_friend_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare actor uuid := auth.uid();
begin
  if actor is null or p_user_id is null or p_user_id = actor then
    raise exception using message = 'cannot_block_self', errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(least(actor, p_user_id)::text || ':' || greatest(actor, p_user_id)::text, 0));
  delete from public.friendships where user_low = least(actor, p_user_id) and user_high = greatest(actor, p_user_id);
  update public.friend_requests set status = 'cancelled', updated_at = now()
    where status = 'pending' and ((sender_id = actor and receiver_id = p_user_id) or (sender_id = p_user_id and receiver_id = actor));
  insert into public.friend_blocks(blocker_id, blocked_id) values (actor, p_user_id) on conflict do nothing;
  return true;
end;
$$;

create or replace function public.unblock_friend_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.friend_blocks where blocker_id = auth.uid() and blocked_id = p_user_id;
  if not found then raise exception using message = 'block_not_found', errcode = 'P0001'; end if;
  return true;
end;
$$;

revoke all on function public.friend_profile_is_active(uuid) from public;
revoke all on function public.friend_activity(uuid) from public;
revoke all on function public.get_friends_overview() from public;
revoke all on function public.search_friend_users(text) from public;
revoke all on function public.send_friend_request(uuid) from public;
revoke all on function public.respond_friend_request(uuid, boolean) from public;
revoke all on function public.cancel_friend_request(uuid) from public;
revoke all on function public.remove_friend(uuid) from public;
revoke all on function public.block_friend_user(uuid) from public;
revoke all on function public.unblock_friend_user(uuid) from public;

grant execute on function public.get_friends_overview() to authenticated;
grant execute on function public.search_friend_users(text) to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.block_friend_user(uuid) to authenticated;
grant execute on function public.unblock_friend_user(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships') then
    alter publication supabase_realtime add table public.friendships;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friend_blocks') then
    alter publication supabase_realtime add table public.friend_blocks;
  end if;
end $$;
