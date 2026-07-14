-- Keep one SELECT path per table. Overlapping permissive policies are ORed by
-- PostgreSQL and make every read evaluate redundant predicates.

drop policy if exists "users manage own queue row" on public.matchmaking_queue;
create policy "users insert own queue row"
on public.matchmaking_queue for insert to authenticated
with check (user_id = (select auth.uid()));
create policy "users update own queue row"
on public.matchmaking_queue for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
create policy "users delete own queue row"
on public.matchmaking_queue for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "platform admins read every room" on public.rooms;

drop policy if exists "members read their rooms" on public.room_members;
drop policy if exists "platform admins read every room member" on public.room_members;

drop policy if exists "members read their games" on public.games;
drop policy if exists "platform admins read every game" on public.games;

drop policy if exists "game players visible to game members" on public.game_players;
drop policy if exists "platform admins read every game player" on public.game_players;
create policy "authorized users read game players"
on public.game_players for select to authenticated
using (public.is_game_member(game_id) or public.is_platform_admin());

drop policy if exists "game events visible to game members" on public.game_events;
drop policy if exists "platform admins read every game event" on public.game_events;
create policy "authorized users read game events"
on public.game_events for select to authenticated
using (public.is_game_member(game_id) or public.is_platform_admin());

drop policy if exists "managers manage card sets" on public.card_sets;
create policy "managers insert card sets"
on public.card_sets for insert to authenticated
with check (
  (space_id is not null and public.is_space_manager(space_id))
  or public.is_platform_admin()
);
create policy "managers update card sets"
on public.card_sets for update to authenticated
using (
  (space_id is not null and public.is_space_manager(space_id))
  or public.is_platform_admin()
)
with check (
  (space_id is not null and public.is_space_manager(space_id))
  or public.is_platform_admin()
);
create policy "managers delete card sets"
on public.card_sets for delete to authenticated
using (
  (space_id is not null and public.is_space_manager(space_id))
  or public.is_platform_admin()
);

drop policy if exists "managers manage card designs" on public.card_designs;
create policy "managers insert card designs"
on public.card_designs for insert to authenticated
with check (exists (
  select 1
  from public.card_sets s
  where s.id = card_designs.card_set_id
    and (
      (s.space_id is not null and public.is_space_manager(s.space_id))
      or public.is_platform_admin()
    )
));
create policy "managers update card designs"
on public.card_designs for update to authenticated
using (exists (
  select 1
  from public.card_sets s
  where s.id = card_designs.card_set_id
    and (
      (s.space_id is not null and public.is_space_manager(s.space_id))
      or public.is_platform_admin()
    )
))
with check (exists (
  select 1
  from public.card_sets s
  where s.id = card_designs.card_set_id
    and (
      (s.space_id is not null and public.is_space_manager(s.space_id))
      or public.is_platform_admin()
    )
));
create policy "managers delete card designs"
on public.card_designs for delete to authenticated
using (exists (
  select 1
  from public.card_sets s
  where s.id = card_designs.card_set_id
    and (
      (s.space_id is not null and public.is_space_manager(s.space_id))
      or public.is_platform_admin()
    )
));
