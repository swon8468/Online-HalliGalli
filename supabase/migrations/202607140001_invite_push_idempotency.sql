-- A pending invite may be submitted to the push Edge Function more than once
-- by retries or rapid clicks. Claim delivery once at the database boundary so
-- concurrent requests cannot send duplicate notifications.

alter table public.game_invites
  add column if not exists push_sent_at timestamptz;

create index if not exists game_invites_push_delivery_idx
  on public.game_invites(id, sender_id)
  where status = 'pending' and push_sent_at is null;
