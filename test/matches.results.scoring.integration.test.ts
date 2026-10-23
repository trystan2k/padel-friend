import { describe, expect, it } from 'vitest';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import { scoringCases } from './helpers/match-result-scoring-cases';
import { fixtureSql, sqlRows } from './helpers/match-registration-sql';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

describe('SQL match result scoring parity', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'matches every shared decision, normalized row, and structured rejection',
    async () => {
      const input = JSON.stringify(scoringCases).replaceAll("'", "''");
      await expect(
        fixtureSql(`do $$
      declare
        v_case jsonb;
        v_classify boolean;
        v_actual jsonb;
        v_expected jsonb;
        v_detail text;
      begin
        for v_case in select value from jsonb_array_elements('${input}'::jsonb) loop
          foreach v_classify in array array[false, true] loop
            begin
              if v_classify then
                v_actual := jsonb_build_object('classification', public.classify_match_result_sets(v_case->'sets'));
              else
                v_actual := jsonb_build_object('sets', public.validate_match_result_sets(v_case->'sets'));
              end if;
            exception when others then
              get stacked diagnostics v_detail = pg_exception_detail;
              v_actual := jsonb_build_object('message', sqlerrm, 'detail', v_detail::jsonb);
            end;
            if v_case ? 'error' then
              v_expected := jsonb_build_object('message', 'MATCH_RESULT_' || (v_case->'error'->>'reason_token'),
                'detail', v_case->'error');
            elsif v_classify then
              v_expected := jsonb_build_object('classification', v_case->'classification');
            else
              v_expected := jsonb_build_object('sets', v_case->'sets');
            end if;
            if v_actual is distinct from v_expected then
              raise exception 'Parity failed: %, classifier=%, expected %, got %',
                v_case->>'name', v_classify, v_expected, v_actual;
            end if;
          end loop;
        end loop;
      end; $$;`)
      ).resolves.toBeUndefined();
    }
  );

  it.skipIf(!environment.env)('keeps both pure invoker functions internal', async () => {
    const rows = await sqlRows(`select p.proname, p.prosecdef, p.provolatile,
      has_function_privilege('anon', p.oid, 'execute') as anon_execute,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
      exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('validate_match_result_sets', 'classify_match_result_sets')`);
    expect(rows).toHaveLength(2);
    for (const row of rows)
      expect(row).toMatchObject({
        prosecdef: false,
        provolatile: 'i',
        anon_execute: false,
        authenticated_execute: false,
        public_execute: false
      });
  });
});
