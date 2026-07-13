-- Reject machine-speed repeated game actions even when a client bypasses the UI.
-- Turn/round locks and action_id uniqueness remain the primary race-condition guards.
create or replace function public.limit_game_action_frequency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null
     and new.event_type in ('reveal', 'ring')
     and exists (
       select 1
       from public.game_events previous
       where previous.game_id = new.game_id
         and previous.user_id = new.user_id
         and previous.event_type = new.event_type
         and previous.created_at > clock_timestamp() - interval '80 milliseconds'
     ) then
    raise exception 'game_action_rate_limited' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.limit_game_action_frequency() from public, anon, authenticated;

drop trigger if exists limit_game_action_frequency_trigger on public.game_events;
create trigger limit_game_action_frequency_trigger
before insert on public.game_events
for each row execute function public.limit_game_action_frequency();

comment on function public.limit_game_action_frequency() is
  'Server-side final guard against repeated reveal/ring requests from one user.';
