-- Keep account deactivation consistent across the profile and social/queue data.
-- The Edge Function bans Auth first and calls this service-role-only transaction;
-- if this transaction fails, it can safely compensate by removing the Auth ban.

create or replace function public.finalize_account_deletion(
  p_user_id uuid,
  p_deleted_tag text,
  p_deleted_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_deleted_tag !~ '^deleted#[0-9a-f]{8}$' then
    raise exception using message = 'invalid_account_deletion_input', errcode = 'P0001';
  end if;

  update public.profiles
  set nickname = '탈퇴한 사용자',
      friend_tag = p_deleted_tag,
      deleted_at = p_deleted_at,
      suspension_reason = '사용자 직접 탈퇴',
      updated_at = p_deleted_at
  where id = p_user_id;
  if not found then
    raise exception using message = 'account_profile_not_found', errcode = 'P0001';
  end if;

  delete from public.matchmaking_queue where user_id = p_user_id;

  update public.game_invites
  set status = 'cancelled', updated_at = p_deleted_at
  where status = 'pending' and (sender_id = p_user_id or receiver_id = p_user_id);

  update public.friend_requests
  set status = 'cancelled', updated_at = p_deleted_at
  where status = 'pending' and (sender_id = p_user_id or receiver_id = p_user_id);

  delete from public.friendships where user_low = p_user_id or user_high = p_user_id;
end;
$$;

revoke all on function public.finalize_account_deletion(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_account_deletion(uuid, text, timestamptz) to service_role;

comment on function public.finalize_account_deletion(uuid, text, timestamptz) is
  'Atomically anonymizes a profile and removes active matchmaking, invites, and friendships. Service role only.';
