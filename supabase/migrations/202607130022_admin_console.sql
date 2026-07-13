alter table public.moderation_actions
  drop constraint if exists moderation_actions_action_check;

alter table public.moderation_actions
  add constraint moderation_actions_action_check
  check (action in (
    'bootstrap_super_admin', 'warn', 'suspend', 'unsuspend', 'soft_delete',
    'close_room', 'suspend_space', 'restore_space', 'role_change', 'create_admin'
  ));

create or replace function public.is_platform_operator(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = p_user_id
      and platform_role in ('support', 'admin', 'super_admin')
      and deleted_at is null
      and (suspended_until is null or suspended_until <= now())
  );
$$;

drop policy if exists "admins read moderation audit" on public.moderation_actions;
create policy "operators read moderation audit"
  on public.moderation_actions
  for select
  to authenticated
  using (public.is_platform_operator());

grant execute on function public.is_platform_operator(uuid) to authenticated;

comment on function public.is_platform_operator(uuid)
  is '지원 담당자 이상 관리자 콘솔 읽기 권한 검사. 변경 권한은 Edge Function에서 별도로 검증한다.';
