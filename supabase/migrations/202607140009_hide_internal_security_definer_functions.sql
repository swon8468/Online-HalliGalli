-- These functions are implementation details used by triggers or by other
-- SECURITY DEFINER entry points. Clients should only call the validated public
-- entry points that wrap them.
revoke execute on function public.deal_game_card_snapshot(uuid, uuid[], jsonb) from authenticated;
revoke execute on function public.delete_card_set(uuid) from authenticated;
revoke execute on function public.expire_game_invites(uuid) from authenticated;
revoke execute on function public.friend_activity(uuid) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.matchmaking_status_for(uuid) from authenticated;
revoke execute on function public.refresh_game_snapshot(uuid) from authenticated;
revoke execute on function public.reset_waiting_room_readiness() from authenticated;
revoke execute on function public.sync_identity_registry() from authenticated;
