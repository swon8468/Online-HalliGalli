-- Development received 202607150002 before the JSON face-key operands were
-- parenthesized. Patch only that stored function fragment; fresh environments
-- already receive the corrected definition from 202607150002.
do $migration$
declare
  definition text;
  old_fragment constant text := 'card ->> ''fruit'' || '':'' || card ->> ''count''';
  new_fragment constant text := '(card ->> ''fruit'') || '':'' || (card ->> ''count'')';
begin
  select pg_get_functiondef('public.deal_game_card_snapshot(uuid,uuid[],jsonb)'::regprocedure)
  into definition;

  if position(old_fragment in definition) > 0 then
    execute replace(definition, old_fragment, new_fragment);
  else
    raise notice 'deal_game_card_snapshot face expression is already corrected';
  end if;
end;
$migration$;
