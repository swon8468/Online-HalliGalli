create or replace function public.claim_game_invite_push(
  p_invite_id uuid,
  p_sender_id uuid,
  p_sent_at timestamptz
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update public.game_invites gi
    set push_sent_at = p_sent_at,
        updated_at = p_sent_at
    where gi.id = p_invite_id
      and gi.sender_id = p_sender_id
      and gi.status = 'pending'
      and gi.expires_at > p_sent_at
      and gi.push_sent_at is null
      and public.profile_is_active(p_sender_id)
      and public.profile_is_active(gi.receiver_id)
    returning gi.id, gi.sender_id, gi.receiver_id, gi.room_id,
      gi.status, gi.expires_at, gi.push_sent_at
  )
  select to_jsonb(claimed)
  from claimed;
$$;

revoke all on function public.claim_game_invite_push(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_game_invite_push(uuid, uuid, timestamptz) to service_role;
