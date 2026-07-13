create table public.platform_bootstrap (
  singleton boolean primary key default true check (singleton),
  consumed_at timestamptz,
  consumed_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

insert into public.platform_bootstrap(singleton) values (true)
on conflict (singleton) do nothing;

alter table public.platform_bootstrap enable row level security;

alter table public.moderation_actions drop constraint moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check
  check (action in ('bootstrap_super_admin', 'warn', 'suspend', 'unsuspend', 'soft_delete', 'close_room', 'suspend_space', 'restore_space'));

create or replace function public.complete_platform_bootstrap(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  bootstrap_row public.platform_bootstrap;
begin
  select * into bootstrap_row
  from public.platform_bootstrap
  where singleton = true
  for update;

  if bootstrap_row.consumed_at is not null then
    raise exception 'platform bootstrap already completed';
  end if;

  if exists (select 1 from public.profiles where platform_role = 'super_admin' and deleted_at is null) then
    raise exception 'super administrator already exists';
  end if;

  update public.profiles
  set platform_role = 'super_admin', suspended_until = null, suspension_reason = null, updated_at = now()
  where id = p_user_id;

  if not found then raise exception 'profile not found'; end if;

  update public.platform_bootstrap
  set consumed_at = now(), consumed_by = p_user_id
  where singleton = true;

  insert into public.moderation_actions(actor_id, target_user_id, action, reason)
  values (p_user_id, p_user_id, 'bootstrap_super_admin', 'Initial one-time platform bootstrap');
end;
$$;

revoke all on table public.platform_bootstrap from anon, authenticated;
revoke all on function public.complete_platform_bootstrap(uuid) from public, anon, authenticated;
grant execute on function public.complete_platform_bootstrap(uuid) to service_role;

comment on table public.platform_bootstrap is 'Singleton latch consumed exactly once when the first super administrator is created';
