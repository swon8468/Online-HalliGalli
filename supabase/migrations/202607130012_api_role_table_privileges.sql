-- PostgreSQL privileges and RLS solve different parts of authorization.
-- The API roles need table privileges before RLS policies can be evaluated;
-- service_role additionally needs full access for trusted Edge Functions.

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- Keep later migrations portable when they add tables or identity sequences.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
