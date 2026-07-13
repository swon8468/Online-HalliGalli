alter table public.card_sets
  alter column created_by drop not null,
  add column if not exists description text,
  add column if not exists back_asset_path text,
  add column if not exists back_design jsonb not null default '{"background":"#0878dd","accent":"#ffffff","pattern":"bell"}'::jsonb;

alter table public.card_designs
  add column if not exists label text;

create unique index if not exists card_designs_set_fruit_count_key
  on public.card_designs(card_set_id, fruit_type, fruit_count);

create table if not exists public.card_set_versions (
  id uuid primary key default gen_random_uuid(),
  card_set_id uuid not null references public.card_sets(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz not null default now(),
  unique(card_set_id, version)
);

alter table public.card_set_versions enable row level security;
create policy "authorized users read card versions"
  on public.card_set_versions for select to authenticated
  using (exists (
    select 1 from public.card_sets cs
    where cs.id = card_set_id
      and (cs.is_platform_default or cs.status = 'published' or (cs.space_id is not null and public.is_space_manager(cs.space_id)) or public.is_platform_admin())
  ));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('card-assets', 'card-assets', true, 2097152, array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read card assets" on storage.objects;
create policy "public read card assets" on storage.objects for select to public using (bucket_id = 'card-assets');
drop policy if exists "card managers upload assets" on storage.objects;
create policy "card managers upload assets" on storage.objects for insert to authenticated
with check (
  bucket_id = 'card-assets'
  and name ~ '^[0-9a-f-]{36}/'
  and exists (
    select 1 from public.card_sets cs
    where cs.id = split_part(name, '/', 1)::uuid
      and ((cs.space_id is not null and public.is_space_manager(cs.space_id)) or (cs.space_id is null and public.is_platform_admin()))
  )
);
drop policy if exists "card managers update assets" on storage.objects;
create policy "card managers update assets" on storage.objects for update to authenticated
using (
  bucket_id = 'card-assets' and name ~ '^[0-9a-f-]{36}/'
  and exists (select 1 from public.card_sets cs where cs.id = split_part(name, '/', 1)::uuid and ((cs.space_id is not null and public.is_space_manager(cs.space_id)) or (cs.space_id is null and public.is_platform_admin())))
)
with check (
  bucket_id = 'card-assets' and name ~ '^[0-9a-f-]{36}/'
  and exists (select 1 from public.card_sets cs where cs.id = split_part(name, '/', 1)::uuid and ((cs.space_id is not null and public.is_space_manager(cs.space_id)) or (cs.space_id is null and public.is_platform_admin())))
);
drop policy if exists "card managers delete assets" on storage.objects;
create policy "card managers delete assets" on storage.objects for delete to authenticated
using (
  bucket_id = 'card-assets' and name ~ '^[0-9a-f-]{36}/'
  and exists (select 1 from public.card_sets cs where cs.id = split_part(name, '/', 1)::uuid and ((cs.space_id is not null and public.is_space_manager(cs.space_id)) or (cs.space_id is null and public.is_platform_admin())))
);

do $$
declare
  default_id uuid;
  fruit text;
  amount integer;
  qty integer;
begin
  select id into default_id from public.card_sets where is_platform_default limit 1;
  if default_id is null then
    insert into public.card_sets(name, description, status, is_platform_default, version, created_by, published_at)
    values ('기본 과일 카드', '온라인 할리갈리 기본 56장 과일 카드', 'published', true, 1, null, now())
    returning id into default_id;
  end if;
  foreach fruit in array array['strawberry','banana','lime','plum'] loop
    for amount in 1..5 loop
      qty := case amount when 1 then 5 when 2 then 3 when 3 then 3 when 4 then 2 else 1 end;
      insert into public.card_designs(card_set_id, fruit_type, fruit_count, quantity, label, design, sort_order)
      values (default_id, fruit, amount, qty, initcap(fruit), jsonb_build_object('background','#ffffff','accent','#111111','render','builtin'), amount)
      on conflict (card_set_id, fruit_type, fruit_count) do nothing;
    end loop;
  end loop;
  insert into public.card_set_versions(card_set_id, version, snapshot, published_by)
  select default_id, 1, jsonb_build_object(
    'card_set', jsonb_build_object('name', cs.name, 'description', cs.description, 'back_asset_path', cs.back_asset_path, 'back_design', cs.back_design),
    'designs', (select jsonb_agg(to_jsonb(cd) - 'created_at' order by cd.fruit_type, cd.fruit_count) from public.card_designs cd where cd.card_set_id = default_id)
  ), null
  from public.card_sets cs where cs.id = default_id
  on conflict (card_set_id, version) do nothing;
end $$;

create or replace function public.can_manage_card_set(p_card_set_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.card_sets cs
    where cs.id = p_card_set_id
      and ((cs.space_id is null and public.is_platform_admin(p_user_id)) or (cs.space_id is not null and public.is_space_manager(cs.space_id, p_user_id)))
  );
$$;

create or replace function public.create_card_set(p_name text, p_description text default null, p_space_id uuid default null)
returns public.card_sets
language plpgsql security definer set search_path = public
as $$
declare
  result public.card_sets;
  template_id uuid;
begin
  if auth.uid() is null or char_length(trim(p_name)) not between 2 and 80 then raise exception using message = 'invalid_card_set', errcode = 'P0001'; end if;
  if p_space_id is null then
    if not public.is_platform_admin() then raise exception using message = 'platform_admin_required', errcode = 'P0001'; end if;
  elsif not public.is_space_manager(p_space_id) then raise exception using message = 'space_manager_required', errcode = 'P0001'; end if;
  insert into public.card_sets(space_id, name, description, status, is_platform_default, version, created_by)
  values (p_space_id, trim(p_name), nullif(trim(p_description), ''), 'draft', false, 1, auth.uid()) returning * into result;
  select id into template_id from public.card_sets where is_platform_default limit 1;
  insert into public.card_designs(card_set_id, fruit_type, fruit_count, quantity, label, front_asset_path, design, sort_order)
  select result.id, fruit_type, fruit_count, quantity, label, null, design, sort_order from public.card_designs where card_set_id = template_id;
  return result;
end;
$$;

create or replace function public.clone_card_set(p_source_id uuid, p_name text, p_space_id uuid default null)
returns public.card_sets
language plpgsql security definer set search_path = public
as $$
declare
  source public.card_sets;
  result public.card_sets;
begin
  select * into source from public.card_sets where id = p_source_id;
  if source.id is null then raise exception using message = 'card_set_not_found', errcode = 'P0001'; end if;
  if not public.can_manage_card_set(source.id) and source.status <> 'published' then raise exception using message = 'card_set_access_denied', errcode = 'P0001'; end if;
  if p_space_id is null then
    if source.space_id is null and not public.is_platform_admin() then raise exception using message = 'platform_admin_required', errcode = 'P0001'; end if;
    if source.space_id is not null and not public.is_space_manager(source.space_id) then raise exception using message = 'space_manager_required', errcode = 'P0001'; end if;
  elsif not public.is_space_manager(p_space_id) then raise exception using message = 'space_manager_required', errcode = 'P0001'; end if;
  insert into public.card_sets(space_id, name, description, status, is_platform_default, version, created_by, back_asset_path, back_design)
  values (coalesce(p_space_id, source.space_id), trim(p_name), source.description, 'draft', false, 1, auth.uid(), source.back_asset_path, source.back_design) returning * into result;
  insert into public.card_designs(card_set_id, fruit_type, fruit_count, quantity, label, front_asset_path, design, sort_order)
  select result.id, fruit_type, fruit_count, quantity, label, front_asset_path, design, sort_order from public.card_designs where card_set_id = source.id;
  return result;
end;
$$;

create or replace function public.publish_card_set(p_card_set_id uuid)
returns public.card_sets
language plpgsql security definer set search_path = public
as $$
declare
  target public.card_sets;
  next_version integer;
begin
  select * into target from public.card_sets where id = p_card_set_id for update;
  if target.id is null then raise exception using message = 'card_set_not_found', errcode = 'P0001'; end if;
  if not public.can_manage_card_set(target.id) then raise exception using message = 'card_set_access_denied', errcode = 'P0001'; end if;
  if (select count(*) from public.card_designs where card_set_id = target.id) <> 20
    or exists (select 1 from unnest(array['strawberry','banana','lime','plum']) fruit cross join generate_series(1,5) amount where not exists (select 1 from public.card_designs cd where cd.card_set_id = target.id and cd.fruit_type = fruit and cd.fruit_count = amount))
  then raise exception using message = 'incomplete_card_set', errcode = 'P0001'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.card_set_versions where card_set_id = target.id;
  if not exists (select 1 from public.card_set_versions where card_set_id = target.id) then next_version := 1; end if;
  update public.card_sets set status = 'published', version = next_version, published_at = now(), updated_at = now() where id = target.id returning * into target;
  insert into public.card_set_versions(card_set_id, version, snapshot, published_by)
  values (target.id, next_version, jsonb_build_object(
    'card_set', jsonb_build_object('name', target.name, 'description', target.description, 'back_asset_path', target.back_asset_path, 'back_design', target.back_design),
    'designs', (select jsonb_agg(to_jsonb(cd) - 'created_at' order by cd.fruit_type, cd.fruit_count) from public.card_designs cd where cd.card_set_id = target.id)
  ), auth.uid());
  return target;
end;
$$;

create or replace function public.unpublish_card_set(p_card_set_id uuid)
returns public.card_sets language plpgsql security definer set search_path = public
as $$
declare target public.card_sets;
begin
  select * into target from public.card_sets where id = p_card_set_id for update;
  if target.id is null or not public.can_manage_card_set(target.id) then raise exception using message = 'card_set_access_denied', errcode = 'P0001'; end if;
  if target.is_platform_default then raise exception using message = 'cannot_unpublish_default', errcode = 'P0001'; end if;
  update public.card_sets set status = 'draft', updated_at = now() where id = target.id returning * into target;
  return target;
end;
$$;

create or replace function public.delete_card_set(p_card_set_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare target public.card_sets;
begin
  select * into target from public.card_sets where id = p_card_set_id for update;
  if target.id is null or not public.can_manage_card_set(target.id) then raise exception using message = 'card_set_access_denied', errcode = 'P0001'; end if;
  if target.is_platform_default then raise exception using message = 'cannot_delete_default', errcode = 'P0001'; end if;
  if exists (select 1 from public.rooms where card_set_id = target.id) then raise exception using message = 'card_set_in_use', errcode = 'P0001'; end if;
  delete from public.card_sets where id = target.id;
end;
$$;

create or replace function public.set_room_card_set(p_room_id uuid, p_card_set_id uuid default null)
returns public.rooms language plpgsql security definer set search_path = public
as $$
declare target_room public.rooms; target_set public.card_sets;
begin
  select * into target_room from public.rooms where id = p_room_id for update;
  if target_room.id is null or target_room.host_id <> auth.uid() then raise exception using message = 'host_only', errcode = 'P0001'; end if;
  if target_room.status <> 'waiting' then raise exception using message = 'room_not_waiting', errcode = 'P0001'; end if;
  if p_card_set_id is not null then
    select * into target_set from public.card_sets where id = p_card_set_id and status = 'published';
    if target_set.id is null or not (target_set.is_platform_default or target_set.space_id = target_room.space_id) then raise exception using message = 'invalid_card_set', errcode = 'P0001'; end if;
  end if;
  update public.rooms set card_set_id = p_card_set_id, updated_at = now() where id = target_room.id returning * into target_room;
  return target_room;
end;
$$;

revoke all on function public.can_manage_card_set(uuid, uuid) from public;
revoke all on function public.create_card_set(text, text, uuid) from public;
revoke all on function public.clone_card_set(uuid, text, uuid) from public;
revoke all on function public.publish_card_set(uuid) from public;
revoke all on function public.unpublish_card_set(uuid) from public;
revoke all on function public.delete_card_set(uuid) from public;
revoke all on function public.set_room_card_set(uuid, uuid) from public;
grant execute on function public.can_manage_card_set(uuid, uuid) to authenticated;
grant execute on function public.create_card_set(text, text, uuid) to authenticated;
grant execute on function public.clone_card_set(uuid, text, uuid) to authenticated;
grant execute on function public.publish_card_set(uuid) to authenticated;
grant execute on function public.unpublish_card_set(uuid) to authenticated;
grant execute on function public.delete_card_set(uuid) to authenticated;
grant execute on function public.set_room_card_set(uuid, uuid) to authenticated;

create or replace function public.protect_published_card_designs()
returns trigger language plpgsql set search_path = public
as $$
declare target_id uuid := coalesce(new.card_set_id, old.card_set_id);
begin
  if current_user <> 'service_role' and exists (select 1 from public.card_sets where id = target_id and status = 'published') then
    raise exception using message = 'unpublish_before_edit', errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists protect_published_card_designs_trigger on public.card_designs;
create trigger protect_published_card_designs_trigger
before insert or update or delete on public.card_designs
for each row execute function public.protect_published_card_designs();
