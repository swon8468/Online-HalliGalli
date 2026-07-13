-- Functions are executable by PUBLIC by default in PostgreSQL. Keep the API
-- surface allowlisted through the explicit authenticated grants in prior
-- migrations, while trusted Edge Functions retain service-role access.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public
  revoke execute on functions from public;
alter default privileges in schema public
  grant execute on functions to service_role;

-- PostgREST invokes this hook before both anonymous and authenticated Data API
-- requests. It is the only SECURITY DEFINER function that anonymous requests
-- need to execute directly.
grant execute on function public.enforce_active_profile_request()
  to authenticator, anon, authenticated, service_role;

-- Public buckets serve a known object URL without a storage.objects SELECT
-- policy. Removing this policy prevents anonymous or unrelated users from
-- enumerating every custom card asset.
drop policy if exists "public read card assets" on storage.objects;
