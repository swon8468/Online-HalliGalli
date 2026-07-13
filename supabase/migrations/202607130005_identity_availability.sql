create table public.identity_registry (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_hash text unique,
  phone_hash text unique,
  updated_at timestamptz not null default now(),
  check (email_hash is not null or phone_hash is not null)
);

alter table public.identity_registry enable row level security;
revoke all on table public.identity_registry from anon, authenticated;

create or replace function public.sync_identity_registry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.identity_registry(user_id, email_hash, phone_hash, updated_at)
  values (
    new.id,
    case when new.email is null then null else encode(extensions.digest(lower(trim(new.email)), 'sha256'), 'hex') end,
    case when new.phone is null then null else encode(extensions.digest(regexp_replace(new.phone, '[^0-9]', '', 'g'), 'sha256'), 'hex') end,
    now()
  )
  on conflict (user_id) do update set
    email_hash = excluded.email_hash,
    phone_hash = excluded.phone_hash,
    updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_identity_changed
  after insert or update of email, phone on auth.users
  for each row execute procedure public.sync_identity_registry();

insert into public.identity_registry(user_id, email_hash, phone_hash)
select
  id,
  case when email is null then null else encode(extensions.digest(lower(trim(email)), 'sha256'), 'hex') end,
  case when phone is null then null else encode(extensions.digest(regexp_replace(phone, '[^0-9]', '', 'g'), 'sha256'), 'hex') end
from auth.users
where email is not null or phone is not null
on conflict (user_id) do update set email_hash = excluded.email_hash, phone_hash = excluded.phone_hash, updated_at = now();

create table public.identifier_check_limits (
  fingerprint_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts smallint not null default 1
);

alter table public.identifier_check_limits enable row level security;
revoke all on table public.identifier_check_limits from anon, authenticated;

create or replace function public.consume_identifier_check(p_fingerprint_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_attempts smallint;
begin
  insert into public.identifier_check_limits(fingerprint_hash, window_started_at, attempts)
  values (p_fingerprint_hash, now(), 1)
  on conflict (fingerprint_hash) do update set
    window_started_at = case
      when public.identifier_check_limits.window_started_at < now() - interval '1 minute' then now()
      else public.identifier_check_limits.window_started_at
    end,
    attempts = case
      when public.identifier_check_limits.window_started_at < now() - interval '1 minute' then 1
      else public.identifier_check_limits.attempts + 1
    end
  returning attempts into current_attempts;
  return current_attempts <= 10;
end;
$$;

revoke all on function public.consume_identifier_check(text) from public, anon, authenticated;
grant execute on function public.consume_identifier_check(text) to service_role;

comment on table public.identity_registry is 'SHA-256 identity hashes used only for rate-limited pre-signup availability checks';
