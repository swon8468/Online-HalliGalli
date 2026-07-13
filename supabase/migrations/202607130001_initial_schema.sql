create extension if not exists pgcrypto;

create type public.room_kind as enum ('private', 'matchmaking');
create type public.room_status as enum ('waiting', 'playing', 'finished', 'closed');
create type public.member_role as enum ('host', 'player');
create type public.request_status as enum ('pending', 'accepted', 'declined', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 12),
  friend_tag text not null unique,
  avatar_seed text not null default encode(extensions.gen_random_bytes(6), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text check (code is null or code ~ '^[A-Z]{3}[0-9]{3}$'),
  kind public.room_kind not null,
  status public.room_status not null default 'waiting',
  host_id uuid not null references public.profiles(id) on delete restrict,
  max_players smallint not null check (max_players between 2 and 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index rooms_active_code_key on public.rooms(code)
  where code is not null and status in ('waiting', 'playing');

create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null default 'player',
  seat smallint,
  kicked_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, seat)
);

create table public.matchmaking_queue (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  player_count smallint not null check (player_count between 2 and 6),
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null unique references public.rooms(id) on delete cascade,
  current_turn uuid references public.profiles(id),
  version integer not null default 0,
  state jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.game_players (
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  seat smallint not null,
  card_count integer not null default 0 check (card_count >= 0),
  eliminated_at timestamptz,
  disconnected_at timestamptz,
  primary key (game_id, user_id),
  unique (game_id, seat)
);

create table public.game_events (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index game_events_game_id_id_idx on public.game_events(game_id, id);

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

create unique index friend_requests_pending_pair_key
  on public.friend_requests(least(sender_id, receiver_id), greatest(sender_id, receiver_id))
  where status = 'pending';

create table public.friendships (
  user_low uuid not null references public.profiles(id) on delete cascade,
  user_high uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  check (user_low < user_high)
);

create table public.game_invites (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  status public.request_status not null default 'pending',
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  suffix text := lpad(floor(random() * 10000)::int::text, 4, '0');
  base_name text := coalesce(nullif(new.raw_user_meta_data->>'nickname', ''), '게스트');
begin
  insert into public.profiles(id, nickname, friend_tag)
  values (new.id, left(base_name, 12), lower(regexp_replace(base_name, '[^a-zA-Z0-9가-힣]', '', 'g')) || '#' || suffix);
  return new;
exception when unique_violation then
  insert into public.profiles(id, nickname, friend_tag)
  values (new.id, left(base_name, 12), 'player#' || substr(replace(new.id::text, '-', ''), 1, 8));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.matchmaking_queue enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_events enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.game_invites enable row level security;
alter table public.push_subscriptions enable row level security;

create or replace function public.is_room_member(p_room_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = p_user_id and kicked_at is null
  );
$$;

create policy "profiles readable by signed in users" on public.profiles for select to authenticated using (true);
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "rooms readable by members or joinable code" on public.rooms for select to authenticated
  using (status = 'waiting' or public.is_room_member(id));
create policy "members read their rooms" on public.room_members for select to authenticated
  using (public.is_room_member(room_id));
create policy "users read own queue row" on public.matchmaking_queue for select to authenticated using (user_id = auth.uid());
create policy "users manage own queue row" on public.matchmaking_queue for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "members read their games" on public.games for select to authenticated
  using (exists (select 1 from public.room_members m where m.room_id = room_id and m.user_id = auth.uid()));
create policy "game players visible to game members" on public.game_players for select to authenticated
  using (exists (select 1 from public.game_players self where self.game_id = game_id and self.user_id = auth.uid()));
create policy "game events visible to game members" on public.game_events for select to authenticated
  using (exists (select 1 from public.game_players p where p.game_id = game_id and p.user_id = auth.uid()));
create policy "users read related friend requests" on public.friend_requests for select to authenticated using (auth.uid() in (sender_id, receiver_id));
create policy "users create friend requests" on public.friend_requests for insert to authenticated with check (sender_id = auth.uid());
create policy "users update received or sent requests" on public.friend_requests for update to authenticated using (auth.uid() in (sender_id, receiver_id));
create policy "users read own friendships" on public.friendships for select to authenticated using (auth.uid() in (user_low, user_high));
create policy "users read related invites" on public.game_invites for select to authenticated using (auth.uid() in (sender_id, receiver_id));
create policy "users send invites" on public.game_invites for insert to authenticated with check (sender_id = auth.uid());
create policy "receivers update invites" on public.game_invites for update to authenticated using (receiver_id = auth.uid());
create policy "users manage own push subscriptions" on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.generate_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  digits constant text := '0123456789';
  result text := '';
begin
  for i in 1..3 loop result := result || substr(letters, floor(random() * length(letters) + 1)::int, 1); end loop;
  for i in 1..3 loop result := result || substr(digits, floor(random() * length(digits) + 1)::int, 1); end loop;
  return result;
end;
$$;

create or replace function public.create_private_room(p_max_players smallint)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  new_room public.rooms;
  new_code text;
begin
  if auth.uid() is null or p_max_players not between 2 and 6 then raise exception 'invalid room request'; end if;
  for attempt in 1..20 loop
    new_code := public.generate_room_code();
    begin
      insert into public.rooms(code, kind, host_id, max_players)
      values (new_code, 'private', auth.uid(), p_max_players) returning * into new_room;
      insert into public.room_members(room_id, user_id, role, seat) values (new_room.id, auth.uid(), 'host', 0);
      return new_room;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'could not allocate room code';
end;
$$;

create or replace function public.attempt_ring(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_game public.games;
  is_valid boolean;
begin
  select * into locked_game from public.games where id = p_game_id for update;
  if not exists (select 1 from public.game_players where game_id = p_game_id and user_id = auth.uid() and eliminated_at is null) then
    raise exception 'not an active player';
  end if;
  is_valid := coalesce((locked_game.state->>'fruit_total_is_five')::boolean, false);
  if exists (select 1 from public.game_events where game_id = p_game_id and event_type = 'ring' and payload->>'round_version' = locked_game.version::text) then
    return jsonb_build_object('accepted', false, 'reason', 'already_rung');
  end if;
  insert into public.game_events(game_id, user_id, event_type, payload)
  values (p_game_id, auth.uid(), 'ring', jsonb_build_object('correct', is_valid, 'round_version', locked_game.version));
  return jsonb_build_object('accepted', true, 'correct', is_valid);
end;
$$;

create or replace function public.join_private_room(p_code text)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.rooms;
  next_seat smallint;
  member_count integer;
begin
  if auth.uid() is null or p_code !~ '^[A-Z]{3}[0-9]{3}$' then raise exception 'invalid room code'; end if;
  select * into target_room from public.rooms
    where code = p_code and kind = 'private' and status = 'waiting'
    for update;
  if target_room.id is null then raise exception 'room not found'; end if;
  select count(*) into member_count from public.room_members
    where room_id = target_room.id and kicked_at is null;
  if member_count >= target_room.max_players then raise exception 'room is full'; end if;
  select coalesce(min(candidate), 1)::smallint into next_seat
  from generate_series(1, target_room.max_players - 1) candidate
  where not exists (
    select 1 from public.room_members m
    where m.room_id = target_room.id and m.seat = candidate and m.kicked_at is null
  );
  insert into public.room_members(room_id, user_id, role, seat)
  values (target_room.id, auth.uid(), 'player', next_seat)
  on conflict (room_id, user_id) do update set kicked_at = null, joined_at = now(), seat = excluded.seat;
  return target_room;
end;
$$;

grant execute on function public.create_private_room(smallint) to authenticated;
grant execute on function public.join_private_room(text) to authenticated;
grant execute on function public.attempt_ring(uuid) to authenticated;
grant execute on function public.is_room_member(uuid, uuid) to authenticated;

alter publication supabase_realtime add table public.rooms, public.room_members, public.matchmaking_queue, public.games, public.game_events, public.friend_requests, public.game_invites;
