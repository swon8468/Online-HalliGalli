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
  );
$$;

revoke all on function public.profile_is_active(uuid) from public;
grant execute on function public.profile_is_active(uuid) to authenticated, service_role;

create or replace function public.is_platform_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.profile_is_active(p_user_id)
    and exists (
      select 1
      from public.profiles p
      where p.id = p_user_id
        and p.platform_role in ('admin', 'super_admin')
    );
$$;

create or replace function public.is_space_manager(
  p_space_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.profile_is_active(p_user_id)
    and (
      public.is_platform_admin(p_user_id)
      or exists (
        select 1
        from public.space_members sm
        where sm.space_id = p_space_id
          and sm.user_id = p_user_id
          and sm.role in ('manager', 'owner')
      )
    );
$$;

create or replace function public.friend_profile_is_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.profile_is_active(p_user_id);
$$;

revoke all on function public.friend_profile_is_active(uuid) from public;
grant execute on function public.friend_profile_is_active(uuid) to authenticated, service_role;
