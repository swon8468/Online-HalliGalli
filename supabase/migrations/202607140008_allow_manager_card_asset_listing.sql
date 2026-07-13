drop policy if exists "card managers read assets" on storage.objects;
create policy "card managers read assets"
on storage.objects for select to authenticated
using (
  bucket_id = 'card-assets'
  and storage.objects.name ~ '^[0-9a-f-]{36}/'
  and exists (
    select 1
    from public.card_sets cs
    where cs.id = split_part(storage.objects.name, '/', 1)::uuid
      and (
        (cs.space_id is not null and public.is_space_manager(cs.space_id))
        or (cs.space_id is null and public.is_platform_admin())
      )
  )
);
