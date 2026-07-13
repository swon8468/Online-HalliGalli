-- Auth bans stop new sign-ins and refreshes, but an already issued JWT remains
-- cryptographically valid until it expires. Reject every authenticated Data API
-- request when its profile is suspended or deleted, before RPC/RLS execution.

create or replace function public.enforce_active_profile_request()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  profile public.profiles;
begin
  if auth.role() is distinct from 'authenticated' then return; end if;
  if actor is null then
    raise exception using message = 'authentication_required', errcode = '42501';
  end if;

  select * into profile from public.profiles where id = actor;
  if profile.id is null then
    raise exception using message = 'account_profile_unavailable', errcode = '42501';
  end if;
  if profile.deleted_at is not null then
    raise exception using message = 'account_deleted', errcode = '42501';
  end if;
  if profile.suspended_until is not null and profile.suspended_until > now() then
    raise exception using message = 'account_suspended', errcode = '42501';
  end if;
end;
$$;

revoke all on function public.enforce_active_profile_request() from public, anon, authenticated, service_role;
grant execute on function public.enforce_active_profile_request() to authenticator, anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.enforce_active_profile_request';
notify pgrst, 'reload config';

comment on function public.enforce_active_profile_request() is
  'PostgREST pre-request guard that rejects suspended/deleted profiles even when an older JWT is still valid.';
