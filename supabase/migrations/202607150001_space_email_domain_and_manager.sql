alter table public.spaces
  add column if not exists allowed_email_domain text;

alter table public.spaces drop constraint if exists spaces_allowed_email_domain_format;
alter table public.spaces add constraint spaces_allowed_email_domain_format
  check (
    allowed_email_domain is null
    or allowed_email_domain ~ '^@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  );

create or replace function public.join_space_by_code(p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.spaces;
  requester_email text;
begin
  if auth.uid() is null then raise exception using message = 'authentication_required', errcode = 'P0001'; end if;
  select * into target from public.spaces
  where join_code = upper(trim(p_join_code))
  for update;
  if target.id is null then raise exception using message = 'space_not_found', errcode = 'P0001'; end if;
  if target.status <> 'active' then raise exception using message = 'space_inactive', errcode = 'P0001'; end if;
  if not target.join_enabled then raise exception using message = 'space_join_disabled', errcode = 'P0001'; end if;

  if target.allowed_email_domain is not null then
    select lower(email) into requester_email from auth.users where id = auth.uid();
    if requester_email is null
      or split_part(requester_email, '@', 2) <> substring(target.allowed_email_domain from 2) then
      raise exception using message = 'space_email_domain_required', errcode = 'P0001';
    end if;
  end if;

  insert into public.space_members(space_id, user_id, role, joined_at)
  values (target.id, auth.uid(), 'member', now())
  on conflict (space_id, user_id) do nothing;
  return jsonb_build_object('id', target.id, 'slug', target.slug, 'name', target.name, 'role', (
    select role from public.space_members where space_id = target.id and user_id = auth.uid()
  ));
end;
$$;

revoke all on function public.join_space_by_code(text) from public;
grant execute on function public.join_space_by_code(text) to authenticated;

comment on column public.spaces.allowed_email_domain is '가입 코드와 관리자 생성에 적용되는 소문자 기관 이메일 도메인(@example.org)';
