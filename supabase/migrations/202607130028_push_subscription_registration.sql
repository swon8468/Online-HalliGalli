create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  subscription_id uuid;
begin
  if actor is null then
    raise exception using message = 'authentication_required', errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_endpoint, ''))) not between 20 and 4096
     or length(trim(coalesce(p_p256dh, ''))) not between 20 and 512
     or length(trim(coalesce(p_auth, ''))) not between 8 and 256
     or length(coalesce(p_user_agent, '')) > 1024 then
    raise exception using message = 'invalid_push_subscription', errcode = 'P0001';
  end if;

  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth, user_agent)
  values (actor, trim(p_endpoint), trim(p_p256dh), trim(p_auth), nullif(left(p_user_agent, 1024), ''))
  on conflict (endpoint) do update
  set user_id = actor,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      created_at = now()
  returning id into subscription_id;

  return subscription_id;
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

comment on function public.register_push_subscription(text, text, text, text) is
  'Registers or safely reassigns the current browser push endpoint to auth.uid().';
