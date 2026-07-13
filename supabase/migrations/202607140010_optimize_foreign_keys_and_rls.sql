-- Cover every foreign key used by cascades, relationship cleanup, and common
-- administrative filters. PostgreSQL does not create these indexes
-- automatically for referencing columns.
create index if not exists card_set_versions_published_by_idx on public.card_set_versions(published_by);
create index if not exists card_sets_created_by_idx on public.card_sets(created_by);
create index if not exists card_sets_space_id_idx on public.card_sets(space_id);
create index if not exists game_cards_holder_id_idx on public.game_cards(holder_id);
create index if not exists game_events_user_id_idx on public.game_events(user_id);
create index if not exists game_invites_room_id_idx on public.game_invites(room_id);
create index if not exists game_players_user_id_idx on public.game_players(user_id);
create index if not exists games_card_set_id_idx on public.games(card_set_id);
create index if not exists games_current_turn_idx on public.games(current_turn);
create index if not exists matchmaking_queue_matched_game_id_idx on public.matchmaking_queue(matched_game_id);
create index if not exists matchmaking_queue_matched_room_id_idx on public.matchmaking_queue(matched_room_id);
create index if not exists moderation_actions_actor_id_idx on public.moderation_actions(actor_id);
create index if not exists moderation_actions_target_room_id_idx on public.moderation_actions(target_room_id);
create index if not exists moderation_actions_target_space_id_idx on public.moderation_actions(target_space_id);
create index if not exists moderation_actions_target_user_id_idx on public.moderation_actions(target_user_id);
create index if not exists platform_bootstrap_consumed_by_idx on public.platform_bootstrap(consumed_by);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
create index if not exists rooms_card_set_id_idx on public.rooms(card_set_id);
create index if not exists rooms_host_id_idx on public.rooms(host_id);
create index if not exists rooms_space_id_idx on public.rooms(space_id);
create index if not exists space_members_invited_by_idx on public.space_members(invited_by);
create index if not exists space_members_user_id_idx on public.space_members(user_id);
create index if not exists spaces_created_by_idx on public.spaces(created_by);

-- Wrap auth.uid() in a scalar subquery so PostgreSQL evaluates it once per
-- statement instead of once for every candidate row.
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists "users read own queue row" on public.matchmaking_queue;
create policy "users read own queue row"
on public.matchmaking_queue for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "users manage own queue row" on public.matchmaking_queue;
create policy "users manage own queue row"
on public.matchmaking_queue for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "members read their games" on public.games;
create policy "members read their games"
on public.games for select to authenticated
using (exists (
  select 1
  from public.room_members m
  where m.room_id = games.room_id
    and m.user_id = (select auth.uid())
));

drop policy if exists "users read related friend requests" on public.friend_requests;
create policy "users read related friend requests"
on public.friend_requests for select to authenticated
using ((select auth.uid()) in (sender_id, receiver_id));

drop policy if exists "users read own friendships" on public.friendships;
create policy "users read own friendships"
on public.friendships for select to authenticated
using ((select auth.uid()) in (user_low, user_high));

drop policy if exists "users read related invites" on public.game_invites;
create policy "users read related invites"
on public.game_invites for select to authenticated
using ((select auth.uid()) in (sender_id, receiver_id));

drop policy if exists "users manage own push subscriptions" on public.push_subscriptions;
create policy "users manage own push subscriptions"
on public.push_subscriptions for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "users read own blocks" on public.friend_blocks;
create policy "users read own blocks"
on public.friend_blocks for select to authenticated
using (blocker_id = (select auth.uid()));

drop policy if exists "space managers read scoped games" on public.games;
create policy "space managers read scoped games"
on public.games for select to authenticated
using (
  exists (
    select 1
    from public.room_members m
    where m.room_id = games.room_id
      and m.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.rooms r
    where r.id = games.room_id
      and r.space_id is not null
      and public.is_space_manager(r.space_id, (select auth.uid()))
  )
);

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
      'create policy "active accounts read realtime data" on public.%I as restrictive for select to authenticated using (public.profile_is_active((select auth.uid())))',
      table_name
    );
  end loop;
end
$$;
