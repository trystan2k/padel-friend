-- Forward-only correction: keep validation and both classification entry points consistent.
-- CREATE OR REPLACE preserves the existing internal-only EXECUTE permissions.
create or replace function public.validate_match_result_sets(p_sets jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_row jsonb;
  v_index integer;
  v_side text;
  v_score jsonb;
  v_a integer;
  v_b integer;
  v_high integer;
  v_low integer;
  v_completed boolean;
  v_previous_completed boolean := true;
  v_terminal boolean;
  v_reason text := 'INVALID_SETS';
begin
  <<validation>>
  begin
    if jsonb_typeof(p_sets) is distinct from 'array' then exit validation; end if;
    if jsonb_array_length(p_sets) not between 1 and 3 then exit validation; end if;
    for v_row, v_index in
      select value, ordinality::integer from jsonb_array_elements(p_sets) with ordinality
    loop
      v_reason := 'INVALID_SET';
      v_side := null;
      if jsonb_typeof(v_row) is distinct from 'object' then exit validation; end if;
      if not (v_row ?& array['position', 'team_a_games', 'team_b_games', 'completed'])
        or (v_row - array['position', 'team_a_games', 'team_b_games', 'completed']) <> '{}'::jsonb
      then exit validation; end if;
      v_reason := 'INVALID_SET_POSITION';
      if jsonb_typeof(v_row->'position') is distinct from 'number'
        or v_row->'position' <> to_jsonb(v_index)
      then exit validation; end if;
      v_reason := 'INVALID_SET';
      if jsonb_typeof(v_row->'completed') is distinct from 'boolean' then exit validation; end if;
      v_reason := 'INVALID_SET_SCORE';
      foreach v_side in array array['team_a', 'team_b'] loop
        v_score := v_row->(v_side || '_games');
        if jsonb_typeof(v_score) is distinct from 'number' then exit validation; end if;
        if (v_score #>> '{}')::numeric < 0 or (v_score #>> '{}')::numeric > 7
          or trunc((v_score #>> '{}')::numeric) <> (v_score #>> '{}')::numeric
        then exit validation; end if;
      end loop;
      v_side := null;
      v_reason := 'NON_SEQUENTIAL_SETS';
      if not v_previous_completed then exit validation; end if;
      v_a := (v_row->>'team_a_games')::numeric::integer;
      v_b := (v_row->>'team_b_games')::numeric::integer;
      v_completed := (v_row->>'completed')::boolean;
      v_high := greatest(v_a, v_b);
      v_low := least(v_a, v_b);
      v_terminal := (v_high = 6 and v_low <= 4) or (v_high = 7 and v_low in (5, 6));
      v_reason := 'TERMINAL_SCORE_UNFINISHED';
      if v_terminal and not v_completed then exit validation; end if;
      v_reason := 'THIRD_SET_AFTER_DECIDED';
      if v_index = 3 and v_completed and
        ((v_result->0->>'team_a_games')::integer > (v_result->0->>'team_b_games')::integer) =
        ((v_result->1->>'team_a_games')::integer > (v_result->1->>'team_b_games')::integer)
      then exit validation; end if;
      v_reason := 'INVALID_SET_SCORE';
      if (v_completed and not v_terminal) or (v_high = 7 and not v_terminal) then
        v_side := case when v_a >= v_b then 'team_a' else 'team_b' end;
        exit validation;
      end if;
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'position', v_index, 'team_a_games', v_a, 'team_b_games', v_b, 'completed', v_completed
      ));
      v_previous_completed := v_completed;
    end loop;
    v_reason := null;
  end validation;
  if v_reason is not null then
    raise exception using message = 'MATCH_RESULT_' || v_reason,
      detail = jsonb_build_object('set_index', v_index, 'side', v_side, 'reason_token', v_reason)::text;
  end if;
  return v_result;
end;
$$;
