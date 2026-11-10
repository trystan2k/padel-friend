import { fixtureSql } from './match-registration-sql';

export type TriggerRef = { table: string; trigger: string };

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Builds one DO block (a single statement, so a single transaction) that locks the tables in
 * SHARE ROW EXCLUSIVE (the level ALTER TABLE ... TRIGGER takes itself, so concurrent trigger DDL
 * serializes before capture while row-lock holders on the table are not blocked),
 * captures each trigger's `tgenabled`, refuses missing triggers, disables them, runs `work`,
 * then restores every trigger to its captured O/A/R/D state. Any failure rolls the whole block
 * back, which also rolls the trigger DDL back. `work` is PL/pgSQL statement text.
 */
export function triggerStatePreservingSql(
  triggers: readonly TriggerRef[],
  work: string | readonly string[]
): string {
  const unique = new Map<string, TriggerRef>();
  for (const ref of triggers) {
    if (!IDENTIFIER.test(ref.table) || !IDENTIFIER.test(ref.trigger))
      throw new Error(`Invalid trigger reference: ${ref.table}.${ref.trigger}`);
    unique.set(`${ref.table}.${ref.trigger}`, ref);
  }
  if (unique.size === 0) throw new Error('At least one trigger is required');
  const refs = [...unique.values()];
  const tables = [...new Set(refs.map((ref) => ref.table))].sort();
  const predicates = refs
    .map((ref) => `(c.relname = '${ref.table}' and t.tgname = '${ref.trigger}')`)
    .join(' or ');
  const body = typeof work === 'string' ? work : work.join('\n');
  return `do $paf_trigger_ddl$
declare
  v_states jsonb;
  v_state record;
begin
  ${tables.map((table) => `lock table public.${table} in share row exclusive mode;`).join('\n  ')}
  select coalesce(jsonb_agg(jsonb_build_object('t', c.relname, 'g', t.tgname, 'e', t.tgenabled::text)), '[]'::jsonb)
    into v_states
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal and (${predicates});
  if jsonb_array_length(v_states) <> ${refs.length} then
    raise exception 'Refusing trigger DDL because expected triggers are missing: expected %, found %', ${refs.length}, jsonb_array_length(v_states);
  end if;
  for v_state in select * from jsonb_to_recordset(v_states) as x(t text, g text, e text) loop
    execute format('alter table public.%I disable trigger %I', v_state.t, v_state.g);
  end loop;

  ${body}

  for v_state in select * from jsonb_to_recordset(v_states) as x(t text, g text, e text) loop
    execute format(case v_state.e
      when 'O' then 'alter table public.%I enable trigger %I'
      when 'A' then 'alter table public.%I enable always trigger %I'
      when 'R' then 'alter table public.%I enable replica trigger %I'
      else 'alter table public.%I disable trigger %I' end, v_state.t, v_state.g);
  end loop;
end
$paf_trigger_ddl$;`;
}

/** Runs `work` with the named triggers disabled in one transaction, restoring their exact prior state. */
export async function withTriggersDisabled(
  triggers: readonly TriggerRef[],
  work: string | readonly string[]
): Promise<void> {
  await fixtureSql(triggerStatePreservingSql(triggers, work));
}

export const matchEventImmutable: TriggerRef = {
  table: 'match_events',
  trigger: 'match_event_immutable'
};
export const matchEventLeagueBinding: TriggerRef = {
  table: 'match_events',
  trigger: 'match_event_league_binding'
};
export const communityMemberGuard: TriggerRef = {
  table: 'community_members',
  trigger: 'community_member_guard'
};
