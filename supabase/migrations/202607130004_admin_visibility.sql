create policy "platform admins read every room" on public.rooms
for select to authenticated using (public.is_platform_admin());

create policy "platform admins read every room member" on public.room_members
for select to authenticated using (public.is_platform_admin());

create policy "platform admins read every game" on public.games
for select to authenticated using (public.is_platform_admin());

create policy "platform admins read every game player" on public.game_players
for select to authenticated using (public.is_platform_admin());

create policy "platform admins read every game event" on public.game_events
for select to authenticated using (public.is_platform_admin());
