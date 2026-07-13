create type public.platform_role as enum ('player', 'support', 'admin', 'super_admin');
create type public.space_role as enum ('member', 'manager', 'owner');
create type public.space_status as enum ('draft', 'active', 'suspended', 'archived');
create type public.card_set_status as enum ('draft', 'published', 'archived');

alter type public.room_kind add value if not exists 'bot';

alter table public.profiles
  add column platform_role public.platform_role not null default 'player',
  add column suspended_until timestamptz,
  add column suspension_reason text,
  add column deleted_at timestamptz;

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,48}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text,
  status public.space_status not null default 'draft',
  settings jsonb not null default '{"allow_public_signup": false, "allow_custom_cards": true}'::jsonb,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.space_role not null default 'member',
  student_or_employee_id text,
  invited_by uuid references public.profiles(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table public.card_sets (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references public.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  status public.card_set_status not null default 'draft',
  is_platform_default boolean not null default false,
  version integer not null default 1,
  created_by uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_platform_default and space_id is null) or not is_platform_default)
);

create unique index one_platform_default_card_set on public.card_sets(is_platform_default)
  where is_platform_default;

create table public.card_designs (
  id uuid primary key default gen_random_uuid(),
  card_set_id uuid not null references public.card_sets(id) on delete cascade,
  fruit_type text not null check (fruit_type in ('strawberry', 'banana', 'lime', 'plum')),
  fruit_count smallint not null check (fruit_count between 1 and 5),
  quantity smallint not null check (quantity between 1 and 12),
  front_asset_path text,
  back_asset_path text,
  design jsonb not null default '{}'::jsonb,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

alter table public.rooms
  add column space_id uuid references public.spaces(id) on delete set null,
  add column card_set_id uuid references public.card_sets(id) on delete restrict;

create table public.moderation_actions (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  target_user_id uuid references public.profiles(id) on delete set null,
  target_room_id uuid references public.rooms(id) on delete set null,
  target_space_id uuid references public.spaces(id) on delete set null,
  action text not null check (action in ('warn', 'suspend', 'unsuspend', 'soft_delete', 'close_room', 'suspend_space', 'restore_space')),
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (num_nonnulls(target_user_id, target_room_id, target_space_id) = 1)
);

create or replace function public.is_platform_admin(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = p_user_id and platform_role in ('admin', 'super_admin') and deleted_at is null); $$;

create or replace function public.is_space_member(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.space_members where space_id = p_space_id and user_id = p_user_id); $$;

create or replace function public.is_space_manager(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_platform_admin(p_user_id) or exists (select 1 from public.space_members where space_id = p_space_id and user_id = p_user_id and role in ('manager', 'owner')); $$;

alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.card_sets enable row level security;
alter table public.card_designs enable row level security;
alter table public.moderation_actions enable row level security;

create policy "members read spaces" on public.spaces for select to authenticated using (public.is_space_member(id) or public.is_platform_admin());
create policy "managers update spaces" on public.spaces for update to authenticated using (public.is_space_manager(id)) with check (public.is_space_manager(id));
create policy "members read space roster" on public.space_members for select to authenticated using (public.is_space_member(space_id) or public.is_platform_admin());
create policy "managers manage space roster" on public.space_members for all to authenticated using (public.is_space_manager(space_id)) with check (public.is_space_manager(space_id));
create policy "members read published card sets" on public.card_sets for select to authenticated using (is_platform_default or (space_id is not null and public.is_space_member(space_id)) or public.is_platform_admin());
create policy "managers manage card sets" on public.card_sets for all to authenticated using ((space_id is not null and public.is_space_manager(space_id)) or public.is_platform_admin()) with check ((space_id is not null and public.is_space_manager(space_id)) or public.is_platform_admin());
create policy "members read card designs" on public.card_designs for select to authenticated using (exists (select 1 from public.card_sets s where s.id = card_set_id and (s.is_platform_default or public.is_space_member(s.space_id) or public.is_platform_admin())));
create policy "managers manage card designs" on public.card_designs for all to authenticated using (exists (select 1 from public.card_sets s where s.id = card_set_id and ((s.space_id is not null and public.is_space_manager(s.space_id)) or public.is_platform_admin()))) with check (exists (select 1 from public.card_sets s where s.id = card_set_id and ((s.space_id is not null and public.is_space_manager(s.space_id)) or public.is_platform_admin())));
create policy "admins read moderation audit" on public.moderation_actions for select to authenticated using (public.is_platform_admin());

revoke update on public.profiles from authenticated;
grant update (nickname, avatar_seed, updated_at) on public.profiles to authenticated;
grant execute on function public.is_platform_admin(uuid) to authenticated;
grant execute on function public.is_space_member(uuid, uuid) to authenticated;
grant execute on function public.is_space_manager(uuid, uuid) to authenticated;

comment on table public.spaces is '학교, 행사, 회사 등 독립 운영 단위';
comment on table public.moderation_actions is '관리자 조치 불변 감사 로그. 실제 정지/탈퇴는 service role Edge Function에서 수행';
