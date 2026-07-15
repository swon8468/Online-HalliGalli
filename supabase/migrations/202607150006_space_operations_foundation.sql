alter table public.profiles
  add column if not exists session_invalid_after timestamptz;

alter table public.spaces
  add column if not exists join_policy text not null default 'code',
  add column if not exists join_code_expires_at timestamptz,
  add column if not exists allowed_email_domains text[] not null default '{}'::text[];

update public.spaces
set allowed_email_domains = array[allowed_email_domain]
where allowed_email_domain is not null
  and cardinality(allowed_email_domains) = 0;

alter table public.spaces drop constraint if exists spaces_join_policy_check;
alter table public.spaces add constraint spaces_join_policy_check
  check (join_policy in ('code', 'invite_only', 'closed'));

create or replace function public.valid_space_email_domains(domains text[])
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare domain text;
begin
  if cardinality(domains) > 10 then return false; end if;
  foreach domain in array domains loop
    if domain is null or domain !~ '^@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then
      return false;
    end if;
  end loop;
  return cardinality(domains) = cardinality(array(select distinct value from unnest(domains) value));
end;
$$;

alter table public.spaces drop constraint if exists spaces_allowed_email_domains_format;
alter table public.spaces add constraint spaces_allowed_email_domains_format
  check (public.valid_space_email_domains(allowed_email_domains));

create table if not exists public.space_managed_accounts (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_kind text not null default 'existing' check (account_kind in ('managed', 'existing')),
  status text not null default 'active' check (status in ('active', 'suspended', 'deactivated')),
  must_change_password boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_managed_by uuid references public.profiles(id) on delete set null,
  last_managed_at timestamptz,
  primary key (space_id, user_id)
);

insert into public.space_managed_accounts(space_id, user_id, account_kind, status, created_by, created_at)
select member.space_id, member.user_id, 'existing', 'active', member.invited_by, member.joined_at
from public.space_members member
on conflict (space_id, user_id) do nothing;

create index if not exists space_managed_accounts_user_idx on public.space_managed_accounts(user_id);
create index if not exists space_managed_accounts_status_idx on public.space_managed_accounts(space_id, status, account_kind);
alter table public.space_managed_accounts enable row level security;
revoke all on table public.space_managed_accounts from anon, authenticated;

create or replace view public.space_member_directory
with (security_invoker = true)
as
select
  member.space_id,
  member.user_id,
  member.role,
  member.student_or_employee_id,
  member.invited_by,
  member.joined_at,
  profile.nickname,
  profile.friend_tag,
  profile.deleted_at,
  profile.suspended_until,
  coalesce(account.account_kind, 'existing') as account_kind,
  coalesce(account.status, 'active') as account_status,
  coalesce(account.must_change_password, false) as must_change_password,
  coalesce(account.created_at, member.joined_at) as managed_at,
  account.last_managed_at
from public.space_members member
join public.profiles profile on profile.id = member.user_id
left join public.space_managed_accounts account on account.space_id = member.space_id and account.user_id = member.user_id;

revoke all on table public.space_member_directory from public, anon, authenticated;
grant select on table public.space_member_directory to service_role;

create or replace function public.clear_space_password_change_requirement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.encrypted_password is distinct from new.encrypted_password then
    update public.space_managed_accounts
    set must_change_password = false, updated_at = now()
    where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_space_password_change_requirement on auth.users;
create trigger clear_space_password_change_requirement
  after update of encrypted_password on auth.users
  for each row execute function public.clear_space_password_change_requirement();

create table if not exists public.space_slug_aliases (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{2,48}$'),
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists space_slug_aliases_space_idx on public.space_slug_aliases(space_id);
alter table public.space_slug_aliases enable row level security;
revoke all on table public.space_slug_aliases from anon, authenticated;

create table if not exists public.space_action_claims (
  request_id uuid primary key,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete cascade,
  action text not null,
  status text not null default 'started' check (status in ('started', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists space_action_claims_rate_idx on public.space_action_claims(actor_id, action, created_at desc);
alter table public.space_action_claims enable row level security;
revoke all on table public.space_action_claims from anon, authenticated;

alter table public.moderation_actions drop constraint if exists moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check
  check (action in (
    'bootstrap_super_admin', 'warn', 'suspend', 'unsuspend', 'soft_delete', 'close_room',
    'suspend_space', 'restore_space', 'role_change', 'create_admin', 'create_space',
    'update_space', 'archive_space', 'add_space_member', 'remove_space_member',
    'change_space_role', 'bulk_create_space_members', 'maintenance_cleanup',
    'transfer_space_owner', 'space_account_update', 'space_account_reset',
    'space_account_suspend', 'space_account_reactivate', 'space_account_delete',
    'bulk_update_space_members', 'space_access_denied', 'close_space_room'
  ));

create or replace function public.profile_is_active(p_user_id uuid default auth.uid())
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
      and (
        p_user_id is distinct from auth.uid()
        or p.session_invalid_after is null
        or auth.role() is distinct from 'authenticated'
        or to_timestamp(coalesce((auth.jwt()->>'iat')::bigint, 0)) >= p.session_invalid_after
      )
  );
$$;

create or replace function public.enforce_active_profile_request()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  profile public.profiles;
  issued_at timestamptz;
begin
  if auth.role() is distinct from 'authenticated' then return; end if;
  if actor is null then
    raise exception using message = 'authentication_required', errcode = '42501';
  end if;
  select * into profile from public.profiles where id = actor;
  if profile.id is null then raise exception using message = 'account_profile_unavailable', errcode = '42501'; end if;
  if profile.deleted_at is not null then raise exception using message = 'account_deleted', errcode = '42501'; end if;
  if profile.suspended_until is not null and profile.suspended_until > now() then
    raise exception using message = 'account_suspended', errcode = '42501';
  end if;
  issued_at := to_timestamp(coalesce((auth.jwt()->>'iat')::bigint, 0));
  if profile.session_invalid_after is not null and issued_at < profile.session_invalid_after then
    raise exception using message = 'session_invalidated', errcode = '42501';
  end if;
end;
$$;

create or replace function public.join_space_by_code(p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.spaces;
  requester_email text;
  requester_domain text;
begin
  if auth.uid() is null then raise exception using message = 'authentication_required', errcode = 'P0001'; end if;
  select * into target from public.spaces where join_code = upper(trim(p_join_code)) for update;
  if target.id is null then raise exception using message = 'space_not_found', errcode = 'P0001'; end if;
  if target.status <> 'active' then raise exception using message = 'space_inactive', errcode = 'P0001'; end if;
  if not target.join_enabled or target.join_policy <> 'code' then raise exception using message = 'space_join_disabled', errcode = 'P0001'; end if;
  if target.join_code_expires_at is not null and target.join_code_expires_at <= now() then
    raise exception using message = 'space_join_code_expired', errcode = 'P0001';
  end if;
  if cardinality(target.allowed_email_domains) > 0 then
    select lower(email) into requester_email from auth.users where id = auth.uid();
    requester_domain := case when requester_email is null then null else '@' || split_part(requester_email, '@', 2) end;
    if requester_domain is null or not requester_domain = any(target.allowed_email_domains) then
      raise exception using message = 'space_email_domain_required', errcode = 'P0001';
    end if;
  end if;
  insert into public.space_members(space_id, user_id, role, joined_at)
  values (target.id, auth.uid(), 'member', now()) on conflict (space_id, user_id) do nothing;
  insert into public.space_managed_accounts(space_id, user_id, account_kind, status, created_by)
  values (target.id, auth.uid(), 'existing', 'active', auth.uid())
  on conflict (space_id, user_id) do update set status = 'active', updated_at = now();
  return jsonb_build_object('id', target.id, 'slug', target.slug, 'name', target.name, 'role', (
    select role from public.space_members where space_id = target.id and user_id = auth.uid()
  ));
end;
$$;

create or replace function public.transfer_space_ownership(p_space_id uuid, p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_role public.space_role;
  target_role public.space_role;
begin
  if actor is null then raise exception using message = 'authentication_required', errcode = 'P0001'; end if;
  perform 1 from public.spaces where id = p_space_id for update;
  if not found then raise exception using message = 'space_not_found', errcode = 'P0001'; end if;
  select role into actor_role from public.space_members where space_id = p_space_id and user_id = actor for update;
  if not public.is_platform_admin(actor) and actor_role <> 'owner' then
    raise exception using message = 'space_owner_required', errcode = 'P0001';
  end if;
  if p_target_user_id = actor then raise exception using message = 'cannot_transfer_to_self', errcode = 'P0001'; end if;
  select role into target_role from public.space_members where space_id = p_space_id and user_id = p_target_user_id for update;
  if target_role is null then raise exception using message = 'member_not_found', errcode = 'P0001'; end if;
  update public.space_members set role = 'manager' where space_id = p_space_id and role = 'owner';
  update public.space_members set role = 'owner' where space_id = p_space_id and user_id = p_target_user_id;
end;
$$;

revoke all on function public.valid_space_email_domains(text[]) from public;
grant execute on function public.valid_space_email_domains(text[]) to service_role;
revoke all on function public.clear_space_password_change_requirement() from public, anon, authenticated;
revoke all on function public.transfer_space_ownership(uuid, uuid) from public;
grant execute on function public.transfer_space_ownership(uuid, uuid) to authenticated;
revoke all on function public.join_space_by_code(text) from public;
grant execute on function public.join_space_by_code(text) to authenticated;

comment on table public.space_managed_accounts is 'Tracks whether a membership uses a space-owned Auth account without storing credentials.';
comment on table public.space_action_claims is 'PII-free idempotency and rate-limit claims for sensitive space operations.';
comment on view public.space_member_directory is 'Service-role-only, PII-free searchable member directory for server pagination.';
comment on column public.profiles.session_invalid_after is 'JWTs issued before this timestamp are rejected by Data API and active-profile policies.';
