do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'rooms',
    'room_members',
    'matchmaking_queue',
    'games',
    'game_players',
    'game_events',
    'friend_requests',
    'friendships',
    'friend_blocks',
    'game_invites'
  ]
  loop
    execute format(
      'drop policy if exists "active accounts read realtime data" on public.%I',
      table_name
    );
    execute format(
      'create policy "active accounts read realtime data" on public.%I as restrictive for select to authenticated using (public.profile_is_active(auth.uid()))',
      table_name
    );
  end loop;
end
$$;
