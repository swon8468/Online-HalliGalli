create or replace function public.is_game_member(p_game_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.game_players
    where game_id = p_game_id and user_id = p_user_id
  );
$$;

drop policy if exists "game players visible to game members" on public.game_players;
create policy "game players visible to game members" on public.game_players for select to authenticated
  using (public.is_game_member(game_id));

drop policy if exists "game events visible to game members" on public.game_events;
create policy "game events visible to game members" on public.game_events for select to authenticated
  using (public.is_game_member(game_id));

grant execute on function public.is_game_member(uuid, uuid) to authenticated;
