import { describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './local-supabase-env';
import { executeTrustedSql, queryTrustedSql } from './sql-transport';
import {
  triggerStatePreservingSql,
  withTriggersDisabled,
  type TriggerRef
} from './trigger-state-sql';

const environment = localSupabaseEnv();

const stateSql = (table: string, trigger: string) => `select t.tgenabled::text as state
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = '${table}' and t.tgname = '${trigger}'`;

async function stateOf(table: string, trigger: string) {
  const state = (await queryTrustedSql(stateSql(table, trigger))).rows[0]?.['state'];
  if (typeof state !== 'string') throw new Error(`${table}.${trigger} not found`);
  return state;
}

const alterSql: Record<string, string> = {
  O: 'enable trigger',
  A: 'enable always trigger',
  R: 'enable replica trigger',
  D: 'disable trigger'
};

const assertDisabledSql = (table: string, trigger: string) => `
  if (${stateSql(table, trigger)}) <> 'D' then raise exception 'trigger not disabled during work'; end if;`;

/**
 * Test-owned scratch table with a dummy trigger in a known `tgenabled` state. The helper under test
 * only ever touches these objects, so no production guard is ever altered, even on interruption.
 */
type Scratch = TriggerRef & { drop: () => Promise<void> };

let scratchCounter = 0;

async function createScratch(
  state: string,
  options: { deferredUnique?: boolean } = {}
): Promise<Scratch> {
  scratchCounter += 1;
  const suffix = `${process.pid}_${scratchCounter}_${crypto.randomUUID().slice(0, 8).replaceAll('-', '')}`;
  const table = `paf_trg_scratch_${suffix}`;
  const trigger = `paf_trg_scratch_trg_${suffix}`;
  const fn = `paf_trg_scratch_fn_${suffix}`;
  const drop = async () => {
    await executeTrustedSql(`drop table if exists public.${table}`);
    await executeTrustedSql(`drop function if exists public.${fn}()`);
  };
  try {
    await executeTrustedSql(
      `create function public.${fn}() returns trigger language plpgsql as $$ begin return new; end $$`
    );
    const constraint = options.deferredUnique
      ? `, constraint ${table}_id_key unique (id) deferrable initially deferred`
      : '';
    await executeTrustedSql(`create table public.${table} (id int${constraint})`);
    await executeTrustedSql(
      `create trigger ${trigger} before insert on public.${table} for each row execute function public.${fn}()`
    );
    await executeTrustedSql(`alter table public.${table} ${alterSql[state]} ${trigger}`);
  } catch (error) {
    await drop();
    throw error;
  }
  return { table, trigger, drop };
}

async function stateOfScratch(scratch: TriggerRef) {
  return stateOf(scratch.table, scratch.trigger);
}

async function withScratches<T>(
  states: readonly string[],
  run: (scratches: Scratch[]) => Promise<T>,
  options: { deferredUnique?: boolean } = {}
): Promise<T> {
  const created: Scratch[] = [];
  try {
    for (const state of states) created.push(await createScratch(state, options));
    return await run(created);
  } finally {
    for (const scratch of created) await scratch.drop();
  }
}

describe.skipIf(environment.env === null)('trigger state preserving DDL helper', () => {
  for (const original of ['O', 'A', 'R', 'D']) {
    it(`restores a ${original} trigger exactly after disabling it for the work`, async () => {
      await withScratches([original], async ([scratch]) => {
        expect(await stateOfScratch(scratch!)).toBe(original);
        await withTriggersDisabled([scratch!], assertDisabledSql(scratch!.table, scratch!.trigger));
        expect(await stateOfScratch(scratch!)).toBe(original);
      });
    });
  }

  it('restores each trigger of a multi-trigger call to its own original state', async () => {
    await withScratches(['A', 'R'], async ([first, second]) => {
      await withTriggersDisabled(
        [first!, second!, second!],
        [
          assertDisabledSql(first!.table, first!.trigger),
          assertDisabledSql(second!.table, second!.trigger)
        ]
      );
      expect(await stateOfScratch(first!)).toBe('A');
      expect(await stateOfScratch(second!)).toBe('R');
    });
  });

  for (const original of ['O', 'A', 'R', 'D']) {
    it(`rolls back the disable and leaves the ${original} state when the work fails`, async () => {
      await withScratches([original], async ([scratch]) => {
        await expect(withTriggersDisabled([scratch!], 'perform 1 / 0;')).rejects.toThrow(
          /division by zero/
        );
        expect(await stateOfScratch(scratch!)).toBe(original);
      });
    });
  }

  it('rolls back and restores the original state when a deferred constraint blocks the restore', async () => {
    await withScratches(
      ['R'],
      async ([scratch]) => {
        await expect(
          withTriggersDisabled(
            [scratch!],
            `insert into public.${scratch!.table} (id) values (1), (1);`
          )
        ).rejects.toThrow(/pending trigger events/);
        expect(await stateOfScratch(scratch!)).toBe('R');
      },
      { deferredUnique: true }
    );
  });

  it('rejects a missing trigger without changing any other trigger', async () => {
    await withScratches(['R'], async ([scratch]) => {
      await expect(
        withTriggersDisabled(
          [scratch!, { table: scratch!.table, trigger: 'no_such_trigger' }],
          'perform 1;'
        )
      ).rejects.toThrow(/expected triggers are missing: expected 2, found 1/);
      expect(await stateOfScratch(scratch!)).toBe('R');
    });
  });
});

describe('triggerStatePreservingSql input validation', () => {
  it('rejects unsafe identifiers and empty trigger lists', () => {
    expect(() =>
      triggerStatePreservingSql([{ table: 'x; drop table y', trigger: 't' }], 'perform 1;')
    ).toThrow(/Invalid trigger reference/);
    expect(() => triggerStatePreservingSql([], 'perform 1;')).toThrow(
      /At least one trigger is required/
    );
  });
});
