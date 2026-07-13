alter table public.moderation_actions drop constraint if exists moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check
  check (action in (
    'bootstrap_super_admin', 'warn', 'suspend', 'unsuspend', 'soft_delete', 'close_room',
    'suspend_space', 'restore_space', 'role_change', 'create_admin', 'create_space',
    'update_space', 'archive_space', 'add_space_member', 'remove_space_member',
    'change_space_role', 'bulk_create_space_members', 'maintenance_cleanup'
  ));

create or replace function public.get_release_maintenance_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception using message = 'platform_admin_required', errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'safeCleanup', jsonb_build_object(
      'staleWaitingQueue', (select count(*) from public.matchmaking_queue where status = 'waiting' and heartbeat_at < now() - interval '30 seconds'),
      'finishedMatchedQueue', (select count(*) from public.matchmaking_queue q where q.status = 'matched' and q.updated_at < now() - interval '1 day' and (q.matched_game_id is null or exists (select 1 from public.games g where g.id = q.matched_game_id and g.finished_at is not null))),
      'expiredPendingInvites', (select count(*) from public.game_invites where status = 'pending' and expires_at <= now()),
      'expiredIdentifierLimits', (select count(*) from public.identifier_check_limits where window_started_at < now() - interval '1 day')
    ),
    'reviewOnly', jsonb_build_object(
      'pushSubscriptionsOlderThan180Days', (select count(*) from public.push_subscriptions where created_at < now() - interval '180 days'),
      'finishedGamesOlderThan90Days', (select count(*) from public.games where finished_at < now() - interval '90 days'),
      'closedRoomsOlderThan90Days', (select count(*) from public.rooms where status in ('closed', 'finished') and updated_at < now() - interval '90 days'),
      'softDeletedProfiles', (select count(*) from public.profiles where deleted_at is not null),
      'orphanCardAssets', (select count(*) from storage.objects object where object.bucket_id = 'card-assets' and (object.name !~ '^[0-9a-f-]{36}/' or not exists (select 1 from public.card_sets card_set where card_set.id::text = split_part(object.name, '/', 1))))
    ),
    'policy', jsonb_build_object(
      'safeCleanupDeletesHistory', false,
      'reviewOnlyRequiresManualApproval', true,
      'generatedAt', now()
    )
  ) into result;
  return result;
end;
$$;

create or replace function public.run_release_maintenance(p_execute boolean default false, p_confirmation text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  preview jsonb;
  waiting_count integer := 0;
  matched_count integer := 0;
  invite_count integer := 0;
  limit_count integer := 0;
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception using message = 'platform_admin_required', errcode = 'P0001';
  end if;
  preview := public.get_release_maintenance_preview();
  if not p_execute then return preview || jsonb_build_object('executed', false); end if;
  if p_confirmation is distinct from 'RELEASE_MAINTENANCE' then
    raise exception using message = 'maintenance_confirmation_required', errcode = 'P0001';
  end if;

  delete from public.matchmaking_queue where status = 'waiting' and heartbeat_at < now() - interval '30 seconds';
  get diagnostics waiting_count = row_count;
  delete from public.matchmaking_queue q where q.status = 'matched' and q.updated_at < now() - interval '1 day'
    and (q.matched_game_id is null or exists (select 1 from public.games g where g.id = q.matched_game_id and g.finished_at is not null));
  get diagnostics matched_count = row_count;
  update public.game_invites set status = 'cancelled', updated_at = now() where status = 'pending' and expires_at <= now();
  get diagnostics invite_count = row_count;
  delete from public.identifier_check_limits where window_started_at < now() - interval '1 day';
  get diagnostics limit_count = row_count;

  result := jsonb_build_object(
    'executed', true,
    'staleWaitingQueue', waiting_count,
    'finishedMatchedQueue', matched_count,
    'expiredPendingInvites', invite_count,
    'expiredIdentifierLimits', limit_count
  );
  insert into public.moderation_actions(actor_id, action, reason, metadata)
  values (actor, 'maintenance_cleanup', '릴리스 유지보수 안전 정리', result || jsonb_build_object('preview', preview));
  return result;
end;
$$;

revoke all on function public.get_release_maintenance_preview() from public, anon;
revoke all on function public.run_release_maintenance(boolean, text) from public, anon;
grant execute on function public.get_release_maintenance_preview() to authenticated;
grant execute on function public.run_release_maintenance(boolean, text) to authenticated;

comment on function public.run_release_maintenance(boolean, text) is
  'Dry-run by default. Explicit execution only removes transient rows; historical games, rooms, profiles, push subscriptions, and card assets remain review-only.';
